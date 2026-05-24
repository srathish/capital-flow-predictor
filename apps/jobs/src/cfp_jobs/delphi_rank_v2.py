"""Delphi ranker v0.2 — features-based, regime-stratified, conflict-aware.

Replaces v0.1's "join 3 tables in the ranker" with "read delphi_features
which already joined ~20 tables." Same delphi_predictions schema — the only
distinguishing column is model_version='v0.2-features', so A/B comparisons
flow naturally through delphi_model_performance.

What v0.2 does differently from v0.1:

  1. Reads delphi_features (which carries ~120 features per ticker) instead
     of three raw tables. Reachability check, GEX wall logic, and IV-based
     expected move all become trivial joins on the composed row.

  2. Tags every prediction with the latest composite_regime
     (e.g. 'uptrend_normal_risk_on'). Previously this was NULL on every row,
     which made the regime-stratified calibration buckets useless. With it,
     each calibration bucket sees a behaviorally homogeneous sample.

  3. Expanded reason codes (~40 vs ~12). Each non-null feature can mint a
     code (DARK_POOL_BUY_24H, INSIDER_CLUSTER_BUY_30D, CONGRESS_BUYING_14D,
     OI_OPENING_RATIO_HIGH, MAX_PAIN_PIN_NEAR, SHORT_SQUEEZE_SETUP,
     EARNINGS_INSIDE_HORIZON, ANALYST_NET_UPGRADE, INST_NET_BUYER_90D,
     CALL_PUT_RATIO_SPIKE, SWEEP_HEAVY_24H, SKEW_CALL_HEAVY, NOPE_EXTREME,
     UW_SMART_MONEY_BULL, RSI_OVERSOLD_REVERSAL, MA_GOLDEN_CROSS,
     ATR_EXPANSION, BB_SQUEEZE, OBV_RISING, VOLUME_BREAKOUT, etc).

  4. Conflict dampening. delphi_features.conflict_codes gets read; each
     conflict code subtracts a small probability nudge (default -0.05) and
     emits a CONFLICT_* reason code so the trader can see why a setup
     scored lower than expected.

  5. Expected move uses true IV30 (when present) instead of the iv_rank
     proxy. Falls back to the proxy when IV30 is missing, so behavior is
     monotone.

  6. ML overlay (Layer 4) blend: when DELPHI_USE_ML_OVERLAY=true and an
     active delphi_ml_models row exists, blend the rules probability with
     the calibrated ML probability (default 60/40 toward ML).

  7. Holdout assignment: every prediction is hashed into delphi_holdout_set
     with a deterministic 15% bucket so the training loop can stratify
     train/val/holdout honestly.

The v0.1 ranker keeps writing in parallel until v0.2 has matured against
real outcomes. delphi_model_performance shows both rows side by side.
"""

from __future__ import annotations

import hashlib
import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect

log = logging.getLogger(__name__)


MODEL_VERSION = "v0.2-features"


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


USE_ADAPTIVE_WEIGHTS = _flag("DELPHI_USE_ADAPTIVE_WEIGHTS", default=True)
USE_CALIBRATION     = _flag("DELPHI_USE_CALIBRATION", default=True)
USE_AGENT_ENSEMBLE  = _flag("DELPHI_USE_AGENT_ENSEMBLE", default=True)
USE_ML_OVERLAY      = _flag("DELPHI_USE_ML_OVERLAY", default=False)
USE_UW_PRED_VOTERS  = _flag("DELPHI_USE_UW_PRED_VOTERS", default=True)


HOLDOUT_PCT = int(os.environ.get("DELPHI_HOLDOUT_PCT", "15"))

_PROB_MIN, _PROB_MAX = 0.20, 0.95

SIGNAL_TO_HORIZONS: dict[str, list[str]] = {
    "5m":  ["EOD"],
    "1h":  ["1w"],
    "4h":  ["1mo"],
    "1d":  ["3mo", "6mo"],
    "1w":  ["12mo"],
}

HORIZON_HOURS: dict[str, int] = {
    "EOD": 8,
    "1w":  24 * 7,
    "1mo": 24 * 30,
    "3mo": 24 * 90,
    "6mo": 24 * 180,
    "12mo": 24 * 365,
    "24mo": 24 * 365 * 2,
}

REACHABILITY: dict[str, float] = {
    "EOD": 1.5, "1w": 1.75, "1mo": 2.0,
    "3mo": 2.5, "6mo": 3.0, "12mo": 4.0,
}

