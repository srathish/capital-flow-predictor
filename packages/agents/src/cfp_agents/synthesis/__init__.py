"""Synthesis stage: collapses 17 agent signals into a tradeable decision.

Pipeline (sequential):
  Trader            — reads all analysts + personas, frames a position thesis
  RiskManager       — deterministic position sizing + LLM tail-risk commentary
  PortfolioManager  — final approval (long/short/avoid + target weight)

Each node writes a structured AgentSignal back to state and persists to
`agent_signals` keyed by agent name (`trader`, `risk_manager`, `portfolio_manager`).
"""

from cfp_agents.synthesis.portfolio_manager import PortfolioManager
from cfp_agents.synthesis.risk_manager import RiskManager
from cfp_agents.synthesis.trader import Trader

__all__ = ["PortfolioManager", "RiskManager", "Trader"]
