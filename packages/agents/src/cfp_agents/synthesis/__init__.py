"""Synthesis stage: collapses 18 agent signals into a tradeable decision.

Pipeline:
  BullResearcher \\__ run in parallel after personas — adversarial briefs
  BearResearcher /
  Trader            — reads bull/bear briefs (+ raw signals as backup)
  RiskManager       — deterministic position sizing + LLM tail-risk commentary
  PortfolioManager  — final approval (long/short/avoid + target weight)

Each node writes a structured AgentSignal back to state and persists to
`agent_signals` keyed by agent name (`bull_researcher`, `bear_researcher`,
`trader`, `risk_manager`, `portfolio_manager`).
"""

from cfp_agents.synthesis.portfolio_manager import PortfolioManager
from cfp_agents.synthesis.researchers import BearResearcher, BullResearcher
from cfp_agents.synthesis.risk_manager import RiskManager
from cfp_agents.synthesis.trader import Trader

__all__ = [
    "BearResearcher",
    "BullResearcher",
    "PortfolioManager",
    "RiskManager",
    "Trader",
]
