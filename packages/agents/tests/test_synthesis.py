"""Tests for the Phase 4d synthesis stage.

Covers:
  - Aggregate vote math
  - Deterministic risk-manager sizing rules
  - Trader / Risk / PM all map LLM outputs to AgentSignal correctly
  - Full graph runs analysts -> personas -> trader -> risk -> pm with mocked LLMs
  - Risk-manager veto path forces PM to avoid
"""

from __future__ import annotations

from unittest.mock import patch

import numpy as np
import pandas as pd
from cfp_agents.graph import build_full_graph
from cfp_agents.llm import LlmClient
from cfp_agents.personas import all_personas
from cfp_agents.state import AgentSignal
from cfp_agents.synthesis import PortfolioManager, RiskManager, Trader
from cfp_agents.synthesis.base import aggregate_vote, signals_table
from cfp_agents.synthesis.portfolio_manager import PortfolioDecision
from cfp_agents.synthesis.risk_manager import (
    HIGH_VOL_THRESHOLD,
    MAX_PER_POSITION,
    RiskAssessment,
    deterministic_target_weight,
)
from cfp_agents.synthesis.trader import TraderDecision


def _signal(agent: str, signal: str, confidence: float, rationale: str = "") -> AgentSignal:
    return AgentSignal(agent=agent, signal=signal, confidence=confidence, rationale=rationale or agent)


# ---------- Aggregate vote ----------


def test_aggregate_vote_empty() -> None:
    out = aggregate_vote({})
    assert out["n_agents"] == 0
    assert out["weighted_score"] == 0.0


def test_aggregate_vote_all_bull() -> None:
    state = {
        "analyst_signals": [_signal("technicals", "bullish", 0.8)],
        "persona_signals": [
            _signal("buffett", "bullish", 0.9),
            _signal("burry", "bullish", 0.6),
        ],
    }
    out = aggregate_vote(state)
    assert out["bull_count"] == 3
    assert out["bear_count"] == 0
    # weighted = (0.8 + 0.9 + 0.6) / 3 ≈ 0.767
    assert abs(out["weighted_score"] - (0.8 + 0.9 + 0.6) / 3) < 1e-9


def test_aggregate_vote_mixed() -> None:
    state = {
        "analyst_signals": [_signal("a", "bullish", 0.6), _signal("b", "bearish", 0.7)],
        "persona_signals": [_signal("c", "neutral", 0.0)],
    }
    out = aggregate_vote(state)
    assert out["bull_count"] == 1 and out["bear_count"] == 1 and out["neutral_count"] == 1
    # weighted = (0.6 - 0.7 + 0) / 3
    assert abs(out["weighted_score"] - (-0.1 / 3)) < 1e-9


def test_signals_table_contains_each_agent() -> None:
    state = {
        "analyst_signals": [_signal("technicals", "bullish", 0.8, "trend up")],
        "persona_signals": [_signal("buffett", "bullish", 0.9, "wonderful biz")],
    }
    out = signals_table(state)
    assert "technicals" in out
    assert "buffett" in out
    assert "trend up" in out


# ---------- Deterministic risk sizing ----------


def _state_with_trader(direction: str, confidence: float, prices=None) -> dict:
    trader_signal = AgentSignal(
        agent="trader",
        signal="bullish" if direction == "long" else ("bearish" if direction == "short" else "neutral"),
        confidence=confidence,
        rationale=f"trader says {direction}",
        payload={"direction": direction},
    )
    return {
        "ticker": "FOO",
        "trader_decision": trader_signal,
        "prices": prices,
        "analyst_signals": [_signal("a", "bullish", confidence)],
        "persona_signals": [_signal("b", "bullish", confidence)],
    }


def test_risk_sizing_avoid_returns_zero() -> None:
    weight, breakdown = deterministic_target_weight(_state_with_trader("avoid", 0.7))
    assert weight == 0.0
    assert breakdown["reason"].startswith("trader_direction=")


def test_risk_sizing_long_high_confidence() -> None:
    state = _state_with_trader("long", 0.8)
    weight, breakdown = deterministic_target_weight(state)
    expected = 0.8 * MAX_PER_POSITION  # vote aligned, no vol scale (no prices)
    assert abs(weight - expected) < 1e-9
    assert breakdown["vote_aligned"] is True


