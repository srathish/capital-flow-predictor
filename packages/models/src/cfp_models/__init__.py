"""Model training, inference, and evaluation.

Pure computation: pandas/numpy/xgboost in, pandas out. Database I/O lives in
`cfp_jobs.train`.
"""

from cfp_models import (
    metrics,
    monte_carlo,
    panel,
    position_sizing,
    targets,
    walk_forward,
    xgb_baseline,
)

__all__ = [
    "metrics", "monte_carlo", "panel", "position_sizing",
    "targets", "walk_forward", "xgb_baseline",
]
