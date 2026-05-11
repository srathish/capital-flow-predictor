"""Whale Conviction scorer.

The Flow tab's job is to surface moments where somebody is making a real bet —
not "here's every options anomaly" but "here's the handful of tickers right
now where the flow is loud, opening, aggressive, and corroborated by other
smart-money signals."

We re-derive `whale_conviction_signals` from the raw UW feeds every ~5min:

  for each (ticker, lookback ∈ {4h, 24h}):
    aggregate flow + dark pool over the window
    join recent insider (7d) + congress (14d) buys
    pull current IV rank + the market tide for tape alignment
    score 0..100 with a small interpretable formula
    capture the why (list of short strings) for the UI

The score is intentionally heuristic, not learned — we want users to be able
to read it and understand why a ticker is at 87. Once we have a few weeks of
forward returns we can swap in a learned ranker over the same features.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime

import psycopg
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect

log = logging.getLogger(__name__)

# Tunables. Live in code (not a config table) so dev and prod stay aligned.
WINDOWS_HOURS = (4, 24)
MIN_PREMIUM_FOR_CANDIDACY = 250_000     # ticker needs at least this $ flow in window
TAPE_DIRECTION_THRESHOLD = 50_000_000   # |net_call - net_put| above this = tape has direction


@dataclass
class Aggregate:
    ticker: str
    call_premium: float = 0.0
    put_premium: float = 0.0
    call_ask: float = 0.0
    put_ask: float = 0.0
    sweep_count: int = 0
    block_count: int = 0
    opening_prem: float = 0.0
    total_prem: float = 0.0
    vol_oi_max: float = 0.0
    short_dated_prem: float = 0.0          # < 30d expiry premium
    dark_pool_above_mid: float = 0.0
    insider_buy_7d: float = 0.0
    congress_buy_14d: int = 0
    iv_rank: float | None = None
    reasons: list[str] = field(default_factory=list)


def _money(v: float) -> str:
    if v >= 1e9:
        return f"${v/1e9:.1f}B"
    if v >= 1e6:
        return f"${v/1e6:.1f}M"
    if v >= 1e3:
        return f"${v/1e3:.0f}K"
    return f"${v:.0f}"


def _aggregate_flow(conn: psycopg.Connection, window_hours: int) -> dict[str, Aggregate]:
    """One pass over uw_flow_alerts for the window; group into per-ticker totals."""
    sql = """
        SELECT
            ticker,
            option_type,
            COALESCE(total_premium, 0)   AS prem,
            COALESCE(ask_side_prem, 0)   AS ask_prem,
            COALESCE(has_sweep, false)   AS sweep,
            COALESCE(has_floor, false)   AS block,
            COALESCE(all_opening_trades, false) AS opening,
            COALESCE(volume_oi_ratio, 0) AS voi,
            expiry
        FROM uw_flow_alerts
        WHERE created_at >= NOW() - (%s || ' hours')::interval
          AND total_premium IS NOT NULL
    """
    out: dict[str, Aggregate] = {}
    with conn.cursor() as cur:
        cur.execute(sql, (str(window_hours),))
        for ticker, opt_type, prem, ask, sweep, block, opening, voi, expiry in cur.fetchall():
            if not ticker or prem is None:
                continue
            agg = out.setdefault(ticker, Aggregate(ticker=ticker))
            agg.total_prem += float(prem)
            if opt_type == "call":
                agg.call_premium += float(prem)
                agg.call_ask += float(ask or 0)
            elif opt_type == "put":
                agg.put_premium += float(prem)
                agg.put_ask += float(ask or 0)
            if sweep:
                agg.sweep_count += 1
            if block:
                agg.block_count += 1
            if opening:
                agg.opening_prem += float(prem)
            if voi and float(voi) > agg.vol_oi_max:
                agg.vol_oi_max = float(voi)
            if expiry is not None:
                days = (expiry - datetime.now(UTC).date()).days
                if days <= 30:
                    agg.short_dated_prem += float(prem)
    return out


def _dark_pool_above_mid(conn: psycopg.Connection, window_hours: int) -> dict[str, float]:
    """Sum of $ premium of dark prints that traded above NBBO mid in the window."""
    sql = """
        SELECT ticker, SUM(premium) AS prem_above
        FROM uw_dark_pool_prints
        WHERE executed_at >= NOW() - (%s || ' hours')::interval
          AND canceled IS NOT TRUE
          AND price IS NOT NULL
          AND nbbo_ask IS NOT NULL
          AND nbbo_bid IS NOT NULL
          AND price > (nbbo_ask + nbbo_bid) / 2.0
        GROUP BY ticker
    """
    out: dict[str, float] = {}
    with conn.cursor() as cur:
        cur.execute(sql, (str(window_hours),))
        for ticker, prem in cur.fetchall():
            out[ticker] = float(prem or 0)
    return out


def _insider_buys_7d(conn: psycopg.Connection) -> dict[str, float]:
    sql = """
        SELECT ticker, SUM(ABS(amount) * COALESCE(price, 0)) AS buy_value
        FROM uw_insider_transactions
        WHERE transaction_date >= CURRENT_DATE - 7
          AND transaction_code = 'P'
          AND amount IS NOT NULL AND amount > 0
        GROUP BY ticker
    """
    out: dict[str, float] = {}
    with conn.cursor() as cur:
        cur.execute(sql)
        for ticker, v in cur.fetchall():
            out[ticker] = float(v or 0)
    return out


def _congress_buys_14d(conn: psycopg.Connection) -> dict[str, int]:
    sql = """
        SELECT ticker, COUNT(*) AS n
        FROM uw_congress_trades
        WHERE transaction_date >= CURRENT_DATE - 14
          AND ticker IS NOT NULL
          AND txn_type ILIKE 'buy%'
        GROUP BY ticker
    """
    out: dict[str, int] = {}
    with conn.cursor() as cur:
        cur.execute(sql)
        for ticker, n in cur.fetchall():
            out[ticker] = int(n or 0)
    return out


def _iv_rank(conn: psycopg.Connection) -> dict[str, float]:
    sql = """
        SELECT DISTINCT ON (ticker) ticker, iv_rank
        FROM uw_volatility_stats
        WHERE iv_rank IS NOT NULL
        ORDER BY ticker, snapshot_date DESC
    """
    out: dict[str, float] = {}
    with conn.cursor() as cur:
        cur.execute(sql)
        for ticker, ivr in cur.fetchall():
            out[ticker] = float(ivr)
    return out


def _market_tide_direction(conn: psycopg.Connection) -> str | None:
    """'bull' if today's net call premium dominates by > threshold, 'bear' if puts.
    None = no decisive tape direction."""
    sql = """
        SELECT
            SUM(COALESCE(net_call_premium, 0)) AS calls,
            SUM(COALESCE(net_put_premium, 0))  AS puts
        FROM uw_market_tide
        WHERE ts >= NOW() - INTERVAL '6 hours'
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        row = cur.fetchone()
    if not row:
        return None
    calls = float(row[0] or 0)
    puts = float(row[1] or 0)
    diff = calls - puts
    if abs(diff) < TAPE_DIRECTION_THRESHOLD:
        return None
    return "bull" if diff > 0 else "bear"


