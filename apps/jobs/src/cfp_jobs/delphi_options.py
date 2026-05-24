"""Option suggestions + EV calculator for Delphi predictions.

Bridges the gap between a Delphi prediction on the UNDERLYING
("NVDA bullish 1w, target 158, prob 0.68") and an actual tradeable
contract with a real price and a real expected $ payoff.

Pipeline:
  1. _pick_contract(): given (ticker, bias, primary_target, invalidation,
     horizon, spot), choose a strike (~target for OTM call/put) and an
     expiry (matched to horizon).
  2. _fetch_current_price(): pull the freshest mid from
       uw_flow_alerts (last 24h trade) → most recent
       uw_option_contract_history (yesterday close) → fallback
       Black-Scholes theoretical from spot + IV30 → last resort
  3. _bs_price(): Black-Scholes for theoretical value at any (spot, t, iv)
  4. _value_at_target(), _value_at_invalidation(): BS at the two outcome
     anchors, with the prediction's horizon as t_remaining.
  5. _compute_ev(): EV per contract in $ terms, given a position-time mid
     and Black-Scholes value at each outcome.
  6. suggest_for_prediction(): orchestrates and writes one row to
     delphi_option_suggestions.

Honest limits:
  - Assumes IV unchanged at outcome time. In reality IV crushes 20-30%
    when targets hit (especially earnings names). We over-estimate value
    at target by that much.
  - No multi-leg suggestions (verticals, condors, etc). One-legged only.
  - Risk-free rate from FRED DTB3 if present, else 5% default.
  - For 0DTE EOD predictions, picks shortest available expiry.
"""

from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect

log = logging.getLogger(__name__)


# Black-Scholes risk-free rate. Pulled from FRED DTB3 when present, else
# this fallback. Override via DELPHI_OPTIONS_RFR env (decimal: 0.05 = 5%).
DEFAULT_RFR = float(os.environ.get("DELPHI_OPTIONS_RFR", "0.05"))

# How many days out to look for a matching expiry per horizon. Soft target;
# picker walks the available expiries and picks nearest.
HORIZON_TO_DTE: dict[str, int] = {
    "EOD":  1,
    "1w":   7,
    "1mo":  30,
    "3mo":  90,
    "6mo":  180,
    "12mo": 365,
    "24mo": 540,
}

# How far OTM (as fraction of spot) for the suggested strike. Calls go above
# spot, puts below. Default tries to land near `primary_target` since that's
# where max payoff sits. Overrideable per-horizon if we find empirically that
# slightly-different OTM works better.
TARGET_OTM_FRAC: dict[str, float] = {
    "EOD":  0.005,   # near-ATM (0.5%)
    "1w":   0.02,    # ~2% OTM
    "1mo":  0.04,    # ~4%
    "3mo":  0.07,
    "6mo":  0.10,
    "12mo": 0.15,
    "24mo": 0.20,
}

# Assumed bankroll for Kelly contract sizing. $10k notional default.
# Real position size = floor(kelly_fraction * BANKROLL / (100 * mid)).
SIZING_BANKROLL = float(os.environ.get("DELPHI_OPTIONS_BANKROLL", "10000"))


# ----------------------------------------------------------------------------
# Black-Scholes (no dividend yield — close enough for short-dated US equities)
# ----------------------------------------------------------------------------


def _safe_fetchone(conn: psycopg.Connection, sql: str, params: tuple) -> tuple | None:
    """SELECT wrapped in a savepoint so a query failure (missing column,
    bad cast, etc) doesn't poison the outer transaction. Same defensive
    pattern as delphi_features._safe_fetchone — necessary because this
    module hits many UW tables some of which may not exist on a partial
    migration window.
    """
    try:
        with conn.transaction():
            return conn.execute(sql, params).fetchone()
    except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
        return None
    except Exception as e:  # noqa: BLE001
        log.debug("options safe-select failed: %s", e)
        return None


def _safe_fetchall(conn: psycopg.Connection, sql: str, params: tuple) -> list[tuple]:
    try:
        with conn.transaction():
            return conn.execute(sql, params).fetchall()
    except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
        return []
    except Exception as e:  # noqa: BLE001
        log.debug("options safe-select failed: %s", e)
        return []


