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
import time
import math
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

import psycopg
from concurrent.futures import ThreadPoolExecutor, as_completed
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect

log = logging.getLogger(__name__)


# Tunables — these get recalibrated as forward data accumulates.
# Phase 2 layers 5 confirmation signals: NOPE extremity, risk-reversal skew
# flip, IV vs RV divergence, volume-profile magnet, and insider net buying.
WEIGHTS = {
    "flow_concentration": 0.18,
    "iv_term":            0.10,
    "squeeze":            0.10,
    "catalyst":           0.16,
    "cheap_optionality":  0.10,
    "gex_bonus":          0.02,
    # Phase 2
    "iv_vs_rv":           0.04,
    "skew_flip":          0.04,
    "nope":               0.03,
    "insider_buy":        0.02,
    "volume_profile":     0.02,
    # Phase 3 — catalyst calendar + smart-money + per-ticker GEX (migrations 0028-0030)
    "earnings_window":    0.06,    # refines catalyst with the *upcoming* earnings cal
    "analyst":            0.04,    # recent upgrade + price-target raise
    "institutional":      0.05,    # 13F adds + ownership + insider multi-buyer
    "spot_gex":           0.04,    # per-ticker short-gamma at OTM cluster
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
    # Phase 3 inputs (catalyst calendar, analyst, institutional, spot-GEX)
    next_earnings_date: date | None = None
    next_earnings_session: str | None = None
    next_earnings_expected_move_pct: float | None = None
    analyst_upgrade_count_14d: int = 0
    analyst_downgrade_count_14d: int = 0
    analyst_max_pt_raise_pct: float | None = None
    inst_net_buy_value_30d: float | None = None
    inst_net_buyer_count_30d: int = 0
    inst_ownership_pct: float | None = None
    inst_insider_buy_count_30d: int | None = None
    inst_insider_sell_count_30d: int | None = None
    spot_gamma_latest: float | None = None
    spot_gamma_short: bool = False
    spot_gamma_swing_pct: float | None = None     # (max-min)/|max| over last hour
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
    # Phase 3
    earnings_window_score: float = 0.0
    analyst_score: float = 0.0
    institutional_score: float = 0.0
    spot_gex_score: float = 0.0


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
    """Tickers we'll score — the top of the funnel.

    Funnel-architecture seed order (Phase A):
      1. uw_screener_stocks — UW's stock-level pre-ranked screener (last 24h).
         The primary discovery surface: UW already filtered for unusual
         IV/volume/perchange, we just pull names.
      2. uw_market_oi_change — biggest overnight OI shifts market-wide
         (catches institutional positioning before tape moves).
      3. uw_top_net_impact — names where net options impact moves the needle.
      4. uw_movers_snapshot — top % gainers/losers (last 24h).
      5. uw_contract_screener — UW "Hottest Chains" (option-level, last 24h).
      6. uw_earnings_calendar_daily — every name reporting next 10d.
      7. uw_fda_calendar / uw_ipo_calendar — non-earnings catalysts.
      8. uw_earnings (legacy backstop).

    Each source is wrapped in try/except so a missing table (e.g. Phase A
    migrations not yet applied) doesn't blow up scoring.
    """
    horizon = today + timedelta(days=10)
    universe: set[str] = set()
    with conn.cursor() as cur:
        def _safe(sql: str, params: tuple[Any, ...] = ()) -> None:
            try:
                cur.execute(sql, params)
                universe.update(row[0] for row in cur.fetchall() if row[0])
            except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
                conn.rollback()
        # 1. Stock screener — primary discovery (Phase A).
        _safe(
            """
            SELECT DISTINCT ticker FROM uw_screener_stocks
            WHERE snapshot_ts >= NOW() - INTERVAL '24 hours'
            """
        )
        # 2. Market-wide OI change (Phase A).
        _safe(
            """
            SELECT DISTINCT ticker FROM uw_market_oi_change
            WHERE snapshot_ts >= NOW() - INTERVAL '24 hours'
            """
        )
        # 3. Top net-impact ranking.
        _safe(
            """
            SELECT DISTINCT ticker FROM uw_top_net_impact
            WHERE snapshot_ts >= NOW() - INTERVAL '24 hours'
            """
        )
        # 4. Market movers (gainers / losers / most-active buckets).
        _safe(
            """
            SELECT DISTINCT ticker FROM uw_movers_snapshot
            WHERE snapshot_ts >= NOW() - INTERVAL '24 hours'
            """
        )
        # 5. Hottest contract chains.
        _safe(
            """
            SELECT DISTINCT ticker FROM uw_contract_screener
            WHERE snapshot_ts >= NOW() - INTERVAL '24 hours'
            """
        )
        # 6. Upcoming earnings (UW daily calendar).
        _safe(
            """
            SELECT DISTINCT ticker FROM uw_earnings_calendar_daily
            WHERE report_date BETWEEN %s AND %s
            """,
            (today, horizon),
        )
        # 7. FDA + IPO catalysts.
        _safe(
            "SELECT DISTINCT ticker FROM uw_fda_calendar WHERE catalyst_date BETWEEN %s AND %s",
            (today, horizon),
        )
        _safe(
            "SELECT DISTINCT ticker FROM uw_ipo_calendar WHERE ipo_date BETWEEN %s AND %s",
            (today, horizon),
        )
        # 8. Legacy earnings backstop.
        _safe(
            "SELECT DISTINCT ticker FROM uw_earnings WHERE report_date BETWEEN %s AND %s",
            (today, horizon),
        )
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


# ---------- Phase 3 loaders (catalyst calendar / analyst / institutional / spot-GEX) -----


def _load_next_earnings(
    conn: psycopg.Connection,
    ticker: str,
    today: date,
) -> tuple[date | None, str | None, float | None]:
    """Closest upcoming row in uw_earnings_calendar_daily (refines the
    existing catalyst signal — that one reads uw_earnings which is historical;
    this one reads the actual upcoming calendar with session + expected
    move). Returns (report_date, session, expected_move_pct)."""
    horizon = today + timedelta(days=14)
    with conn.cursor() as cur:
        try:
            cur.execute(
                """
                SELECT report_date, session, expected_move_pct
                FROM uw_earnings_calendar_daily
                WHERE ticker = %s AND report_date BETWEEN %s AND %s
                ORDER BY report_date ASC, session ASC
                LIMIT 1
                """,
                (ticker, today, horizon),
            )
            row = cur.fetchone()
        except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
            return None, None, None
    if not row:
        return None, None, None
    return row[0], row[1], float(row[2]) if row[2] is not None else None


def _load_analyst_activity(
    conn: psycopg.Connection,
    ticker: str,
    today: date,
) -> tuple[int, int, float | None]:
    """Returns (upgrade_count_14d, downgrade_count_14d, max_pt_raise_pct).
    PT-raise % is computed as max((pt_new - pt_prior)/pt_prior) over events
    in the window where both prior and new are present and pt_new > pt_prior."""
    since = today - timedelta(days=14)
    up = dn = 0
    max_raise: float | None = None
    with conn.cursor() as cur:
        try:
            cur.execute(
                """
                SELECT action, price_target_prior, price_target_new
                FROM uw_analyst_ratings
                WHERE ticker = %s AND event_date >= %s
                """,
                (ticker, since),
            )
            rows = cur.fetchall()
        except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
            return 0, 0, None
    for action, pt_prior, pt_new in rows:
        a = (action or "").lower()
        if "upgrade" in a or "initiated" in a:
            up += 1
        elif "downgrade" in a:
            dn += 1
        if pt_prior is not None and pt_new is not None and pt_prior > 0 and pt_new > pt_prior:
            r = (float(pt_new) - float(pt_prior)) / float(pt_prior)
            max_raise = r if max_raise is None or r > max_raise else max_raise
    return up, dn, max_raise


def _load_institutional(
    conn: psycopg.Connection,
    ticker: str,
    today: date,
) -> tuple[float | None, int, float | None, int | None, int | None]:
    """Returns:
       (inst_net_buy_value_30d, inst_net_buyer_count_30d, inst_ownership_pct,
        insider_buy_count_30d, insider_sell_count_30d)
    Net buy aggregates uw_institution_activity filed in last 30d with
    action in ('buy', 'new', 'increased')."""
    since = today - timedelta(days=30)
    net_value: float | None = None
    buyer_count = 0
    own: float | None = None
    insider_buy: int | None = None
    insider_sell: int | None = None
    with conn.cursor() as cur:
        try:
            cur.execute(
                """
                SELECT COALESCE(SUM(value_usd), 0) AS net_value,
                       COUNT(DISTINCT institution_name) AS buyer_count
                FROM uw_institution_activity
                WHERE ticker = %s AND filing_date >= %s
                  AND action IN ('buy', 'new', 'increased')
                """,
                (ticker, since),
            )
            row = cur.fetchone()
            if row:
                net_value = float(row[0]) if row[0] is not None else None
                buyer_count = int(row[1] or 0)
        except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
            pass
        try:
            cur.execute(
                """
                SELECT institutional_pct FROM uw_stock_ownership
                WHERE ticker = %s ORDER BY snapshot_date DESC LIMIT 1
                """,
                (ticker,),
            )
            row = cur.fetchone()
            if row and row[0] is not None:
                own = float(row[0])
        except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
            pass
        try:
            cur.execute(
                """
                SELECT buy_count, sell_count FROM uw_stock_insider_buy_sells
                WHERE ticker = %s AND window_days = 30
                ORDER BY snapshot_date DESC LIMIT 1
                """,
                (ticker,),
            )
            row = cur.fetchone()
            if row:
                insider_buy = int(row[0]) if row[0] is not None else None
                insider_sell = int(row[1]) if row[1] is not None else None
        except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
            pass
    return net_value, buyer_count, own, insider_buy, insider_sell


def _load_spot_gex(
    conn: psycopg.Connection,
    ticker: str,
) -> tuple[float | None, bool, float | None]:
    """Latest 1-min spot-GEX bar + last-hour gamma swing.
    Returns (latest_total_gamma, dealer_short_gamma, last_hour_swing_pct)."""
    latest: float | None = None
    is_short = False
    swing: float | None = None
    with conn.cursor() as cur:
        try:
            cur.execute(
                """
                SELECT total_gamma FROM uw_spot_gex_intraday
                WHERE ticker = %s ORDER BY ts DESC LIMIT 1
                """,
                (ticker,),
            )
            row = cur.fetchone()
            if row and row[0] is not None:
                latest = float(row[0])
                is_short = latest < 0
        except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
            return None, False, None
        try:
            cur.execute(
                """
                SELECT MAX(total_gamma), MIN(total_gamma)
                FROM uw_spot_gex_intraday
                WHERE ticker = %s AND ts >= NOW() - INTERVAL '1 hour'
                """,
                (ticker,),
            )
            row = cur.fetchone()
            if row and row[0] is not None and row[1] is not None:
                mx, mn = float(row[0]), float(row[1])
                denom = max(abs(mx), abs(mn))
                if denom > 0:
                    swing = (mx - mn) / denom
        except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
            pass
    return latest, is_short, swing


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


def _score_earnings_window(sig: TickerSignals, today: date) -> None:
    """Refines catalyst_score using the actual upcoming earnings calendar
    (uw_earnings_calendar_daily) rather than the historical uw_earnings table.
    Peak score 1-3 days before report; tighter falloff after that."""
    if not sig.next_earnings_date:
        sig.earnings_window_score = 0.0
        return
    dte = (sig.next_earnings_date - today).days
    if dte < 0:
        sig.earnings_window_score = 0.0
        return
    if 1 <= dte <= 3:
        base = 100.0
    elif dte == 0:
        # If the session is "post" we still have an entry into the report;
        # if it's "pre" the move has already happened intraday.
        base = 70.0 if (sig.next_earnings_session or "").lower() in ("post", "amc") else 30.0
    elif dte <= 7:
        base = 80 - (dte - 3) * 10.0
    elif dte <= 14:
        base = 30 - (dte - 7) * 3.0
    else:
        base = 0.0
    # Expected-move boost — when UW publishes the straddle-implied move, a
    # large expected move means real implied vol is being priced in
    if sig.next_earnings_expected_move_pct is not None:
        em = abs(sig.next_earnings_expected_move_pct)
        # +0pp at 0%, +20pp at 10%, +40pp at 20% (capped)
        boost = min(40.0, em * 2.0 * 100.0)  # em is fractional, e.g. 0.10
        base = _clip(base + boost)
    sig.earnings_window_score = _clip(base)
    if sig.earnings_window_score > 5:
        bits = [f"earnings in {dte}d"]
        if sig.next_earnings_session:
            bits.append(sig.next_earnings_session.upper())
        if sig.next_earnings_expected_move_pct is not None:
            bits.append(f"implied ±{sig.next_earnings_expected_move_pct*100:.1f}%")
        sig.reasons["earnings_window"] = ", ".join(bits)


def _score_analyst(sig: TickerSignals) -> None:
    """Analyst confirmation: recent upgrades + price-target raises.
    Downgrades cancel out one upgrade each (small penalty)."""
    net_up = sig.analyst_upgrade_count_14d - sig.analyst_downgrade_count_14d
    if net_up <= 0 and (sig.analyst_max_pt_raise_pct or 0) <= 0:
        sig.analyst_score = 0.0
        return
    s = 0.0
    if net_up >= 1:
        s += 30.0
    if net_up >= 2:
        s += 30.0
    if net_up >= 3:
        s += 20.0
    # Price target raise (% increase, fractional)
    pt = sig.analyst_max_pt_raise_pct or 0.0
    if pt > 0:
        # +0pp at 0%, +30pp at 15%, +50pp at 30%+
        s += min(50.0, pt * 100.0 * 1.67)
    sig.analyst_score = _clip(s)
    if sig.analyst_score > 5:
        bits = []
        if net_up > 0:
            bits.append(f"{net_up} net upgrade(s) 14d")
        if pt > 0:
            bits.append(f"PT raise {pt*100:.0f}%")
        sig.reasons["analyst"] = ", ".join(bits)


def _score_institutional(sig: TickerSignals) -> None:
    """Smart-money confirmation: net 13F adds + multi-buyer breadth +
    insider-side agreement. Each component contributes additively."""
    s = 0.0
    parts: list[str] = []
    if sig.inst_net_buy_value_30d is not None and sig.inst_net_buy_value_30d > 0:
        v = sig.inst_net_buy_value_30d
        if v >= 5e7:
            s += 60.0
        elif v >= 1e7:
            s += 40.0
        elif v >= 1e6:
            s += 20.0 + 20.0 * math.log10(v / 1e6)
        else:
            s += 10.0
        parts.append(f"13F net buy {_money(v)}/30d")
    if sig.inst_net_buyer_count_30d >= 5:
        s += 20.0
        parts.append(f"{sig.inst_net_buyer_count_30d} buyers")
    elif sig.inst_net_buyer_count_30d >= 2:
        s += 10.0
    # Insider-side agreement — if institutions are buying AND insiders are too
    if sig.inst_insider_buy_count_30d and sig.inst_insider_sell_count_30d is not None:
        if sig.inst_insider_buy_count_30d > sig.inst_insider_sell_count_30d:
            s += 15.0
            parts.append(
                f"insiders {sig.inst_insider_buy_count_30d}B/{sig.inst_insider_sell_count_30d}S"
            )
    # Concentrated ownership — both ways. <30% = too retail-driven, >80% = no
    # room for accumulation. Reward 40-70% sweet spot.
    if sig.inst_ownership_pct is not None:
        own = sig.inst_ownership_pct
        if 0.40 <= own <= 0.70:
            s += 5.0
    sig.institutional_score = _clip(s)
    if parts:
        sig.reasons["institutional"] = ", ".join(parts)


def _score_spot_gex(sig: TickerSignals) -> None:
    """Per-ticker spot-GEX confirmation. Short dealer gamma at OTM = unstable
    regime; intraday gamma swings = hedging activity that amplifies underlying
    moves. Different from gex_bonus_score (which is just 'in coverage')."""
    if sig.spot_gamma_latest is None:
        sig.spot_gex_score = 0.0
        return
    s = 0.0
    if sig.spot_gamma_short:
        # Negative gamma → dealers chase moves = larger expected swings
        s += 60.0
    if sig.spot_gamma_swing_pct is not None and sig.spot_gamma_swing_pct > 0:
        # Bigger 1h swing → more hedging activity. 50%+ swing = full credit
        s += min(40.0, sig.spot_gamma_swing_pct * 80.0)
    sig.spot_gex_score = _clip(s)
    if sig.spot_gex_score > 10:
        bits = []
        if sig.spot_gamma_short:
            bits.append("dealer short γ")
        if sig.spot_gamma_swing_pct and sig.spot_gamma_swing_pct > 0.1:
            bits.append(f"1h γ swing {sig.spot_gamma_swing_pct*100:.0f}%")
        sig.reasons["spot_gex"] = ", ".join(bits)


def _score_gex_bonus(conn: psycopg.Connection, sig: TickerSignals) -> None:
    """Bonus for tickers in GEX coverage with dealer short gamma at/near the
    OTM cluster. If gex tables don't exist or ticker isn't covered → 0.
    Adds +25 if we find an explicit short-gamma signal, +10 if only covered.

    gex_feed.tickers is TEXT[] (see migration 0016) — query with ANY()
    rather than `ticker = %s`. The savepoint isolates schema mismatches so
    a failure here doesn't poison the per-ticker transaction."""
    sig.gex_bonus_score = 0.0
    try:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT 1 FROM gex_feed
                    WHERE %s = ANY(tickers)
                      AND ts >= NOW() - INTERVAL '2 days'
                    LIMIT 1
                    """,
                    (sig.ticker,),
                )
                if cur.fetchone():
                    sig.gex_bonus_score = 10.0
                    sig.reasons["gex_bonus"] = "in GEX coverage"
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

    # Phase 3 inputs (catalyst calendar, analyst, institutional, spot-GEX)
    (
        sig.next_earnings_date,
        sig.next_earnings_session,
        sig.next_earnings_expected_move_pct,
    ) = _load_next_earnings(conn, ticker, today)
    (
        sig.analyst_upgrade_count_14d,
        sig.analyst_downgrade_count_14d,
        sig.analyst_max_pt_raise_pct,
    ) = _load_analyst_activity(conn, ticker, today)
    (
        sig.inst_net_buy_value_30d,
        sig.inst_net_buyer_count_30d,
        sig.inst_ownership_pct,
        sig.inst_insider_buy_count_30d,
        sig.inst_insider_sell_count_30d,
    ) = _load_institutional(conn, ticker, today)
    (
        sig.spot_gamma_latest,
        sig.spot_gamma_short,
        sig.spot_gamma_swing_pct,
    ) = _load_spot_gex(conn, ticker)

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
    # Phase 3
    _score_earnings_window(sig, today)
    _score_analyst(sig)
    _score_institutional(sig)
    _score_spot_gex(sig)
    return sig


# ---------- Phase B: cascading funnel stage evaluators ----------
#
# Each stage answers a yes/no question. Pass = the signal layer agrees,
# fail = it doesn't. The Board ranks by (stages_passed DESC, score DESC)
# so cards visibly stack: 5/5 = thesis fully loaded, 3/5 = watch only.
# Thresholds are intentionally permissive on first pass — easier to tighten
# after seeing real distribution than to widen after surfacing nothing.


def _stage1_screener(sig: TickerSignals) -> tuple[bool, str]:
    """Stage 1 — Screener seed. Universe loader has already filtered to
    tickers that showed up in at least one UW screener / catalyst feed in
    the last 24h, so by the time we're here this is always TRUE. We still
    record the reason so the UI can show "where did this come from."
    """
    return True, "in UW universe seed"


def _stage2_flow(sig: TickerSignals) -> tuple[bool, str]:
    """Stage 2 — Flow confirmation. Needs sustained one-sided premium
    pressure on OTM calls, not just one alert."""
    if sig.total_otm_call_prem >= 1_000_000 and sig.strike_concentration_pct >= 0.3:
        return True, f"${sig.total_otm_call_prem/1e6:.1f}M call premium, {sig.strike_concentration_pct*100:.0f}% on top strike"
    if sig.total_otm_call_prem >= 5_000_000:
        return True, f"${sig.total_otm_call_prem/1e6:.1f}M call premium (size dominates)"
    if sig.flow_concentration_score >= 60:
        return True, f"flow_concentration_score {sig.flow_concentration_score:.0f}/100"
    return False, "no sustained one-sided call premium"


def _stage3_positioning(sig: TickerSignals) -> tuple[bool, str]:
    """Stage 3 — Positioning. Squeeze fuel: dealer short gamma, IV term
    inversion, or strong per-ticker GEX context."""
    reasons: list[str] = []
    if sig.spot_gamma_short:
        reasons.append("dealer short gamma")
    if sig.iv_term_inversion >= 0.05:
        reasons.append(f"IV term inverted +{sig.iv_term_inversion*100:.0f}%")
    if sig.gex_bonus_score >= 30:
        reasons.append(f"GEX context score {sig.gex_bonus_score:.0f}")
    if sig.spot_gex_score >= 30:
        reasons.append(f"intraday GEX score {sig.spot_gex_score:.0f}")
    if reasons:
        return True, " · ".join(reasons)
    return False, "no positioning fuel (no short gamma, no IV inversion, no GEX edge)"


def _stage4_catalyst(sig: TickerSignals) -> tuple[bool, str]:
    """Stage 4 — Catalyst. Needs a forcing function: catalyst in ≤14d, or
    flow so large it's a thesis on its own ($5M+)."""
    if sig.days_to_catalyst is not None and sig.days_to_catalyst <= 14:
        label = sig.catalyst_label or sig.catalyst_type or "catalyst"
        return True, f"{label} in {sig.days_to_catalyst}d"
    if sig.total_otm_call_prem >= 5_000_000:
        return True, f"exceptional flow ${sig.total_otm_call_prem/1e6:.1f}M (no catalyst needed)"
    return False, "no catalyst in 14d and flow not large enough to stand alone"


def _stage5_squeeze(sig: TickerSignals) -> tuple[bool, str]:
    """Stage 5 — Squeeze (BONUS, not gate). Short interest + FTD or high
    utilization = combustible mix on top of everything else."""
    has_si = sig.short_percent_float is not None and sig.short_percent_float >= 0.10
    has_ftd = sig.recent_ftd_quantity is not None and sig.recent_ftd_quantity > 0
    high_util = sig.utilization is not None and sig.utilization >= 0.7
    if has_si and (has_ftd or high_util):
        parts = [f"SI/float {sig.short_percent_float*100:.1f}%"]
        if has_ftd:
            parts.append(f"FTD {sig.recent_ftd_quantity:,}")
        if high_util:
            parts.append(f"util {sig.utilization*100:.0f}%")
        return True, " · ".join(parts)
    return False, "no squeeze fuel (low SI or no FTD/utilization)"


STAGES: list[tuple[str, Any]] = [
    ("stage1_passed", _stage1_screener),
    ("stage2_passed", _stage2_flow),
    ("stage3_passed", _stage3_positioning),
    ("stage4_passed", _stage4_catalyst),
    ("stage5_passed", _stage5_squeeze),
]


def _evaluate_stages(sig: TickerSignals) -> dict[str, Any]:
    """Run all 5 stage evaluators against a signals bundle. Returns a dict
    with the boolean flags, total count, and per-stage reasoning string.
    """
    out: dict[str, Any] = {}
    reasons: dict[str, str] = {}
    passed = 0
    for key, fn in STAGES:
        ok, why = fn(sig)
        out[key] = ok
        reasons[key.replace("_passed", "")] = why
        if ok:
            passed += 1
    out["stages_passed"] = passed
    out["stage_reasons"] = reasons
    return out


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
        # Phase 3
        + WEIGHTS["earnings_window"]    * sig.earnings_window_score
        + WEIGHTS["analyst"]            * sig.analyst_score
        + WEIGHTS["institutional"]      * sig.institutional_score
        + WEIGHTS["spot_gex"]           * sig.spot_gex_score
    )