def _score_one(agg: Aggregate, tape: str | None) -> tuple[float, str, bool, list[str]]:
    """Compute (score 0..100, direction, against_tape, reasons)."""
    reasons: list[str] = []
    call_share = agg.call_premium / agg.total_prem if agg.total_prem else 0.5
    direction = "bull" if call_share >= 0.5 else "bear"
    dom_prem = agg.call_premium if direction == "bull" else agg.put_premium
    dom_ask = agg.call_ask if direction == "bull" else agg.put_ask
    ask_share = dom_ask / dom_prem if dom_prem > 0 else 0.0

    score = 0.0

    # Size: up to 30 pts. Saturates around $5M dominant-side premium.
    size_pts = min(30.0, dom_prem / 5_000_000 * 30.0)
    score += size_pts
    if dom_prem >= 1_000_000:
        reasons.append(f"{_money(dom_prem)} {direction}ish premium")

    # Ask-side aggression: up to 20 pts. ≥ 70% lifted is the signal.
    if ask_share >= 0.70:
        aa = min(20.0, (ask_share - 0.70) / 0.30 * 20.0 + 5.0)
        score += aa
        reasons.append(f"{int(ask_share*100)}% lifted at the ask")

    # Sweeps + blocks: 10 pts.
    if agg.sweep_count >= 3:
        score += 10
        reasons.append(f"{agg.sweep_count} sweeps in window")
    elif agg.sweep_count >= 1:
        score += 5
    if agg.block_count >= 1:
        score += 5
        reasons.append(f"{agg.block_count} floor block(s)")

    # Opening trades share: up to 8 pts.
    if agg.total_prem > 0:
        opening_share = agg.opening_prem / agg.total_prem
        if opening_share >= 0.5:
            score += min(8.0, opening_share * 8.0)
            reasons.append(f"{int(opening_share*100)}% opening")

    # Vol/OI explosion: 7 pts.
    if agg.vol_oi_max >= 5:
        score += 7
        reasons.append(f"{agg.vol_oi_max:.1f}× vol/OI")
    elif agg.vol_oi_max >= 2:
        score += 3

    # Short-dated urgency: 5 pts (if ≥ 40% of premium expires < 30d).
    if agg.total_prem > 0 and agg.short_dated_prem / agg.total_prem >= 0.4:
        score += 5
        reasons.append("urgency · short-dated")

    # IV regime multiplier — bold bets in cheap vol.
    if agg.iv_rank is not None:
        if agg.iv_rank <= 0.20 and direction == "bull":
            score += 8
            reasons.append(f"IV rank {int(agg.iv_rank*100)} · cheap vol")
        elif agg.iv_rank >= 0.80 and direction == "bull":
            score -= 5
            reasons.append(f"IV rank {int(agg.iv_rank*100)} · chasing rich vol")

    # Dark pool above mid: up to 8 pts.
    if agg.dark_pool_above_mid >= 5_000_000:
        score += min(8.0, agg.dark_pool_above_mid / 20_000_000 * 8.0)
        reasons.append(f"{_money(agg.dark_pool_above_mid)} dark pool above mid")

    # Insider buys: 6 pts.
    if agg.insider_buy_7d >= 100_000:
        score += min(6.0, agg.insider_buy_7d / 1_000_000 * 6.0 + 2.0)
        reasons.append(f"{_money(agg.insider_buy_7d)} insider buys (7d)")

    # Congress buys: 4 pts.
    if agg.congress_buy_14d >= 2:
        score += 4
        reasons.append(f"{agg.congress_buy_14d} Congress buys (14d)")
    elif agg.congress_buy_14d >= 1:
        score += 2

    # Tape alignment: bold = against tape.
    against_tape = False
    if tape is not None and tape != direction:
        score += 4
        against_tape = True
        reasons.append(f"against {tape}ish tape")

    return min(100.0, max(0.0, score)), direction, against_tape, reasons


