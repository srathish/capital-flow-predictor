"""Delphi Layer 4 — dual-head LightGBM with overfitting tripwire.

Replaces delphi_ml_overlay.py (which was calibrating-mode stub). This module
actually trains when the threshold is met, with two heads:

  Classification head:  P(hit_target_range = True) for the prediction's horizon
                        Brier + AUC measured; isotonic calibrated.
  Regression head:      expected % return over the horizon, signed by bias
                        MAE + R² measured; no calibration needed.

Splits (walk-forward; deterministic by created_at):
  - holdout = predictions whose prediction_id hashes into delphi_holdout_set
              (15% of all rows, fixed since prediction time)
  - of the remaining 85%: oldest 70/15 split → train / val (time-ordered)
  - holdout is NEVER seen during training or hyperparam tuning

Overfitting tripwire:
  - If |train_brier - holdout_brier| > overfit_threshold (default 0.05) OR
    holdout_brier > val_brier + 0.03,
  - the model is rejected (status='rejected', tripwire_fired=true),
  - and DELPHI_USE_ML_OVERLAY remains "use prior active model" — no rotation.

Regularization defaults (against overfitting on noisy financial features):
  - min_data_in_leaf=50  (no leaf below 50 samples)
  - num_leaves=31        (modest)
  - learning_rate=0.05   (slow learner; ~200 rounds)
  - reg_alpha=0.1, reg_lambda=0.1
  - feature_fraction=0.7, bagging_fraction=0.8, bagging_freq=5
  - early_stopping_rounds=30 on val

Model storage: delphi_ml_models with pickled estimator + isotonic calibrator
as BYTEA. Production rank reads the row with status='active'.

Cron: nightly at 23:45 UTC, after delphi-learn lands. Train no more than
once per day to avoid wasted compute when no new outcomes accrued.
"""

from __future__ import annotations

import logging
import os
import pickle
from datetime import UTC, datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect

log = logging.getLogger(__name__)


def _fenv(name: str, default: float) -> float:
    v = os.environ.get(name)
    if not v:
        return default
    try:
        return float(v)
    except ValueError:
        return default


def _ienv(name: str, default: int) -> int:
    v = os.environ.get(name)
    if not v:
        return default
    try:
        return int(v)
    except ValueError:
        return default


MIN_OUTCOMES_TO_TRAIN = _ienv("DELPHI_ML_MIN_OUTCOMES", 200)
OVERFIT_THRESHOLD     = _fenv("DELPHI_ML_OVERFIT_GAP", 0.05)
VAL_GAP_THRESHOLD     = _fenv("DELPHI_ML_VAL_GAP", 0.03)
BLEND_WEIGHT_ML       = _fenv("DELPHI_ML_BLEND_WEIGHT", 0.6)
# Half-life in DAYS for the exponential time-decay sample weights. Recent
# outcomes weigh more — financial regimes drift, and an outcome from 9 months
# ago is half as informative as one from today. 90 days = quarterly half-life
# matches typical buy-side recalibration cadence.
TIME_DECAY_HALFLIFE_DAYS = _fenv("DELPHI_ML_HALFLIFE_DAYS", 90.0)


# Hyperparameter defaults chosen for noisy financial data. The bias here is
# "underfit slightly rather than overfit a lot" — financial signal-to-noise
# is low and out-of-sample stability matters more than in-sample fit.
DEFAULT_PARAMS_CLF = {
    "objective": "binary",
    "metric": ["binary_logloss", "auc"],
    "num_leaves": 31,
    "learning_rate": 0.05,
    "min_data_in_leaf": 50,
    "reg_alpha": 0.1,
    "reg_lambda": 0.1,
    "feature_fraction": 0.7,
    "bagging_fraction": 0.8,
    "bagging_freq": 5,
    "verbose": -1,
    "seed": 42,
}

DEFAULT_PARAMS_REG = {
    "objective": "regression_l1",   # MAE — more robust to fat tails than L2
    "metric": ["mae", "rmse"],
    "num_leaves": 31,
    "learning_rate": 0.05,
    "min_data_in_leaf": 50,
    "reg_alpha": 0.1,
    "reg_lambda": 0.1,
    "feature_fraction": 0.7,
    "bagging_fraction": 0.8,
    "bagging_freq": 5,
    "verbose": -1,
    "seed": 42,
}


