"""LangGraph wiring for the agent ensemble.

Phase 4b: analysts (parallel) -> END
Phase 4c: analysts -> merge -> personas (parallel) -> END
Phase 4d: analysts -> merge -> personas (parallel) -> personas_done -> trader -> risk -> pm -> END

The synthesis stage runs sequentially because each step reads the previous one.
"""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from cfp_agents.analysts import (
    FlowAnalyst,
    FundamentalsAnalyst,
    GexAnalyst,
    NewsAnalyst,
    SentimentAnalyst,
    TechnicalsAnalyst,
)
from cfp_agents.personas import all_personas
from cfp_agents.state import AnalysisState
from cfp_agents.synthesis import (
    BearRebuttal,
    BearResearcher,
    BullRebuttal,
    BullResearcher,
    PortfolioManager,
    RiskManager,
    Trader,
)


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
        FlowAnalyst(),
        GexAnalyst(),
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
        FlowAnalyst(),
        GexAnalyst(),
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
    """Phase 4d full graph: analysts -> personas -> [bull|bear] -> trader -> risk -> pm -> END.

    Bull and bear researchers run in PARALLEL after personas (each reads the same
    inputs and is forced to take a side). Trader then reconciles the two
    adversarial briefs. Risk reads trader; PM reads trader + risk.
    """
    graph = StateGraph(AnalysisState)

    # --- Analysts (parallel) ---
    analysts = [
        TechnicalsAnalyst(),
        FundamentalsAnalyst(),
        SentimentAnalyst(),
        NewsAnalyst(),
        FlowAnalyst(),
        GexAnalyst(),
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

    # --- Debate (parallel rebuttals) ---
    # Top bull persona rebuts top bear's strongest claim, and vice versa.
    # Forces structural cross-examination before the researchers summarize.
    bull_reb = BullRebuttal()
    bear_reb = BearRebuttal()
    graph.add_node(bull_reb.name, bull_reb)
    graph.add_node(bear_reb.name, bear_reb)
    graph.add_edge("_personas_done", bull_reb.name)
    graph.add_edge("_personas_done", bear_reb.name)
    graph.add_edge(bull_reb.name, "_debate_done")
    graph.add_edge(bear_reb.name, "_debate_done")
    graph.add_node("_debate_done", _passthrough)

    # --- Researchers (parallel, adversarial) ---
    bull = BullResearcher()
    bear = BearResearcher()
    graph.add_node(bull.name, bull)
    graph.add_node(bear.name, bear)
    graph.add_edge("_debate_done", bull.name)
    graph.add_edge("_debate_done", bear.name)
    graph.add_edge(bull.name, "_researchers_done")
    graph.add_edge(bear.name, "_researchers_done")
    graph.add_node("_researchers_done", _passthrough)

    # --- Synthesis (sequential) ---
    trader = Trader()
    risk = RiskManager()
    pm = PortfolioManager()
    graph.add_node(trader.name, trader)
    graph.add_node(risk.name, risk)
    graph.add_node(pm.name, pm)

    graph.add_edge("_researchers_done", trader.name)
    graph.add_edge(trader.name, risk.name)
    graph.add_edge(risk.name, pm.name)
    graph.add_edge(pm.name, END)

    return graph.compile()