def run(database_url: str) -> dict:
    """Refresh whale_conviction_signals for both windows. Returns per-window counts."""
    out: dict[str, int] = {}
    now = datetime.now(UTC)
    with connect(database_url) as conn:
        tape = _market_tide_direction(conn)
        iv_by_ticker = _iv_rank(conn)
        insider_by_ticker = _insider_buys_7d(conn)
        congress_by_ticker = _congress_buys_14d(conn)

        for window_hours in WINDOWS_HOURS:
            aggs = _aggregate_flow(conn, window_hours)
            if not aggs:
                out[f"{window_hours}h"] = 0
                continue
            dark_by_ticker = _dark_pool_above_mid(conn, window_hours)
            written = 0
            with conn.cursor() as cur:
                for ticker, agg in aggs.items():
                    if agg.total_prem < MIN_PREMIUM_FOR_CANDIDACY:
                        continue
                    agg.dark_pool_above_mid = dark_by_ticker.get(ticker, 0.0)
                    agg.insider_buy_7d = insider_by_ticker.get(ticker, 0.0)
                    agg.congress_buy_14d = congress_by_ticker.get(ticker, 0)
                    agg.iv_rank = iv_by_ticker.get(ticker)

                    score, direction, against_tape, reasons = _score_one(agg, tape)
                    if score < 25:
                        continue

                    dom_prem = agg.call_premium if direction == "bull" else agg.put_premium
                    dom_ask = agg.call_ask if direction == "bull" else agg.put_ask
                    opening_share = (
                        agg.opening_prem / agg.total_prem if agg.total_prem else None
                    )

                    cur.execute(
                        """
                        INSERT INTO whale_conviction_signals (
                            window_end, ticker, window_hours, direction, score,
                            call_premium, put_premium, ask_side_premium,
                            sweep_count, block_count, opening_share, vol_oi_max,
                            dark_pool_above_mid_prem, insider_buy_7d, congress_buy_14d,
                            iv_rank, against_tape, reasons
                        ) VALUES (
                            %s, %s, %s, %s, %s,
                            %s, %s, %s,
                            %s, %s, %s, %s,
                            %s, %s, %s,
                            %s, %s, %s
                        ) ON CONFLICT (window_end, ticker, window_hours) DO UPDATE SET
                            direction = EXCLUDED.direction,
                            score = EXCLUDED.score,
                            call_premium = EXCLUDED.call_premium,
                            put_premium = EXCLUDED.put_premium,
                            ask_side_premium = EXCLUDED.ask_side_premium,
                            sweep_count = EXCLUDED.sweep_count,
                            block_count = EXCLUDED.block_count,
                            opening_share = EXCLUDED.opening_share,
                            vol_oi_max = EXCLUDED.vol_oi_max,
                            dark_pool_above_mid_prem = EXCLUDED.dark_pool_above_mid_prem,
                            insider_buy_7d = EXCLUDED.insider_buy_7d,
                            congress_buy_14d = EXCLUDED.congress_buy_14d,
                            iv_rank = EXCLUDED.iv_rank,
                            against_tape = EXCLUDED.against_tape,
                            reasons = EXCLUDED.reasons
                        """,
                        (
                            now, ticker, window_hours, direction, score,
                            agg.call_premium, agg.put_premium, dom_ask,
                            agg.sweep_count, agg.block_count, opening_share, agg.vol_oi_max,
                            agg.dark_pool_above_mid, agg.insider_buy_7d, agg.congress_buy_14d,
                            agg.iv_rank, against_tape, Jsonb(reasons),
                        ),
                    )
                    written += 1
            out[f"{window_hours}h"] = written
        conn.commit()
    return out
