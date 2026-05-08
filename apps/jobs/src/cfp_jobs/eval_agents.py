"""Forward-return evaluation for the agent ensemble.

For every agent_signals row that's at least 5 trading days old, join to
prices_daily and compute the realized forward return vs SPY at multiple
horizons (5d, 10d, 20d, 60d). Persist to `agent_eval` for the scorecard
endpoint to read.

The eval is what makes the ensemble falsifiable. After ~60 days of daily
runs you'll have enough per-persona, per-regime data to:
  - rank personas by hit-rate
  - flag redundant pairs (Buffett ↔ Munger correlation, etc.)
  - tell the synthesizer which personas to weight in current regime

Idempotent: re-running fills in newer forward-return horizons as more
trading days accrue. Skips rows where the run_ts is too recent for any
horizon to be valid (less than 5 trading days old).

Run via: `cfp-jobs eval-agents [--lookback 90]`
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

import psycopg

from cfp_jobs.db import connect

log = logging.getLogger(__name__)


# Forward-return horizons we care about (in calendar days; close enough to
# trading days for windowed lookups).
HORIZONS = [5, 10, 20, 60]


# Hit-rate threshold: |forward return| > 1% counts as a "real" move; smaller
# noise doesn't validate or invalidate the agent's call.
HIT_THRESHOLD = 0.01


_UPSERT_SQL = """
INSERT INTO agent_eval (
    run_ts, ticker, agent, signal, confidence,
    fwd_return_5d, fwd_return_10d, fwd_return_20d, fwd_return_60d,
    regime_at_run,
    hit_5d, hit_10d, hit_20d, hit_60d,
    last_evaluated
) VALUES (
    %(run_ts)s, %(ticker)s, %(agent)s, %(signal)s, %(confidence)s,
    %(fwd_return_5d)s, %(fwd_return_10d)s, %(fwd_return_20d)s, %(fwd_return_60d)s,
    %(regime_at_run)s,
    %(hit_5d)s, %(hit_10d)s, %(hit_20d)s, %(hit_60d)s,
    NOW()
) ON CONFLICT (run_ts, ticker, agent) DO UPDATE SET
    fwd_return_5d  = COALESCE(EXCLUDED.fwd_return_5d,  agent_eval.fwd_return_5d),
    fwd_return_10d = COALESCE(EXCLUDED.fwd_return_10d, agent_eval.fwd_return_10d),
    fwd_return_20d = COALESCE(EXCLUDED.fwd_return_20d, agent_eval.fwd_return_20d),
    fwd_return_60d = COALESCE(EXCLUDED.fwd_return_60d, agent_eval.fwd_return_60d),
    hit_5d  = COALESCE(EXCLUDED.hit_5d,  agent_eval.hit_5d),
    hit_10d = COALESCE(EXCLUDED.hit_10d, agent_eval.hit_10d),
    hit_20d = COALESCE(EXCLUDED.hit_20d, agent_eval.hit_20d),
    hit_60d = COALESCE(EXCLUDED.hit_60d, agent_eval.hit_60d),
    regime_at_run = COALESCE(EXCLUDED.regime_at_run, agent_eval.regime_at_run),
    last_evaluated = NOW()
