"""Monte Carlo bootstrap tests."""

from __future__ import annotations

import numpy as np
import pytest

from cfp_models.monte_carlo import run_monte_carlo


def test_positive_drift_has_positive_mean_return() -> None:
    rng = np.random.default_rng(0)
    # Daily returns with positive drift
    returns = rng.normal(loc=0.001, scale=0.01, size=252)
    out = run_monte_carlo(returns, n_sims=500, seed=1)
    assert out.total_return["mean"] > 0
    assert out.sharpe["mean"] > 0


def test_max_drawdown_is_nonpositive() -> None:
    returns = np.array([0.01, -0.05, 0.02, -0.10, 0.03] * 20)
    out = run_monte_carlo(returns, n_sims=200, seed=1)
    assert out.max_drawdown["mean"] <= 0
    assert out.max_drawdown["p05"] <= out.max_drawdown["p95"]


def test_p05_lt_p50_lt_p95() -> None:
    rng = np.random.default_rng(2)
    returns = rng.normal(loc=0.0005, scale=0.012, size=252)
    out = run_monte_carlo(returns, n_sims=1000, seed=3)
    for k in ("total_return", "max_drawdown", "sharpe", "win_rate"):
        s = getattr(out, k)
        assert s["p05"] <= s["p50"] <= s["p95"], f"{k} percentiles out of order: {s}"


def test_block_bootstrap_changes_distribution() -> None:
    """Stationary block bootstrap should yield different — usually wider — DD
    distribution than IID resampling on autocorrelated returns."""
    rng = np.random.default_rng(4)
    # AR(1) returns
    eps = rng.normal(0, 0.01, 500)
    returns = np.zeros_like(eps)
    for i in range(1, len(eps)):
        returns[i] = 0.5 * returns[i - 1] + eps[i]
    iid = run_monte_carlo(returns, n_sims=500, block_size=1, seed=5)
    block = run_monte_carlo(returns, n_sims=500, block_size=20, seed=5)
    # Both should produce sane DD values; block-bootstrap p05 should be <= iid p05
    # (block bootstrap preserves the autocorrelation that makes drawdowns deeper).
    assert block.max_drawdown["p05"] <= iid.max_drawdown["p05"] + 0.05  # tolerance


def test_rejects_too_few_returns() -> None:
    with pytest.raises(ValueError):
        run_monte_carlo([0.01], n_sims=10)


def test_to_dict_serializable() -> None:
    import json

    out = run_monte_carlo([0.01, -0.005, 0.002, 0.001] * 30, n_sims=50, seed=0)
    json.dumps(out.to_dict())  # must not raise
