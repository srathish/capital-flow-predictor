"""Multi-agent ensemble for stock-level analysis.

Architecture (DESIGN.md addendum):
  Analysts (parallel) -> Researchers debate (bull vs bear personas) -> Trader
                                  -> Risk Manager -> Portfolio Manager

Phase 4b implements just the Analyst layer (this file's __all__ reflects that).
"""

from cfp_agents.state import AgentSignal, AnalysisState

__all__ = ["AgentSignal", "AnalysisState"]