def _load_training_set(conn: psycopg.Connection) -> dict[str, Any]:
    """Pull (features, hit, realized_return) for all completed, NON-holdout v0.2 predictions."""
    rows = conn.execute(
        """
        SELECT p.prediction_id, p.created_at, p.signal_timeframe, p.forecast_horizon,
               p.regime, p.bias, p.expected_return, p.downside_risk, p.probability,
               p.features,
               o.hit_target_range,
               CASE
                   WHEN p.bias = 'bullish' THEN (o.actual_close - p.current_price) / p.current_price
                   WHEN p.bias = 'bearish' THEN (p.current_price - o.actual_close) / p.current_price
                   ELSE 0
               END AS realized_return
        FROM delphi_predictions p
        JOIN delphi_outcomes o USING (prediction_id)
        LEFT JOIN delphi_holdout_set h USING (prediction_id)
        WHERE p.model_version = 'v0.2-features'
          AND h.prediction_id IS NULL
        ORDER BY p.created_at ASC
        """
    ).fetchall()
    return _shape_rows(rows)


def _load_holdout(conn: psycopg.Connection) -> dict[str, Any]:
    """Pull the same shape but ONLY holdout rows. Used solely for final eval."""
    rows = conn.execute(
        """
        SELECT p.prediction_id, p.created_at, p.signal_timeframe, p.forecast_horizon,
               p.regime, p.bias, p.expected_return, p.downside_risk, p.probability,
               p.features,
               o.hit_target_range,
               CASE
                   WHEN p.bias = 'bullish' THEN (o.actual_close - p.current_price) / p.current_price
                   WHEN p.bias = 'bearish' THEN (p.current_price - o.actual_close) / p.current_price
                   ELSE 0
               END AS realized_return
        FROM delphi_predictions p
        JOIN delphi_outcomes o USING (prediction_id)
        JOIN delphi_holdout_set h USING (prediction_id)
        WHERE p.model_version = 'v0.2-features'
        ORDER BY p.created_at ASC
        """
    ).fetchall()
    return _shape_rows(rows)


def _shape_rows(rows: list[tuple]) -> dict[str, Any]:
    """Turn DB rows into (X feature matrix, y_clf, y_reg, feature_names)."""
    import numpy as np
    if not rows:
        return {"n": 0, "X": np.array([]), "y_clf": np.array([]), "y_reg": np.array([]),
                "feature_names": [], "created_at": []}
    # Build feature matrix from the snapshot stored in p.features
    feature_names_set: set[str] = set()
    feature_rows = []
    y_clf = []
    y_reg = []
    created = []
    for r in rows:
        feat_blob = r[9] or {}
        snap = (feat_blob.get("features_snapshot") or {}).copy()
        snap.update(feat_blob.get("promoted_snapshot") or {})
        # also stash horizon as a categorical feature
        snap["__horizon"] = r[3]
        snap["__signal_tf"] = r[2]
        snap["__regime"] = r[4] or "any"
        snap["__bias_bullish"] = 1 if r[5] == "bullish" else 0
        snap["__rules_prob"] = float(r[8])
        feature_rows.append(snap)
        feature_names_set.update(snap.keys())
        y_clf.append(1 if r[10] else 0)
        y_reg.append(float(r[11]) if r[11] is not None else 0.0)
        created.append(r[1])

    feature_names = sorted(feature_names_set)
    X = np.full((len(feature_rows), len(feature_names)), np.nan)
    cat_lookup: dict[str, dict[str, int]] = {}
    for i, fr in enumerate(feature_rows):
        for j, name in enumerate(feature_names):
            v = fr.get(name)
            if isinstance(v, bool):
                X[i, j] = 1.0 if v else 0.0
            elif isinstance(v, (int, float)):
                X[i, j] = float(v)
            elif isinstance(v, str):
                # categorical encode (stable per training run)
                lookup = cat_lookup.setdefault(name, {})
                if v not in lookup:
                    lookup[v] = len(lookup)
                X[i, j] = float(lookup[v])
            # None → leave as NaN; LightGBM handles NaN natively
    return {
        "n": len(feature_rows),
        "X": X,
        "y_clf": np.array(y_clf),
        "y_reg": np.array(y_reg),
        "feature_names": feature_names,
        "created_at": created,
        "cat_lookup": cat_lookup,
    }


def _time_decay_weights(created_at: list, halflife_days: float) -> Any:
    """Exponential decay sample weights with `halflife_days` half-life.

    weight[i] = 0.5 ** (days_old / halflife)

    A sample 90 days old (default halflife) gets weight 0.5; 180 days old
    gets 0.25; same-day gets 1.0. Total mass NORMALIZED so LightGBM sees
    sum(weights) == len(weights), keeping its internal regularization
    behavior the same as uniform-weighted.
    """
    import numpy as np
    if not created_at:
        return np.array([])
    now = max(created_at)
    days_old = np.array([
        max(0.0, (now - ts).total_seconds() / 86400.0) for ts in created_at
    ])
    w = 0.5 ** (days_old / max(1e-6, halflife_days))
    # Normalize so sum equals n (keeps LGBM regularization comparable)
    w = w * (len(w) / w.sum())
    return w


