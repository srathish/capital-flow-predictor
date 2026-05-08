"""XGBoost ranker baseline (DESIGN.md §7.1).

Pairwise rank objective. Group = date — within each date, the model learns to
order symbols by predicted relative-strength score.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import xgboost as xgb


@dataclass
class XgbRankParams:
    n_estimators: int = 300
    max_depth: int = 4
    learning_rate: float = 0.05
    subsample: float = 0.8
    colsample_bytree: float = 0.8
    min_child_weight: float = 5.0
    reg_lambda: float = 1.0
    early_stopping_rounds: int = 30
    objective: str = "rank:pairwise"
    eval_metric: str = "ndcg@5"
    tree_method: str = "hist"
    seed: int = 42


def _materials(panel: pd.DataFrame, feature_cols: list[str]) -> tuple[np.ndarray, np.ndarray, list[int]]:
    """Prepare X, y, group. y is dense integer relevance per date (0=worst).

    NDCG evaluation requires integer relevance; pairwise objective is ordering-only,
    so the dense rank preserves the training signal that matters.
    """
    panel = panel.sort_values(["ts", "symbol"]).copy()
    panel["_relevance"] = (
        panel.groupby("ts", sort=False)["target"]
        .rank(method="dense", ascending=True)
        .astype(int)
        - 1
    )
    X = panel[feature_cols].to_numpy(dtype=np.float32)  # noqa: N806
    y = panel["_relevance"].to_numpy(dtype=np.int32)
    group = panel.groupby("ts", sort=True).size().to_list()
    return X, y, group


def train(
    train_panel: pd.DataFrame,
    val_panel: pd.DataFrame,
    feature_cols: list[str],
    params: XgbRankParams | None = None,
) -> xgb.XGBRanker:
    """Fit an XGBRanker on train + early-stop on val."""
    p = params or XgbRankParams()
    X_train, y_train, g_train = _materials(train_panel, feature_cols)  # noqa: N806
    X_val, y_val, g_val = _materials(val_panel, feature_cols)  # noqa: N806

    model = xgb.XGBRanker(
        objective=p.objective,
        eval_metric=p.eval_metric,
        n_estimators=p.n_estimators,
        max_depth=p.max_depth,
        learning_rate=p.learning_rate,
        subsample=p.subsample,
        colsample_bytree=p.colsample_bytree,
        min_child_weight=p.min_child_weight,
        reg_lambda=p.reg_lambda,
        tree_method=p.tree_method,
        random_state=p.seed,
        early_stopping_rounds=p.early_stopping_rounds,
        verbosity=0,
    )
    model.fit(
        X_train,
        y_train,
        group=g_train,
        eval_set=[(X_val, y_val)],
        eval_group=[g_val],
        verbose=False,
    )
    return model


def predict(
    model: xgb.XGBRanker,
    panel: pd.DataFrame,
    feature_cols: list[str],
) -> pd.DataFrame:
    """Return DataFrame: ts, symbol, score, rank.

    Rank is 1-based within each ts (1 = highest predicted score).
    """
    panel = panel.sort_values(["ts", "symbol"]).reset_index(drop=True).copy()
    X = panel[feature_cols].to_numpy(dtype=np.float32)  # noqa: N806
    panel["score"] = model.predict(X)
    panel["rank"] = (
        panel.groupby("ts")["score"].rank(method="first", ascending=False).astype(int)
    )
    return panel[["ts", "symbol", "score", "rank"]]