# Per-conflict probability dampening. Tuned conservatively — multiple
# conflicts can stack but we cap total at -0.20.
CONFLICT_DAMP: dict[str, float] = {
    "CONFLICT_LATEDAY_DP_VS_FLOW":         -0.08,
    "CONFLICT_INSIDER_SELL_VS_BULL_FLOW":  -0.07,
    "CONFLICT_MAX_PAIN_BELOW_BULL":        -0.04,
    "CONFLICT_ANALYST_DOWN_VS_BULL_FLOW":  -0.05,
    "CONFLICT_UW_SMART_VS_WHALES":         -0.05,
}
MAX_CONFLICT_DAMP = -0.20


# ----------------------------------------------------------------------------
# Feature load
# ----------------------------------------------------------------------------


@dataclass
class FeatureSnapshot:
    ticker: str
    snapshot_ts: datetime
    spot: float
    iv_rank: float | None
    iv30: float | None
    rv30: float | None
    composite_regime: str
    has_conflict: bool
    conflict_codes: list[str]
    promoted: dict[str, Any]     # one row from delphi_features cols
    features: dict[str, Any]     # JSONB blob (price action + flow + gex detail)


def _latest_features(conn: psycopg.Connection, limit: int) -> list[FeatureSnapshot]:
    """Pull the freshest delphi_features rows. One per ticker, freshest snapshot.

    Drops rows with no spot price (price filter mirrors v0.1).
    """
    rows = conn.execute(
        """
        WITH ranked AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY snapshot_ts DESC) AS rn
            FROM delphi_features
        )
        SELECT
            ticker, snapshot_ts, spot_price, iv_rank, iv30, rv30,
            dp_net_premium_24h, dp_print_count_24h, dp_late_day_share,
            insider_net_30d, insider_buyers_30d, insider_sellers_30d,
            congress_buys_14d, congress_sells_14d,
            oi_delta_call_1d, oi_delta_put_1d, oi_opening_ratio,
            max_pain_distance, max_pain_expiry,
            short_pct_float, short_fee_rate, short_utilization,
            days_to_earnings, earnings_in_horizon,
            analyst_revisions_30d, analyst_net_upgrade,
            inst_net_delta_shares,
            gex_expiry_front,
            rr_skew_25d, nope_score,
            uw_smart_money_score, uw_whales_score,
            news_count_24h, news_sentiment_24h,
            seasonality_avg_ret,
            vol_regime, trend_regime, macro_regime,
            has_conflict, conflict_codes, features
        FROM ranked
        WHERE rn = 1
          AND spot_price IS NOT NULL AND spot_price > 1.0
        ORDER BY snapshot_ts DESC
        LIMIT %s
        """,
        (limit,),
    ).fetchall()

    out: list[FeatureSnapshot] = []
    for r in rows:
        composite = f"{r[36] or 'rangebound'}_{r[35] or 'normal'}_{r[37] or 'neutral'}"
        promoted: dict[str, Any] = {
            "dp_net_premium_24h":   r[6],
            "dp_print_count_24h":   r[7],
            "dp_late_day_share":    r[8],
            "insider_net_30d":      r[9],
            "insider_buyers_30d":   r[10],
            "insider_sellers_30d":  r[11],
            "congress_buys_14d":    r[12],
            "congress_sells_14d":   r[13],
            "oi_delta_call_1d":     r[14],
            "oi_delta_put_1d":      r[15],
            "oi_opening_ratio":     r[16],
            "max_pain_distance":    r[17],
            "max_pain_expiry":      r[18],
            "short_pct_float":      r[19],
            "short_fee_rate":       r[20],
            "short_utilization":    r[21],
            "days_to_earnings":     r[22],
            "earnings_in_horizon":  r[23],
            "analyst_revisions_30d": r[24],
            "analyst_net_upgrade":   r[25],
            "inst_net_delta_shares": r[26],
            "gex_expiry_front":     r[27],
            "rr_skew_25d":          r[28],
            "nope_score":           r[29],
            "uw_smart_money_score": r[30],
            "uw_whales_score":      r[31],
            "news_count_24h":       r[32],
            "news_sentiment_24h":   r[33],
            "seasonality_avg_ret":  r[34],
        }
        out.append(FeatureSnapshot(
            ticker=r[0],
            snapshot_ts=r[1],
            spot=float(r[2]),
            iv_rank=float(r[3]) if r[3] is not None else None,
            iv30=float(r[4]) if r[4] is not None else None,
            rv30=float(r[5]) if r[5] is not None else None,
            composite_regime=composite,
            has_conflict=bool(r[38]),
            conflict_codes=list(r[39] or []),
            promoted=promoted,
            features=dict(r[40] or {}),
        ))
    return out


