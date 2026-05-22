"""Explosive-options scorer.

Reads the tables populated by `cfp-jobs explosive-ingest` and writes a ranked
score per ticker into `explosive_scores`. The /explosive tab reads from there.

Score composition (each sub-score 0-100, weighted into composite):

  flow_concentration_score  -- ask-side OTM call clustering at one strike
  iv_term_score             -- front-month IV inversion strength
  squeeze_score             -- short interest + utilization + FTD presence
  catalyst_score            -- days-to-catalyst proximity (1-3d peaks)
  cheap_optionality_score   -- low stock price + cheap OTM weekly available
  gex_bonus_score           -- if name is in GEX coverage with short-gamma at OTM cluster

Composite weights live in WEIGHTS and are tunable forward; first ~month is
calibration since we can't backtest historical UW flow (30d API tier limit).
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect

log = logging.getLogger(__name__)


# Tunables — these get recalibrated as forward data accumulates.
# Phase 2 layers 5 confirmation signals: NOPE extremity, risk-reversal skew
# flip, IV vs RV divergence, volume-profile magnet, and insider net buying.
WEIGHTS = {
    "flow_concentration": 0.22,
    "iv_term":            0.12,
    "squeeze":            0.12,
    "catalyst":           0.20,
    "cheap_optionality":  0.12,
    "gex_bonus":          0.04,
    # Phase 2
    "iv_vs_rv":           0.05,
    "skew_flip":          0.05,
    "nope":               0.04,
    "insider_buy":        0.02,
    "volume_profile":     0.02,
}

# A name needs at least this much aggregate OTM call premium today to be considered.
MIN_OTM_CALL_PREMIUM = 100_000

# "Cheap optionality" gate — stock < this price → the cheap-options leverage applies.
CHEAP_STOCK_PRICE = 30.0

# OTM weekly call price ceiling that defines "lottery ticket" leverage.
LOTTERY_TICKET_MAX_PRICE = 0.75


@dataclass
class TickerSignals:
    ticker: str
    underlying_price: float | None = None
    # catalyst
    catalyst_type: str | None = None
    catalyst_date: date | None = None
    catalyst_label: str | None = None
    days_to_catalyst: int | None = None
    # flow concentration
    top_strike: float | None = None
    top_expiry: date | None = None
    top_option_symbol: str | None = None
    top_option_type: str | None = None
    top_last_price: float | None = None
    top_volume: int | None = None
    top_oi: int | None = None
    top_premium: float | None = None
    total_otm_call_prem: float = 0.0
    strike_concentration_pct: float = 0.0   # top strike % of total OTM call prem
    ask_side_proportion: float = 0.0        # ask_prem / total_prem at top strike
    # IV
    front_iv: float | None = None
    back_iv: float | None = None
    iv_term_inversion: float = 0.0          # (front - back) / back; positive = inverted
    # squeeze
    short_percent_float: float | None = None
    utilization: float | None = None
    recent_ftd_quantity: int | None = None
    # Phase 2: confirmation signals
    nope_value: float | None = None
    nope_z: float | None = None
    skew_now: float | None = None
    skew_30d_ago: float | None = None
    iv_30d: float | None = None
    rv_30d: float | None = None
    insider_net_buy_30d: float | None = None
    volume_profile_top_price: float | None = None
    volume_profile_top_share: float | None = None
    # rationale strings shown in UI
    reasons: dict[str, str] = field(default_factory=dict)

    # computed sub-scores
    flow_concentration_score: float = 0.0
    iv_term_score: float = 0.0
    squeeze_score: float = 0.0
    catalyst_score: float = 0.0
    cheap_optionality_score: float = 0.0
    gex_bonus_score: float = 0.0
    # Phase 2
    iv_vs_rv_score: float = 0.0
    skew_flip_score: float = 0.0
    nope_score: float = 0.0
    insider_buy_score: float = 0.0
    volume_profile_score: float = 0.0


def _money(v: float | None) -> str:
    if v is None:
        return "—"
    if v >= 1e9:
        return f"${v/1e9:.1f}B"
    if v >= 1e6:
        return f"${v/1e6:.1f}M"
    if v >= 1e3:
        return f"${v/1e3:.0f}K"
    return f"${v:.0f}"


def _pct(v: float | None) -> str:
    if v is None:
        return "—"
    return f"{v*100:.0f}%"


def _clip(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


# ---------- per-signal loaders ----------


def _load_universe(conn: psycopg.Connection, today: date) -> list[str]:
    """Tickers we'll score — union of recent contract_screener hits + catalysts."""
    horizon = today + timedelta(days=10)
    universe: set[str] = set()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ticker FROM uw_contract_screener
            WHERE snapshot_ts >= NOW() - INTERVAL '6 hours'
            """
        )
        universe.update(row[0] for row in cur.fetchall() if row[0])
        cur.execute(
            "SELECT DISTINCT ticker FROM uw_fda_calendar WHERE catalyst_date BETWEEN %s AND %s",
            (today, horizon),
        )
        universe.update(row[0] for row in cur.fetchall() if row[0])
        cur.execute(
            "SELECT DISTINCT ticker FROM uw_ipo_calendar WHERE ipo_date BETWEEN %s AND %s",
            (today, horizon),
        )
        universe.update(row[0] for row in cur.fetchall() if row[0])
        try:
            cur.execute(
                "SELECT DISTINCT ticker FROM uw_earnings WHERE report_date BETWEEN %s AND %s",
                (today, horizon),
            )
            universe.update(row[0] for row in cur.fetchall() if row[0])
        except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
            pass
    return sorted(t.upper() for t in universe if t)


def _load_catalyst(conn: psycopg.Connection, ticker: str, today: date) -> tuple[str, date, str, int] | None:
    """Closest upcoming catalyst for ticker. Returns (type, date, label, dte) or None."""
    horizon = today + timedelta(days=14)
    with conn.cursor() as cur:
        # FDA
        cur.execute(
            """
            SELECT catalyst_date, drug, catalyst FROM uw_fda_calendar
            WHERE ticker = %s AND catalyst_date BETWEEN %s AND %s
            ORDER BY catalyst_date ASC LIMIT 1
            """,
            (ticker, today, horizon),
        )
        row = cur.fetchone()
        if row:
            cdate, drug, catalyst = row
            label = f"{catalyst or 'FDA'}: {drug}" if drug else (catalyst or "FDA")
            return ("fda", cdate, label, (cdate - today).days)
        # IPO
        cur.execute(
            "SELECT ipo_date, company_name FROM uw_ipo_calendar WHERE ticker = %s AND ipo_date BETWEEN %s AND %s ORDER BY ipo_date ASC LIMIT 1",
            (ticker, today, horizon),
        )
        row = cur.fetchone()
        if row:
            ipo_date, company = row
            return ("ipo", ipo_date, f"IPO: {company or ticker}", (ipo_date - today).days)
        # Earnings (existing table)
        try:
            cur.execute(
                """
                SELECT report_date FROM uw_earnings
                WHERE ticker = %s AND report_date BETWEEN %s AND %s
                ORDER BY report_date ASC LIMIT 1
                """,
                (ticker, today, horizon),
            )
            row = cur.fetchone()
            if row:
                edate = row[0]
                return ("earnings", edate, f"Earnings {edate}", (edate - today).days)
        except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
            pass
    return None


def _load_flow_concentration(
    conn: psycopg.Connection,
    ticker: str,
    today: date,
) -> tuple[dict[str, Any] | None, float, float, float]:
    """Look at today's flow_per_strike for this ticker. Find the OTM call strike
    with the most ask-side premium. Returns (top_row, total_otm_call_prem,
    concentration_pct, ask_proportion)."""
    with conn.cursor() as cur:
        # Try today's snapshot first, then most recent within 3 days
        for lookback_days in (0, 1, 2, 3):
            d = today - timedelta(days=lookback_days)
            cur.execute(
                """
                SELECT expiry, strike, call_volume, call_premium, call_ask_premium,
                       call_bid_premium, call_oi
                FROM uw_flow_per_strike
                WHERE snapshot_date = %s AND ticker = %s
                ORDER BY COALESCE(call_ask_premium, call_premium, 0) DESC
                """,
                (d, ticker),
            )
            rows = cur.fetchall()
            if rows:
                break
        else:
            return None, 0.0, 0.0, 0.0

    # Pull current underlying price to filter OTM
    underlying = _underlying_price(conn, ticker)
    otm_rows = []
    total_otm = 0.0
    for expiry, strike, vol, prem, ask_prem, bid_prem, oi in rows:
        prem = float(prem or 0)
        ask_prem = float(ask_prem or 0)
        if underlying is not None and strike <= underlying:
            continue  # ITM — not interesting for the explosive case
        otm_rows.append((expiry, strike, vol, prem, ask_prem, bid_prem, oi))
        total_otm += max(prem, ask_prem)
    if not otm_rows or total_otm <= 0:
        return None, total_otm, 0.0, 0.0
    # Top row = max ask_side_premium (falls back to total premium)
    otm_rows.sort(key=lambda r: r[4] if r[4] else r[3], reverse=True)
    top = otm_rows[0]
    expiry, strike, vol, prem, ask_prem, bid_prem, oi = top
    top_prem = max(prem, ask_prem)
    concentration = (top_prem / total_otm) if total_otm > 0 else 0.0
    ask_proportion = (ask_prem / prem) if prem > 0 else 0.0
    top_dict = {
        "expiry": expiry,
        "strike": strike,
        "volume": vol,
        "premium": prem,
        "ask_premium": ask_prem,
        "oi": oi,
    }
    return top_dict, total_otm, concentration, ask_proportion


def _load_iv_term(conn: psycopg.Connection, ticker: str, today: date) -> tuple[float | None, float | None, float]:
    """Front-month vs back-month IV. Returns (front_iv, back_iv, inversion)."""
    with conn.cursor() as cur:
        for lookback_days in (0, 1, 2, 3):
            d = today - timedelta(days=lookback_days)
            cur.execute(
                """
                SELECT expiry, dte, iv FROM uw_iv_term_structure
                WHERE snapshot_date = %s AND ticker = %s AND iv IS NOT NULL
                ORDER BY dte ASC
                """,
                (d, ticker),
            )
            rows = cur.fetchall()
            if rows:
                break
        else:
            return None, None, 0.0
    if len(rows) < 2:
        return None, None, 0.0
    # front = nearest expiry with dte >= 1
    front = next((r for r in rows if (r[1] or 0) >= 1), rows[0])
    # back = first expiry with dte >= 60 (or last row)
    back = next((r for r in rows if (r[1] or 0) >= 60), rows[-1])
    front_iv = float(front[2]) if front[2] is not None else None
    back_iv = float(back[2]) if back[2] is not None else None
    if front_iv is None or back_iv is None or back_iv <= 0:
        return front_iv, back_iv, 0.0
    inversion = (front_iv - back_iv) / back_iv
    return front_iv, back_iv, inversion


def _load_squeeze(
    conn: psycopg.Connection,
    ticker: str,
    today: date,
) -> tuple[float | None, float | None, int | None]:
    """Returns (short_percent_float, utilization, recent_ftd_quantity)."""
    spf: float | None = None
    util: float | None = None
    ftd: int | None = None
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT short_percent_float, utilization
            FROM uw_short_screener
            WHERE ticker = %s
            ORDER BY snapshot_date DESC LIMIT 1
            """,
            (ticker,),
        )
        row = cur.fetchone()
        if row:
            spf, util = (float(row[0]) if row[0] is not None else None,
                         float(row[1]) if row[1] is not None else None)
        cur.execute(
            """
            SELECT quantity FROM uw_failures_to_deliver
            WHERE ticker = %s AND settlement_date >= %s
            ORDER BY settlement_date DESC LIMIT 1
            """,
            (ticker, today - timedelta(days=10)),
        )
        row = cur.fetchone()
        if row and row[0] is not None:
            ftd = int(row[0])
    return spf, util, ftd


