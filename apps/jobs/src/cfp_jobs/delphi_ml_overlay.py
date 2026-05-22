"""Delphi Layer 4 — ML overlay (calibrating until enough outcomes accrue).

Idea: once Delphi has evaluated a few hundred predictions, train a small
gradient-boosted model on the features JSONB + macro/regime context, with
`hit_target_range` as the target. The ranker can then blend the ML score
against the rules-based delphi_score when DELPHI_USE_ML_OVERLAY=true.

This module ships in calibrating mode: it counts evaluated rows, logs how
many more are needed, and exits clean. The real training body stays in
this file as a TODO block — when the threshold trips, a single follow-up
PR turns the calibrating-mode return into a real LightGBM fit + write to
delphi_ml_predictions (migration deferred until then).

Why not just defer the whole file: shipping the calibrating-mode loop now
means the cron entry, settings plumbing, and observability are all in
place. When data arrives, only the train function needs to land.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from cfp_jobs.db import connect

log = logging.getLogger(__name__)


def _ienv(name: str, default: int) -> int:
    v = os.environ.get(name)
    if not v:
        return default
    try:
        return int(v)
    except ValueError:
        return default


# Minimum evaluated outcomes before training is attempted. 500 was chosen so
# the train/val split lands on a meaningful sample even after a stratified
# horizon × bias breakdown.
MIN_OUTCOMES_TO_TRAIN = _ienv("DELPHI_ML_MIN_OUTCOMES", 500)


def train(database_url: str) -> dict[str, Any]:
    """Train the Layer-4 overlay, or report calibrating mode.

    Layout for the future training pass (left as a TODO so we land it in a
    standalone PR once the data threshold is hit):

      1. SELECT p.features, p.signal_timeframe, p.forecast_horizon,
                p.regime, o.hit_target_range
         FROM delphi_predictions p JOIN delphi_outcomes o ...
      2. Build a tabular X by flattening p.features (one-hot signal_tf etc.)
      3. Stratified split by (signal_tf, horizon, regime, ticker)
      4. Fit `lightgbm.LGBMClassifier(num_leaves=31, learning_rate=0.05,
                                      n_estimators=200)`
      5. Evaluate AUC + Brier on holdout, persist {model_blob,
         model_version, n_train, n_test, auc, brier} to delphi_ml_models.
      6. For the freshest delphi_predictions snapshot (latest 12h), score
         every row and write delphi_ml_predictions(prediction_id, ml_proba,
         ml_score, model_version).
    """
    with connect(database_url) as conn:
        n_outcomes = conn.execute(
            "SELECT COUNT(*) FROM delphi_outcomes"
        ).fetchone()[0]

    if n_outcomes < MIN_OUTCOMES_TO_TRAIN:
        need = MIN_OUTCOMES_TO_TRAIN - int(n_outcomes)
        log.info(
            "delphi-ml-train: calibrating — have %d outcomes, need %d more before training",
            n_outcomes, need,
        )
        return {
            "status": "calibrating",
            "outcomes_total": int(n_outcomes),
            "threshold": MIN_OUTCOMES_TO_TRAIN,
            "outcomes_needed": need,
        }

    # When threshold is reached this returns the trained-status payload; the
    # actual fit + persist is in the follow-up PR (see docstring TODO).
    log.warning(
        "delphi-ml-train: outcomes_total=%d >= threshold %d — training body "
        "not yet implemented; flip DELPHI_ML_TRAINING_READY=true after wiring",
        n_outcomes, MIN_OUTCOMES_TO_TRAIN,
    )
    return {
        "status": "ready_for_training",
        "outcomes_total": int(n_outcomes),
        "threshold": MIN_OUTCOMES_TO_TRAIN,
    }