# ----------------------------------------------------------------------------
# Reason code emission — turn a feature snapshot into ~40 named signals.
# Each emitted code is a binary decision; downstream learning measures which
# codes pay so we don't have to weight them by hand.
# ----------------------------------------------------------------------------


def _emit_reason_codes(fs: FeatureSnapshot, bias: str) -> list[str]:  # noqa: PLR0912, PLR0915
    codes: list[str] = []
    pr = fs.promoted
    feat = fs.features

    # --- options flow ---
    if pr["dp_net_premium_24h"] and float(pr["dp_net_premium_24h"]) > 1_000_000:
        codes.append("DARK_POOL_BUY_24H")
    elif pr["dp_net_premium_24h"] and float(pr["dp_net_premium_24h"]) < -1_000_000:
        codes.append("DARK_POOL_SELL_24H")
    if pr["dp_late_day_share"] and float(pr["dp_late_day_share"]) > 0.5:
        codes.append("DARK_POOL_LATE_DAY_HEAVY")

    # --- insider ---
    if (pr["insider_buyers_30d"] or 0) >= 3 and (pr["insider_sellers_30d"] or 0) == 0:
        codes.append("INSIDER_CLUSTER_BUY_30D")
    if (pr["insider_sellers_30d"] or 0) >= 5:
        codes.append("INSIDER_CLUSTER_SELL_30D")

    # --- congress ---
    if (pr["congress_buys_14d"] or 0) >= 2 and (pr["congress_sells_14d"] or 0) == 0:
        codes.append("CONGRESS_BUYING_14D")

    # --- OI ---
    if pr["oi_opening_ratio"] and float(pr["oi_opening_ratio"]) > 0.5:
        codes.append("OI_OPENING_RATIO_HIGH")
    if (pr["oi_delta_call_1d"] or 0) > 0 and (pr["oi_delta_put_1d"] or 0) < 0:
        codes.append("OI_CALL_BUILD_PUT_UNWIND")
    if (pr["oi_delta_call_1d"] or 0) < 0 and (pr["oi_delta_put_1d"] or 0) > 0:
        codes.append("OI_PUT_BUILD_CALL_UNWIND")

    # --- max pain ---
    mp_dist = pr["max_pain_distance"]
    if mp_dist is not None and abs(float(mp_dist)) < 0.02:
        codes.append("MAX_PAIN_PIN_NEAR")

    # --- short ---
    if pr["short_fee_rate"] and float(pr["short_fee_rate"]) > 0.10:
        codes.append("SHORT_FEE_ELEVATED")
    if pr["short_utilization"] and float(pr["short_utilization"]) > 0.85:
        codes.append("SHORT_SQUEEZE_SETUP")

    # --- earnings ---
    de = pr["days_to_earnings"]
    if de is not None and 0 <= int(de) <= 7:
        codes.append("EARNINGS_WITHIN_1W")
    elif de is not None and 0 <= int(de) <= 30:
        codes.append("EARNINGS_WITHIN_1MO")

    # --- analyst ---
    if (pr["analyst_net_upgrade"] or 0) >= 2:
        codes.append("ANALYST_NET_UPGRADE")
    elif (pr["analyst_net_upgrade"] or 0) <= -2:
        codes.append("ANALYST_NET_DOWNGRADE")

    # --- institutional ---
    if pr["inst_net_delta_shares"] and int(pr["inst_net_delta_shares"]) > 0:
        codes.append("INST_NET_BUYER_90D")
    elif pr["inst_net_delta_shares"] and int(pr["inst_net_delta_shares"]) < 0:
        codes.append("INST_NET_SELLER_90D")

    # --- GEX ---
    if pr["gex_expiry_front"] is not None and float(pr["gex_expiry_front"]) > 0:
        codes.append("GEX_POSITIVE_FRONT")
    elif pr["gex_expiry_front"] is not None and float(pr["gex_expiry_front"]) < 0:
        codes.append("GEX_NEGATIVE_FRONT")

    # --- skew / NOPE ---
    if pr["rr_skew_25d"] and float(pr["rr_skew_25d"]) > 0.02:
        codes.append("SKEW_CALL_HEAVY")
    elif pr["rr_skew_25d"] and float(pr["rr_skew_25d"]) < -0.02:
        codes.append("SKEW_PUT_HEAVY")
    if pr["nope_score"] is not None and abs(float(pr["nope_score"])) > 100:
        codes.append("NOPE_EXTREME")

    # --- UW prediction voters ---
    if pr["uw_smart_money_score"] is not None and float(pr["uw_smart_money_score"]) >= 0.65:
        codes.append("UW_SMART_MONEY_BULL")
    elif pr["uw_smart_money_score"] is not None and float(pr["uw_smart_money_score"]) <= 0.35:
        codes.append("UW_SMART_MONEY_BEAR")
    if pr["uw_whales_score"] is not None and float(pr["uw_whales_score"]) >= 0.65:
        codes.append("UW_WHALES_BULL")

    # --- news ---
    if (pr["news_count_24h"] or 0) >= 10 and (pr["news_sentiment_24h"] or 0) > 0.3:
        codes.append("NEWS_BULL_VOLUME_HIGH")
    elif (pr["news_count_24h"] or 0) >= 10 and (pr["news_sentiment_24h"] or 0) < -0.3:
        codes.append("NEWS_BEAR_VOLUME_HIGH")

    # --- price action (from JSONB) ---
    rsi = feat.get("rsi_14")
    if rsi is not None and float(rsi) <= 30 and bias == "bullish":
        codes.append("RSI_OVERSOLD_REVERSAL")
    elif rsi is not None and float(rsi) >= 70 and bias == "bearish":
        codes.append("RSI_OVERBOUGHT_REVERSAL")

    ma_20 = feat.get("ma_20_distance")
    ma_50 = feat.get("ma_50_distance")
    ma_200 = feat.get("ma_200_distance")
    if all(v is not None for v in (ma_20, ma_50, ma_200)) and ma_20 > 0 and ma_50 > 0 and ma_200 > 0:
        codes.append("ABOVE_ALL_MAS")
    elif all(v is not None for v in (ma_20, ma_50, ma_200)) and ma_20 < 0 and ma_50 < 0 and ma_200 < 0:
        codes.append("BELOW_ALL_MAS")

    macd_h = feat.get("macd_histogram")
    if macd_h is not None and float(macd_h) > 0:
        codes.append("MACD_BULL_HIST")
    elif macd_h is not None and float(macd_h) < 0:
        codes.append("MACD_BEAR_HIST")

    bb_pct = feat.get("bb_pct_position")
    if bb_pct is not None and float(bb_pct) < 0.05:
        codes.append("BB_LOWER_BAND_TAG")
    elif bb_pct is not None and float(bb_pct) > 0.95:
        codes.append("BB_UPPER_BAND_TAG")

    bb_w = feat.get("bb_width")
    if bb_w is not None and float(bb_w) < 0.04:
        codes.append("BB_SQUEEZE")

    obv = feat.get("obv_slope_20")
    if obv is not None and float(obv) > 0.5:
        codes.append("OBV_RISING")
    elif obv is not None and float(obv) < -0.5:
        codes.append("OBV_FALLING")

    vol_vs_30 = feat.get("volume_vs_30d")
    if vol_vs_30 is not None and float(vol_vs_30) > 2.0:
        codes.append("VOLUME_BREAKOUT")
    elif vol_vs_30 is not None and float(vol_vs_30) < 0.5:
        codes.append("VOLUME_DROUGHT")

    adx = feat.get("adx_14")
    if adx is not None and float(adx) > 30:
        codes.append("ADX_STRONG_TREND")

    rs_5 = feat.get("ret_vs_spy_5d")
    if rs_5 is not None and float(rs_5) > 0.05:
        codes.append("RS_STRONG_VS_SPY_5D")
    elif rs_5 is not None and float(rs_5) < -0.05:
        codes.append("RS_WEAK_VS_SPY_5D")

    dist_hi = feat.get("dist_52w_high")
    if dist_hi is not None and float(dist_hi) > -0.02:
        codes.append("NEAR_52W_HIGH")

    gap = feat.get("gap_pct_today")
    if gap is not None and abs(float(gap)) > 0.03:
        codes.append("GAP_TODAY_LARGE")

    return codes


