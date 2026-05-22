"""Delphi ranker — Stage 3 of the funnel.

Consumes the existing UW funnel output (uw_screener_stocks for Stage 1+2,
uw_greek_exposure_strike for GEX walls) and writes ranked predictions to
delphi_predictions for each forecast horizon.

This is the v0 rules-based scoring engine described in section 14 of the
Delphi design doc:
  Layer 1: deterministic rules (this file)
  Layer 2: adaptive weights (TODO — read from delphi_adaptive_weights)
  Layer 3: probability calibration (TODO — apply delphi_calibration_buckets)
  Layer 4: ML overlay (later)

Key principles preserved from the doc:
  - Frozen hypothesis: write once, never mutate
  - Reachability filter: don't rank a target far outside the expected move
  - Target *range*, not exact price
  - Reason codes so every score is traceable

Wire-up: ``cfp-jobs delphi-rank`` runs ingestion first, then this. The job
assumes uw_screener_stocks and uw_greek_exposure_strike are fresh (the
existing screeners-ingest job populates them).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect

log = logging.getLogger(__name__)


MODEL_VERSION = "v0.1-rules"

# Default horizon mappings from the doc, section 3. Each entry maps a signal
# timeframe to the forecast horizon(s) that timeframe is best suited to.
SIGNAL_TO_HORIZONS: dict[str, list[str]] = {
    "5m": ["EOD"],
    "1h": ["1w"],
    "4h": ["1mo"],
    "1d": ["3mo", "6mo"],
    "1w": ["12mo"],
}

# Hours until the forecast horizon closes — used to populate horizon_ends_at
# so delphi-evaluate knows when to score a prediction.
HORIZON_HOURS: dict[str, int] = {
    "EOD": 8,
    "1w": 24 * 7,
    "1mo": 24 * 30,
    "3mo": 24 * 90,
    "6mo": 24 * 180,
    "12mo": 24 * 365,
    "24mo": 24 * 365 * 2,
}

# Reachability multipliers — target distance must be within this multiple of
# the expected move for the horizon, otherwise the prediction is dropped.
# Per doc section 11: "A target should not rank highly if it is far outside
# the expected move for the horizon."
REACHABILITY: dict[str, float] = {
    "EOD": 1.5,
    "1w": 1.75,
    "1mo": 2.0,
    "3mo": 2.5,
    "6mo": 3.0,
    "12mo": 4.0,
}


@dataclass
class Candidate:
    ticker: str
    last_price: float
    iv_rank: float | None
    sector: str | None
    call_volume: int | None
    put_volume: int | None
    total_premium: float | None
    rank: int | None


def _load_candidates(conn: psycopg.Connection, limit: int) -> list[Candidate]:
    """Pull the freshest screener snapshot — Stage 1+2 of the funnel."""
    row = conn.execute(
        "SELECT MAX(snapshot_ts) FROM uw_screener_stocks"
    ).fetchone()
    if not row or row[0] is None:
        log.warning("delphi-rank: uw_screener_stocks is empty; nothing to rank")
        return []
    snapshot_ts = row[0]

    # Fall back to payload JSONB when last_price column is NULL. UW returns
    # different price-field names depending on endpoint version (last_price,
    # price, close, last, mark); the ingest only maps two of them, so price
    # ends up NULL for some rows. COALESCE here is the cheapest fix without
    # re-running the ingest.
    cur = conn.execute(
        """
        SELECT ticker,
               COALESCE(
                   last_price,
                   (payload->>'last_price')::float,
                   (payload->>'price')::float,
                   (payload->>'close')::float,
                   (payload->>'last')::float,
                   (payload->>'mark')::float
               ) AS px,
               iv_rank, sector,
               call_volume, put_volume, total_premium, rank
        FROM uw_screener_stocks
        WHERE snapshot_ts = %s
        ORDER BY COALESCE(rank, 99999) ASC
        LIMIT %s
        """,
        (snapshot_ts, limit * 2),  # over-fetch so the price filter below has room
    )
    rows = cur.fetchall()
    if not rows:
        log.warning("delphi-rank: no rows at snapshot_ts=%s", snapshot_ts)
        return []

    # Diagnostic: when nothing passes the price filter, dump a sample so
    # we can see which field names UW is actually using.
    candidates: list[Candidate] = []
    for r in rows:
        if r[1] is None or float(r[1]) <= 1.0:
            continue
        candidates.append(
            Candidate(
                ticker=r[0],
                last_price=float(r[1]),
                iv_rank=float(r[2]) if r[2] is not None else None,
                sector=r[3],
                call_volume=int(r[4]) if r[4] is not None else None,
                put_volume=int(r[5]) if r[5] is not None else None,
                total_premium=float(r[6]) if r[6] is not None else None,
                rank=int(r[7]) if r[7] is not None else None,
            )
        )
        if len(candidates) >= limit:
            break

    if not candidates:
        # Dump first payload key set so we know which UW field name to map.
        sample = conn.execute(
            "SELECT ticker, last_price, payload FROM uw_screener_stocks "
            "WHERE snapshot_ts = %s LIMIT 1",
            (snapshot_ts,),
        ).fetchone()
        if sample:
            payload_keys = list(sample[2].keys()) if isinstance(sample[2], dict) else "non-dict"
            log.warning(
                "delphi-rank: 0 candidates from %d rows. sample ticker=%s last_price=%s "
                "payload_keys=%s",
                len(rows), sample[0], sample[1], payload_keys,
            )

    return candidates


def _largest_gex_walls(
    conn: psycopg.Connection, ticker: str, current_price: float
) -> tuple[float | None, float | None]:
    """Return (largest_call_wall_above, largest_put_wall_below).

    Uses the most-recent strike-level snapshot. Returns (None, None) if we
    don't have GEX data for the ticker — Delphi can still predict, it just
    won't carry GEX_WALL_* reason codes for that row.
    """
    row = conn.execute(
        """
        SELECT snapshot_date FROM uw_greek_exposure_strike
        WHERE ticker = %s
        ORDER BY snapshot_date DESC LIMIT 1
        """,
        (ticker,),
    ).fetchone()
    if not row:
        return (None, None)
    snapshot_date = row[0]

    # Largest call-side GEX above current price (potential ceiling/magnet).
    call_row = conn.execute(
        """
        SELECT strike FROM uw_greek_exposure_strike
        WHERE ticker = %s AND snapshot_date = %s
          AND strike > %s
        ORDER BY COALESCE(call_gex, 0) DESC LIMIT 1
        """,
        (ticker, snapshot_date, current_price),
    ).fetchone()

    put_row = conn.execute(
        """
        SELECT strike FROM uw_greek_exposure_strike
        WHERE ticker = %s AND snapshot_date = %s
          AND strike < %s
        ORDER BY COALESCE(put_gex, 0) DESC LIMIT 1
        """,
        (ticker, snapshot_date, current_price),
    ).fetchone()

    return (
        float(call_row[0]) if call_row else None,
        float(put_row[0]) if put_row else None,
    )


def _expected_move(_price: float, iv_rank: float | None, horizon: str) -> float:
    """Rough expected move as a fraction of price.

    Uses IV rank as a stand-in for IV magnitude scaled by horizon. This is
    deliberately simple — once Delphi has IV30 + RV30, swap to the proper
    sigma*sqrt(t) formulation. The `_price` slot is reserved for that
    upgrade so the caller doesn't have to change.
    """
    # Baseline annual vol assumption when IV rank is missing.
    iv_proxy = 0.35 if iv_rank is None else max(0.15, min(1.0, iv_rank / 100.0 + 0.20))
    horizon_years = HORIZON_HOURS[horizon] / (24 * 365)
    return iv_proxy * (horizon_years**0.5)


def _build_prediction(
    c: Candidate, horizon: str, signal_tf: str,
    call_wall: float | None, put_wall: float | None,
) -> dict[str, Any] | None:
    """Apply the rules-based Layer-1 scorer to a candidate.

    Returns None if no realistic target exists (reachability filter trips,
    or we can't tell which side has edge). The doc explicitly allows a
    no-trade verdict in section 23.2 step 5.
    """
    price = c.last_price
    exp_move = _expected_move(price, c.iv_rank, horizon)
    max_target_distance = exp_move * REACHABILITY[horizon]

    # Bias: call-skew or put-skew tells us which side to lean on. If we
    # don't have flow data, default bullish (matches the doc's bias toward
    # bullish setups in section 2's example output).
    call_v = c.call_volume or 0
    put_v = c.put_volume or 0
    total = call_v + put_v
    call_skew = (call_v - put_v) / total if total > 0 else 0.0
    bias = "bullish" if call_skew >= 0 else "bearish"

    reason_codes: list[str] = []
    if call_skew >= 0.2:
        reason_codes.append("CALL_FLOW_DOMINANT")
    elif call_skew <= -0.2:
        reason_codes.append("PUT_FLOW_DOMINANT")

    if c.iv_rank is not None and c.iv_rank >= 70:
        reason_codes.append("IV_RANK_HIGH")
    elif c.iv_rank is not None and c.iv_rank <= 20:
        reason_codes.append("IV_RANK_LOW")

    # Pick the primary target from GEX walls when we have them, otherwise
    # use a fraction of the expected move on the bias side.
    if bias == "bullish":
        if call_wall is not None and (call_wall - price) / price <= max_target_distance:
            primary_target = call_wall
            reason_codes.append("GEX_WALL_ABOVE")
        else:
            primary_target = price * (1 + exp_move * 0.85)
        invalidation = (
            put_wall if put_wall is not None and (price - put_wall) / price <= max_target_distance
            else price * (1 - exp_move * 0.6)
        )
        if put_wall is not None and invalidation == put_wall:
            reason_codes.append("GEX_WALL_BELOW")
    else:
        if put_wall is not None and (price - put_wall) / price <= max_target_distance:
            primary_target = put_wall
            reason_codes.append("GEX_WALL_BELOW")
        else:
            primary_target = price * (1 - exp_move * 0.85)
        invalidation = (
            call_wall if call_wall is not None and (call_wall - price) / price <= max_target_distance
            else price * (1 + exp_move * 0.6)
        )
        if call_wall is not None and invalidation == call_wall:
            reason_codes.append("GEX_WALL_ABOVE")

    # Target range = primary_target ± half the expected move toward the
    # invalidation side. Keeps the range honest about uncertainty without
    # being symmetric (the riskier side is the side away from the wall).
    range_width = abs(primary_target - price) * 0.25 + price * exp_move * 0.15
    target_low = primary_target - range_width
    target_high = primary_target + range_width

    expected_return = (primary_target - price) / price if bias == "bullish" else (price - primary_target) / price
    downside_risk = abs(price - invalidation) / price
    risk_reward = expected_return / downside_risk if downside_risk > 1e-6 else None

    # Reachability: drop if the target distance exceeds the budget.
    if abs(primary_target - price) / price > max_target_distance:
        return None

    # v0 probability — anchored at 0.50, nudged by reason-code count and
    # IV regime. Calibration (Layer 3) will adjust this against realized
    # outcomes once delphi-evaluate has populated delphi_outcomes.
    probability = 0.50 + min(0.20, 0.04 * len(reason_codes))
    if c.iv_rank is not None and c.iv_rank >= 80 and bias == "bullish":
        # High-IV bullish setups historically under-perform vs base rate;
        # the calibration loop will refine, but anchor lower here.
        probability -= 0.05

    # Score: EV-weighted, capped 0..100. Mirrors section 9 weights but
    # collapsed to inputs we already have at this stage.
    ev_score = max(0.0, min(100.0, (probability * expected_return - (1 - probability) * downside_risk) * 800 + 50))
    score = ev_score
    if "GEX_WALL_ABOVE" in reason_codes or "GEX_WALL_BELOW" in reason_codes:
        score += 8
    if "CALL_FLOW_DOMINANT" in reason_codes or "PUT_FLOW_DOMINANT" in reason_codes:
        score += 5
    score = max(0.0, min(100.0, score))

    confidence = (
        "high" if score >= 80 else
        "medium-high" if score >= 70 else
        "medium" if score >= 55 else
        "low"
    )

    now = datetime.now(UTC)
    horizon_ends_at = now + timedelta(hours=HORIZON_HOURS[horizon])
    pid = f"{c.ticker}_{now.strftime('%Y%m%d_%H%M')}_{signal_tf}_{horizon}"

    return {
        "prediction_id": pid,
        "created_at": now,
        "ticker": c.ticker,
        "signal_timeframe": signal_tf,
        "forecast_horizon": horizon,
        "horizon_ends_at": horizon_ends_at,
        "current_price": price,
        "bias": bias,
        "target_range_low": target_low,
        "target_range_high": target_high,
        "primary_target": primary_target,
        "expected_return": expected_return,
        "probability": probability,
        "downside_risk": downside_risk,
        "risk_reward": risk_reward,
        "invalidation": invalidation,
        "confidence": confidence,
        "delphi_score": score,
        "reason_codes": reason_codes,
        "regime": None,
        "model_version": MODEL_VERSION,
        "explanation": (
            f"{c.ticker} {bias} on the {signal_tf} signal for {horizon}. "
            f"Target {target_low:.2f}–{target_high:.2f}, invalidation {invalidation:.2f}. "
            f"Driven by: {', '.join(reason_codes) if reason_codes else 'baseline flow + IV regime'}."
        ),
        "features": {
            "iv_rank": c.iv_rank,
            "call_skew": call_skew,
            "expected_move": exp_move,
            "call_wall": call_wall,
            "put_wall": put_wall,
            "screener_rank": c.rank,
            "sector": c.sector,
        },
    }


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


def rank(database_url: str, *, candidate_limit: int = 50) -> dict[str, Any]:
    """Run the Delphi ranker end to end and return a summary dict."""
    written = 0
    skipped = 0
    horizons_seen: dict[str, int] = {}

    with connect(database_url) as conn:
        candidates = _load_candidates(conn, candidate_limit)
        if not candidates:
            return {"candidates": 0, "predictions_written": 0, "horizons": {}}

        for c in candidates:
            call_wall, put_wall = _largest_gex_walls(conn, c.ticker, c.last_price)
            for signal_tf, horizons in SIGNAL_TO_HORIZONS.items():
                for horizon in horizons:
                    pred = _build_prediction(c, horizon, signal_tf, call_wall, put_wall)
                    if pred is None:
                        skipped += 1
                        continue
                    _upsert_prediction(conn, pred)
                    written += 1
                    horizons_seen[horizon] = horizons_seen.get(horizon, 0) + 1
        conn.commit()

    return {
        "candidates": len(candidates),
        "predictions_written": written,
        "skipped_reachability": skipped,
        "horizons": horizons_seen,
        "model_version": MODEL_VERSION,
    }
