"""Feature engineering library — pure computation, no I/O.

Inputs are pandas DataFrames; outputs are pandas DataFrames. Database loading
and feature persistence live in `cfp_jobs.features`.
"""

from cfp_features import cross_asset, granger, panel, pipeline, regime, sector, signals

__all__ = ["cross_asset", "granger", "panel", "pipeline", "regime", "sector", "signals"]