# ----------------------------------------------------------------------------
# Bias + expected move
# ----------------------------------------------------------------------------


def _decide_bias(fs: FeatureSnapshot) -> str:
    """Composite bias from features. Bullish if more bull signals than bear."""
    pr = fs.promoted
    feat = fs.features
    bull = bear = 0
    if (pr.get("uw_smart_money_score") or 0.5) > 0.55:
        bull += 1
    if (pr.get("uw_smart_money_score") or 0.5) < 0.45:
        bear += 1
    if (pr.get("uw_whales_score") or 0.5) > 0.55:
        bull += 1
    if (pr.get("uw_whales_score") or 0.5) < 0.45:
        bear += 1
    if (feat.get("macd_histogram") or 0) > 0:
        bull += 1
    elif (feat.get("macd_histogram") or 0) < 0:
        bear += 1
    if (pr.get("dp_net_premium_24h") or 0) > 0:
        bull += 1
    elif (pr.get("dp_net_premium_24h") or 0) < 0:
        bear += 1
    if (pr.get("insider_buyers_30d") or 0) >= 2:
        bull += 1
    if (pr.get("insider_sellers_30d") or 0) >= 3:
        bear += 1
    return "bullish" if bull >= bear else "bearish"


def _expected_move(fs: FeatureSnapshot, horizon: str) -> float:
    """Annualized IV scaled by horizon. Uses iv30 when present, else proxy."""
    if fs.iv30 is not None and fs.iv30 > 0:
        sigma = fs.iv30 / 100.0 if fs.iv30 > 5 else fs.iv30  # UW may return % or fraction
    elif fs.iv_rank is not None:
        sigma = max(0.15, min(1.0, fs.iv_rank / 100.0 + 0.20))
    else:
        sigma = 0.35
    years = HORIZON_HOURS[horizon] / (24 * 365)
    return sigma * (years ** 0.5)


