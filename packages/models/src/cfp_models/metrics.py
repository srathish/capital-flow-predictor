"""Evaluation metrics (DESIGN.md §7.4).

All metrics operate on a long-format predictions DataFrame:
    columns = [ts, symbol, score, rank, target]
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import roc_auc_score

ANNUALIZATION = 252.0


def _per_date_concordant_auc(group: pd.DataFrame) -> float:
    """Within a date, AUC of: 'is target above median' as label, score as rank."""
    if group["target"].notna().sum() < 4:
        return float("nan")
    median = group["target"].median()
    label = (group["target"] > median).astype(int)
    if label.nunique() < 2:
        return float("nan")
    try:
        return float(roc_auc_score(label, group["score"]))
    except ValueError:
        return float("nan")


def ranking_auc(preds: pd.DataFrame) -> float:
    """Mean per-date ranking AUC across the test set."""
    if preds.empty:
        return float("nan")
    aucs = preds.groupby("ts").apply(_per_date_concordant_auc)
    return float(aucs.dropna().mean())


def information_coefficient(preds: pd.DataFrame) -> float:
    """Mean per-date Spearman correlation of predicted score vs realized target."""
    if preds.empty:
        return float("nan")

    def _ic(g: pd.DataFrame) -> float:
        valid = g.dropna(subset=["score", "target"])
        if len(valid) < 4:
            return float("nan")
        rho, _ = spearmanr(valid["score"], valid["target"])
        return float(rho)

    ics = preds.groupby("ts").apply(_ic)
    return float(ics.dropna().mean())


def long_short_sharpe(preds: pd.DataFrame, k: int = 3) -> float:
    """Top-k long, bottom-k short, daily-rebalanced; annualized Sharpe of the PnL.

    PnL_t = mean(target | rank<=k) - mean(target | rank > N-k)
    """
    if preds.empty:
        return float("nan")

    pnl: list[float] = []
    for _, g in preds.groupby("ts"):
        if g["target"].notna().sum() < 2 * k:
            continue
        sorted_g = g.dropna(subset=["target", "score"]).sort_values("score", ascending=False)
        if len(sorted_g) < 2 * k:
            continue
        long_leg = sorted_g.head(k)["target"].mean()
        short_leg = sorted_g.tail(k)["target"].mean()
        pnl.append(float(long_leg - short_leg))

    if len(pnl) < 5:
        return float("nan")
    arr = np.asarray(pnl, dtype=float)
    if arr.std(ddof=1) == 0:
        return float("nan")
    return float(arr.mean() / arr.std(ddof=1) * np.sqrt(ANNUALIZATION))


def top1_hit_rate(preds: pd.DataFrame) -> float:
    """Fraction of dates where the rank-1 prediction is also rank-1 by realized target."""
    if preds.empty:
        return float("nan")

    hits = 0
    n = 0
    for _, g in preds.groupby("ts"):
        valid = g.dropna(subset=["target", "score"])
        if len(valid) < 2:
            continue
        n += 1
        pred_top = valid.sort_values("score", ascending=False).iloc[0]["symbol"]
        real_top = valid.sort_values("target", ascending=False).iloc[0]["symbol"]
        if pred_top == real_top:
            hits += 1
    return float(hits / n) if n else float("nan")


def summarize(preds: pd.DataFrame) -> dict[str, float]:
    return {
        "auc": ranking_auc(preds),
        "ic": information_coefficient(preds),
        "sharpe": long_short_sharpe(preds),
        "hit_rate": top1_hit_rate(preds),
        "n_test_dates": int(preds["ts"].nunique()) if not preds.empty else 0,
        "n_test_rows": len(preds),
    }
