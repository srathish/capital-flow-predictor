"""Well-replicated quant anomalies — features the academic literature has
beaten on for 50 years and that Delphi has never read.

Three to start:

1. **PEAD** (Post-Earnings-Announcement Drift, Ball & Brown 1968 → present):
   Earnings surprises drift 60 trading days in the direction of the surprise.
   Effect is strongest in the first 10 days. We can't compute true surprise
   without consensus EPS for the *prior* report; we proxy it with the actual
   post-earnings 1d move (positive = beat, negative = miss) and decay it over
   the next 60d.

2. **Time-series momentum** (Moskowitz et al 2012): 12-1 momentum (12-month
   return excluding the most recent month) has strong t-stats across asset
   classes. Predicts +1mo to +12mo returns.

3. **Idiosyncratic vol anomaly** (Ang et al 2006): low-idiovol > high-idiovol
   on a risk-adjusted basis. Compute residual vol = stddev(return - β*spy_return)
   over 60 days.

We have prices_daily and uw_earnings already. No new ingest required.
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd
import psycopg

log = logging.getLogger(__name__)


def _pead(conn: psycopg.Connection, ticker: str) -> dict[str, Any]:
    """True PEAD signal — actual EPS − consensus EPS, with 60-day decay.

    Earnings surprise is the textbook PEAD predictor (Ball & Brown 1968):
    standardized unexpected earnings (SUE) drift positively for 60 trading
    days post-announcement. Sign of surprise tells direction, magnitude
    tells strength. We use raw $ surprise scaled by analyst-disagreement
    proxy (estimate_high − estimate_low) so that a $0.05 beat on a
    consensus-tight name carries more weight than $0.05 on a wide range.

    Falls back to the post_earnings_move_1d proxy when consensus estimates
    are missing — but only for the SIGN, not magnitude. Removes the
    look-back bias my v1 proxy had (which leaked the next-day reaction
    into the "predictor").

    Returns:
      pead_signal           decayed surprise (sign = direction, mag = strength)
      pead_surprise_pct     (actual − est) / abs(est)   — raw, undecayed
      pead_sue              standardized: surprise / (high − low) when present
      pead_days_since       trading days since report (calendar days actually)
      pead_in_window        days_since <= 60
      pead_source           'true_surprise' | 'reaction_proxy' | 'no_data'
    """
    # First try the true surprise path.
    row = conn.execute(
        """
        SELECT report_date, actual_eps, street_mean_est
        FROM uw_earnings
        WHERE ticker = %s AND report_date <= CURRENT_DATE
          AND actual_eps IS NOT NULL AND street_mean_est IS NOT NULL
        ORDER BY report_date DESC LIMIT 1
        """,
        (ticker,),
    ).fetchone()
    if row and row[0] is not None:
        rd, actual, est = row[0], float(row[1]), float(row[2])
        days_since = (pd.Timestamp.now(tz="UTC").date() - rd).days
        surprise = actual - est
        # Percent surprise relative to consensus magnitude.
        surprise_pct = surprise / abs(est) if abs(est) > 1e-6 else None

        # Pull analyst-disagreement range for SUE-style normalization.
        rng_row = conn.execute(
            """
            SELECT eps_estimate_high, eps_estimate_low
            FROM uw_earnings_estimates
            WHERE ticker = %s AND report_date = %s
              AND eps_estimate_high IS NOT NULL AND eps_estimate_low IS NOT NULL
            ORDER BY report_date DESC LIMIT 1
            """,
            (ticker, rd),
        ).fetchone()
        sue = None
        if rng_row and rng_row[0] is not None and rng_row[1] is not None:
            spread = float(rng_row[0]) - float(rng_row[1])
            if spread > 1e-9:
                sue = surprise / spread  # standardized unexpected earnings

        # 60-trading-day linear decay (~84 calendar days).
        decay = max(0.0, 1.0 - days_since / 60.0) if days_since <= 60 else 0.0
        signal_mag = sue if sue is not None else surprise_pct
        signal = (float(signal_mag) * decay) if signal_mag is not None else None
        return {
            "pead_signal":       signal,
            "pead_surprise_pct": surprise_pct,
            "pead_sue":          sue,
            "pead_days_since":   int(days_since),
            "pead_in_window":    days_since <= 60,
            "pead_source":       "true_surprise",
        }

    # Fallback: reaction proxy. Sign-only — magnitude is the next-day move
    # which has look-back leakage so we don't use it as strength.
    fb_row = conn.execute(
        """
        SELECT report_date, post_earnings_move_1d
        FROM uw_earnings
        WHERE ticker = %s AND report_date <= CURRENT_DATE
          AND post_earnings_move_1d IS NOT NULL
        ORDER BY report_date DESC LIMIT 1
        """,
        (ticker,),
    ).fetchone()
    if not fb_row or fb_row[0] is None:
        return {
            "pead_signal": None, "pead_surprise_pct": None, "pead_sue": None,
            "pead_days_since": None, "pead_in_window": False,
            "pead_source": "no_data",
        }
    rd, move = fb_row[0], float(fb_row[1])
    days_since = (pd.Timestamp.now(tz="UTC").date() - rd).days
    decay = max(0.0, 1.0 - days_since / 60.0) if days_since <= 60 else 0.0
    return {
        # sign-only signal: small fixed magnitude so it's not dominant
        "pead_signal":       (0.5 if move > 0 else -0.5) * decay,
        "pead_surprise_pct": None,
        "pead_sue":          None,
        "pead_days_since":   int(days_since),
        "pead_in_window":    days_since <= 60,
        "pead_source":       "reaction_proxy",
    }


def _ts_momentum(conn: psycopg.Connection, ticker: str) -> dict[str, Any]:
    """12-1 momentum: (price 21d ago / price 252d ago) - 1.

    Skipping the most recent month is intentional — short-term reversal
    confounds raw 12m mom. The skip-month form is the academic version with
    the cleanest replication.
    """
    rows = conn.execute(
        """
        SELECT ts::date, close FROM prices_daily
        WHERE symbol = %s AND close IS NOT NULL
        ORDER BY ts DESC LIMIT 270
        """,
        (ticker,),
    ).fetchall()
    if not rows or len(rows) < 252:
        return {"ts_momentum_12_1": None}
    closes = [float(r[1]) for r in rows]
    # rows are DESC, so closes[0] = most recent
    p_now = closes[21]   # 21 trading days ago = ~1 calendar month
    p_then = closes[251] if len(closes) > 251 else closes[-1]
    if p_then is None or p_then == 0:
        return {"ts_momentum_12_1": None}
    return {"ts_momentum_12_1": float(p_now / p_then - 1.0)}


def _idio_vol(conn: psycopg.Connection, ticker: str) -> dict[str, Any]:
    """Idiosyncratic volatility = stddev of (ticker_return - β * spy_return)
    over the last 60 trading days. β estimated by OLS over the same window.

    Pulls SPY in the same query for speed. Returns None when SPY is missing
    or the window is too short.
    """
    if ticker.upper() == "SPY":
        return {"idio_vol_60d": None, "beta_60d": None}
    rows = conn.execute(
        """
        WITH a AS (
            SELECT ts::date AS d, close AS c
            FROM prices_daily WHERE symbol = %s AND close IS NOT NULL
            ORDER BY ts DESC LIMIT 65
        ),
        s AS (
            SELECT ts::date AS d, close AS c
            FROM prices_daily WHERE symbol = 'SPY' AND close IS NOT NULL
            ORDER BY ts DESC LIMIT 65
        )
        SELECT a.d, a.c AS ac, s.c AS sc
        FROM a JOIN s USING (d)
        ORDER BY a.d ASC
        """,
        (ticker,),
    ).fetchall()
    if not rows or len(rows) < 30:
        return {"idio_vol_60d": None, "beta_60d": None}
    df = pd.DataFrame(rows, columns=["d", "ac", "sc"])
    df["ar"] = df["ac"].pct_change()
    df["sr"] = df["sc"].pct_change()
    df = df.dropna()
    if len(df) < 20 or df["sr"].std() == 0:
        return {"idio_vol_60d": None, "beta_60d": None}
    cov = float(df["ar"].cov(df["sr"]))
    var_s = float(df["sr"].var())
    beta = cov / var_s if var_s > 0 else None
    if beta is None:
        return {"idio_vol_60d": None, "beta_60d": None}
    df["resid"] = df["ar"] - beta * df["sr"]
    return {"idio_vol_60d": float(df["resid"].std() * np.sqrt(252)), "beta_60d": float(beta)}


def compute(conn: psycopg.Connection, ticker: str) -> dict[str, Any]:
    """All anomaly features for a ticker. Empty dict on hard failure."""
    out: dict[str, Any] = {}
    try:
        out.update(_pead(conn, ticker))
    except Exception as e:  # noqa: BLE001
        log.debug("pead failed for %s: %s", ticker, e)
    try:
        out.update(_ts_momentum(conn, ticker))
    except Exception as e:  # noqa: BLE001
        log.debug("ts_momentum failed for %s: %s", ticker, e)
    try:
        out.update(_idio_vol(conn, ticker))
    except Exception as e:  # noqa: BLE001
        log.debug("idio_vol failed for %s: %s", ticker, e)
    return out
