from __future__ import annotations

import pandas as pd
from cfp_models.walk_forward import WalkForwardConfig, splits


def test_splits_are_non_overlapping_and_chronological() -> None:
    dates = list(pd.date_range("2024-01-02", periods=600, freq="B"))
    cfg = WalkForwardConfig(train_months=18, val_months=1, test_months=1, step_months=1)
    folds = list(splits(dates, cfg))
    assert len(folds) > 0

    for train, val, test in folds:
        assert len(train) == 18 * 21
        assert len(val) == 21
        assert len(test) == 21
        # ordering
        assert max(train) < min(val)
        assert max(val) < min(test)


def test_splits_step_size() -> None:
    dates = list(pd.date_range("2024-01-02", periods=600, freq="B"))
    cfg = WalkForwardConfig(step_months=1)
    folds = list(splits(dates, cfg))
    if len(folds) >= 2:
        first_test_start = folds[0][2][0]
        second_test_start = folds[1][2][0]
        # step is 21 business days
        gap = (second_test_start - first_test_start).days
        # business days span ~21 calendar days (give or take weekends/holidays)
        assert 28 <= gap <= 35


def test_splits_too_short_history() -> None:
    """If we don't have enough data for even one fold, return nothing."""
    dates = list(pd.date_range("2024-01-02", periods=50, freq="B"))
    folds = list(splits(dates, WalkForwardConfig()))
    assert folds == []
