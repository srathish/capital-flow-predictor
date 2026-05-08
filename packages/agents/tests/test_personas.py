"""Persona tests with mocked LLM responses.

We don't hit the Anthropic API — we patch ``LlmClient.invoke_persona`` to
return canned ``PersonaOutput`` objects and verify:
  - the persona's user prompt is assembled correctly
  - the LLM response is mapped to AgentSignal cleanly
  - missing API key falls back to neutral with a clear reason
  - the full LangGraph (analysts -> merge -> personas) runs end-to-end
"""

from __future__ import annotations

from unittest.mock import patch

import numpy as np
import pandas as pd
from cfp_agents.graph import build_full_graph
from cfp_agents.llm import LlmClient, PersonaOutput
from cfp_agents.personas import (
    BuffettPersona,
    BurryPersona,
    CathieWoodPersona,
    DamodaranPersona,
    DruckenmillerPersona,
    TalebPersona,
    all_personas,
)


def _prices() -> pd.DataFrame:
    rng = np.random.default_rng(0)
    n = 250
    rets = rng.normal(0.001, 0.012, n)
    close = 100 * np.exp(np.cumsum(rets))
    idx = pd.date_range("2024-01-02", periods=n, freq="B")
    return pd.DataFrame(
        {
            "ts": idx,
            "open": close, "high": close * 1.005, "low": close * 0.995, "close": close,
            "volume": rng.integers(1_000_000, 5_000_000, n),
        }
    )


def _fundamentals() -> pd.DataFrame:
    rows = []
    for metric, value in [
        ("revenue", 200e9), ("net_income", 100e9), ("free_cash_flow", 90e9),
        ("roe", 0.6), ("debt_to_equity", 0.1), ("pe_ratio", 30.0),
        ("price_to_book", 25.0), ("market_cap", 3e12),
    ]:
        rows.append(
            {
                "fiscal_period": pd.Timestamp("2025-09-27").date(),
                "period_type": "A",
                "metric": metric,
                "value": value,
            }
        )
    return pd.DataFrame(rows)


def _state() -> dict:
    return {
        "ticker": "NVDA",
        "sector": "XLK",
        "prices": _prices(),
        "fundamentals": _fundamentals(),
        "analyst_signals": [],
        "persona_signals": [],
    }


# ---------- LLM-availability fallback ----------


def test_persona_returns_neutral_when_no_api_key() -> None:
    persona = BuffettPersona(llm=LlmClient(provider="anthropic", api_key=""))
    sig = persona.analyze(_state())
    assert sig.signal == "neutral"
    assert sig.confidence == 0.0
    assert "unavailable" in sig.rationale
    assert sig.payload.get("reason") == "no_api_key"
    assert sig.payload.get("provider") == "anthropic"


def test_moonshot_provider_routes_through_openai_sdk() -> None:
    """LlmClient with provider='moonshot' uses the openai SDK pointed at Moonshot."""
    llm = LlmClient(provider="moonshot", api_key="fake-moonshot-key")
    assert llm.provider == "moonshot"
    assert llm.base_url == "https://api.moonshot.cn/v1"
    assert llm.model == "moonshot-v1-32k"
    # Constructed an openai.OpenAI client
    from openai import OpenAI
    assert isinstance(llm._client, OpenAI)


def test_moonshot_persona_returns_neutral_when_no_key() -> None:
    persona = BuffettPersona(llm=LlmClient(provider="moonshot", api_key=""))
    sig = persona.analyze(_state())
    assert sig.signal == "neutral"
    assert sig.payload.get("provider") == "moonshot"


def test_unknown_provider_raises() -> None:
    import pytest
    with pytest.raises(ValueError, match="Unknown LLM_PROVIDER"):
        LlmClient(provider="bogus")


# ---------- Mocked LLM round-trip ----------


def _mock_llm_returning(output: PersonaOutput) -> LlmClient:
    """Build an LlmClient that pretends to be available and returns `output`."""
    client = LlmClient(api_key="fake-key-for-tests")
    # The constructor will have tried to import anthropic and create a real client.
    # That's fine — we patch invoke_persona directly so no network call happens.
    client._client = object()  # any non-None makes .available True
    return client


