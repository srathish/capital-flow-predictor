"""LangGraph wiring for the agent ensemble.

Phase 4b: analysts (parallel) -> END
Phase 4c: analysts -> merge -> personas (parallel) -> END
Phase 4d: analysts -> merge -> personas (parallel) -> personas_done -> trader -> risk -> pm -> END

The synthesis stage runs sequentially because each step reads the previous one.
"""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from cfp_agents.analysts import (
    FundamentalsAnalyst,
    NewsAnalyst,
    SentimentAnalyst,
    TechnicalsAnalyst,
)
from cfp_agents.personas import all_personas
from cfp_agents.state import AnalysisState
from cfp_agents.synthesis import PortfolioManager, RiskManager, Trader


def _passthrough(_state: AnalysisState) -> dict:
    """No-op join node — collects all upstream signals before fanning out."""
    return {}


def build_analyst_graph() -> object:
    """Phase 4b: just analysts (parallel) -> END."""
    graph = StateGraph(AnalysisState)
    analysts = [
        TechnicalsAnalyst(),
        FundamentalsAnalyst(),
        SentimentAnalyst(),
        NewsAnalyst(),
    ]
    for a in analysts:
        graph.add_node(a.name, a)
        graph.add_edge(START, a.name)
        graph.add_edge(a.name, END)
    return graph.compile()


def build_persona_graph() -> object:
    """Phase 4c: analysts -> merge -> personas (parallel) -> END."""
    graph = StateGraph(AnalysisState)

    analysts = [
        TechnicalsAnalyst(),
        FundamentalsAnalyst(),
        SentimentAnalyst(),
        NewsAnalyst(),
    ]
    for a in analysts:
        graph.add_node(a.name, a)
        graph.add_edge(START, a.name)
        graph.add_edge(a.name, "_analysts_done")

    graph.add_node("_analysts_done", _passthrough)

    personas = all_personas()
    for p in personas:
        graph.add_node(p.name, p)
        graph.add_edge("_analysts_done", p.name)
        graph.add_edge(p.name, END)

    return graph.compile()


def build_full_graph() -> object:
    """Phase 4d full graph: analysts -> personas -> trader -> risk -> pm -> END.

    Synthesis stage is sequential: trader reads all signals; risk reads trader;
    PM reads trader + risk.
    """
    graph = StateGraph(AnalysisState)

    # --- Analysts (parallel) ---
    analysts = [
        TechnicalsAnalyst(),
        FundamentalsAnalyst(),
        SentimentAnalyst(),
        NewsAnalyst(),
    ]
    for a in analysts:
        graph.add_node(a.name, a)
        graph.add_edge(START, a.name)
        graph.add_edge(a.name, "_analysts_done")

    graph.add_node("_analysts_done", _passthrough)

    # --- Personas (parallel) ---
    personas = all_personas()
    for p in personas:
        graph.add_node(p.name, p)
        graph.add_edge("_analysts_done", p.name)
        graph.add_edge(p.name, "_personas_done")

    graph.add_node("_personas_done", _passthrough)

    # --- Synthesis (sequential) ---
    trader = Trader()
    risk = RiskManager()
    pm = PortfolioManager()
    graph.add_node(trader.name, trader)
    graph.add_node(risk.name, risk)
    graph.add_node(pm.name, pm)

    graph.add_edge("_personas_done", trader.name)
    graph.add_edge(trader.name, risk.name)
    graph.add_edge(risk.name, pm.name)
    graph.add_edge(pm.name, END)

    return graph.compile()