# ----------------------------------------------------------------------------
# Probability composition
# ----------------------------------------------------------------------------


def _base_probability(fs: FeatureSnapshot, bias: str, reason_codes: list[str]) -> float:
    """v0.2 base probability — count signals consistent with the bias."""
    pr = fs.promoted
    # Anchor at 0.50; each consistent signal nudges +0.025, opposing -0.025.
    bull_codes = {
        "DARK_POOL_BUY_24H", "INSIDER_CLUSTER_BUY_30D", "CONGRESS_BUYING_14D",
        "OI_OPENING_RATIO_HIGH", "OI_CALL_BUILD_PUT_UNWIND",
        "SHORT_SQUEEZE_SETUP", "ANALYST_NET_UPGRADE", "INST_NET_BUYER_90D",
        "GEX_POSITIVE_FRONT", "SKEW_CALL_HEAVY", "UW_SMART_MONEY_BULL",
        "UW_WHALES_BULL", "NEWS_BULL_VOLUME_HIGH", "RSI_OVERSOLD_REVERSAL",
        "ABOVE_ALL_MAS", "MACD_BULL_HIST", "BB_LOWER_BAND_TAG",
        "OBV_RISING", "VOLUME_BREAKOUT", "RS_STRONG_VS_SPY_5D",
        "ADX_STRONG_TREND",
    }
    bear_codes = {
        "DARK_POOL_SELL_24H", "INSIDER_CLUSTER_SELL_30D",
        "OI_PUT_BUILD_CALL_UNWIND", "ANALYST_NET_DOWNGRADE",
        "INST_NET_SELLER_90D", "GEX_NEGATIVE_FRONT", "SKEW_PUT_HEAVY",
        "UW_SMART_MONEY_BEAR", "NEWS_BEAR_VOLUME_HIGH",
        "RSI_OVERBOUGHT_REVERSAL", "BELOW_ALL_MAS", "MACD_BEAR_HIST",
        "BB_UPPER_BAND_TAG", "OBV_FALLING", "RS_WEAK_VS_SPY_5D",
    }
    p = 0.50
    for code in reason_codes:
        if code in bull_codes:
            p += 0.025 if bias == "bullish" else -0.025
        elif code in bear_codes:
            p += 0.025 if bias == "bearish" else -0.025
    # IV regime soft penalty for crowded bullish bets in high vol.
    if bias == "bullish" and fs.iv_rank is not None and fs.iv_rank >= 80:
        p -= 0.03
    return max(_PROB_MIN, min(_PROB_MAX, p))


def _apply_conflicts(p: float, conflicts: list[str]) -> tuple[float, list[str]]:
    total = 0.0
    applied: list[str] = []
    for code in conflicts:
        damp = CONFLICT_DAMP.get(code, -0.03)
        total += damp
        applied.append(code)
    total = max(MAX_CONFLICT_DAMP, total)
    return (max(_PROB_MIN, min(_PROB_MAX, p + total)), applied)


