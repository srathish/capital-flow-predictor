"""Tests for the Phase 4e debate stage.

Covers:
  - _pick_top selects the highest-confidence persona on each side
  - Rebuttal node skips gracefully when one side has no personas
  - Rebuttal node skips gracefully when LLM is unavailable
  - to_signal-equivalent path: a successful LLM call produces an AgentSignal
    with target_claim / flip_condition / why_it_is_wrong wired into payload
  - render_rebuttals formats both rebuttals into a prompt block
  - render_rebuttals tolerates a missing or stub-only side
"""

from __future__ import annotations

from cfp_agents.llm import LlmClient
from cfp_agents.state import AgentSignal
from cfp_agents.synthesis.debate import (
    BearRebuttal,
    BullRebuttal,
    RebuttalOutput,
    _pick_top,
    render_rebuttals,
)


def _signal(agent: str, signal: str, conf: float, *, evidence: list[str] | None = None) -> AgentSignal:
    return AgentSignal(
        agent=agent,
        signal=signal,  # type: ignore[arg-type]
        confidence=conf,
        rationale=f"{agent}-thesis",
        payload={"key_evidence": evidence or []},
    )


def _mock_llm() -> LlmClient:
    """An LlmClient that reports available=True without making real calls.
    Tests then patch the .parse method to control output."""
    client = LlmClient(api_key="fake")
    client._client = object()
    return client


# ---------- _pick_top ----------


def test_pick_top_selects_highest_confidence_on_side() -> None:
    sigs = [
        _signal("buffett", "bullish", 0.6),
        _signal("burry", "bearish", 0.7),
        _signal("lynch", "bullish", 0.85),
        _signal("taleb", "bearish", 0.4),
    ]
    bull = _pick_top(sigs, "bullish")
    bear = _pick_top(sigs, "bearish")
    assert bull is not None and bull.agent == "lynch"
    assert bear is not None and bear.agent == "burry"


def test_pick_top_returns_none_when_side_empty() -> None:
    sigs = [_signal("buffett", "bullish", 0.6), _signal("lynch", "bullish", 0.4)]
    assert _pick_top(sigs, "bearish") is None


# ---------- Rebuttal node fallbacks ----------


def test_bull_rebuttal_skips_when_no_bear_persona() -> None:
    node = BullRebuttal(llm=_mock_llm())
    state = {
        "ticker": "FOO",
        "persona_signals": [
            _signal("buffett", "bullish", 0.7),
            _signal("lynch", "bullish", 0.5),
        ],
    }
    out = node(state)
    sig = out["bull_rebuttal"]
    assert sig.signal == "neutral"
    assert sig.payload["stub"] is True
    assert "skipped" in sig.rationale


def test_bear_rebuttal_skips_when_no_bull_persona() -> None:
    node = BearRebuttal(llm=_mock_llm())
    state = {
        "ticker": "FOO",
        "persona_signals": [_signal("burry", "bearish", 0.8)],
    }
    out = node(state)
    sig = out["bear_rebuttal"]
    assert sig.signal == "neutral"
    assert sig.payload["stub"] is True


def test_rebuttal_skips_when_llm_unavailable() -> None:
    node = BullRebuttal(llm=LlmClient(provider="anthropic", api_key=""))
    state = {
        "ticker": "FOO",
        "persona_signals": [
            _signal("buffett", "bullish", 0.7),
            _signal("burry", "bearish", 0.6),
        ],
    }
    sig = node(state)["bull_rebuttal"]
    assert sig.signal == "neutral"
    assert "unavailable" in sig.rationale


# ---------- Successful rebuttal path ----------


def test_bull_rebuttal_writes_full_payload(monkeypatch) -> None:
    node = BullRebuttal(llm=_mock_llm())

    parsed = RebuttalOutput(
        target_claim="margin compression to 30% by Q4",
        flip_condition="I would flip bearish if FCF margin compresses below 30% for 2 quarters",
        why_it_is_wrong="Latest FCF margin print 41.2%, expanding QoQ — not contracting",
        confidence_after=0.78,
    )

    def fake_parse(self, **_kwargs):  # type: ignore[no-untyped-def]
        return parsed

    monkeypatch.setattr(LlmClient, "parse", fake_parse)

    state = {
        "ticker": "FOO",
        "persona_signals": [
            _signal("lynch", "bullish", 0.85, evidence=["FCF margin 41%"]),
            _signal("burry", "bearish", 0.7, evidence=["margin compression to 30% by Q4"]),
            _signal("buffett", "bullish", 0.5),
        ],
    }
    sig = node(state)["bull_rebuttal"]

    assert sig.agent == "bull_rebuttal"
    assert sig.signal == "bullish"
    assert sig.confidence == 0.78
    assert "lynch rebuts burry" in sig.rationale
    p = sig.payload
    assert p["self_persona"] == "lynch"
    assert p["opponent_persona"] == "burry"
    assert p["target_claim"].startswith("margin compression")
    assert p["flip_condition"].startswith("I would flip bearish")
    assert p["confidence_before"] == 0.85
    assert p["confidence_after"] == 0.78


def test_rebuttal_handles_llm_exception(monkeypatch) -> None:
    node = BearRebuttal(llm=_mock_llm())

    def fake_parse(self, **_kwargs):  # type: ignore[no-untyped-def]
        raise RuntimeError("API timeout")

    monkeypatch.setattr(LlmClient, "parse", fake_parse)

    state = {
        "ticker": "FOO",
        "persona_signals": [
            _signal("lynch", "bullish", 0.85),
            _signal("burry", "bearish", 0.7),
        ],
    }
    sig = node(state)["bear_rebuttal"]
    assert sig.signal == "neutral"
    assert "API timeout" in sig.rationale


# ---------- render_rebuttals ----------


def test_render_rebuttals_includes_both_sides() -> None:
    bull = AgentSignal(
        agent="bull_rebuttal", signal="bullish", confidence=0.8,
        rationale="lynch rebuts burry: ...",
        payload={
            "self_persona": "lynch",
            "opponent_persona": "burry",
            "target_claim": "margin compression",
            "flip_condition": "if FCF<30% for 2 quarters",
            "why_it_is_wrong": "FCF margin 41%",
            "confidence_before": 0.85,
            "confidence_after": 0.8,
        },
    )
    bear = AgentSignal(
        agent="bear_rebuttal", signal="bearish", confidence=0.65,
        rationale="burry rebuts lynch: ...",
        payload={
            "self_persona": "burry",
            "opponent_persona": "lynch",
            "target_claim": "ARK net inflows",
            "flip_condition": "if inflows reverse 4w",
            "why_it_is_wrong": "ARK outflows last 6w",
            "confidence_before": 0.7,
            "confidence_after": 0.65,
        },
    )
    out = render_rebuttals({"bull_rebuttal": bull, "bear_rebuttal": bear})
    assert "BULL REBUTTAL" in out
    assert "BEAR REBUTTAL" in out
    assert "lynch rebutting burry" in out
    assert "burry rebutting lynch" in out
    assert "0.85 → 0.80" in out


def test_render_rebuttals_skips_stubs() -> None:
    stub = AgentSignal(
        agent="bull_rebuttal", signal="neutral", confidence=0.0,
        rationale="skipped",
        payload={"stub": True, "reason": "no bear persona"},
    )
    out = render_rebuttals({"bull_rebuttal": stub, "bear_rebuttal": None})
    assert "no rebuttals" in out


def test_render_rebuttals_handles_empty_state() -> None:
    out = render_rebuttals({})
    assert "no rebuttals" in out
