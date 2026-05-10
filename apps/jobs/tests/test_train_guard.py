"""Regression test for train.train_baseline degenerate-rank guard.

Past bug: every persisted prediction landed at rank=1 across the universe.
The guard refuses to upsert when the rank column is uniformly degenerate.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

import pandas as pd
import pytest


def _patch_module():
    """Import-and-patch helper so the test doesn't require a real DB."""
    from cfp_jobs import train as train_mod

    return train_mod


def test_degenerate_rank_raises() -> None:
    """If walk-forward emits all-rank=1 across multiple dates, training must abort."""
    train_mod = _patch_module()

    fake_prices = pd.DataFrame(
        {
            "ts": pd.date_range("2024-01-02", periods=30, freq="B"),
            "symbol": ["XLK"] * 30,
            "close": [100.0 + i for i in range(30)],
        }
    )
    fake_features = pd.DataFrame(
        [
            {
                "ts": ts,
                "symbol": sym,
                "feature_set": "sector_v1",
                "payload": {"f1": 0.0, "f2": 0.0},
            }
            for ts in pd.date_range("2024-01-02", periods=30, freq="B")
            for sym in ("XLK", "XLF", "XLE")
        ]
    )
    # Walk-forward stub: returns an all-rank=1 prediction set across two dates.
    bad_preds = pd.DataFrame(
        [
            {"ts": pd.Timestamp("2024-02-05"), "symbol": "XLK", "score": 0.0, "rank": 1, "target": 0.01},
            {"ts": pd.Timestamp("2024-02-05"), "symbol": "XLF", "score": 0.0, "rank": 1, "target": 0.02},
            {"ts": pd.Timestamp("2024-02-06"), "symbol": "XLK", "score": 0.0, "rank": 1, "target": 0.01},
            {"ts": pd.Timestamp("2024-02-06"), "symbol": "XLF", "score": 0.0, "rank": 1, "target": 0.02},
        ]
    )
    fake_metrics = {"auc": 0.5, "ic": 0.0, "sharpe": 0.0, "hit_rate": 0.0, "n_test_dates": 2, "n_test_rows": 4}

    with (  # noqa: SIM117 — single nested with is cleaner than this many patches inline
        patch.object(train_mod, "connect"),
        patch.object(train_mod, "_load_prices", return_value=fake_prices),
        patch.object(train_mod, "_load_features", return_value=fake_features),
        patch.object(
            train_mod.targets_mod,
            "compute_targets",
            return_value=pd.DataFrame(
                [
                    {"ts": pd.Timestamp("2024-02-05"), "symbol": "XLK", "horizon_d": 5, "target": 0.01},
                    {"ts": pd.Timestamp("2024-02-05"), "symbol": "XLF", "horizon_d": 5, "target": 0.02},
                    {"ts": pd.Timestamp("2024-02-06"), "symbol": "XLK", "horizon_d": 5, "target": 0.01},
                    {"ts": pd.Timestamp("2024-02-06"), "symbol": "XLF", "horizon_d": 5, "target": 0.02},
                ]
            ),
        ),
        patch.object(
            train_mod.model_panel,
            "build_panel",
            return_value=(
                pd.DataFrame(
                    [
                        {"ts": pd.Timestamp("2024-02-05"), "symbol": "XLK", "f1": 0.0, "target": 0.01},
                        {"ts": pd.Timestamp("2024-02-05"), "symbol": "XLF", "f1": 0.0, "target": 0.02},
                        {"ts": pd.Timestamp("2024-02-06"), "symbol": "XLK", "f1": 0.0, "target": 0.01},
                        {"ts": pd.Timestamp("2024-02-06"), "symbol": "XLF", "f1": 0.0, "target": 0.02},
                    ]
                ),
                ["f1"],
            ),
        ),
        patch.object(
            train_mod.walk_forward,
            "run",
            return_value=(bad_preds, pd.DataFrame([{"fold": 0}])),
        ),
        patch.object(
            train_mod.metrics, "summarize", return_value=fake_metrics
        ),
    ):
        with pytest.raises(RuntimeError, match="degenerate rank"):
            train_mod.train_baseline("postgresql://dummy", horizons=(5,))


def test_healthy_rank_passes_guard() -> None:
    """Sanity check: a non-degenerate rank distribution does not raise."""
    train_mod = _patch_module()

    good_preds = pd.DataFrame(
        [
            {"ts": pd.Timestamp("2024-02-05"), "symbol": "XLK", "score": 0.5, "rank": 1, "target": 0.03},
            {"ts": pd.Timestamp("2024-02-05"), "symbol": "XLF", "score": 0.2, "rank": 2, "target": 0.01},
            {"ts": pd.Timestamp("2024-02-06"), "symbol": "XLK", "score": 0.3, "rank": 2, "target": 0.02},
            {"ts": pd.Timestamp("2024-02-06"), "symbol": "XLF", "score": 0.6, "rank": 1, "target": 0.04},
        ]
    )
    fake_metrics = {"auc": 0.6, "ic": 0.1, "sharpe": 1.0, "hit_rate": 0.5, "n_test_dates": 2, "n_test_rows": 4}

    class _FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def commit(self):
            pass

        def cursor(self):
            class _Cur:
                def __enter__(self):
                    return self

                def __exit__(self, *a):
                    return False

                def executemany(self, *a, **k):
                    pass

            return _Cur()

    with (
        patch.object(train_mod, "connect", return_value=_FakeConn()),
        patch.object(train_mod, "_load_prices", return_value=pd.DataFrame({"ts": [datetime(2024, 1, 1, tzinfo=UTC)], "symbol": ["XLK"], "close": [100.0]})),
        patch.object(train_mod, "_load_features", return_value=pd.DataFrame([{"ts": datetime(2024, 1, 1, tzinfo=UTC), "symbol": "XLK", "feature_set": "sector_v1", "payload": {}}])),
        patch.object(train_mod.targets_mod, "compute_targets", return_value=pd.DataFrame([{"ts": pd.Timestamp("2024-02-05"), "symbol": "XLK", "horizon_d": 5, "target": 0.03}])),
        patch.object(
            train_mod.model_panel,
            "build_panel",
            return_value=(
                pd.DataFrame([{"ts": pd.Timestamp("2024-02-05"), "symbol": "XLK", "f1": 0.0, "target": 0.01}]),
                ["f1"],
            ),
        ),
        patch.object(
            train_mod.walk_forward,
            "run",
            return_value=(good_preds, pd.DataFrame([{"fold": 0}])),
        ),
        patch.object(train_mod.metrics, "summarize", return_value=fake_metrics),
    ):
        result = train_mod.train_baseline("postgresql://dummy", horizons=(5,))
        assert result["n_predictions"] == 4
