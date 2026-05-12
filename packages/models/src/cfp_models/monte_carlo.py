"""Monte Carlo bootstrap for backtest robustness.

walk_forward.py gives one realized path; this module resamples that path's
daily returns with replacement to estimate the distribution of:

  * total return
  * max drawdown
  * Sharpe ratio
  * win rate

Use when you want to answer "could my walk-forward NDCG@5 be luck?" — if the
5th-percentile Sharpe is < 0, the strategy is fragile.

Stationary block bootstrap supported (preserves autocorrelation) — pass
``block_size > 1``.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class MCResult:
    n_sims: int
    block_size: int
    total_return: dict[str, float]      # mean, p05, p50, p95
    max_drawdown: dict[str, float]
    sharpe: dict[str, float]
    win_rate: dict[str, float]

    def to_dict(self) -> dict:
        return {
            "n_sims": self.n_sims,
            "block_size": self.block_size,
            "total_return": self.total_return,
            "max_drawdown": self.max_drawdown,
            "sharpe": self.sharpe,
            "win_rate": self.win_rate,
        }


def _max_drawdown(returns: np.ndarray) -> float:
    """Returns a negative number — the worst peak-to-trough decline."""
    cum = np.cumprod(1.0 + returns)
    peaks = np.maximum.accumulate(cum)
    dd = (cum - peaks) / peaks
    return float(dd.min()) if len(dd) else 0.0


def _sharpe(returns: np.ndarray, periods_per_year: int = 252) -> float:
    if len(returns) < 2:
        return 0.0
    std = returns.std(ddof=1)
    if std == 0:
        return 0.0
    return float((returns.mean() / std) * np.sqrt(periods_per_year))


def _bootstrap_sample(returns: np.ndarray, block_size: int, rng: np.random.Generator) -> np.ndarray:
    n = len(returns)
    if block_size <= 1:
        idx = rng.integers(0, n, size=n)
        return returns[idx]
    # Stationary block bootstrap (geometrically distributed block lengths give
    # the same expected length without the edge artifacts of fixed-block).
    out = np.empty(n, dtype=returns.dtype)
    i = 0
    while i < n:
        start = rng.integers(0, n)
        length = rng.geometric(1.0 / block_size)
        for j in range(length):
            if i >= n:
                break
            out[i] = returns[(start + j) % n]
            i += 1
    return out


def run_monte_carlo(
    daily_returns: np.ndarray | list[float],
    *,
    n_sims: int = 10_000,
    block_size: int = 1,
    seed: int | None = 42,
    periods_per_year: int = 252,
) -> MCResult:
    """Bootstrap the daily-return series and summarize the resampled paths."""
    arr = np.asarray(daily_returns, dtype=float)
    arr = arr[~np.isnan(arr)]
    if len(arr) < 2:
        raise ValueError("need at least 2 daily returns to bootstrap")
    rng = np.random.default_rng(seed)

    totals = np.empty(n_sims)
    dds = np.empty(n_sims)
    sharpes = np.empty(n_sims)
    wins = np.empty(n_sims)
    for i in range(n_sims):
        sample = _bootstrap_sample(arr, block_size, rng)
        totals[i] = np.prod(1.0 + sample) - 1.0
        dds[i] = _max_drawdown(sample)
        sharpes[i] = _sharpe(sample, periods_per_year)
        wins[i] = float((sample > 0).mean())

    def _summary(x: np.ndarray) -> dict[str, float]:
        return {
            "mean": float(np.mean(x)),
            "p05": float(np.percentile(x, 5)),
            "p50": float(np.percentile(x, 50)),
            "p95": float(np.percentile(x, 95)),
        }

    return MCResult(
        n_sims=n_sims,
        block_size=block_size,
        total_return=_summary(totals),
        max_drawdown=_summary(dds),
        sharpe=_summary(sharpes),
        win_rate=_summary(wins),
    )