def _underlying_price(conn: psycopg.Connection, ticker: str) -> float | None:
    """Best-effort spot price from the most recent UW source we have."""
    with conn.cursor() as cur:
        # contract_screener has it on every row, most recent
        cur.execute(
            """
            SELECT underlying_price FROM uw_contract_screener
            WHERE ticker = %s AND underlying_price IS NOT NULL
            ORDER BY snapshot_ts DESC LIMIT 1
            """,
            (ticker,),
        )
        row = cur.fetchone()
        if row and row[0] is not None:
            return float(row[0])
        # max_pain row carries it too
        cur.execute(
            """
            SELECT underlying_price FROM uw_max_pain
            WHERE ticker = %s AND underlying_price IS NOT NULL
            ORDER BY snapshot_date DESC LIMIT 1
            """,
            (ticker,),
        )
        row = cur.fetchone()
        if row and row[0] is not None:
            return float(row[0])
    return None


def _load_nope(conn: psycopg.Connection, ticker: str) -> tuple[float | None, float | None]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT nope, nope_z FROM uw_nope WHERE ticker = %s ORDER BY snapshot_date DESC LIMIT 1",
            (ticker,),
        )
        row = cur.fetchone()
    if not row:
        return None, None
    return (
        float(row[0]) if row[0] is not None else None,
        float(row[1]) if row[1] is not None else None,
    )