def _load_reason_code_hit_rates(
    conn: psycopg.Connection, signal_tf: str, horizon: str, regime: str
) -> dict[str, tuple[float, int]]:
    if not USE_ADAPTIVE_WEIGHTS:
        return {}
    rows = conn.execute(
        """
        SELECT reason_code, target_hit_rate, sample_size
        FROM delphi_reason_code_performance
        WHERE signal_timeframe = %s
          AND forecast_horizon = %s
          AND regime IN (%s, 'any')
          AND target_hit_rate IS NOT NULL
          AND sample_size >= 20
        ORDER BY (regime = %s) DESC, sample_size DESC
        """,
        (signal_tf, horizon, regime, regime),
    ).fetchall()
    out: dict[str, tuple[float, int]] = {}
    for rc, hit, n in rows:
        out.setdefault(rc, (float(hit), int(n)))
    return out


def _calibrate(conn: psycopg.Connection, p: float, horizon: str, regime: str) -> float:
    if not USE_CALIBRATION:
        return p
    row = conn.execute(
        """
        SELECT adjusted_probability
        FROM delphi_calibration_buckets
        WHERE forecast_horizon = %s
          AND regime IN (%s, 'any')
          AND %s BETWEEN
                CASE probability_bucket
                    WHEN '50-55' THEN 0.50 WHEN '55-60' THEN 0.55
                    WHEN '60-65' THEN 0.60 WHEN '65-70' THEN 0.65
                    WHEN '70-75' THEN 0.70 WHEN '75-80' THEN 0.75
                    WHEN '80-85' THEN 0.80 WHEN '85-90' THEN 0.85
                    WHEN '90-95' THEN 0.90 WHEN '95-100' THEN 0.95
                    ELSE 0 END
            AND
                CASE probability_bucket
                    WHEN '50-55' THEN 0.55 WHEN '55-60' THEN 0.60
                    WHEN '60-65' THEN 0.65 WHEN '65-70' THEN 0.70
                    WHEN '70-75' THEN 0.75 WHEN '75-80' THEN 0.80
                    WHEN '80-85' THEN 0.85 WHEN '85-90' THEN 0.90
                    WHEN '90-95' THEN 0.95 WHEN '95-100' THEN 1.01
                    ELSE 1.01 END - 0.0001
        ORDER BY (regime = %s) DESC
        LIMIT 1
        """,
        (horizon, regime, p, regime),
    ).fetchone()
    return float(row[0]) if row and row[0] is not None else p


def _load_active_ml_model(conn: psycopg.Connection) -> dict[str, Any] | None:
    if not USE_ML_OVERLAY:
        return None
    row = conn.execute(
        """
        SELECT model_version, model_blob, calibrator_blob, hyperparams
        FROM delphi_ml_models
        WHERE status = 'active'
        ORDER BY created_at DESC LIMIT 1
        """
    ).fetchone()
    if not row or not row[1]:
        return None
    return {
        "model_version": row[0],
        "model_blob": bytes(row[1]),
        "calibrator_blob": bytes(row[2]) if row[2] else None,
        "hyperparams": dict(row[3] or {}),
    }


# ----------------------------------------------------------------------------
# Prediction build + persist
# ----------------------------------------------------------------------------


def _holdout_bucket(prediction_id: str) -> int | None:
    """Deterministic 0..9 bucket; returns None when NOT in holdout."""
    h = int(hashlib.sha256(prediction_id.encode()).hexdigest()[:8], 16) % 100
    if h < HOLDOUT_PCT:
        return h % 10
    return None