def test_risk_sizing_high_vol_halves_weight() -> None:
    rng = np.random.default_rng(0)
    n = 250
    high_vol_rets = rng.normal(0.0, 0.05, n)  # 5%/day -> ~80%/yr annualized — well above threshold
    close = 100 * np.exp(np.cumsum(high_vol_rets))
    prices = pd.DataFrame({"ts": pd.date_range("2024-01-02", periods=n, freq="B"), "close": close})
    state = _state_with_trader("long", 0.8, prices=prices)
    _weight, breakdown = deterministic_target_weight(state)
    assert breakdown["vol_scale"] == 0.5
    assert breakdown["realized_vol_20d"] > HIGH_VOL_THRESHOLD


def test_risk_sizing_disagreeing_vote_halves_weight() -> None:
    """If agents are mostly bearish but trader said long, weight gets halved."""
    trader_signal = AgentSignal(
        agent="trader", signal="bullish", confidence=0.8,
        rationale="long", payload={"direction": "long"},
    )
    state = {
        "ticker": "FOO",
        "trader_decision": trader_signal,
        "analyst_signals": [_signal("a", "bearish", 0.7), _signal("b", "bearish", 0.6)],
        "persona_signals": [_signal("c", "bearish", 0.5)],
        "prices": None,
    }
    weight, breakdown = deterministic_target_weight(state)
    assert breakdown["vote_aligned"] is False
    expected = 0.8 * MAX_PER_POSITION * 1.0 * 0.5  # base * vol_scale * disagreement penalty
    assert abs(weight - expected) < 1e-9


# ---------- Synthesizer mappings (Trader / Risk / PM) ----------


def _mock_llm() -> LlmClient:
    client = LlmClient(api_key="fake")
    client._client = object()
    return client


def test_trader_to_signal_maps_direction_to_signal() -> None:
    trader = Trader(llm=_mock_llm())
    parsed = TraderDecision(
        direction="long", confidence=0.7, thesis="t",
        bull_summary=["a"], bear_summary=["b"], key_risks=["r"],
    )
    sig = trader.to_signal(parsed, ticker="FOO")
    assert sig.agent == "trader"
    assert sig.signal == "bullish"
    assert sig.payload["direction"] == "long"
    assert sig.payload["bull_summary"] == ["a"]


def test_trader_short_maps_to_bearish() -> None:
    trader = Trader(llm=_mock_llm())
    parsed = TraderDecision(direction="short", confidence=0.6, thesis="t")
    sig = trader.to_signal(parsed, ticker="FOO")
    assert sig.signal == "bearish"


def test_trader_avoid_maps_to_neutral() -> None:
    trader = Trader(llm=_mock_llm())
    parsed = TraderDecision(direction="avoid", confidence=0.4, thesis="t")
    sig = trader.to_signal(parsed, ticker="FOO")
    assert sig.signal == "neutral"


def test_risk_manager_veto_zeros_weight() -> None:
    rm = RiskManager(llm=_mock_llm())
    parsed = RiskAssessment(
        target_weight=0.05, max_stop_loss=0.10, veto=True,
        veto_reason="macro regime hostile", regime_concern="high",
        rationale="vetoed", correlation_caveat="",
    )
    sig = rm.to_signal(parsed, ticker="FOO")
    assert sig.payload["target_weight"] == 0.0
    assert sig.payload["veto"] is True


def test_risk_manager_no_veto_keeps_weight() -> None:
    rm = RiskManager(llm=_mock_llm())
    parsed = RiskAssessment(
        target_weight=0.06, max_stop_loss=0.10, veto=False,
        regime_concern="medium", rationale="ok",
    )
    sig = rm.to_signal(parsed, ticker="FOO")
    assert sig.payload["target_weight"] == 0.06


def test_pm_long_maps_to_bullish() -> None:
    pm = PortfolioManager(llm=_mock_llm())
    parsed = PortfolioDecision(
        final_signal="long", target_weight=0.07, confidence=0.7,
        final_thesis="approved", reasoning_notes=["x"],
    )
    sig = pm.to_signal(parsed, ticker="FOO")
    assert sig.agent == "portfolio_manager"
    assert sig.signal == "bullish"
    assert sig.payload["final_signal"] == "long"
    assert sig.payload["target_weight"] == 0.07


