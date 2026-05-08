"""End-to-end test of the XGBoost ranker on synthetic data with a planted signal.

If the ranker can't learn a feature that perfectly predicts the target, the
training pipeline is broken. This is the canary for refactors.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from cfp_models import metrics, xgb_baseline


def _synthetic_panel(
    n_dates: int = 200, n_symbols: int = 10, seed: int = 42
) -> tuple[pd.DataFrame, list[str]]:
    """Build a panel where feature `signal` linearly predicts `target` plus noise.

    Other features are pure noise so the model has to discriminate.
    """
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2024-01-02", periods=n_dates, freq="B")
    rows = []
    for ts in dates:
        signals = rng.normal(0, 1.0, size=n_symbols)
        noise = rng.normal(0, 0.5, size=n_symbols)
        targets = 0.01 * signals + 0.005 * noise  # signal explains majority
        for i in range(n_symbols):
            rows.append(
                {
                    "ts": ts,
                    "symbol": f"SYM{i}",
                    "signal": float(signals[i]),
                    "noise1": float(rng.normal()),
                    "noise2": float(rng.normal()),
                    "noise3": float(rng.normal()),
                    "target": float(targets[i]),
                }
            )
    panel = pd.DataFrame(rows)
    feature_cols = ["signal", "noise1", "noise2", "noise3"]
    return panel, feature_cols


def test_ranker_learns_planted_signal() -> None:
    panel, feature_cols = _synthetic_panel()
    dates = sorted(panel["ts"].unique())
    train = panel[panel["ts"].isin(dates[:120])]
    val = panel[panel["ts"].isin(dates[120:140])]
    test = panel[panel["ts"].isin(dates[140:])]

    model = xgb_baseline.train(
        train, val, feature_cols,
        params=xgb_baseline.XgbRankParams(n_estimators=100, early_stopping_rounds=20),
    )
    preds = xgb_baseline.predict(model, test, feature_cols)
    preds = preds.merge(test[["ts", "symbol", "target"]], on=["ts", "symbol"])

    auc = metrics.ranking_auc(preds)
    ic = metrics.information_coefficient(preds)
    assert auc > 0.85, f"ranker failed to learn planted signal (AUC={auc:.3f})"
    assert ic > 0.5, f"IC too low (IC={ic:.3f})"


def test_predict_assigns_unique_ranks_per_date() -> None:
    panel, feature_cols = _synthetic_panel(n_dates=40, n_symbols=8)
    dates = sorted(panel["ts"].unique())
    train = panel[panel["ts"].isin(dates[:20])]
    val = panel[panel["ts"].isin(dates[20:25])]
    test = panel[panel["ts"].isin(dates[25:])]

    model = xgb_baseline.train(
        train, val, feature_cols,
        params=xgb_baseline.XgbRankParams(n_estimators=30, early_stopping_rounds=10),
    )
    preds = xgb_baseline.predict(model, test, feature_cols)
    for _, g in preds.groupby("ts"):
        ranks = sorted(g["rank"].tolist())
        assert ranks == list(range(1, len(g) + 1))