def _upsert_score(
    conn: psycopg.Connection,
    snapshot_ts: datetime,
    sig: TickerSignals,
    score: float,
    stages: dict[str, Any],
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
            earnings_window_score, analyst_score, institutional_score, spot_gex_score,
            stage1_passed, stage2_passed, stage3_passed, stage4_passed, stage5_passed,
            stages_passed, stage_reasons,
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
            %(earnings_window_score)s, %(analyst_score)s, %(institutional_score)s, %(spot_gex_score)s,
            %(stage1_passed)s, %(stage2_passed)s, %(stage3_passed)s, %(stage4_passed)s, %(stage5_passed)s,
            %(stages_passed)s, %(stage_reasons)s,
            %(signals)s
        ) ON CONFLICT (snapshot_ts, ticker) DO UPDATE SET
            score = EXCLUDED.score,
            signals = EXCLUDED.signals,
            earnings_window_score = EXCLUDED.earnings_window_score,
            analyst_score = EXCLUDED.analyst_score,
            institutional_score = EXCLUDED.institutional_score,
            spot_gex_score = EXCLUDED.spot_gex_score,
            stage1_passed = EXCLUDED.stage1_passed,
            stage2_passed = EXCLUDED.stage2_passed,
            stage3_passed = EXCLUDED.stage3_passed,
            stage4_passed = EXCLUDED.stage4_passed,
            stage5_passed = EXCLUDED.stage5_passed,
            stages_passed = EXCLUDED.stages_passed,
            stage_reasons = EXCLUDED.stage_reasons
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
        "earnings_window_score": sig.earnings_window_score,
        "analyst_score": sig.analyst_score,
        "institutional_score": sig.institutional_score,
        "spot_gex_score": sig.spot_gex_score,
        "stage1_passed": bool(stages.get("stage1_passed", False)),
        "stage2_passed": bool(stages.get("stage2_passed", False)),
        "stage3_passed": bool(stages.get("stage3_passed", False)),
        "stage4_passed": bool(stages.get("stage4_passed", False)),
        "stage5_passed": bool(stages.get("stage5_passed", False)),
        "stages_passed": int(stages.get("stages_passed", 0)),
        "stage_reasons": Jsonb(stages.get("stage_reasons", {})),
        "signals": Jsonb(sig.reasons),
    }
    with conn.cursor() as cur:
        cur.execute(sql, params)