"""


def _hit_for_signal(signal: str, ret: float | None) -> bool | None:
    """Did the agent's directional call get rewarded by the forward return?

    Returns None when the move was below threshold (insufficient signal),
    True when call + outcome agree, False when they disagree. Neutral
    calls "hit" when the move stayed within +/- threshold (i.e., the
    neutral call was correct that nothing happened)."""
    if ret is None:
        return None
    if signal == "bullish":
        return ret > HIT_THRESHOLD if abs(ret) > HIT_THRESHOLD else None
    if signal == "bearish":
        return ret < -HIT_THRESHOLD if abs(ret) > HIT_THRESHOLD else None
    if signal == "neutral":
        return abs(ret) <= HIT_THRESHOLD
    return None


def _fwd_relative_return(
    conn: psycopg.Connection,
    ticker: str,
    run_date: datetime,
    horizon_days: int,
) -> float | None:
    """Forward-N-day return for `ticker` minus the same return for SPY.

    Uses calendar-day search with closest-bar fallback so weekends/holidays
    don't break the lookup. Returns None when forward bar isn't yet observed."""
    target_dt = run_date + timedelta(days=horizon_days)
    sql = """
        WITH base AS (
            SELECT close FROM prices_daily
            WHERE symbol = %s AND ts <= %s
            ORDER BY ts DESC LIMIT 1
        ),
        fwd AS (
            SELECT close FROM prices_daily
            WHERE symbol = %s AND ts >= %s
            ORDER BY ts ASC LIMIT 1
        )
        SELECT (SELECT close FROM base), (SELECT close FROM fwd)
    """
    with conn.cursor() as cur:
        cur.execute(sql, (ticker, run_date, ticker, target_dt))
        row = cur.fetchone()
        base_close, fwd_close = (row or (None, None))
    if not base_close or not fwd_close or base_close <= 0:
        return None
    sym_ret = (fwd_close / base_close) - 1.0

    with conn.cursor() as cur:
        cur.execute(sql, ("SPY", run_date, "SPY", target_dt))
        row = cur.fetchone()
        spy_base, spy_fwd = (row or (None, None))
    if not spy_base or not spy_fwd or spy_base <= 0:
        return float(sym_ret)
    spy_ret = (spy_fwd / spy_base) - 1.0
    return float(sym_ret - spy_ret)


def _classify_regime(conn: psycopg.Connection, run_date: datetime) -> str | None:
    """Bull / bear / chop classification of SPY at run time using 50d slope.

    +5% over 50d -> 'bull', -5% -> 'bear', else 'chop'. Cheap heuristic; can
    be replaced with a real regime model later."""
    sql = """
        SELECT
          (SELECT close FROM prices_daily WHERE symbol='SPY' AND ts <= %s ORDER BY ts DESC LIMIT 1),
          (SELECT close FROM prices_daily WHERE symbol='SPY' AND ts <= %s ORDER BY ts DESC LIMIT 1)
    """
    with conn.cursor() as cur:
        cur.execute(sql, (run_date, run_date - timedelta(days=50)))
        row = cur.fetchone()
    if not row:
        return None
    now_close, then_close = row
    if not now_close or not then_close or then_close <= 0:
        return None
    pct = (now_close / then_close) - 1.0
    if pct > 0.05:
        return "bull"
    if pct < -0.05:
        return "bear"
    return "chop"


def evaluate(database_url: str, lookback_days: int = 90) -> dict:
    """Walk agent_signals rows in (now - lookback, now - 5d) and compute
    forward returns for any horizon that has elapsed.

    Returns counts dict for the CLI to print."""
    now = datetime.now(UTC)
    cutoff_recent = now - timedelta(days=5)
    cutoff_old = now - timedelta(days=lookback_days)

    n_rows = 0
    n_skipped = 0
    n_per_horizon: dict[int, int] = {h: 0 for h in HORIZONS}

    with connect(database_url) as conn:
        # Pull the candidate signals once.
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT run_ts, ticker, agent, signal, confidence
                FROM agent_signals
                WHERE run_ts BETWEEN %s AND %s
                ORDER BY run_ts ASC
                """,
                (cutoff_old, cutoff_recent),
            )
            rows = cur.fetchall()

        for run_ts, ticker, agent, signal, confidence in rows:
            regime = _classify_regime(conn, run_ts)

            fwds: dict[int, float | None] = {}
            for h in HORIZONS:
                # Skip horizons that haven't elapsed yet.
                # run_ts is TIMESTAMPTZ-backed; coerce to UTC for the delta.
                run_ts_utc = run_ts if run_ts.tzinfo else run_ts.replace(tzinfo=UTC)
                if now - run_ts_utc < timedelta(days=h):
                    fwds[h] = None
                    continue
                fwds[h] = _fwd_relative_return(conn, ticker, run_ts, h)
                if fwds[h] is not None:
                    n_per_horizon[h] += 1

            if all(v is None for v in fwds.values()):
                n_skipped += 1
                continue

            params = {
                "run_ts": run_ts,
                "ticker": ticker,
                "agent": agent,
                "signal": signal,
                "confidence": float(confidence) if confidence is not None else None,
                "fwd_return_5d": fwds.get(5),
                "fwd_return_10d": fwds.get(10),
                "fwd_return_20d": fwds.get(20),
                "fwd_return_60d": fwds.get(60),
                "regime_at_run": regime,
                "hit_5d": _hit_for_signal(signal, fwds.get(5)),
                "hit_10d": _hit_for_signal(signal, fwds.get(10)),
                "hit_20d": _hit_for_signal(signal, fwds.get(20)),
                "hit_60d": _hit_for_signal(signal, fwds.get(60)),
            }
            with conn.cursor() as cur:
                cur.execute(_UPSERT_SQL, params)
            n_rows += 1

        conn.commit()

    return {
        "n_rows_evaluated": n_rows,
        "n_skipped": n_skipped,
        "per_horizon": n_per_horizon,
    }
