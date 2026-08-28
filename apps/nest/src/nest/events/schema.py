"""The four event types. Keys are stable; payload-specific detail lives in `meta`.
Nothing is ever updated in place — a correction is a new event.

    Signal  — a normalized observation from any source
    Score   — the engine's rolling conviction for a ticker
    Call    — an alert that crossed the floor (rare, budgeted)
    Grade   — the tracker scoring a past Call against realized price
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

Direction = Literal["bull", "bear", "neutral"]


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class Signal(BaseModel):
    type: Literal["signal"] = "signal"
    ts: str = Field(default_factory=_now)
    source: str  # stable source id, e.g. "uw_darkpool" or "discord:callerX"
    ticker: str
    direction: Direction = "bull"
    strength: float = Field(ge=0.0, le=1.0)  # source-native 0-1 scaling
    ttl_hours: float = 48.0  # how long this evidence stays live before it decays out
    meta: dict[str, Any] = Field(default_factory=dict)

    def dedupe_key(self) -> str:
        """Hash of source+ticker+meta so the same UW alert or a reposted Discord
        message doesn't double-count. TTL bucketing happens at ingest time."""
        blob = json.dumps(
            {"source": self.source, "ticker": self.ticker, "meta": self.meta},
            sort_keys=True,
            default=str,
        )
        return hashlib.sha1(blob.encode()).hexdigest()  # noqa: S324 (dedupe, not crypto)


class Score(BaseModel):
    type: Literal["score"] = "score"
    ts: str = Field(default_factory=_now)
    ticker: str
    conviction: float  # 0-100
    direction: Direction = "bull"
    contributors: list[str] = Field(default_factory=list)  # distinct source ids
    families: list[str] = Field(default_factory=list)  # distinct families present
    delta: float = 0.0  # change vs the previous score for this ticker


class Call(BaseModel):
    type: Literal["call"] = "call"
    ts: str = Field(default_factory=_now)
    ticker: str
    conviction: float
    direction: Direction = "bull"
    ref_price: float | None = None
    thesis: str = ""  # two-sentence synthesis
    entry_zone: list[float] = Field(default_factory=list)  # [lo, hi]
    invalidation: float | None = None
    signals: list[dict[str, Any]] = Field(default_factory=list)  # contributing Signals
    calibration_note: str = ""  # "calls like this have hit 63% at 5d"


class Grade(BaseModel):
    type: Literal["grade"] = "grade"
    ts: str = Field(default_factory=_now)
    call_ts: str  # the Call this grades (its ts is the join key)
    ticker: str
    source: str = ""  # set when grading a single source's contribution; "" = the Call
    horizon: Literal["1d", "5d", "20d"]
    ref_price: float
    realized: float
    return_pct: float
    hit: bool  # bull: realized>ref; bear: realized<ref


EVENT_MODELS = {"signal": Signal, "score": Score, "call": Call, "grade": Grade}
