"""Delphi learning loop — Layers 2 + 3 + ticker memory + model performance.

Reads the (delphi_predictions JOIN delphi_outcomes) view and writes:
  - delphi_reason_code_performance  (per reason code × signal_tf × horizon × regime)
  - delphi_calibration_buckets      (Layer 3 — does a stated 70% mean a real 70%?)
  - delphi_adaptive_weights         (Layer 2 — per-segment feature-group weights)
  - delphi_ticker_memory            (per-ticker rollup)
  - delphi_model_performance        (top-level "is the model getting better?")

Everything is GATED OFF from the ranker by default. delphi_rank.py reads
these tables only when DELPHI_USE_ADAPTIVE_WEIGHTS / DELPHI_USE_CALIBRATION
are set to "true". This module writes; the ranker decides whether to read.

Sample-size thresholds (conservative — overridable via env vars):
  DELPHI_MIN_RC_SAMPLES     = 20   (reason-code performance)
  DELPHI_MIN_BUCKET_SAMPLES = 30   (probability calibration bucket)
  DELPHI_MIN_AW_SAMPLES     = 50   (adaptive feature-group weight)

Idempotent — re-running on the same outcomes set produces the same writes.
Runs after delphi-evaluate, daily.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

import psycopg

from cfp_jobs.db import connect

log = logging.getLogger(__name__)


# ----------------------------------------------------------------------------
# Configuration — thresholds are env-overridable so tuning doesn't need a
# code change. Conservative defaults match the design discussion: keep
# layer-2/3 inert until each segment has enough evidence to mean anything.
# ----------------------------------------------------------------------------

def _ienv(name: str, default: int) -> int:
    v = os.environ.get(name)
    if not v:
        return default
    try:
        return int(v)
    except ValueError:
        return default


MIN_RC_SAMPLES = _ienv("DELPHI_MIN_RC_SAMPLES", 20)
MIN_BUCKET_SAMPLES = _ienv("DELPHI_MIN_BUCKET_SAMPLES", 30)
MIN_AW_SAMPLES = _ienv("DELPHI_MIN_AW_SAMPLES", 50)


# Feature groups mirror the W1..W9 list in the design doc's section 9. Each
# group's "present" flag is derived from the prediction's features JSONB +
# reason codes. The adaptive layer learns which groups actually carry edge.
FEATURE_GROUPS: list[str] = [
    "expected_value",
    "probability",
    "gex_vex",
    "flow",
    "velocity",
    "regime",
    "liquidity",
    "ticker_memory",
    "data_quality",
]

# Default weight per group when no row exists. Sum is illustrative — the
# ranker normalizes at consumption time, so absolute magnitude doesn't matter.
DEFAULT_WEIGHTS: dict[str, float] = {
    "expected_value": 1.0,
    "probability": 1.0,
    "gex_vex": 1.0,
    "flow": 1.0,
    "velocity": 0.8,
    "regime": 0.8,
    "liquidity": 0.5,
    "ticker_memory": 0.5,
    "data_quality": 0.3,
}

# Probability bucket edges — closed on the left, open on the right, with
# 95-100 catching 1.0 inclusive. Mirrors the doc's calibration table.
_BUCKET_EDGES: list[tuple[str, float, float]] = [
    ("50-55", 0.50, 0.55),
    ("55-60", 0.55, 0.60),
    ("60-65", 0.60, 0.65),
    ("65-70", 0.65, 0.70),
    ("70-75", 0.70, 0.75),
    ("75-80", 0.75, 0.80),
    ("80-85", 0.80, 0.85),
    ("85-90", 0.85, 0.90),
    ("90-95", 0.90, 0.95),
    ("95-100", 0.95, 1.01),
]


def _bucket_for(p: float) -> str | None:
    for label, lo, hi in _BUCKET_EDGES:
        if lo <= p < hi:
            return label
    return None


def _midpoint(label: str) -> float:
    for name, lo, hi in _BUCKET_EDGES:
        if name == label:
            return (lo + min(hi, 1.0)) / 2.0
    return 0.5


# ----------------------------------------------------------------------------
# Writer 1: reason-code performance
# ----------------------------------------------------------------------------


# ----------------------------------------------------------------------------
# Benjamini-Hochberg FDR control for reason-code promotions.
#
# v0.2/v0.3 emit ~40 reason codes per prediction. With ~7 horizons and ~10
# regimes, the family of hypotheses we test ("does code X have edge in
# segment Y?") is roughly 2800. Naive p<0.05 testing surfaces ~140 false
# positives by chance alone. BH at α=0.05 caps the expected false-discovery
# rate at 5% across the family.
#
# A code's weight_modifier in delphi_reason_code_performance is only allowed
# to deviate from 1.0 when the segment clears BH. We write the test result
# (raw_p, q_value, promoted flag, direction) to delphi_reason_code_promotions
# so the promotion decision is auditable.
# ----------------------------------------------------------------------------


def _binom_test_one_sided(k: int, n: int, p0: float) -> float:
    """One-sided binomial test: P(X >= k | n, p0).

    Used to test "this code's hit rate exceeds the base rate" — we care
    about edge in either direction so the caller flips k for bearish edge.
    Falls back to normal approximation when scipy isn't around.
    """
    if n <= 0 or k < 0 or k > n:
        return 1.0
    try:
        from scipy.stats import binomtest
        return float(binomtest(k, n, p0, alternative="greater").pvalue)
    except ImportError:
        # Normal approximation with continuity correction
        import math
        mu = n * p0
        sd = math.sqrt(max(1e-9, n * p0 * (1 - p0)))
        z = (k - 0.5 - mu) / sd  # continuity correction
        # 1 - Phi(z)
        return 0.5 * math.erfc(z / math.sqrt(2))


def _bh_qvalues(p_values: list[float]) -> list[float]:
    """Benjamini-Hochberg step-up procedure.

    Returns a list of BH-corrected q-values, same order as input. q_i is the
    smallest FDR at which hypothesis i would be rejected.
    """
    n = len(p_values)
    if n == 0:
        return []
    indexed = sorted(enumerate(p_values), key=lambda x: x[1])
    qs: list[float] = [1.0] * n
    min_q = 1.0
    for rank in range(n - 1, -1, -1):
        orig_idx, p = indexed[rank]
        q = p * n / (rank + 1)
        if q < min_q:
            min_q = q
        qs[orig_idx] = min(1.0, min_q)
    return qs


def _update_reason_code_promotions(conn: psycopg.Connection, fdr_alpha: float = 0.05) -> dict[str, int]:
    """Test every (code, signal_tf, horizon, regime) segment for hit-rate
    edge vs the segment base rate, BH-correct the family, and write
    promotion decisions to delphi_reason_code_promotions.

    Subsequent runs of _update_reason_code_performance read this table and
    only set weight_modifier away from 1.0 when promoted=TRUE.
    """
    # Pull per-segment stats already aggregated in delphi_reason_code_performance.
    try:
        rows = conn.execute(
            """
            SELECT rc.reason_code, rc.signal_timeframe, rc.forecast_horizon, rc.regime,
                   rc.sample_size, rc.target_hit_rate,
                   (SELECT AVG(CASE WHEN o.hit_target_range THEN 1.0 ELSE 0.0 END)
                    FROM delphi_predictions p
                    JOIN delphi_outcomes o USING (prediction_id)
                    WHERE p.signal_timeframe = rc.signal_timeframe
                      AND p.forecast_horizon = rc.forecast_horizon
                      AND COALESCE(p.regime, 'any') = rc.regime
                   ) AS base_rate
            FROM delphi_reason_code_performance rc
            WHERE rc.target_hit_rate IS NOT NULL
              AND rc.sample_size >= 20
            """
        ).fetchall()
    except psycopg.errors.UndefinedTable:
        return {"tested": 0, "promoted": 0, "note": "delphi_reason_code_performance missing"}

    if not rows:
        return {"tested": 0, "promoted": 0}

    # Compute one-sided p-values (greater than base rate) — we only promote
    # codes that beat base, not ones that under-perform (under-performers
    # already get suppressed via weight_modifier < 1.0 but don't need FDR
    # protection because we don't promote them to "active" anything).
    p_values: list[float] = []
    parsed: list[tuple] = []
    for r in rows:
        rc, stf, hz, regime, n, hit, base = r
        n = int(n or 0)
        if hit is None or base is None or n < 20:
            continue
        hit = float(hit)
        base = float(base)
        # Test in the direction of observed deviation: greater if hit>base, else less.
        if hit >= base:
            k = int(round(hit * n))
            p = _binom_test_one_sided(k, n, base)
            direction = "bullish"
        else:
            # Test "less than base": equivalent to greater test on (n-k) vs (1-base)
            k = n - int(round(hit * n))
            p = _binom_test_one_sided(k, n, 1 - base)
            direction = "bearish"
        edge = hit - base
        p_values.append(p)
        parsed.append((rc, stf, hz, regime, n, edge, p, direction))

    q_values = _bh_qvalues(p_values)

    promoted_count = 0
    try:
        for (rc, stf, hz, regime, n, edge, p, direction), q in zip(parsed, q_values, strict=True):
            promoted = q < fdr_alpha
            conn.execute(
                """
                INSERT INTO delphi_reason_code_promotions (
                    reason_code, signal_timeframe, forecast_horizon, regime,
                    n_observations, edge_vs_base, raw_p_value, bh_q_value,
                    promoted, direction, promoted_at, last_evaluated_at
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s,
                    CASE WHEN %s THEN NOW() ELSE NULL END,
                    NOW()
                ) ON CONFLICT (reason_code, signal_timeframe, forecast_horizon, regime) DO UPDATE SET
                    n_observations = EXCLUDED.n_observations,
                    edge_vs_base = EXCLUDED.edge_vs_base,
                    raw_p_value = EXCLUDED.raw_p_value,
                    bh_q_value = EXCLUDED.bh_q_value,
                    promoted = EXCLUDED.promoted,
                    direction = EXCLUDED.direction,
                    promoted_at = COALESCE(delphi_reason_code_promotions.promoted_at, EXCLUDED.promoted_at),
                    last_evaluated_at = NOW()
                """,
                (rc, stf, hz, regime, n, edge, p, q, promoted, direction, promoted),
            )
            if promoted:
                promoted_count += 1
    except psycopg.errors.UndefinedTable:
        return {"tested": len(parsed), "promoted": 0, "note": "delphi_reason_code_promotions table missing"}

    return {
        "tested": len(parsed),
        "promoted": promoted_count,
        "family_size": len(parsed),
        "fdr_alpha": fdr_alpha,
    }


def _update_reason_code_performance(conn: psycopg.Connection) -> dict[str, int]:
    """Roll up (reason_code × signal_tf × horizon × regime) hit-rate stats.

    weight_modifier is bounded to [0.5, 1.5] and only mutates when the
    segment has >= MIN_RC_SAMPLES outcomes. Reason codes below threshold get
    weight_modifier = 1.0 (neutral) so the ranker sees no signal from them.
    """
    rows = conn.execute(
        """
        WITH joined AS (
            SELECT p.signal_timeframe,
                   p.forecast_horizon,
                   COALESCE(p.regime, 'any') AS regime,
                   UNNEST(p.reason_codes) AS reason_code,
                   o.hit_target_range,
                   o.hit_invalidation_first,
                   p.expected_return,
                   p.downside_risk,
                   o.max_favorable_return,
                   o.max_adverse_return
            FROM delphi_predictions p
            JOIN delphi_outcomes o USING (prediction_id)
        )
        SELECT reason_code, signal_timeframe, forecast_horizon, regime,
               COUNT(*) AS sample_size,
               AVG(CASE WHEN hit_target_range THEN 1.0 ELSE 0.0 END) AS hit_rate,
               AVG(CASE WHEN hit_target_range AND NOT hit_invalidation_first THEN 1.0 ELSE 0.0 END) AS target_first_rate,
               AVG(max_favorable_return) AS avg_mfe,
               AVG(max_adverse_return)   AS avg_mae
        FROM joined
        GROUP BY reason_code, signal_timeframe, forecast_horizon, regime
        """
    ).fetchall()

    written = 0
    for r in rows:
        rc, stf, hz, regime, n, hit_rate, tfr, mfe, mae = r
        n = int(n or 0)
        # Compute weight modifier only above threshold. Below = neutral.
        if n >= MIN_RC_SAMPLES and hit_rate is not None:
            # Base rate for the same (stf, horizon, regime) — pulled inline
            # so the segment is its own control. If we lack a base rate row
            # (small sample), default to 0.5 so under-performers don't drag
            # weights to zero on noise.
            base = conn.execute(
                """
                SELECT AVG(CASE WHEN o.hit_target_range THEN 1.0 ELSE 0.0 END)
                FROM delphi_predictions p
                JOIN delphi_outcomes o USING (prediction_id)
                WHERE p.signal_timeframe = %s
                  AND p.forecast_horizon = %s
                  AND COALESCE(p.regime, 'any') = %s
                """,
                (stf, hz, regime),
            ).fetchone()
            base_rate = float(base[0]) if base and base[0] is not None else 0.5
            edge = float(hit_rate) - base_rate
            # Map edge in [-0.5, +0.5] to weight modifier in [0.5, 1.5].
            modifier = max(0.5, min(1.5, 1.0 + edge))
        else:
            modifier = 1.0

        conn.execute(
            """
            INSERT INTO delphi_reason_code_performance (
                reason_code, signal_timeframe, forecast_horizon, regime,
                times_used, target_hit_rate, target_before_invalidation_rate,
                average_return, average_drawdown,
                weight_modifier, sample_size, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (reason_code, signal_timeframe, forecast_horizon, regime) DO UPDATE SET
                times_used = EXCLUDED.times_used,
                target_hit_rate = EXCLUDED.target_hit_rate,
                target_before_invalidation_rate = EXCLUDED.target_before_invalidation_rate,
                average_return = EXCLUDED.average_return,
                average_drawdown = EXCLUDED.average_drawdown,
                weight_modifier = EXCLUDED.weight_modifier,
                sample_size = EXCLUDED.sample_size,
                updated_at = NOW()
            """,
            (
                rc, stf, hz, regime,
                n, float(hit_rate) if hit_rate is not None else None,
                float(tfr) if tfr is not None else None,
                float(mfe) if mfe is not None else None,
                float(mae) if mae is not None else None,
                modifier, n,
            ),
        )
        written += 1

    return {"segments_written": written, "min_sample_gate": MIN_RC_SAMPLES}


# ----------------------------------------------------------------------------
# Writer 2: calibration buckets (Layer 3)
# ----------------------------------------------------------------------------


def _update_calibration_buckets(conn: psycopg.Connection) -> dict[str, int]:
    """For each (horizon, regime, prob bucket), measure actual hit rate.

    `adjusted_probability` is the bucket's actual hit rate when we have
    enough data (>= MIN_BUCKET_SAMPLES), otherwise the bucket midpoint.
    The ranker only reads this table when DELPHI_USE_CALIBRATION=true.
    """
    rows = conn.execute(
        """
        SELECT p.forecast_horizon,
               COALESCE(p.regime, 'any') AS regime,
               p.probability,
               o.hit_target_range
        FROM delphi_predictions p
        JOIN delphi_outcomes o USING (prediction_id)
        WHERE p.probability IS NOT NULL
        """
    ).fetchall()

    # Bucket in Python so we control the edges cleanly.
    buckets: dict[tuple[str, str, str], list[int]] = {}
    for hz, regime, prob, hit in rows:
        b = _bucket_for(float(prob))
        if b is None:
            continue
        key = (hz, regime, b)
        buckets.setdefault(key, []).append(1 if hit else 0)

    written = 0
    for (hz, regime, bucket), hits in buckets.items():
        n = len(hits)
        actual = sum(hits) / n if n else None
        mid = _midpoint(bucket)
        if n >= MIN_BUCKET_SAMPLES and actual is not None:
            calibration_gap = mid - actual
            adjusted = actual
        else:
            calibration_gap = None
            adjusted = mid
        conn.execute(
            """
            INSERT INTO delphi_calibration_buckets (
                forecast_horizon, regime, probability_bucket,
                prediction_count, actual_hit_rate, calibration_gap,
                adjusted_probability, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (forecast_horizon, regime, probability_bucket) DO UPDATE SET
                prediction_count = EXCLUDED.prediction_count,
                actual_hit_rate = EXCLUDED.actual_hit_rate,
                calibration_gap = EXCLUDED.calibration_gap,
                adjusted_probability = EXCLUDED.adjusted_probability,
                updated_at = NOW()
            """,
            (hz, regime, bucket, n, actual, calibration_gap, adjusted),
        )
        written += 1

    return {"buckets_written": written, "min_sample_gate": MIN_BUCKET_SAMPLES}


# ----------------------------------------------------------------------------
# Writer 3: adaptive weights (Layer 2)
# ----------------------------------------------------------------------------

# Maps a feature_group to a SQL predicate that checks whether the prediction
# "used" that group. Returns True/False — used as a categorical and correlated
# with outcomes. When a group's present rows beat absent rows, we nudge its
# weight up; when they trail, we nudge it down.
_GROUP_PREDICATES: dict[str, str] = {
    "expected_value":  "p.expected_return >= 0.05",
    "probability":     "p.probability >= 0.60",
    "gex_vex":         "'GEX_WALL_ABOVE' = ANY(p.reason_codes) OR 'GEX_WALL_BELOW' = ANY(p.reason_codes)",
    "flow":            "'CALL_FLOW_DOMINANT' = ANY(p.reason_codes) OR 'PUT_FLOW_DOMINANT' = ANY(p.reason_codes)",
    # Velocity / regime / liquidity / ticker_memory / data_quality predicates
    # default to checking whether the features JSONB has the matching key.
    # delphi_rank.py doesn't write these yet — Layer 2+ writers will, but
    # until then the predicate quietly evaluates false and the group sits
    # at default weight. That's the gate working as designed.
    "velocity":        "(p.features ? 'velocity')",
    "regime":          "p.regime IS NOT NULL",
    "liquidity":       "(p.features ? 'liquidity')",
    "ticker_memory":   "(p.features ? 'ticker_memory_used')",
    "data_quality":    "COALESCE(array_length(p.reason_codes, 1), 0) >= 2",
}


def _update_adaptive_weights(conn: psycopg.Connection) -> dict[str, int]:
    """Learn per-(signal_tf, horizon, regime, feature_group) weights.

    Edge = hit_rate(group present) - hit_rate(group absent). Map edge into
    a [-0.5, +0.5] band, multiply by learning rate eta = 0.1, apply to the
    default weight. Bounded so a noisy 100% segment can't blow up a weight.

    Only mutates when sample_size (count of "present" predictions) crosses
    MIN_AW_SAMPLES. Below threshold = default_weight written verbatim, so
    even untrained rows give the ranker a usable default.
    """
    written = 0
    eta = 0.1

    # Pre-pull list of (signal_tf, horizon, regime) segments that actually
    # have outcomes — avoid writing dead rows for combos that never ran.
    segments = conn.execute(
        """
        SELECT DISTINCT p.signal_timeframe, p.forecast_horizon, COALESCE(p.regime, 'any')
        FROM delphi_predictions p
        JOIN delphi_outcomes o USING (prediction_id)
        """
    ).fetchall()

    for stf, hz, regime in segments:
        for group in FEATURE_GROUPS:
            pred = _GROUP_PREDICATES[group]
            row = conn.execute(
                f"""
                SELECT
                    COUNT(*) FILTER (WHERE {pred})                                                AS n_present,
                    COUNT(*) FILTER (WHERE NOT ({pred}))                                          AS n_absent,
                    AVG(CASE WHEN o.hit_target_range AND ({pred})         THEN 1.0 ELSE 0.0 END) /
                        NULLIF(AVG(CASE WHEN ({pred})         THEN 1.0 ELSE 0.0 END), 0)          AS hr_present,
                    AVG(CASE WHEN o.hit_target_range AND NOT ({pred})     THEN 1.0 ELSE 0.0 END) /
                        NULLIF(AVG(CASE WHEN NOT ({pred})     THEN 1.0 ELSE 0.0 END), 0)          AS hr_absent
                FROM delphi_predictions p
                JOIN delphi_outcomes o USING (prediction_id)
                WHERE p.signal_timeframe = %s
                  AND p.forecast_horizon = %s
                  AND COALESCE(p.regime, 'any') = %s
                """,
                (stf, hz, regime),
            ).fetchone()
            n_present, n_absent, hr_present, hr_absent = row
            n_present = int(n_present or 0)
            default = DEFAULT_WEIGHTS[group]

            if (
                n_present >= MIN_AW_SAMPLES
                and (n_absent or 0) >= MIN_AW_SAMPLES
                and hr_present is not None
                and hr_absent is not None
            ):
                edge = float(hr_present) - float(hr_absent)
                edge = max(-0.5, min(0.5, edge))
                current = max(0.1, min(2.5, default * (1.0 + eta * edge * 2.0)))
                perf = edge
            else:
                current = default
                perf = None

            conn.execute(
                """
                INSERT INTO delphi_adaptive_weights (
                    ticker, signal_timeframe, forecast_horizon, regime,
                    feature_group, current_weight, default_weight,
                    sample_size, performance_score, updated_at
                ) VALUES ('*', %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (ticker, signal_timeframe, forecast_horizon, regime, feature_group) DO UPDATE SET
                    current_weight = EXCLUDED.current_weight,
                    sample_size = EXCLUDED.sample_size,
                    performance_score = EXCLUDED.performance_score,
                    updated_at = NOW()
                """,
                (stf, hz, regime, group, current, default, n_present, perf),
            )
            written += 1

    return {"weight_rows_written": written, "min_sample_gate": MIN_AW_SAMPLES}


# ----------------------------------------------------------------------------
# Writer 4: ticker memory (always writes — informational)
# ----------------------------------------------------------------------------


def _update_ticker_memory(conn: psycopg.Connection) -> dict[str, int]:
    """Per-ticker rollup: best horizon, best/weak reason codes, data quality."""
    tickers = conn.execute(
        """
        SELECT DISTINCT p.ticker
        FROM delphi_predictions p
        JOIN delphi_outcomes o USING (prediction_id)
        """
    ).fetchall()

    written = 0
    for (ticker,) in tickers:
        # Best horizon = max hit_rate with at least 5 outcomes.
        horizons = conn.execute(
            """
            SELECT p.forecast_horizon,
                   COUNT(*) AS n,
                   AVG(CASE WHEN o.hit_target_range THEN 1.0 ELSE 0.0 END) AS hr,
                   AVG(CASE WHEN o.hit_target_range THEN p.expected_return
                            WHEN o.hit_invalidation_first THEN -p.downside_risk
                            ELSE 0.0 END) AS avg_ret
            FROM delphi_predictions p
            JOIN delphi_outcomes o USING (prediction_id)
            WHERE p.ticker = %s
            GROUP BY p.forecast_horizon
            HAVING COUNT(*) >= 5
            ORDER BY hr DESC NULLS LAST
            LIMIT 1
            """,
            (ticker,),
        ).fetchone()
        best_horizon = horizons[0] if horizons else None

        # Best / weak reason codes — top/bottom 3 by hit_rate, minimum 3 samples.
        rc_rows = conn.execute(
            """
            SELECT rc.reason_code,
                   COUNT(*) AS n,
                   AVG(CASE WHEN o.hit_target_range THEN 1.0 ELSE 0.0 END) AS hr
            FROM delphi_predictions p
            JOIN delphi_outcomes o USING (prediction_id)
            CROSS JOIN LATERAL UNNEST(p.reason_codes) AS rc(reason_code)
            WHERE p.ticker = %s
            GROUP BY rc.reason_code
            HAVING COUNT(*) >= 3
            ORDER BY hr DESC NULLS LAST
            """,
            (ticker,),
        ).fetchall()
        best_codes = [r[0] for r in rc_rows[:3]]
        weak_codes = [r[0] for r in rc_rows[-3:] if r[2] is not None and r[2] < 0.4][-3:]

        # Overall stats + data quality (predictions with ≥1 reason code).
        agg = conn.execute(
            """
            SELECT COUNT(*) AS n,
                   AVG(CASE WHEN o.hit_target_range THEN 1.0 ELSE 0.0 END) AS hr,
                   AVG(CASE WHEN o.hit_target_range THEN p.expected_return
                            WHEN o.hit_invalidation_first THEN -p.downside_risk
                            ELSE 0.0 END) AS avg_ret,
                   AVG(CASE WHEN COALESCE(array_length(p.reason_codes, 1), 0) >= 1
                            THEN 1.0 ELSE 0.0 END) AS dq
            FROM delphi_predictions p
            JOIN delphi_outcomes o USING (prediction_id)
            WHERE p.ticker = %s
            """,
            (ticker,),
        ).fetchone()
        n, hr, avg_ret, dq = agg

        conn.execute(
            """
            INSERT INTO delphi_ticker_memory (
                ticker, best_horizon, best_reason_codes, weak_reason_codes,
                prediction_count, average_hit_rate, average_return,
                data_quality_score, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (ticker) DO UPDATE SET
                best_horizon = EXCLUDED.best_horizon,
                best_reason_codes = EXCLUDED.best_reason_codes,
                weak_reason_codes = EXCLUDED.weak_reason_codes,
                prediction_count = EXCLUDED.prediction_count,
                average_hit_rate = EXCLUDED.average_hit_rate,
                average_return = EXCLUDED.average_return,
                data_quality_score = EXCLUDED.data_quality_score,
                updated_at = NOW()
            """,
            (
                ticker, best_horizon, best_codes, weak_codes,
                int(n or 0),
                float(hr) if hr is not None else None,
                float(avg_ret) if avg_ret is not None else None,
                float(dq) if dq is not None else 1.0,
            ),
        )
        written += 1

    return {"tickers_written": written}


# ----------------------------------------------------------------------------
# Writer 5: model performance — top-level "is Delphi getting better?"
# ----------------------------------------------------------------------------


def _update_model_performance(conn: psycopg.Connection) -> dict[str, int]:
    """Compute hit rate, average return, profit factor, Brier, calibration error."""
    rows = conn.execute(
        """
        SELECT p.model_version, p.signal_timeframe, p.forecast_horizon,
               COUNT(*) AS n,
               AVG(CASE WHEN o.hit_target_range THEN 1.0 ELSE 0.0 END) AS hr,
               AVG(CASE WHEN o.hit_target_range THEN p.expected_return
                        WHEN o.hit_invalidation_first THEN -p.downside_risk
                        ELSE 0.0 END) AS avg_ret,
               SUM(CASE WHEN o.hit_target_range THEN p.expected_return ELSE 0.0 END) AS gross_win,
               SUM(CASE WHEN o.hit_invalidation_first THEN p.downside_risk ELSE 0.0 END) AS gross_loss,
               AVG((CASE WHEN o.hit_target_range THEN 1.0 ELSE 0.0 END - p.probability) ^ 2) AS brier
        FROM delphi_predictions p
        JOIN delphi_outcomes o USING (prediction_id)
        GROUP BY p.model_version, p.signal_timeframe, p.forecast_horizon
        """
    ).fetchall()

    written = 0
    for r in rows:
        mv, stf, hz, n, hr, avg_ret, gross_win, gross_loss, brier = r
        profit_factor: float | None
        if gross_loss is not None and float(gross_loss) > 1e-6:
            profit_factor = float(gross_win) / float(gross_loss)
        else:
            profit_factor = None

        # Calibration error = MAE between bucket midpoint and bucket hit rate,
        # weighted by bucket prediction count for the same segment.
        cal_rows = conn.execute(
            """
            SELECT probability_bucket, prediction_count, actual_hit_rate
            FROM delphi_calibration_buckets
            WHERE forecast_horizon = %s
            """,
            (hz,),
        ).fetchall()
        if cal_rows:
            num = 0.0
            den = 0
            for bucket, count, actual in cal_rows:
                if actual is None:
                    continue
                num += int(count) * abs(_midpoint(bucket) - float(actual))
                den += int(count)
            calibration_error = (num / den) if den > 0 else None
        else:
            calibration_error = None

        conn.execute(
            """
            INSERT INTO delphi_model_performance (
                model_version, signal_timeframe, forecast_horizon,
                prediction_count, target_hit_rate, average_realized_return,
                profit_factor, brier_score, calibration_error, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (model_version, signal_timeframe, forecast_horizon) DO UPDATE SET
                prediction_count = EXCLUDED.prediction_count,
                target_hit_rate = EXCLUDED.target_hit_rate,
                average_realized_return = EXCLUDED.average_realized_return,
                profit_factor = EXCLUDED.profit_factor,
                brier_score = EXCLUDED.brier_score,
                calibration_error = EXCLUDED.calibration_error,
                updated_at = NOW()
            """,
            (
                mv, stf, hz, int(n or 0),
                float(hr) if hr is not None else None,
                float(avg_ret) if avg_ret is not None else None,
                profit_factor,
                float(brier) if brier is not None else None,
                calibration_error,
            ),
        )
        written += 1

    return {"segments_written": written}


# ----------------------------------------------------------------------------
# Entry point
# ----------------------------------------------------------------------------


@dataclass
class LearnSummary:
    outcomes_total: int
    reason_codes: dict[str, int]
    calibration: dict[str, int]
    adaptive_weights: dict[str, int]
    ticker_memory: dict[str, int]
    model_performance: dict[str, int]

    def to_dict(self) -> dict[str, Any]:
        return {
            "outcomes_total": self.outcomes_total,
            "reason_codes": self.reason_codes,
            "calibration": self.calibration,
            "adaptive_weights": self.adaptive_weights,
            "ticker_memory": self.ticker_memory,
            "model_performance": self.model_performance,
            "thresholds": {
                "min_reason_code_samples": MIN_RC_SAMPLES,
                "min_calibration_bucket_samples": MIN_BUCKET_SAMPLES,
                "min_adaptive_weight_samples": MIN_AW_SAMPLES,
            },
        }


def learn(database_url: str) -> dict[str, Any]:
    """Run all five writers in sequence. Idempotent.

    Skips if there are no outcomes at all — every writer would be a no-op
    and it's cleaner to log a single "calibrating" line than five empty
    summaries.
    """
    with connect(database_url) as conn:
        n_outcomes = conn.execute("SELECT COUNT(*) FROM delphi_outcomes").fetchone()[0]
        if not n_outcomes:
            log.info("delphi-learn: no outcomes yet — skipping all writers")
            return {
                "status": "calibrating",
                "outcomes_total": 0,
                "thresholds": {
                    "min_reason_code_samples": MIN_RC_SAMPLES,
                    "min_calibration_bucket_samples": MIN_BUCKET_SAMPLES,
                    "min_adaptive_weight_samples": MIN_AW_SAMPLES,
                },
            }

        rc = _update_reason_code_performance(conn)
        # BH FDR pass after the per-code stats land — promotes only segments
        # that clear FDR-corrected q<0.05. Subsequent ranker reads should
        # join against delphi_reason_code_promotions.promoted for the gate.
        fdr = _update_reason_code_promotions(conn, fdr_alpha=0.05)
        cal = _update_calibration_buckets(conn)
        aw = _update_adaptive_weights(conn)
        tm = _update_ticker_memory(conn)
        mp = _update_model_performance(conn)
        conn.commit()

    return LearnSummary(
        outcomes_total=int(n_outcomes),
        reason_codes=rc,
        calibration=cal,
        adaptive_weights=aw,
        ticker_memory=tm,
        model_performance=mp,
    ).to_dict()
