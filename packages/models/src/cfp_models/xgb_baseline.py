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
    """Defaults tuned 2026-05-10 after Alpha158 panel jump (12 -> 83 features).

    Changes from prior defaults:
      - objective: rank:pairwise -> rank:ndcg
        Pairwise only optimizes ordering; ndcg also rewards getting the
        TOP positions right, which matches our use case (top-K sector
        rotation). With rank:pairwise the model collapsed scores into ~3
        coarse buckets — ndcg pushes for finer top-of-list discrimination.
      - min_child_weight: 5.0 -> 2.0
        With 26 ETFs per group, requiring 5-weight leaves forces the model
        into shallow trees. Loosening to 2.0 lets it actually use the new
        Alpha158 splits.
      - max_depth: 4 -> 5
        One extra level of conditional structure — pairs well with the
        wider feature set without blowing up overfit risk on a 26-symbol
        universe.
      - early_stopping_rounds: 30 -> 50
        ndcg eval is noisier on small groups; give the trainer more patience
        before declaring a stop.
    """
    n_estimators: int = 300
    max_depth: int = 5
    learning_rate: float = 0.05
    subsample: float = 0.8
    colsample_bytree: float = 0.8
    min_child_weight: float = 2.0
    reg_lambda: float = 1.0
    early_stopping_rounds: int = 50
    objective: str = "rank:ndcg"
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

    `rank:pairwise` produces ordered output but often collapses scores into
    a few large tied buckets (e.g. with 26 ETFs we see ~3 distinct scores —
    the middle 20 all tied at the same value). When that happens, downstream
    consumers (network graph, watchlist) get an arbitrary alphabetical order
    inside the bucket. We break ties using a tiny weighted blend of two
    secondary signals already in the panel — return_20d (medium-term
    momentum) and dist_ma50 (trend position) — scaled small enough that they
    only nudge ties apart and never override a real model-driven gap.
    """
    panel = panel.sort_values(["ts", "symbol"]).reset_index(drop=True).copy()
    X = panel[feature_cols].to_numpy(dtype=np.float32)  # noqa: N806
    panel["score"] = model.predict(X)

    # Tie-breaker — only kicks in when XGB scores are equal. Magnitude is
    # capped at 1e-6 so it cannot reorder symbols the model actually
    # discriminated; it only shapes order INSIDE tied buckets.
    tie_break = pd.Series(0.0, index=panel.index)
    for col, weight in (("return_20d", 1e-6), ("dist_ma50", 5e-7)):
        if col in panel.columns:
            v = panel[col].fillna(0.0).clip(-1.0, 1.0)
            tie_break = tie_break + weight * v
    panel["score"] = panel["score"] + tie_break

    panel["rank"] = (
        panel.groupby("ts")["score"].rank(method="first", ascending=False).astype(int)
    )
    return panel[["ts", "symbol", "score", "rank"]]