def _walk_forward_split(data: dict[str, Any], train_frac: float = 0.82) -> tuple:
    """Time-ordered split: oldest `train_frac` → train, rest → val. No shuffling.

    Holdout is already excluded upstream.
    """
    import numpy as np
    n = data["n"]
    if n < 50:
        return (data, None)
    cut = int(n * train_frac)
    return (
        {
            "X": data["X"][:cut], "y_clf": data["y_clf"][:cut],
            "y_reg": data["y_reg"][:cut], "n": cut,
        },
        {
            "X": data["X"][cut:], "y_clf": data["y_clf"][cut:],
            "y_reg": data["y_reg"][cut:], "n": n - cut,
        },
    )


def _brier(y_true: Any, y_proba: Any) -> float:
    import numpy as np
    return float(np.mean((y_proba - y_true) ** 2))


def _auc(y_true: Any, y_proba: Any) -> float | None:
    try:
        from sklearn.metrics import roc_auc_score
        return float(roc_auc_score(y_true, y_proba))
    except Exception:  # noqa: BLE001
        return None


def _train_lightgbm(
    train: dict[str, Any], val: dict[str, Any] | None, params: dict[str, Any],
    weights: Any = None,
) -> Any:
    import lightgbm as lgb
    train_set = lgb.Dataset(train["X"], train["y_clf"], weight=weights)
    callbacks = [lgb.log_evaluation(period=0)]
    if val is not None:
        val_set = lgb.Dataset(val["X"], val["y_clf"], reference=train_set)
        callbacks.append(lgb.early_stopping(stopping_rounds=30, verbose=False))
        return lgb.train(
            params, train_set, num_boost_round=300,
            valid_sets=[train_set, val_set], valid_names=["train", "val"],
            callbacks=callbacks,
        )
    return lgb.train(params, train_set, num_boost_round=200, callbacks=callbacks)


def _train_lightgbm_reg(
    train: dict[str, Any], val: dict[str, Any] | None, params: dict[str, Any],
    weights: Any = None,
) -> Any:
    import lightgbm as lgb
    train_set = lgb.Dataset(train["X"], train["y_reg"], weight=weights)
    callbacks = [lgb.log_evaluation(period=0)]
    if val is not None:
        val_set = lgb.Dataset(val["X"], val["y_reg"], reference=train_set)
        callbacks.append(lgb.early_stopping(stopping_rounds=30, verbose=False))
        return lgb.train(
            params, train_set, num_boost_round=300,
            valid_sets=[train_set, val_set], valid_names=["train", "val"],
            callbacks=callbacks,
        )
    return lgb.train(params, train_set, num_boost_round=200, callbacks=callbacks)


def _train_lightgbm_quantile(
    train: dict[str, Any], val: dict[str, Any] | None,
    base_params: dict[str, Any], alpha: float,
    weights: Any = None,
) -> Any:
    """Quantile regression head. alpha=0.1 gives p10, alpha=0.5 = median,
    alpha=0.9 = p90. Used to output the return-distribution fan chart that
    the UI renders per prediction.

    Quantile loss is asymmetric MAE — penalizes (alpha)% on overprediction
    and (1-alpha)% on underprediction. Robust to fat tails (no squared
    residuals), which is what financial returns require.
    """
    import lightgbm as lgb
    params = dict(base_params)
    params["objective"] = "quantile"
    params["alpha"] = alpha
    params["metric"] = ["quantile"]
    train_set = lgb.Dataset(train["X"], train["y_reg"], weight=weights)
    callbacks = [lgb.log_evaluation(period=0)]
    if val is not None:
        val_set = lgb.Dataset(val["X"], val["y_reg"], reference=train_set)
        callbacks.append(lgb.early_stopping(stopping_rounds=30, verbose=False))
        return lgb.train(
            params, train_set, num_boost_round=300,
            valid_sets=[train_set, val_set], valid_names=["train", "val"],
            callbacks=callbacks,
        )
    return lgb.train(params, train_set, num_boost_round=200, callbacks=callbacks)


def _isotonic_calibrate(y_true: Any, y_proba: Any) -> Any:
    """Fit isotonic regression on (proba, true). Returns a callable."""
    from sklearn.isotonic import IsotonicRegression
    iso = IsotonicRegression(out_of_bounds="clip")
    iso.fit(y_proba, y_true)
    return iso