def _build_prediction(fs: FeatureSnapshot, signal_tf: str, horizon: str) -> dict[str, Any] | None:
    bias = _decide_bias(fs)
    exp_move = _expected_move(fs, horizon)
    max_dist = exp_move * REACHABILITY[horizon]
    spot = fs.spot

    # Target range from expected move + bias side.
    if bias == "bullish":
        primary_target = spot * (1 + exp_move * 0.85)
        invalidation  = spot * (1 - exp_move * 0.55)
    else:
        primary_target = spot * (1 - exp_move * 0.85)
        invalidation  = spot * (1 + exp_move * 0.55)

    # Reachability check.
    if abs(primary_target - spot) / spot > max_dist:
        return None

    range_width = abs(primary_target - spot) * 0.25 + spot * exp_move * 0.15
    target_low  = primary_target - range_width
    target_high = primary_target + range_width

    expected_return = (primary_target - spot) / spot if bias == "bullish" else (spot - primary_target) / spot
    downside_risk   = abs(spot - invalidation) / spot
    rr              = expected_return / downside_risk if downside_risk > 1e-6 else None

    codes = _emit_reason_codes(fs, bias)
    p_base = _base_probability(fs, bias, codes)
    p_after_conflict, applied_conflicts = _apply_conflicts(p_base, fs.conflict_codes)
    codes.extend(applied_conflicts)

    score_ev = max(0.0, min(100.0, (p_after_conflict * expected_return - (1 - p_after_conflict) * downside_risk) * 800 + 50))
    score = score_ev + min(20, len(codes) * 0.5)  # tiny boost for signal density
    score = max(0.0, min(100.0, score))

    confidence = (
        "high" if score >= 80 else
        "medium-high" if score >= 70 else
        "medium" if score >= 55 else
        "low"
    )

    now = datetime.now(UTC)
    horizon_ends_at = now + timedelta(hours=HORIZON_HOURS[horizon])
    pid = f"{fs.ticker}_{now.strftime('%Y%m%d_%H%M')}_{signal_tf}_{horizon}_v02"

    return {
        "prediction_id": pid,
        "created_at": now,
        "ticker": fs.ticker,
        "signal_timeframe": signal_tf,
        "forecast_horizon": horizon,
        "horizon_ends_at": horizon_ends_at,
        "current_price": spot,
        "bias": bias,
        "target_range_low":  target_low,
        "target_range_high": target_high,
        "primary_target":    primary_target,
        "expected_return":   expected_return,
        "probability":       p_after_conflict,
        "downside_risk":     downside_risk,
        "risk_reward":       rr,
        "invalidation":      invalidation,
        "confidence":        confidence,
        "delphi_score":      score,
        "reason_codes":      codes,
        "regime":            fs.composite_regime,
        "model_version":     MODEL_VERSION,
        "explanation": (
            f"{fs.ticker} {bias} {signal_tf}→{horizon} (regime: {fs.composite_regime}). "
            f"Target {target_low:.2f}–{target_high:.2f}, invalidation {invalidation:.2f}. "
            f"{len(codes)} signals; {len(applied_conflicts)} conflict(s)."
        ),
        "features": {
            "v02_inputs": {
                "iv30": fs.iv30, "iv_rank": fs.iv_rank, "rv30": fs.rv30,
                "regime": fs.composite_regime,
                "conflicts": fs.conflict_codes,
                "base_prob": round(p_base, 4),
                "conflict_dampened": round(p_after_conflict - p_base, 4),
            },
            # Inline the snapshot so the ML overlay (when trained) can re-score
            # this exact row from the stored row alone.
            "features_snapshot": fs.features,
            "promoted_snapshot": fs.promoted,
        },
    }


def _apply_learning_layers(conn: psycopg.Connection, pred: dict[str, Any]) -> dict[str, Any]:
    """Layer 2 (adaptive code weights) + Layer 3 (calibration) + Layer 4 (ML blend)."""
    regime = pred.get("regime") or "any"
    signal_tf = pred["signal_timeframe"]
    horizon = pred["forecast_horizon"]
    rcs = pred.get("reason_codes") or []

    hit_rates = _load_reason_code_hit_rates(conn, signal_tf, horizon, regime) if rcs else {}
    if rcs and hit_rates:
        prob = 0.50
        per_code: dict[str, float] = {}
        for rc in rcs:
            if rc in hit_rates:
                hit, _n = hit_rates[rc]
                delta = hit - 0.50
            else:
                delta = 0.02  # smaller default than v0.1 since v0.2 emits more codes
            prob += delta
            per_code[rc] = round(delta, 4)
        pred["features"]["per_code_delta"] = per_code
        # Re-apply conflict dampening on the rebuilt probability.
        prob, _ = _apply_conflicts(prob, [c for c in rcs if c.startswith("CONFLICT_")])
    else:
        prob = float(pred["probability"])

    prob = max(_PROB_MIN, min(_PROB_MAX, prob))
    cal_prob = _calibrate(conn, prob, horizon, regime)

    # Layer 4 ML blend
    ml_model = _load_active_ml_model(conn)
    blended = cal_prob
    if ml_model is not None:
        try:
            import pickle
            model = pickle.loads(ml_model["model_blob"])
            calibrator = pickle.loads(ml_model["calibrator_blob"]) if ml_model["calibrator_blob"] else None
            ml_proba = _score_with_model(model, calibrator, pred)
            blend_w = float(ml_model["hyperparams"].get("blend_weight_ml", 0.6))
            blended = blend_w * ml_proba + (1 - blend_w) * cal_prob
            pred["features"]["ml_proba"] = round(ml_proba, 4)
            pred["features"]["ml_model_version"] = ml_model["model_version"]
        except Exception as e:  # noqa: BLE001
            log.warning("ML overlay scoring failed: %s", e)

    final = max(_PROB_MIN, min(_PROB_MAX, blended))
    pred["probability"] = final

    # Recompute score with final probability.
    er = float(pred["expected_return"])
    dr = float(pred["downside_risk"])
    score_ev = max(0.0, min(100.0, (final * er - (1 - final) * dr) * 800 + 50))
    pred["delphi_score"] = max(0.0, min(100.0, score_ev + min(20, len(rcs) * 0.5)))
    pred["confidence"] = (
        "high" if pred["delphi_score"] >= 80
        else "medium-high" if pred["delphi_score"] >= 70
        else "medium" if pred["delphi_score"] >= 55
        else "low"
    )
    return pred


