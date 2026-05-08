"""Granger causality lead-lag matrix (DESIGN.md §6.5).

For each (candidate, target) pair, test whether the candidate's daily returns
Granger-cause the target's. We report the minimum p-value across lags 1..max_lag.

Computed at monthly cadence (this is O(N*M) tests, each ~50ms).
"""

from __future__ import annotations

import logging
import warnings

import numpy as np
import pandas as pd
from statsmodels.tsa.stattools import grangercausalitytests

log = logging.getLogger(__name__)


def compute_lead_lag(
    prices_wide: pd.DataFrame,
    candidates: list[str],
    targets: list[str],
    *,
    max_lag: int = 10,
    lookback: int = 252,
) -> pd.DataFrame:
    """Returns long-format DataFrame: leader, follower, max_lag, p_value.

    `lookback` business days of returns are used (default 1y).
    """
    rets = prices_wide.pct_change(1)
    if lookback:
        rets = rets.iloc[-lookback:]
    rets = rets.replace([np.inf, -np.inf], np.nan)

    rows: list[dict] = []
    for tgt in targets:
        if tgt not in rets.columns:
            continue
        for cand in candidates:
            if cand == tgt or cand not in rets.columns:
                continue
            joined = rets[[tgt, cand]].dropna()
            if len(joined) < max_lag * 4:
                continue
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    result = grangercausalitytests(
                        joined.to_numpy(), maxlag=max_lag, verbose=False
                    )
                p = min(result[lag][0]["ssr_ftest"][1] for lag in result)
            except Exception as e:
                log.debug("Granger fail %s -> %s: %s", cand, tgt, e)
                continue
            rows.append(
                {"leader": cand, "follower": tgt, "max_lag": max_lag, "p_value": float(p)}
            )

    return pd.DataFrame(rows)


def top_leaders_per_target(
    matrix: pd.DataFrame, k: int = 3, alpha: float = 0.05
) -> dict[str, list[dict]]:
    """For each follower, return up to `k` leaders with smallest p_value < alpha."""
    out: dict[str, list[dict]] = {}
    if matrix.empty:
        return out
    for tgt, group in matrix.groupby("follower"):
        sig = group[group["p_value"] < alpha].nsmallest(k, "p_value")
        out[str(tgt)] = sig[["leader", "p_value", "max_lag"]].to_dict(orient="records")
    return out