def _featimp(model: Any, names: list[str]) -> dict[str, float]:
    try:
        importances = model.feature_importance(importance_type="gain")
        return {n: float(v) for n, v in zip(names, importances, strict=False)}
    except Exception:  # noqa: BLE001
        return {}


def train(database_url: str) -> dict[str, Any]:
    """Train + evaluate + persist a Layer-4 model. Skips when below threshold or
    when tripwire fires. Idempotent at the row level (one row per model_version).
    """
    # Lazy import so the calibrating-mode path doesn't need lightgbm installed.
    try:
        import lightgbm  # noqa: F401
        import sklearn   # noqa: F401
        import numpy as np
    except ImportError as e:
        log.warning("delphi-ml-train: missing dep %s — install lightgbm + scikit-learn", e)
        return {"status": "missing_deps", "error": str(e)}

    with connect(database_url) as conn:
        data = _load_training_set(conn)
        holdout = _load_holdout(conn)
    total = data["n"] + holdout["n"]
    if total < MIN_OUTCOMES_TO_TRAIN:
        log.info("delphi-ml-train: calibrating — %d / %d outcomes", total, MIN_OUTCOMES_TO_TRAIN)
        return {"status": "calibrating", "outcomes_total": total, "threshold": MIN_OUTCOMES_TO_TRAIN}

    train_d, val_d = _walk_forward_split(data, train_frac=0.82)
    if val_d is None or val_d["n"] < 20 or holdout["n"] < 20:
        return {"status": "insufficient_split", "train_n": train_d["n"],
                "val_n": val_d["n"] if val_d else 0, "holdout_n": holdout["n"]}

    # Time-decay sample weights. Train slice's created_at order matters; the
    # split is time-ordered so train_d holds the OLDEST 82% chronologically.
    train_created = data["created_at"][:train_d["n"]]
    train_weights = _time_decay_weights(train_created, TIME_DECAY_HALFLIFE_DAYS)

    # ---- Classification head ----
    clf = _train_lightgbm(train_d, val_d, DEFAULT_PARAMS_CLF, weights=train_weights)
    train_proba = clf.predict(train_d["X"])
    val_proba   = clf.predict(val_d["X"])
    holdout_proba_raw = clf.predict(holdout["X"])

    # Isotonic calibrator fit on VAL (not train, not holdout) to avoid optimistic
    # in-sample calibration. Tested on holdout.
    iso = _isotonic_calibrate(val_d["y_clf"], val_proba)
    holdout_proba = iso.predict(holdout_proba_raw)
    val_proba_cal = iso.predict(val_proba)

    train_brier   = _brier(train_d["y_clf"], train_proba)
    val_brier     = _brier(val_d["y_clf"], val_proba_cal)
    holdout_brier = _brier(holdout["y_clf"], holdout_proba)
    train_auc   = _auc(train_d["y_clf"], train_proba)
    val_auc     = _auc(val_d["y_clf"], val_proba_cal)
    holdout_auc = _auc(holdout["y_clf"], holdout_proba)
    holdout_hit_rate = float(np.mean(holdout["y_clf"]))
    calib_err = float(np.mean(np.abs(holdout_proba - holdout["y_clf"])))

    overfit_gap = abs(train_brier - holdout_brier)
    val_gap     = holdout_brier - val_brier
    tripwire    = (overfit_gap > OVERFIT_THRESHOLD) or (val_gap > VAL_GAP_THRESHOLD)

    # ---- Regression head (mean prediction of % return) ----
    reg = _train_lightgbm_reg(train_d, val_d, DEFAULT_PARAMS_REG, weights=train_weights)
    holdout_pred_reg = reg.predict(holdout["X"])
    reg_mae = float(np.mean(np.abs(holdout_pred_reg - holdout["y_reg"])))

    # ---- Quantile heads (p10, p50, p90) — for the UI fan chart ----
    # p50 (median) is more robust to fat tails than the mean reg head and
    # often used as the production point estimate; we keep both. p10/p90
    # give the 80% prediction interval which the trader uses to size.
    reg_p10 = _train_lightgbm_quantile(train_d, val_d, DEFAULT_PARAMS_REG, alpha=0.10, weights=train_weights)
    reg_p50 = _train_lightgbm_quantile(train_d, val_d, DEFAULT_PARAMS_REG, alpha=0.50, weights=train_weights)
    reg_p90 = _train_lightgbm_quantile(train_d, val_d, DEFAULT_PARAMS_REG, alpha=0.90, weights=train_weights)
    # Calibration sanity: holdout coverage of the 80% interval should be ~80%
    p10_hold = reg_p10.predict(holdout["X"])
    p90_hold = reg_p90.predict(holdout["X"])
    coverage_80 = float(np.mean((holdout["y_reg"] >= p10_hold) & (holdout["y_reg"] <= p90_hold)))

    model_version = f"v0.3-lgbm-{datetime.now(UTC).strftime('%Y%m%d')}"
    feat_imp = _featimp(clf, data["feature_names"])

    # Pack model blobs. Includes mean + quantile regression heads + feature
    # names + cat lookup so production scoring can reproduce the feature
    # vector exactly.
    bundle = {
        "clf": clf,
        "reg": reg,
        "reg_p10": reg_p10,
        "reg_p50": reg_p50,
        "reg_p90": reg_p90,
        "isotonic": iso,
        "feature_names": data["feature_names"],
        "cat_lookup": data["cat_lookup"],
        "time_decay_halflife_days": TIME_DECAY_HALFLIFE_DAYS,
    }
    blob = pickle.dumps(bundle)
    iso_blob = pickle.dumps(iso)

    status = "rejected" if tripwire else "active"
    with connect(database_url) as conn:
        # Demote previous active model
        if status == "active":
            conn.execute(
                "UPDATE delphi_ml_models SET status = 'archived' WHERE status = 'active'"
            )
        conn.execute(
            """
            INSERT INTO delphi_ml_models (
                model_version, status,
                n_train, n_val, n_holdout,
                train_brier, val_brier, holdout_brier,
                train_auc, val_auc, holdout_auc,
                holdout_hit_rate, calibration_error,
                overfit_gap, overfit_threshold, tripwire_fired,
                hyperparams, feature_importance,
                model_blob, calibrator_blob,
                used_synthetic, n_synthetic
            ) VALUES (
                %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s,
                %s, %s, %s,
                %s, %s,
                %s, %s,
                %s, %s
            ) ON CONFLICT (model_version) DO UPDATE SET
                status = EXCLUDED.status,
                holdout_brier = EXCLUDED.holdout_brier,
                tripwire_fired = EXCLUDED.tripwire_fired,
                hyperparams = EXCLUDED.hyperparams,
                feature_importance = EXCLUDED.feature_importance,
                model_blob = EXCLUDED.model_blob,
                calibrator_blob = EXCLUDED.calibrator_blob
            """,
            (
                model_version, status,
                int(train_d["n"]), int(val_d["n"]), int(holdout["n"]),
                train_brier, val_brier, holdout_brier,
                train_auc, val_auc, holdout_auc,
                holdout_hit_rate, calib_err,
                overfit_gap, OVERFIT_THRESHOLD, tripwire,
                Jsonb({
                    **DEFAULT_PARAMS_CLF,
                    "blend_weight_ml": BLEND_WEIGHT_ML,
                    "reg_mae_holdout": reg_mae,
                    "reg_p10_p90_coverage_holdout": coverage_80,
                    "time_decay_halflife_days": TIME_DECAY_HALFLIFE_DAYS,
                }),
                Jsonb(feat_imp),
                psycopg.Binary(blob), psycopg.Binary(iso_blob),
                False, 0,
            ),
        )
        # Register version
        conn.execute(
            """
            INSERT INTO delphi_model_versions (model_version, family, description)
            VALUES (%s, 'ml', %s)
            ON CONFLICT (model_version) DO NOTHING
            """,
            (model_version,
             f"LGBM clf+reg dual head, train_n={train_d['n']}, holdout_brier={holdout_brier:.4f}"),
        )
        conn.commit()

    return {
        "status": status,
        "model_version": model_version,
        "n_train": train_d["n"], "n_val": val_d["n"], "n_holdout": holdout["n"],
        "train_brier": round(train_brier, 4),
        "val_brier": round(val_brier, 4),
        "holdout_brier": round(holdout_brier, 4),
        "train_auc": round(train_auc, 4) if train_auc else None,
        "val_auc": round(val_auc, 4) if val_auc else None,
        "holdout_auc": round(holdout_auc, 4) if holdout_auc else None,
        "overfit_gap": round(overfit_gap, 4),
        "val_gap": round(val_gap, 4),
        "tripwire_fired": tripwire,
        "regression_holdout_mae": round(reg_mae, 4),
        "quantile_80_coverage_holdout": round(coverage_80, 4),
        "time_decay_halflife_days": TIME_DECAY_HALFLIFE_DAYS,
        "top_features": dict(sorted(feat_imp.items(), key=lambda kv: -kv[1])[:15]),
    }
