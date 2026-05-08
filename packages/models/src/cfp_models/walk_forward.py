"""Walk-forward CV (DESIGN.md §7.4).

train_window: 18 months, val_window: 1 month, test_window: 1 month, step: 1 month.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import dataclass

import pandas as pd

from cfp_models import metrics, xgb_baseline

log = logging.getLogger(__name__)

BUSINESS_DAYS_PER_MONTH = 21


@dataclass
class WalkForwardConfig:
    train_months: int = 18
    val_months: int = 1
    test_months: int = 1
    step_months: int = 1


def splits(
    dates: list[pd.Timestamp], cfg: WalkForwardConfig | None = None
) -> Iterator[tuple[list[pd.Timestamp], list[pd.Timestamp], list[pd.Timestamp]]]:
    """Yield (train_dates, val_dates, test_dates) for each fold.

    Dates must be sorted ascending. Window sizes are in business days.
    """
    cfg = cfg or WalkForwardConfig()
    train_n = cfg.train_months * BUSINESS_DAYS_PER_MONTH
    val_n = cfg.val_months * BUSINESS_DAYS_PER_MONTH
    test_n = cfg.test_months * BUSINESS_DAYS_PER_MONTH
    step_n = cfg.step_months * BUSINESS_DAYS_PER_MONTH

    n = len(dates)
    start = 0
    while start + train_n + val_n + test_n <= n:
        train = dates[start : start + train_n]
        val = dates[start + train_n : start + train_n + val_n]
        test = dates[start + train_n + val_n : start + train_n + val_n + test_n]
        yield train, val, test
        start += step_n


def run(
    panel: pd.DataFrame,
    feature_cols: list[str],
    cfg: WalkForwardConfig | None = None,
    xgb_params: xgb_baseline.XgbRankParams | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Walk-forward train + test. Returns (predictions_df, fold_metrics_df).

    predictions_df: ts, symbol, score, rank, target, fold
    fold_metrics_df: fold, n_train_dates, n_test_dates, auc, ic, sharpe, hit_rate
    """
    cfg = cfg or WalkForwardConfig()
    panel = panel.sort_values(["ts", "symbol"]).reset_index(drop=True)
    dates = panel["ts"].drop_duplicates().sort_values().tolist()

    fold_rows: list[dict] = []
    pred_pieces: list[pd.DataFrame] = []

    for fold_idx, (train_d, val_d, test_d) in enumerate(splits(dates, cfg)):
        train_panel = panel[panel["ts"].isin(train_d)]
        val_panel = panel[panel["ts"].isin(val_d)]
        test_panel = panel[panel["ts"].isin(test_d)]

        if train_panel.empty or val_panel.empty or test_panel.empty:
            continue

        model = xgb_baseline.train(train_panel, val_panel, feature_cols, xgb_params)
        preds = xgb_baseline.predict(model, test_panel, feature_cols)
        preds = preds.merge(
            test_panel[["ts", "symbol", "target"]], on=["ts", "symbol"], how="left"
        )
        preds["fold"] = fold_idx
        pred_pieces.append(preds)

        fold_rows.append(
            {
                "fold": fold_idx,
                "n_train_dates": len(train_d),
                "n_test_dates": len(test_d),
                "auc": metrics.ranking_auc(preds),
                "ic": metrics.information_coefficient(preds),
                "sharpe": metrics.long_short_sharpe(preds),
                "hit_rate": metrics.top1_hit_rate(preds),
            }
        )
        log.info(
            "fold %d: train=%d test=%d auc=%.3f ic=%.3f sharpe=%.2f hit=%.2f",
            fold_idx,
            len(train_d),
            len(test_d),
            fold_rows[-1]["auc"],
            fold_rows[-1]["ic"],
            fold_rows[-1]["sharpe"],
            fold_rows[-1]["hit_rate"],
        )

    if not pred_pieces:
        return pd.DataFrame(), pd.DataFrame()

    return pd.concat(pred_pieces, ignore_index=True), pd.DataFrame(fold_rows)