# ---------- LLM-availability fallback ----------


def test_synthesizer_returns_neutral_without_api_key() -> None:
    trader = Trader(llm=LlmClient(provider="anthropic", api_key=""))
    state = {"ticker": "FOO", "analyst_signals": [], "persona_signals": []}
    sig = trader.analyze(state)
    assert sig.signal == "neutral"
    assert sig.confidence == 0.0
    assert "unavailable" in sig.rationale


# ---------- All 13 personas wire into the graph ----------


def test_all_13_personas_register_distinct_names() -> None:
    personas = all_personas()
    names = [p.name for p in personas]
    expected = {
        "buffett", "burry", "druckenmiller", "taleb", "soros", "simons",
        "klarman", "greenblatt", "minervini", "cathie_wood", "damodaran", "lynch", "ackman",
    }
    assert set(names) == expected
    assert len(names) == 13


# ---------- Full graph end-to-end (mocked) ----------


def test_full_graph_runs_through_synthesis_layer() -> None:
    """Patch every LLM-using node to return a deterministic structured value."""
    from cfp_agents.personas.base import BasePersona

    def fake_persona_analyze(self, _state):
        return AgentSignal(
            agent=self.name, signal="bullish", confidence=0.6,
            rationale="mocked", payload={"mocked": True},
        )

    def fake_trader_analyze(self, _state):
        return AgentSignal(
            agent="trader", signal="bullish", confidence=0.7,
            rationale="long thesis",
            payload={"direction": "long", "bull_summary": ["a"], "bear_summary": ["b"], "key_risks": ["r"]},
        )

    def fake_risk_analyze(self, _state):
        return AgentSignal(
            agent="risk_manager", signal="neutral", confidence=0.7,
            rationale="ok",
            payload={"target_weight": 0.07, "max_stop_loss": 0.10, "veto": False,
                     "regime_concern": "medium", "correlation_caveat": ""},
        )

    def fake_pm_analyze(self, _state):
        return AgentSignal(
            agent="portfolio_manager", signal="bullish", confidence=0.7,
            rationale="approved long at 7% weight",
            payload={"final_signal": "long", "target_weight": 0.07, "reasoning_notes": ["x"]},
        )

    rng = np.random.default_rng(0)
    n = 250
    rets = rng.normal(0.001, 0.012, n)
    close = 100 * np.exp(np.cumsum(rets))
    prices = pd.DataFrame({
        "ts": pd.date_range("2024-01-02", periods=n, freq="B"),
        "open": close, "high": close * 1.005, "low": close * 0.995, "close": close,
        "volume": rng.integers(1_000_000, 5_000_000, n),
    })
    fundamentals = pd.DataFrame([
        {"fiscal_period": pd.Timestamp("2025-09-27").date(), "period_type": "A", "metric": m, "value": v}
        for m, v in [("revenue", 200e9), ("roe", 0.6), ("free_cash_flow", 90e9)]
    ])

    state = {
        "ticker": "NVDA", "sector": "XLK",
        "prices": prices, "fundamentals": fundamentals,
        "analyst_signals": [], "persona_signals": [],
    }

    with patch.object(BasePersona, "analyze", fake_persona_analyze), \
         patch.object(Trader, "analyze", fake_trader_analyze), \
         patch.object(RiskManager, "analyze", fake_risk_analyze), \
         patch.object(PortfolioManager, "analyze", fake_pm_analyze):
        graph = build_full_graph()
        result = graph.invoke(state)

    # 5 analysts run on real data (technicals, fundamentals, sentiment, news, flow)
    assert len(result["analyst_signals"]) == 5
    # 13 personas run via mock
    assert len(result["persona_signals"]) == 13
    # Synthesis stage outputs land in their dedicated state keys
    assert result["trader_decision"].agent == "trader"
    assert result["risk_assessment"].agent == "risk_manager"
    assert result["portfolio_decision"].agent == "portfolio_manager"
    assert result["portfolio_decision"].payload["final_signal"] == "long"