def _load_skew_flip(
    conn: psycopg.Connection,
    ticker: str,
    today: date,
) -> tuple[float | None, float | None]:
    """Returns (today's 30dte skew, 30 days ago's 30dte skew). Positive change
    = call demand rising vs put demand → bullish skew flip."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT skew FROM uw_risk_reversal_skew
            WHERE ticker = %s AND dte BETWEEN 20 AND 45
            ORDER BY snapshot_date DESC LIMIT 1
            """,
            (ticker,),
        )
        row = cur.fetchone()
        now_skew = float(row[0]) if row and row[0] is not None else None
        cur.execute(
            """
            SELECT skew FROM uw_risk_reversal_skew
            WHERE ticker = %s AND dte BETWEEN 20 AND 45
              AND snapshot_date <= %s
            ORDER BY snapshot_date DESC LIMIT 1
            """,
            (ticker, today - timedelta(days=14)),
        )
        row = cur.fetchone()
        baseline_skew = float(row[0]) if row and row[0] is not None else None
    return now_skew, baseline_skew


def _load_iv_vs_rv(
    conn: psycopg.Connection,
    ticker: str,
) -> tuple[float | None, float | None]:
    """Returns (iv_30d, rv_30d). IV expensive vs RV = market pricing imminent move."""
    iv = None
    with conn.cursor() as cur:
        # Pull 30d-ish IV from term structure (closest to dte=30)
        cur.execute(
            """
            SELECT iv FROM uw_iv_term_structure
            WHERE ticker = %s AND dte BETWEEN 20 AND 45 AND iv IS NOT NULL
            ORDER BY snapshot_date DESC, dte ASC LIMIT 1
            """,
            (ticker,),
        )
        row = cur.fetchone()
        if row and row[0] is not None:
            iv = float(row[0])
        cur.execute(
            """
            SELECT realized_volatility FROM uw_realized_volatility
            WHERE ticker = %s AND rv_window_days = 30 AND realized_volatility IS NOT NULL
            ORDER BY snapshot_date DESC LIMIT 1
            """,
            (ticker,),
        )
        row = cur.fetchone()
        rv = float(row[0]) if row and row[0] is not None else None
    return iv, rv