def _score_with_model(model: Any, calibrator: Any, pred: dict[str, Any]) -> float:
    """Score one prediction row with the LightGBM model + isotonic calibrator.

    Feature vector is built from the snapshot stored inline in pred["features"].
    Returns calibrated probability in [0, 1].
    """
    import numpy as np
    feat = pred["features"].get("features_snapshot") or {}
    promoted = pred["features"].get("promoted_snapshot") or {}
    # Concatenate the dicts in a stable order; model knows its own feature order.
    feature_names = sorted(set(feat.keys()) | set(promoted.keys()))
    row = []
    for k in feature_names:
        v = feat.get(k, promoted.get(k))
        if isinstance(v, bool):
            v = 1.0 if v else 0.0
        try:
            row.append(float(v) if v is not None else float("nan"))
        except (TypeError, ValueError):
            row.append(float("nan"))
    X = np.array([row])
    raw = float(model.predict_proba(X)[0, 1])
    if calibrator is not None:
        return float(calibrator.predict([raw])[0])
    return raw


def _upsert_prediction(conn: psycopg.Connection, p: dict[str, Any]) -> None:
    conn.execute(
        """
        INSERT INTO delphi_predictions (
            prediction_id, created_at, ticker, signal_timeframe, forecast_horizon,
            horizon_ends_at, current_price, bias,
            target_range_low, target_range_high, primary_target,
            expected_return, probability, downside_risk, risk_reward,
            invalidation, confidence, delphi_score, reason_codes,
            regime, model_version, explanation, features
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s
        )
        ON CONFLICT (prediction_id) DO NOTHING
        """,
        (
            p["prediction_id"], p["created_at"], p["ticker"], p["signal_timeframe"], p["forecast_horizon"],
            p["horizon_ends_at"], p["current_price"], p["bias"],
            p["target_range_low"], p["target_range_high"], p["primary_target"],
            p["expected_return"], p["probability"], p["downside_risk"], p["risk_reward"],
            p["invalidation"], p["confidence"], p["delphi_score"], p["reason_codes"],
            p["regime"], p["model_version"], p["explanation"], Jsonb(p["features"]),
        ),
    )
    bucket = _holdout_bucket(p["prediction_id"])
    if bucket is not None:
        conn.execute(
            """
            INSERT INTO delphi_holdout_set (prediction_id, holdout_bucket)
            VALUES (%s, %s) ON CONFLICT (prediction_id) DO NOTHING
            """,
            (p["prediction_id"], bucket),
        )


def rank(database_url: str, *, candidate_limit: int = 50) -> dict[str, Any]:
    written = 0
    skipped = 0
    horizons_seen: dict[str, int] = {}
    holdout_n = 0

    with connect(database_url) as conn:
        candidates = _latest_features(conn, candidate_limit)
        if not candidates:
            log.warning("delphi-rank-v2: no delphi_features rows — run delphi-features first")
            return {"candidates": 0, "predictions_written": 0, "horizons": {}}

        for fs in candidates:
            for signal_tf, horizons in SIGNAL_TO_HORIZONS.items():
                for horizon in horizons:
                    pred = _build_prediction(fs, signal_tf, horizon)
                    if pred is None:
                        skipped += 1
                        continue
                    pred = _apply_learning_layers(conn, pred)
                    _upsert_prediction(conn, pred)
                    written += 1
                    horizons_seen[horizon] = horizons_seen.get(horizon, 0) + 1
                    if _holdout_bucket(pred["prediction_id"]) is not None:
                        holdout_n += 1
        conn.commit()

    return {
        "candidates": len(candidates),
        "predictions_written": written,
        "skipped_reachability": skipped,
        "horizons": horizons_seen,
        "holdout_assigned": holdout_n,
        "model_version": MODEL_VERSION,
        "ml_overlay": USE_ML_OVERLAY,
        "uw_pred_voters": USE_UW_PRED_VOTERS,
    }