_SCORE_MAX_WORKERS = 6
_PER_TICKER_TIMEOUT_S = 25.0


def _score_one_ticker(database_url: str, ticker: str, now: datetime, today: date) -> tuple[str, int, float]:
    """Per-ticker work, run inside a worker thread with its own DB connection.
    psycopg connections are not thread-safe, so each worker owns one outright."""
    with connect(database_url) as wconn:
        with wconn.transaction():
            sig = _compute_signals(wconn, ticker, today)
            score = _composite(sig)
            stages = _evaluate_stages(sig)
            _upsert_score(wconn, now, sig, score, stages)
    return (ticker, int(stages.get("stages_passed", 0)), score)


def score_all(database_url: str) -> dict[str, Any]:
    """Compute and persist explosive_scores for every ticker in the universe.
    Returns {snapshot_ts, count, top: [{ticker, score}, ...]}

    Per-ticker work is 100% I/O-bound (~15 DB queries, no CPU), so we fan it
    out across a thread pool. Sequential mode was ~60-300s and tripped the
    UI's 5-min safety stop under any DB stress; parallel mode lands in 10-20s.
    """
    now = datetime.now(UTC)
    today = now.date()
    written = 0
    # (ticker, stages_passed, score) — preview is sorted by stages first,
    # then score, mirroring how /v1/explosive will rank the Board.
    top_preview: list[tuple[str, int, float]] = []

    # Load universe on a short-lived connection so we don't hold an idle
    # one while workers are running.
    with connect(database_url) as conn:
        universe = _load_universe(conn, today)
    log.info("explosive scoring: %d tickers in universe (workers=%d)", len(universe), _SCORE_MAX_WORKERS)

    progress_step = 25
    loop_started = time.monotonic()
    completed = 0

    with ThreadPoolExecutor(max_workers=_SCORE_MAX_WORKERS) as pool:
        futures = {pool.submit(_score_one_ticker, database_url, t, now, today): t for t in universe}
        for fut in as_completed(futures):
            ticker = futures[fut]
            try:
                # Per-ticker timeout guards against a single hung query stalling
                # the whole rescore. The thread itself can't be cancelled (Python
                # limitation) but the future stops blocking us.
                result = fut.result(timeout=_PER_TICKER_TIMEOUT_S)
                top_preview.append(result)
                written += 1
            except Exception as e:
                log.warning("scoring failed for %s: %s", ticker, e, exc_info=True)
            completed += 1
            if completed % progress_step == 0 or completed == len(universe):
                log.info(
                    "explosive scoring: %d / %d tickers done (%.1fs elapsed)",
                    completed, len(universe), time.monotonic() - loop_started,
                )

    top_preview.sort(key=lambda x: (x[1], x[2]), reverse=True)
    return {
        "snapshot_ts": now.isoformat(),
        "count": written,
        "top": [
            {"ticker": t, "stages": st, "score": round(s, 1)}
            for t, st, s in top_preview[:10]
        ],
    }
