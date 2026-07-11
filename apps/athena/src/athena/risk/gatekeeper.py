"""Risk gatekeeper — sits between thesis and alert; final veto over the LLM, always.

No execution exists in Athena, so the gate governs what may ALERT. Every
rejection is journaled with its reason by the orchestrator.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from athena import config
from athena.reasoning.thesis import Thesis


@dataclass
class Verdict:
    approved: bool
    reasons: list[str] = field(default_factory=list)


def check(
    thesis: Thesis,
    features_as_of: str,
    alerts_today: int,
    now: datetime | None = None,
) -> Verdict:
    now = now or datetime.now(UTC)
    reasons: list[str] = []

    if config.KILL_FILE.exists():
        reasons.append("kill switch active (data/KILL present)")
    if thesis.direction == "stand_aside":
        reasons.append("thesis is stand_aside — nothing to alert")
    if thesis.conviction < config.CONVICTION_FLOOR:
        reasons.append(
            f"conviction {thesis.conviction:.2f} below floor {config.CONVICTION_FLOOR}"
        )
    if alerts_today >= config.MAX_ALERTS_PER_DAY:
        reasons.append(f"daily alert cap reached ({config.MAX_ALERTS_PER_DAY})")
    if not thesis.invalidation.strip():
        reasons.append("thesis has no invalidation level")

    try:
        age = (now - datetime.fromisoformat(features_as_of)).total_seconds()
        if age > config.DATA_STALENESS_MAX_S:
            reasons.append(f"feature data stale ({age:.0f}s > {config.DATA_STALENESS_MAX_S}s)")
    except ValueError:
        reasons.append("unparseable feature timestamp — circuit breaker")

    return Verdict(approved=not reasons, reasons=reasons)


def kill(active: bool) -> None:
    """Flip the kill switch (file-based so it survives restarts and is script-free)."""
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    if active:
        config.KILL_FILE.write_text(datetime.now(UTC).isoformat())
    elif config.KILL_FILE.exists():
        config.KILL_FILE.unlink()
