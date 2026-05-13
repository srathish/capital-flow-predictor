"""Behavior tests for the GexAnalyst — rule-based, no LLM calls."""

from __future__ import annotations

from datetime import UTC, datetime

from cfp_agents.analysts.gex import GexAnalyst
from cfp_shared import EvidenceBundle, Instrument, PositioningCtx


def _bundle(**positioning_kwargs) -> EvidenceBundle:
    return EvidenceBundle(
        run_ts=datetime.now(UTC),
        instrument=Instrument(ticker="TEST", company_name="Test Co"),
        positioning=PositioningCtx(**positioning_kwargs),
    )


def _state(bundle: EvidenceBundle | None) -> dict:
    return {"ticker": "TEST", "evidence": bundle}


def test_no_skylit_coverage_returns_neutral_no_data() -> None:
    """When Skylit doesn't cover the ticker, every skylit_* field is None.
    The analyst must NOT fabricate a signal."""
    bundle = _bundle()  # all None
    sig = GexAnalyst().analyze(_state(bundle))
    assert sig.signal == "neutral"
    assert sig.confidence == 0.0
    assert sig.payload["has_data"] is False
    assert "no Skylit GEX coverage" in sig.rationale


def test_missing_bundle_returns_stub() -> None:
    sig = GexAnalyst().analyze(_state(None))
    assert sig.signal == "neutral"
    assert sig.payload["stub"] is True


def test_positive_gex_king_above_spot_signals_bullish_drift() -> None:
    """Positive GEX + king node 2% above spot → mean-revert UP toward magnet."""
    bundle = _bundle(
        skylit_spot=100.0,
        skylit_regime_score=0.40,           # strongly positive
        skylit_king_strike=102.0,           # 2% above spot
        skylit_king_gamma=1e9,
        skylit_floor_strike=95.0,
        skylit_ceiling_strike=105.0,
    )
    sig = GexAnalyst().analyze(_state(bundle))
    assert sig.signal == "bullish"
    assert sig.confidence > 0.3
    assert sig.payload["regime_concern"] == "low"
    assert "magnet drift up" in sig.rationale


def test_positive_gex_king_below_spot_signals_bearish_drift() -> None:
    """Positive GEX + king 3% below → magnet pulls price down."""
    bundle = _bundle(
        skylit_spot=100.0,
        skylit_regime_score=0.40,
        skylit_king_strike=97.0,
        skylit_king_gamma=1e9,
        skylit_floor_strike=92.0,
        skylit_ceiling_strike=105.0,
    )
    sig = GexAnalyst().analyze(_state(bundle))
    assert sig.signal == "bearish"


def test_negative_gex_regime_flags_high_concern_and_halves_score() -> None:
    """Strongly negative GEX = trending regime. Mean-revert assumptions fail,
    so any directional view we'd emit is halved + flagged."""
    bundle = _bundle(
        skylit_spot=100.0,
        skylit_regime_score=-0.45,
        skylit_king_strike=102.0,
        skylit_floor_strike=95.0,
        skylit_ceiling_strike=105.0,
    )
    sig = GexAnalyst().analyze(_state(bundle))
    assert sig.payload["regime_concern"] == "high"
    # Halved score → likely lands in neutral band
    assert sig.signal == "neutral"
    assert "trending regime" in sig.rationale


def test_air_pockets_above_only_adds_bullish_tilt() -> None:
    bundle = _bundle(
        skylit_spot=100.0,
        skylit_regime_score=0.10,           # weakly positive, no big king effect
        skylit_air_pockets=[{"low": 102.0, "high": 105.0, "span": 3.0}],
    )
    sig = GexAnalyst().analyze(_state(bundle))
    assert sig.payload["n_air_pockets_above"] == 1
    assert sig.payload["n_air_pockets_below"] == 0
    assert "upside acceleration risk" in sig.rationale


def test_expiration_surfaced_in_rationale_when_present() -> None:
    bundle = _bundle(
        skylit_spot=100.0,
        skylit_regime_score=0.20,
        skylit_king_strike=100.5,
        skylit_expiration="2027-01-15",
    )
    sig = GexAnalyst().analyze(_state(bundle))
    assert sig.payload["expiration"] == "2027-01-15"
    assert "2027-01-15" in sig.rationale