def test_persona_maps_llm_output_to_agent_signal() -> None:
    canned = PersonaOutput(
        signal="bullish",
        confidence=0.75,
        thesis="Wonderful business at a fair price.",
        key_evidence=["ROE 60%", "FCF $90B", "Tiny debt"],
        concerns=["Multiple is rich vs history"],
    )
    llm = _mock_llm_returning(canned)
    persona = BuffettPersona(llm=llm)

    with patch.object(llm, "invoke_persona", return_value=canned) as m:
        sig = persona.analyze(_state())

    assert m.called
    _args, kwargs = m.call_args
    assert "Warren Buffett" in kwargs["system_prompt"]
    assert "NVDA" in kwargs["user_prompt"]
    assert "Latest annual fundamentals" in kwargs["user_prompt"]

    assert sig.agent == "buffett"
    assert sig.signal == "bullish"
    assert abs(sig.confidence - 0.75) < 1e-9
    assert sig.rationale == "Wonderful business at a fair price."
    assert sig.payload["key_evidence"] == ["ROE 60%", "FCF $90B", "Tiny debt"]
    assert sig.payload["concerns"] == ["Multiple is rich vs history"]


def test_persona_handles_llm_exception() -> None:
    llm = _mock_llm_returning(
        PersonaOutput(signal="bullish", confidence=0.5, thesis="x")  # not used
    )
    persona = BurryPersona(llm=llm)
    with patch.object(llm, "invoke_persona", side_effect=RuntimeError("network down")):
        sig = persona.analyze(_state())
    assert sig.signal == "neutral"
    assert sig.confidence == 0.0
    assert "RuntimeError" in sig.rationale


# ---------- All 6 personas register distinct names + system prompts ----------


def test_all_personas_distinct_names() -> None:
    """All 13 personas (Phase 4c added 6, Phase 4d added 7 more)."""
    personas = all_personas()
    names = [p.name for p in personas]
    assert len(set(names)) == len(names)
    assert set(names) == {
        "buffett", "munger", "burry", "druckenmiller", "cathie_wood", "taleb",
        "damodaran", "graham", "ackman", "lynch", "fisher", "pabrai", "jhunjhunwala",
    }


def test_each_persona_has_nontrivial_system_prompt() -> None:
    for persona_cls in [
        BuffettPersona, BurryPersona, DruckenmillerPersona,
        CathieWoodPersona, TalebPersona, DamodaranPersona,
    ]:
        sys_prompt = persona_cls.system_prompt
        assert len(sys_prompt) > 200, f"{persona_cls.__name__} system prompt too short"
        # Persona names mentioned in their own prompts (catches accidental copy-paste)
        if persona_cls is BuffettPersona:
            assert "Buffett" in sys_prompt
        if persona_cls is BurryPersona:
            assert "Burry" in sys_prompt
        if persona_cls is TalebPersona:
            assert "Taleb" in sys_prompt


# ---------- Full LangGraph: analysts -> merge -> personas (parallel) ----------


def test_full_graph_runs_analysts_and_personas() -> None:
    """All 4 analysts run, then all 6 personas run; both lists land in state."""
    canned = PersonaOutput(
        signal="bullish", confidence=0.6, thesis="Mocked persona response."
    )
    # Patch the BasePersona's analyze method to skip the LLM entirely
    from cfp_agents.personas.base import BasePersona
    from cfp_agents.state import AgentSignal

    def fake_analyze(self, state):
        return AgentSignal(
            agent=self.name,
            signal=canned.signal,
            confidence=canned.confidence,
            rationale=canned.thesis,
            payload={"mocked": True},
        )

    with patch.object(BasePersona, "analyze", fake_analyze):
        graph = build_full_graph()
        result = graph.invoke(_state())

    analyst_names = {s.agent for s in result["analyst_signals"]}
    persona_names = {s.agent for s in result["persona_signals"]}
    assert analyst_names == {"technicals", "fundamentals", "sentiment", "news"}
    assert persona_names == {
        "buffett", "munger", "burry", "druckenmiller", "cathie_wood", "taleb",
        "damodaran", "graham", "ackman", "lynch", "fisher", "pabrai", "jhunjhunwala",
    }