def _load_insider_flow(conn: psycopg.Connection, ticker: str) -> float | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT net_buy_value FROM uw_insider_ticker_flow
            WHERE ticker = %s AND lookback_days = 30
            ORDER BY snapshot_date DESC LIMIT 1
            """,
            (ticker,),
        )
        row = cur.fetchone()
        if row and row[0] is not None:
            return float(row[0])
        # fall back to any lookback window
        cur.execute(
            """
            SELECT net_buy_value FROM uw_insider_ticker_flow
            WHERE ticker = %s
            ORDER BY snapshot_date DESC, lookback_days ASC LIMIT 1
            """,
            (ticker,),
        )
        row = cur.fetchone()
        if row and row[0] is not None:
            return float(row[0])
    return None


def _load_volume_profile(
    conn: psycopg.Connection,
    option_symbol: str | None,
) -> tuple[float | None, float | None]:
    """For the ticker's top OTM contract, find the price level with the most
    volume — the "magnet strike" where smart money built the position.
    Returns (top_price_level, share_of_total_volume_at_top)."""
    if not option_symbol:
        return None, None
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT price_level, volume FROM uw_volume_profile
            WHERE option_symbol = %s AND volume IS NOT NULL
            ORDER BY snapshot_date DESC, volume DESC
            """,
            (option_symbol,),
        )
        rows = cur.fetchall()
    if not rows:
        return None, None
    total = sum(int(r[1] or 0) for r in rows)
    if total <= 0:
        return None, None
    top_price = float(rows[0][0])
    top_share = float(rows[0][1]) / total
    return top_price, top_share


