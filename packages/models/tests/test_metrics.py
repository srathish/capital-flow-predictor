from __future__ import annotations

import numpy as np
import pandas as pd
from cfp_models.metrics import (
    information_coefficient,
    long_short_sharpe,
    ranking_auc,
    top1_hit_rate,
)


def _perfect_preds(n_dates: int = 30, n_symbols: int = 8) -> pd.DataFrame:
    rng = np.random.default_rng(0)
    rows = []
    for d in range(n_dates):
        ts = pd.Timestamp("2024-01-02") + pd.Timedelta(days=d)
        targets = rng.normal(0, 0.02, size=n_symbols)
        for i, t in enumerate(targets):
            rows.append(
                {
                    "ts": ts,
                    "symbol": f"SYM{i}",
                    "score": float(t),  # perfect: score == target
                    "target": float(t),
                    "rank": 0,
                }
            )
    return pd.DataFrame(rows)


def _random_preds(n_dates: int = 30, n_symbols: int = 8) -> pd.DataFrame:
    rng = np.random.default_rng(1)
    rows = []
    for d in range(n_dates):
        ts = pd.Timestamp("2024-01-02") + pd.Timedelta(days=d)
        for i in range(n_symbols):
            rows.append(
                {
                    "ts": ts,
                    "symbol": f"SYM{i}",
                    "score": float(rng.normal()),
                    "target": float(rng.normal(0, 0.02)),
                    "rank": 0,
                }
            )
    return pd.DataFrame(rows)


def test_perfect_predictions_max_metrics() -> None:
    p = _perfect_preds()
    assert ranking_auc(p) == 1.0
    assert information_coefficient(p) > 0.99
    assert top1_hit_rate(p) == 1.0
    assert long_short_sharpe(p) > 0


def test_random_predictions_near_chance() -> None:
    p = _random_preds(n_dates=200, n_symbols=10)
    auc = ranking_auc(p)
    assert 0.4 < auc < 0.6, f"random AUC should be near 0.5, got {auc}"


def test_empty_inputs() -> None:
    empty = pd.DataFrame(columns=["ts", "symbol", "score", "target", "rank"])
    assert pd.isna(ranking_auc(empty))
    assert pd.isna(information_coefficient(empty))
    assert pd.isna(top1_hit_rate(empty))
    assert pd.isna(long_short_sharpe(empty))