def _norm_cdf(x: float) -> float:
    """Standard normal CDF via erf."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _bs_price(spot: float, strike: float, t_years: float, rfr: float, sigma: float, opt_type: str) -> float:
    """Black-Scholes price for European call/put. Returns 0 when degenerate."""
    if spot <= 0 or strike <= 0 or sigma <= 0:
        # Intrinsic value floor
        if opt_type == "C":
            return max(0.0, spot - strike)
        return max(0.0, strike - spot)
    if t_years <= 1e-6:
        # Expired — intrinsic only.
        if opt_type == "C":
            return max(0.0, spot - strike)
        return max(0.0, strike - spot)
    sqrt_t = math.sqrt(t_years)
    d1 = (math.log(spot / strike) + (rfr + 0.5 * sigma * sigma) * t_years) / (sigma * sqrt_t)
    d2 = d1 - sigma * sqrt_t
    if opt_type == "C":
        return spot * _norm_cdf(d1) - strike * math.exp(-rfr * t_years) * _norm_cdf(d2)
    return strike * math.exp(-rfr * t_years) * _norm_cdf(-d2) - spot * _norm_cdf(-d1)


def _bs_delta(spot: float, strike: float, t_years: float, rfr: float, sigma: float, opt_type: str) -> float:
    """BS delta. 0..1 for calls, -1..0 for puts."""
    if spot <= 0 or strike <= 0 or sigma <= 0 or t_years <= 1e-6:
        if opt_type == "C":
            return 1.0 if spot > strike else 0.0
        return -1.0 if spot < strike else 0.0
    sqrt_t = math.sqrt(t_years)
    d1 = (math.log(spot / strike) + (rfr + 0.5 * sigma * sigma) * t_years) / (sigma * sqrt_t)
    if opt_type == "C":
        return _norm_cdf(d1)
    return _norm_cdf(d1) - 1.0


# ----------------------------------------------------------------------------
# Contract picker
# ----------------------------------------------------------------------------


@dataclass
class ContractChoice:
    underlying: str
    option_type: str
    strike: float
    expiry: date
    contract_symbol: str | None  # OCC-style if we can construct it


def _round_strike(raw: float, spot: float) -> float:
    """Snap a raw strike to a plausible listed strike interval.

    Heuristic: $0.50 increments under $25, $1 under $100, $2.50 under $200,
    $5 above. Matches typical CBOE/OCC listing conventions for equity
    options. Not perfect — UW chain selection is the real fallback when
    the precise contract doesn't exist.
    """
    if spot < 25:
        step = 0.5
    elif spot < 100:
        step = 1.0
    elif spot < 200:
        step = 2.5
    else:
        step = 5.0
    return round(raw / step) * step


def _build_occ_symbol(underlying: str, expiry: date, opt_type: str, strike: float) -> str:
    """OCC option symbol: TICKER + YYMMDD + C/P + STRIKE*1000 padded.

    Example: AAPL 2024-06-21 C 180 -> AAPL240621C00180000
    """
    strike_int = int(round(strike * 1000))
    return f"{underlying}{expiry.strftime('%y%m%d')}{opt_type}{strike_int:08d}"


def _pick_contract(
    conn: psycopg.Connection,
    ticker: str,
    bias: str,
    spot: float,
    primary_target: float,
    horizon: str,
) -> ContractChoice | None:
    """Pick a strike + expiry for the prediction.

    Strike: aim for the `primary_target` (intrinsic at hit = max payoff per
    premium spent), snapped to listed interval. Fallback to spot * (1 ± OTM).

    Expiry: matched to horizon via HORIZON_TO_DTE; walks available expiries
    in uw_max_pain / uw_flow_per_expiry / uw_flow_alerts and picks nearest.
    """
    opt_type = "C" if bias == "bullish" else "P"
    # Strike candidate
    raw_strike = primary_target if primary_target and primary_target > 0 else (
        spot * (1 + TARGET_OTM_FRAC.get(horizon, 0.05)) if bias == "bullish"
        else spot * (1 - TARGET_OTM_FRAC.get(horizon, 0.05))
    )
    strike = _round_strike(raw_strike, spot)

    # Expiry candidate — query the available expiries from any UW table we have
    target_days = HORIZON_TO_DTE.get(horizon, 30)
    target_date_anchor = (datetime.now(UTC).date() + timedelta(days=target_days))

    # Try uw_max_pain first (we have per-expiry rows there)
    rows = []
    for sql in (
        "SELECT DISTINCT expiry FROM uw_max_pain WHERE ticker = %s AND expiry >= CURRENT_DATE",
        "SELECT DISTINCT expiry FROM uw_flow_per_expiry WHERE ticker = %s AND expiry >= CURRENT_DATE",
        "SELECT DISTINCT expiry FROM uw_flow_alerts WHERE ticker = %s AND expiry >= CURRENT_DATE",
    ):
        rows = _safe_fetchall(conn, sql, (ticker,))
        if rows:
            break

    if not rows:
        # No live data — synthesize a typical weekly Friday closest to target
        weekday = target_date_anchor.weekday()  # 4 = Friday
        offset = (4 - weekday) % 7
        expiry = target_date_anchor + timedelta(days=offset)
    else:
        expiries = sorted(r[0] for r in rows if r[0])
        # Pick the expiry whose distance to target_date_anchor is minimized
        expiry = min(expiries, key=lambda d: abs((d - target_date_anchor).days))

    return ContractChoice(
        underlying=ticker, option_type=opt_type,
        strike=float(strike), expiry=expiry,
        contract_symbol=_build_occ_symbol(ticker, expiry, opt_type, strike),
    )


# ----------------------------------------------------------------------------
# Price fetching
# ----------------------------------------------------------------------------


def _fetch_current_price(
    conn: psycopg.Connection, choice: ContractChoice, spot: float, iv: float,
) -> tuple[float | None, float | None, float | None, float | None, str, datetime | None]:
    """Find the freshest available mid/bid/ask/iv for the chosen contract.

    Returns (mid, bid, ask, iv, source, as_of). Always returns SOMETHING —
    Black-Scholes fallback is computed against the passed `iv` (which is the
    underlying iv30 from features).
    """
    # Source 1: uw_flow_alerts for that ticker/strike/expiry/type in last 7d
    row = _safe_fetchone(
        conn,
        """
        SELECT price, iv_end, created_at
        FROM uw_flow_alerts
        WHERE ticker = %s
          AND expiry = %s
          AND strike = %s
          AND option_type = %s
          AND created_at >= NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC LIMIT 1
        """,
        (choice.underlying, choice.expiry, choice.strike,
         "call" if choice.option_type == "C" else "put"),
    )
    if row and row[0]:
        mid = float(row[0])
        return (mid, None, None, float(row[1]) if row[1] else iv,
                "uw_flow", row[2])

    # Source 2: uw_option_contract_history latest close
    if choice.contract_symbol:
        row = _safe_fetchone(
            conn,
            """
            SELECT close, iv, date::timestamptz
            FROM uw_option_contract_history
            WHERE option_symbol = %s AND close IS NOT NULL
            ORDER BY date DESC LIMIT 1
            """,
            (choice.contract_symbol,),
        )
        if row and row[0]:
            mid = float(row[0])
            return (mid, None, None,
                    float(row[1]) if row[1] else iv,
                    "uw_history", row[2])

    # Source 3: Black-Scholes theoretical from underlying spot + iv
    rfr = _risk_free_rate(conn)
    days = max(1, (choice.expiry - datetime.now(UTC).date()).days)
    theo = _bs_price(spot, choice.strike, days / 365.0, rfr, max(0.05, iv), choice.option_type)
    return (theo, None, None, iv, "bs_theo", datetime.now(UTC))


def _risk_free_rate(conn: psycopg.Connection) -> float:
    """Pull latest 3M T-bill from FRED DTB3 if ingested, else fallback."""
    row = _safe_fetchone(
        conn,
        "SELECT value FROM macro_daily WHERE series_id = 'DTB3' AND value IS NOT NULL ORDER BY ts DESC LIMIT 1",
        (),
    )
    if row and row[0]:
        # DTB3 is percent, e.g. 5.32 -> 0.0532
        return float(row[0]) / 100.0
    return DEFAULT_RFR


# ----------------------------------------------------------------------------
# EV calculation
# ----------------------------------------------------------------------------


def _compute_ev(
    cost: float, prob_hit: float,
    value_at_target: float, value_at_invalidation: float,
) -> tuple[float | None, float | None, float | None]:
    """Returns (ev_per_contract_$, ev_pct_of_cost, breakeven_probability).

    Per-share math; multiply by 100 for $ per contract.
    ev = p * (val_target - cost) + (1-p) * (val_invalid - cost)
    breakeven_p = (cost - val_invalid) / (val_target - val_invalid)
    """
    if cost is None or cost <= 0:
        return (None, None, None)
    payoff_hit = (value_at_target - cost) * 100  # per contract
    payoff_miss = (value_at_invalidation - cost) * 100
    ev = prob_hit * payoff_hit + (1 - prob_hit) * payoff_miss
    pct = ev / (cost * 100) if cost > 0 else None
    denom = value_at_target - value_at_invalidation
    if abs(denom) < 1e-9:
        breakeven = None
    else:
        breakeven = (cost - value_at_invalidation) / denom
        breakeven = max(0.0, min(1.0, breakeven))
    return (ev, pct, breakeven)


# ----------------------------------------------------------------------------
# Orchestration
# ----------------------------------------------------------------------------


def suggest_for_prediction(conn: psycopg.Connection, prediction_id: str) -> dict[str, Any] | None:
    """Build + persist an option suggestion for the given prediction.

    Returns the persisted row dict; None on hard failure (e.g. prediction
    not found).
    """
    pred = _safe_fetchone(
        conn,
        """
        SELECT ticker, bias, current_price, primary_target, invalidation,
               forecast_horizon, probability, kelly_fraction, features
        FROM delphi_predictions WHERE prediction_id = %s
        """,
        (prediction_id,),
    )
    if not pred:
        return None
    ticker, bias, spot, primary_target, invalidation, horizon, prob, kelly, features = pred
    if bias not in ("bullish", "bearish") or not spot or spot <= 0:
        return None  # no contract picker for vol_expansion yet

    # Use the row's stored iv30 when present, else fall back to iv_rank proxy
    iv = None
    if isinstance(features, dict):
        snap = features.get("features_snapshot") or {}
        promoted = features.get("promoted_snapshot") or {}
        iv = snap.get("iv30") or promoted.get("iv30") or features.get("iv30")
    iv = float(iv) if iv else 0.35  # 35% fallback default
    if iv > 5:  # if returned as percent
        iv = iv / 100.0

    choice = _pick_contract(conn, ticker, bias, float(spot), float(primary_target), horizon)
    if not choice:
        return None

    rfr = _risk_free_rate(conn)
    days_remaining = max(1, (choice.expiry - datetime.now(UTC).date()).days)
    t_remaining = days_remaining / 365.0

    mid, bid, ask, current_iv, source, as_of = _fetch_current_price(conn, choice, float(spot), iv)
    if mid is None or mid <= 0:
        return None

    # BS values at the outcome anchors. Assume IV unchanged at hit (over-
    # optimistic; real IV crushes 20-30% on hit, especially earnings).
    theo_now = _bs_price(float(spot), choice.strike, t_remaining, rfr,
                         current_iv or iv, choice.option_type)
    delta = _bs_delta(float(spot), choice.strike, t_remaining, rfr,
                      current_iv or iv, choice.option_type)
    val_target = _bs_price(float(primary_target), choice.strike, t_remaining, rfr,
                           current_iv or iv, choice.option_type)
    val_invalid = _bs_price(float(invalidation), choice.strike, t_remaining, rfr,
                            current_iv or iv, choice.option_type)

    ev, ev_pct, breakeven = _compute_ev(mid, float(prob), val_target, val_invalid)

    # Sizing — floor of (kelly * bankroll) / (100 * mid)
    contracts_at_kelly = None
    if kelly and kelly > 0 and mid > 0:
        contracts_at_kelly = max(0, int((float(kelly) * SIZING_BANKROLL) / (100 * mid)))

    rationale = (
        f"{choice.option_type} strike {choice.strike} (target {primary_target:.2f}), "
        f"expiry {choice.expiry} ({days_remaining}d), "
        f"mid ${mid:.2f} from {source}. "
        f"EV ${ev:.0f}/contract ({(ev_pct or 0) * 100:.0f}%) "
        f"if prob {prob:.0%} holds; "
        f"breakeven at {(breakeven or 0):.0%} prob."
        if ev is not None else f"{choice.option_type} {choice.strike} {choice.expiry}, mid ${mid:.2f}"
    )

    conn.execute(
        """
        INSERT INTO delphi_option_suggestions (
            prediction_id, contract_symbol, underlying, option_type, strike,
            expiry, days_to_expiry,
            current_mid, current_bid, current_ask, current_iv, current_delta,
            price_source, price_as_of,
            theo_price_now, value_at_target, value_at_invalidation,
            ev_per_contract, ev_pct_of_cost, breakeven_probability,
            contracts_at_kelly, rationale, payload
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s
        ) ON CONFLICT (prediction_id) DO UPDATE SET
            current_mid = EXCLUDED.current_mid,
            current_iv = EXCLUDED.current_iv,
            current_delta = EXCLUDED.current_delta,
            price_source = EXCLUDED.price_source,
            price_as_of = EXCLUDED.price_as_of,
            theo_price_now = EXCLUDED.theo_price_now,
            value_at_target = EXCLUDED.value_at_target,
            value_at_invalidation = EXCLUDED.value_at_invalidation,
            ev_per_contract = EXCLUDED.ev_per_contract,
            ev_pct_of_cost = EXCLUDED.ev_pct_of_cost,
            breakeven_probability = EXCLUDED.breakeven_probability,
            contracts_at_kelly = EXCLUDED.contracts_at_kelly,
            rationale = EXCLUDED.rationale,
            payload = EXCLUDED.payload
        """,
        (
            prediction_id, choice.contract_symbol, choice.underlying,
            choice.option_type, choice.strike, choice.expiry, days_remaining,
            mid, bid, ask, current_iv, delta,
            source, as_of,
            theo_now, val_target, val_invalid,
            ev, ev_pct, breakeven,
            contracts_at_kelly, rationale,
            Jsonb({
                "spot_at_suggest": spot, "rfr": rfr, "t_remaining_years": t_remaining,
                "iv_used": current_iv or iv,
                "assumes_iv_unchanged_at_outcome": True,
                "sizing_bankroll": SIZING_BANKROLL,
            }),
        ),
    )
    return {
        "prediction_id": prediction_id,
        "contract_symbol": choice.contract_symbol,
        "mid": mid, "ev_per_contract": ev, "ev_pct": ev_pct,
        "value_at_target": val_target, "value_at_invalidation": val_invalid,
        "source": source,
    }


def suggest_recent(database_url: str, hours: int = 24) -> dict[str, Any]:
    """Build suggestions for every v0.3 prediction in the last `hours`.

    Uses a FRESH connection per prediction so a poisoned transaction in one
    ticker (e.g. a SELECT throwing on a missing table) cannot abort the rest.
    First production run skipped all 300 with "current transaction is
    aborted" because the per-prediction work shared one conn; this fixes it.
    """
    n_ok = n_skip = 0
    by_source: dict[str, int] = {}
    with connect(database_url) as list_conn:
        rows = list_conn.execute(
            """
            SELECT prediction_id FROM delphi_predictions
            WHERE model_version = 'v0.3-quant'
              AND created_at >= NOW() - (%s || ' hours')::interval
              AND bias IN ('bullish', 'bearish')
            ORDER BY created_at DESC
            """,
            (hours,),
        ).fetchall()

    for (pid,) in rows:
        try:
            with connect(database_url) as conn:
                out = suggest_for_prediction(conn, pid)
                conn.commit()
            if out is None:
                n_skip += 1
            else:
                n_ok += 1
                src = out["source"]
                by_source[src] = by_source.get(src, 0) + 1
        except Exception as e:  # noqa: BLE001
            log.warning("option suggest failed for %s: %s", pid, e)
            n_skip += 1
    return {"suggested": n_ok, "skipped": n_skip, "by_price_source": by_source}