def _load_top_contract(
    conn: psycopg.Connection,
    ticker: str,
) -> tuple[str | None, float | None, int | None, int | None, float | None] | None:
    """Look at the most recent contract_screener snapshot. Pull the top
    (highest premium) call contract for this ticker. Returns
    (option_symbol, last_price, volume, oi, premium) or None."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT option_symbol, last_price, volume, open_interest, total_premium
            FROM uw_contract_screener
            WHERE ticker = %s
              AND snapshot_ts >= NOW() - INTERVAL '6 hours'
              AND option_type = 'call'
            ORDER BY COALESCE(ask_side_prem, total_premium, 0) DESC
            LIMIT 1
            """,
            (ticker,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return (row[0], float(row[1]) if row[1] is not None else None,
                int(row[2]) if row[2] is not None else None,
                int(row[3]) if row[3] is not None else None,
                float(row[4]) if row[4] is not None else None)


# ---------- scoring ----------


def _score_flow_concentration(sig: TickerSignals) -> None:
    """0-100 from total OTM call prem + concentration + ask proportion."""
    if sig.total_otm_call_prem < MIN_OTM_CALL_PREMIUM:
        sig.flow_concentration_score = 0.0
        return
    # log-scale premium: $100K=20, $1M=50, $10M=80, $50M=100
    prem_score = _clip(20 + 30 * math.log10(max(sig.total_otm_call_prem, 1) / 1e5))
    conc_score = _clip(sig.strike_concentration_pct * 200.0)   # 50% concentration → 100
    ask_score  = _clip((sig.ask_side_proportion - 0.4) * 250.0) # ≥80% ask → 100
    composite = 0.5 * prem_score + 0.3 * conc_score + 0.2 * ask_score
    sig.flow_concentration_score = _clip(composite)
    sig.reasons["flow_concentration"] = (
        f"{_money(sig.total_otm_call_prem)} OTM call prem, "
        f"{_pct(sig.strike_concentration_pct)} at top strike, "
        f"{_pct(sig.ask_side_proportion)} ask-side"
    )


def _score_iv_term(sig: TickerSignals) -> None:
    """0-100 from how inverted the front-month is."""
    if sig.front_iv is None or sig.back_iv is None:
        sig.iv_term_score = 0.0
        return
    # 0% inversion = 0; +20% = 50; +50% = 100
    sig.iv_term_score = _clip(sig.iv_term_inversion * 200.0)
    sig.reasons["iv_term"] = (
        f"front {sig.front_iv*100:.0f}% vs back {sig.back_iv*100:.0f}% "
        f"({sig.iv_term_inversion*100:+.0f}% inversion)"
    )


def _score_squeeze(sig: TickerSignals) -> None:
    """0-100 from short interest + utilization + recent FTD."""
    parts = []
    if sig.short_percent_float is not None:
        # 10% float = 30; 20% = 60; 40%+ = 100
        parts.append(_clip(sig.short_percent_float * 250.0))
    if sig.utilization is not None:
        # 50% util = 25; 80% = 75; 100% = 100
        parts.append(_clip((sig.utilization - 0.25) * 133.0))
    if sig.recent_ftd_quantity and sig.recent_ftd_quantity > 0:
        parts.append(_clip(20 + 20 * math.log10(max(sig.recent_ftd_quantity, 1) / 1e4)))
    if not parts:
        sig.squeeze_score = 0.0
        return
    sig.squeeze_score = _clip(sum(parts) / len(parts))
    bits = []
    if sig.short_percent_float is not None:
        bits.append(f"{sig.short_percent_float*100:.0f}% SI/float")
    if sig.utilization is not None:
        bits.append(f"{sig.utilization*100:.0f}% util")
    if sig.recent_ftd_quantity:
        bits.append(f"{sig.recent_ftd_quantity:,} FTD")
    if bits:
        sig.reasons["squeeze"] = ", ".join(bits)


def _score_catalyst(sig: TickerSignals) -> None:
    """0-100 with peak at 1-3 days to catalyst, falloff outside that window."""
    if sig.days_to_catalyst is None:
        sig.catalyst_score = 0.0
        return
    dte = sig.days_to_catalyst
    if dte < 0:
        sig.catalyst_score = 0.0
        return
    # Triangle: peak 100 at dte∈[1,3], falls to 40 at dte=7, 10 at dte=14
    if 1 <= dte <= 3:
        s = 100.0
    elif dte == 0:
        s = 70.0  # day-of can be too late
    elif dte <= 7:
        s = 100 - (dte - 3) * 15.0
    elif dte <= 14:
        s = 40 - (dte - 7) * 4.0
    else:
        s = max(0, 10 - (dte - 14) * 0.5)
    sig.catalyst_score = _clip(s)
    if sig.catalyst_label:
        sig.reasons["catalyst"] = f"{sig.catalyst_label} in {dte}d"


def _score_cheap_optionality(sig: TickerSignals) -> None:
    """0-100 from stock price and top OTM weekly price.
       Cheap stock + sub-$0.75 weekly OTM call = max leverage potential."""
    parts = []
    if sig.underlying_price is not None:
        # $5=100, $15=70, $30=40, $60=10
        if sig.underlying_price <= 5:
            parts.append(100.0)
        elif sig.underlying_price <= CHEAP_STOCK_PRICE:
            parts.append(100 - (sig.underlying_price - 5) * 2.4)
        elif sig.underlying_price <= 60:
            parts.append(_clip(40 - (sig.underlying_price - CHEAP_STOCK_PRICE) * 1.0))
        else:
            parts.append(0.0)
    if sig.top_last_price is not None and sig.top_last_price > 0:
        # < $0.10 = 100, $0.50 = 50, $1+ = 10
        if sig.top_last_price <= 0.10:
            parts.append(100.0)
        elif sig.top_last_price <= LOTTERY_TICKET_MAX_PRICE:
            parts.append(_clip(100 - (sig.top_last_price - 0.10) * 110.0))
        elif sig.top_last_price <= 2.0:
            parts.append(_clip(40 - (sig.top_last_price - LOTTERY_TICKET_MAX_PRICE) * 24.0))
        else:
            parts.append(0.0)
    if not parts:
        sig.cheap_optionality_score = 0.0
        return
    sig.cheap_optionality_score = sum(parts) / len(parts)
    if sig.underlying_price is not None and sig.top_last_price is not None:
        sig.reasons["cheap_optionality"] = (
            f"stock ${sig.underlying_price:.2f}, top OTM call ${sig.top_last_price:.2f}"
        )


def _score_iv_vs_rv(sig: TickerSignals) -> None:
    """0-100 from IV/RV ratio. >1.5 (IV pricing big move) = 100; ≤1.0 = 0.
    A high ratio confirms the market is actively pricing volatility."""
    if sig.iv_30d is None or sig.rv_30d is None or sig.rv_30d <= 0:
        sig.iv_vs_rv_score = 0.0
        return
    ratio = sig.iv_30d / sig.rv_30d
    # ratio 1.0 → 0, 1.25 → 50, 1.5+ → 100
    sig.iv_vs_rv_score = _clip((ratio - 1.0) * 200.0)
    if sig.iv_vs_rv_score > 5:
        sig.reasons["iv_vs_rv"] = f"IV/RV {ratio:.2f}× — market pricing move"


def _score_skew_flip(sig: TickerSignals) -> None:
    """0-100 from how much 30dte skew has shifted bullish in last ~14d.
    skew_now - skew_baseline > 0 = call demand rising vs put demand."""
    if sig.skew_now is None or sig.skew_30d_ago is None:
        sig.skew_flip_score = 0.0
        return
    delta = sig.skew_now - sig.skew_30d_ago
    # +0% → 0, +5% → 50, +10%+ → 100. (skew measured as call_iv - put_iv)
    sig.skew_flip_score = _clip(delta * 1000.0)
    if sig.skew_flip_score > 5:
        sig.reasons["skew_flip"] = (
            f"skew shifted {delta*100:+.1f}pp bullish vs 14d ago"
        )


def _score_nope(sig: TickerSignals) -> None:
    """Extreme NOPE = positioning concentrated. |z| ≥ 2 = 100, |z| ≥ 1 = 50."""
    if sig.nope_z is not None:
        sig.nope_score = _clip(abs(sig.nope_z) * 50.0)
        if sig.nope_score > 10:
            sig.reasons["nope"] = f"NOPE z={sig.nope_z:+.2f}"
    elif sig.nope_value is not None:
        # No z-score: use absolute magnitude as a weak proxy
        mag = abs(sig.nope_value)
        sig.nope_score = _clip(mag * 50.0)
        if sig.nope_score > 10:
            sig.reasons["nope"] = f"NOPE {sig.nope_value:+.2f}"
    else:
        sig.nope_score = 0.0


def _score_insider_buy(sig: TickerSignals) -> None:
    """Insider net buying (last 30d) as confirmation.
    $100K = 30, $1M = 70, $5M+ = 100. Selling → 0."""
    if sig.insider_net_buy_30d is None or sig.insider_net_buy_30d <= 0:
        sig.insider_buy_score = 0.0
        return
    v = sig.insider_net_buy_30d
    if v < 1e4:
        sig.insider_buy_score = 0.0
    elif v < 1e5:
        sig.insider_buy_score = 30.0 * (v / 1e5)
    elif v < 1e6:
        sig.insider_buy_score = 30 + 40 * math.log10(v / 1e5)
    else:
        sig.insider_buy_score = _clip(70 + 30 * math.log10(v / 1e6))
    if sig.insider_buy_score > 10:
        sig.reasons["insider_buy"] = f"insider net buy {_money(v)} / 30d"


def _score_volume_profile(sig: TickerSignals) -> None:
    """Magnet strike concentration: share of volume at single price level.
    ≥60% = 100, 30% = 50, <15% = 0."""
    if sig.volume_profile_top_share is None:
        sig.volume_profile_score = 0.0
        return
    s = sig.volume_profile_top_share
    if s < 0.15:
        sig.volume_profile_score = 0.0
    elif s < 0.60:
        sig.volume_profile_score = _clip((s - 0.15) * 222.0)
    else:
        sig.volume_profile_score = 100.0
    if sig.volume_profile_score > 20 and sig.volume_profile_top_price is not None:
        sig.reasons["volume_profile"] = (
            f"magnet @ ${sig.volume_profile_top_price:.2f} ({_pct(s)} of fills)"
        )


def _score_gex_bonus(conn: psycopg.Connection, sig: TickerSignals) -> None:
    """Bonus for tickers in GEX coverage with dealer short gamma at/near the
    OTM cluster. If gex tables don't exist or ticker isn't covered → 0.
    Adds +25 if we find an explicit short-gamma signal, +10 if only covered."""
    sig.gex_bonus_score = 0.0
    with conn.cursor() as cur:
        try:
            cur.execute(
                """
                SELECT 1 FROM gex_feed WHERE ticker = %s
                  AND ts >= NOW() - INTERVAL '2 days'
                LIMIT 1
                """,
                (sig.ticker,),
            )
            if cur.fetchone():
                sig.gex_bonus_score = 10.0
                sig.reasons["gex_bonus"] = "in GEX coverage"
        except psycopg.errors.UndefinedTable:
            return
        except Exception:
            return


def _compute_signals(conn: psycopg.Connection, ticker: str, today: date) -> TickerSignals:
    sig = TickerSignals(ticker=ticker)
    sig.underlying_price = _underlying_price(conn, ticker)
    # catalyst
    cat = _load_catalyst(conn, ticker, today)
    if cat:
        sig.catalyst_type, sig.catalyst_date, sig.catalyst_label, sig.days_to_catalyst = cat
    # flow
    top, total_otm, conc, ask_prop = _load_flow_concentration(conn, ticker, today)
    sig.total_otm_call_prem = total_otm
    sig.strike_concentration_pct = conc
    sig.ask_side_proportion = ask_prop
    if top:
        sig.top_strike = top["strike"]
        sig.top_expiry = top["expiry"]
        sig.top_volume = top["volume"]
        sig.top_oi = top["oi"]
        sig.top_premium = top["premium"]
    # most-traded specific contract from screener
    contract = _load_top_contract(conn, ticker)
    if contract:
        sig.top_option_symbol, sig.top_last_price, vol2, oi2, prem2 = contract
        sig.top_option_type = "call"
        if sig.top_volume is None and vol2 is not None:
            sig.top_volume = vol2
        if sig.top_oi is None and oi2 is not None:
            sig.top_oi = oi2
        if sig.top_premium is None and prem2 is not None:
            sig.top_premium = prem2
    # IV
    sig.front_iv, sig.back_iv, sig.iv_term_inversion = _load_iv_term(conn, ticker, today)
    # squeeze
    sig.short_percent_float, sig.utilization, sig.recent_ftd_quantity = _load_squeeze(conn, ticker, today)

    # Phase 2 confirmation signals
    sig.nope_value, sig.nope_z = _load_nope(conn, ticker)
    sig.skew_now, sig.skew_30d_ago = _load_skew_flip(conn, ticker, today)
    sig.iv_30d, sig.rv_30d = _load_iv_vs_rv(conn, ticker)
    sig.insider_net_buy_30d = _load_insider_flow(conn, ticker)
    sig.volume_profile_top_price, sig.volume_profile_top_share = _load_volume_profile(
        conn, sig.top_option_symbol
    )

    # score
    _score_flow_concentration(sig)
    _score_iv_term(sig)
    _score_squeeze(sig)
    _score_catalyst(sig)
    _score_cheap_optionality(sig)
    _score_gex_bonus(conn, sig)
    _score_iv_vs_rv(sig)
    _score_skew_flip(sig)
    _score_nope(sig)
    _score_insider_buy(sig)
    _score_volume_profile(sig)
    return sig


def _composite(sig: TickerSignals) -> float:
    return _clip(
        WEIGHTS["flow_concentration"] * sig.flow_concentration_score
        + WEIGHTS["iv_term"]            * sig.iv_term_score
        + WEIGHTS["squeeze"]            * sig.squeeze_score
        + WEIGHTS["catalyst"]           * sig.catalyst_score
        + WEIGHTS["cheap_optionality"]  * sig.cheap_optionality_score
        + WEIGHTS["gex_bonus"]          * sig.gex_bonus_score
        + WEIGHTS["iv_vs_rv"]           * sig.iv_vs_rv_score
        + WEIGHTS["skew_flip"]          * sig.skew_flip_score
        + WEIGHTS["nope"]               * sig.nope_score
        + WEIGHTS["insider_buy"]        * sig.insider_buy_score
        + WEIGHTS["volume_profile"]     * sig.volume_profile_score
    )


def _upsert_score(
    conn: psycopg.Connection,
    snapshot_ts: datetime,
    sig: TickerSignals,
    score: float,
) -> None:
    sql = """
        INSERT INTO explosive_scores (
            snapshot_ts, ticker, score,
            catalyst_type, catalyst_date, catalyst_label, days_to_catalyst,
            underlying_price,
            top_option_symbol, top_option_type, top_strike, top_expiry,
            top_last_price, top_volume, top_open_interest, top_premium,
            flow_concentration_score, iv_term_score, squeeze_score,
            catalyst_score, cheap_optionality_score, gex_bonus_score,
            iv_vs_rv_score, skew_flip_score, nope_score,
            insider_buy_score, volume_profile_score,
            signals
        ) VALUES (
            %(snapshot_ts)s, %(ticker)s, %(score)s,
            %(catalyst_type)s, %(catalyst_date)s, %(catalyst_label)s, %(days_to_catalyst)s,
            %(underlying_price)s,
            %(top_option_symbol)s, %(top_option_type)s, %(top_strike)s, %(top_expiry)s,
            %(top_last_price)s, %(top_volume)s, %(top_open_interest)s, %(top_premium)s,
            %(flow_concentration_score)s, %(iv_term_score)s, %(squeeze_score)s,
            %(catalyst_score)s, %(cheap_optionality_score)s, %(gex_bonus_score)s,
            %(iv_vs_rv_score)s, %(skew_flip_score)s, %(nope_score)s,
            %(insider_buy_score)s, %(volume_profile_score)s,
            %(signals)s
        ) ON CONFLICT (snapshot_ts, ticker) DO UPDATE SET
            score = EXCLUDED.score,
            signals = EXCLUDED.signals
    """
    params = {
        "snapshot_ts": snapshot_ts,
        "ticker": sig.ticker,
        "score": score,
        "catalyst_type": sig.catalyst_type,
        "catalyst_date": sig.catalyst_date,
        "catalyst_label": sig.catalyst_label,
        "days_to_catalyst": sig.days_to_catalyst,
        "underlying_price": sig.underlying_price,
        "top_option_symbol": sig.top_option_symbol,
        "top_option_type": sig.top_option_type,
        "top_strike": sig.top_strike,
        "top_expiry": sig.top_expiry,
        "top_last_price": sig.top_last_price,
        "top_volume": sig.top_volume,
        "top_open_interest": sig.top_oi,
        "top_premium": sig.top_premium,
        "flow_concentration_score": sig.flow_concentration_score,
        "iv_term_score": sig.iv_term_score,
        "squeeze_score": sig.squeeze_score,
        "catalyst_score": sig.catalyst_score,
        "cheap_optionality_score": sig.cheap_optionality_score,
        "gex_bonus_score": sig.gex_bonus_score,
        "iv_vs_rv_score": sig.iv_vs_rv_score,
        "skew_flip_score": sig.skew_flip_score,
        "nope_score": sig.nope_score,
        "insider_buy_score": sig.insider_buy_score,
        "volume_profile_score": sig.volume_profile_score,
        "signals": Jsonb(sig.reasons),
    }
    with conn.cursor() as cur:
        cur.execute(sql, params)


def score_all(database_url: str) -> dict[str, Any]:
    """Compute and persist explosive_scores for every ticker in the universe.
    Returns {snapshot_ts, count, top: [{ticker, score}, ...]}"""
    now = datetime.now(UTC)
    today = now.date()
    written = 0
    top_preview: list[tuple[str, float]] = []
    with connect(database_url) as conn:
        universe = _load_universe(conn, today)
        log.info("explosive scoring: %d tickers in universe", len(universe))
        for ticker in universe:
            try:
                # Wrap the *entire* per-ticker block in a savepoint so that
                # any SELECT failure rolls back cleanly instead of leaving
                # the outer transaction in INERROR for the next iteration.
                with conn.transaction():
                    sig = _compute_signals(conn, ticker, today)
                    score = _composite(sig)
                    _upsert_score(conn, now, sig, score)
                written += 1
                top_preview.append((ticker, score))
            except Exception as e:
                log.warning("scoring failed for %s: %s", ticker, e, exc_info=True)
        # No explicit conn.commit(): psycopg3's `with psycopg.connect(...)`
        # already wraps the body in a transaction and commits on clean exit;
        # an explicit commit here raises "Explicit commit() forbidden within
        # a Transaction context."
    top_preview.sort(key=lambda x: x[1], reverse=True)
    return {
        "snapshot_ts": now.isoformat(),
        "count": written,
        "top": [{"ticker": t, "score": round(s, 1)} for t, s in top_preview[:10]],
    }
