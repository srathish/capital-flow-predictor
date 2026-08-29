"""Layers 1 & 2 — free, every cycle.

Layer 1 (accumulation): each live Signal contributes
    strength * source_weight * time_decay
to a signed tally (bull positive, bear negative). Decay is exponential with a half-life
of ttl/2, so evidence fades instead of vanishing; a signal past its TTL contributes 0.
Conviction is the saturated magnitude of the net tally; direction is its sign.

Layer 2 (convergence gate): a score never triggers on its own. To pass, the signals
agreeing with the net direction must number >= GATE_MIN_SIGNALS from >= GATE_MIN_FAMILIES
independent families inside GATE_WINDOW_HOURS. This is the anti-noise mechanism — one
whale print or one loud Discord room can't page you by itself.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from nest import config
from nest.engine import weights as weights_mod
from nest.events.log import EventLog
from nest.events.schema import Score, Signal


def _age_hours(ts: str, now: datetime) -> float:
    return (now - datetime.fromisoformat(ts)).total_seconds() / 3600.0


def time_decay(age_hours: float, ttl_hours: float) -> float:
    """Exponential decay, half-life = ttl/2; hard zero once past the TTL."""
    if age_hours >= ttl_hours or ttl_hours <= 0:
        return 0.0
    half_life = ttl_hours / 2.0
    return 0.5 ** (age_hours / half_life)


@dataclass
class Contribution:
    source: str
    family: str
    direction: str
    signed: float  # strength*weight*decay, signed by direction
    signal: Signal


@dataclass
class TickerScore:
    ticker: str
    conviction: float
    direction: str
    contributions: list[Contribution] = field(default_factory=list)
    passed_gate: bool = False
    gate_reason: str = ""
    net_dir: float = 0.0   # magnitude of the DIRECTION stack (momentum/quality/catalyst)

    @property
    def contributors(self) -> list[str]:
        # distinct sources agreeing with net direction, strongest first
        agree = [c for c in self.contributions if c.direction == self.direction]
        agree.sort(key=lambda c: abs(c.signed), reverse=True)
        seen, out = set(), []
        for c in agree:
            if c.source not in seen:
                seen.add(c.source)
                out.append(c.source)
        return out

    @property
    def families(self) -> list[str]:
        return sorted({c.family for c in self.contributions if c.direction == self.direction})


def _latest_per_source(live_signals: list[Signal]) -> list[Signal]:
    """Collapse to the most recent signal per source. A source re-polled every cycle
    (GEX wall still there, trend still up) must REFRESH its one reading, not stack — the
    dedupe hash misses re-polls because volatile meta (spot, SMA) drifts. Conviction should
    reflect how many DISTINCT sources agree and how fresh each is, not how often we polled."""
    latest: dict[str, Signal] = {}
    for s in live_signals:
        cur = latest.get(s.source)
        if cur is None or s.ts > cur.ts:
            latest[s.source] = s
    return list(latest.values())


def score_ticker(
    ticker: str, live_signals: list[Signal], weights: dict[str, float],
    now: datetime | None = None, floor: float | None = None,
) -> TickerScore:
    now = now or datetime.now(UTC)
    contribs: list[Contribution] = []
    net_dir = 0.0   # DIRECTION sources (momentum/quality/catalyst) — these pick the name
    net_con = 0.0   # CONFIRMATION sources (flow/GEX/social) — locate/confirm, never create
    for s in _latest_per_source(live_signals):
        decay = time_decay(_age_hours(s.ts, now), s.ttl_hours)
        if decay <= 0.0 or s.direction == "neutral":
            continue
        w = weights_mod.source_weight(s.source, weights)
        signed = (s.strength * w * decay) * (1 if s.direction == "bull" else -1)
        if s.source in config.DIRECTION_SOURCES:
            net_dir += signed
        else:
            net_con += signed
        contribs.append(Contribution(
            source=s.source, family=config.family_of(s.source),
            direction=s.direction, signed=signed, signal=s,
        ))
    # direction comes from the direction stack; confirmation only modulates the magnitude
    direction = "bull" if net_dir >= 0 else "bear"
    agree = (net_con >= 0) == (net_dir >= 0)
    confirm = min(config.CONFIRM_BONUS_CAP, abs(net_con)) if agree \
        else -min(config.CONFIRM_BONUS_CAP, abs(net_con)) * config.CONFIRM_VETO_SCALE
    effective = max(0.0, abs(net_dir) + confirm)
    conviction = 100.0 * (1.0 - math.exp(-effective / config.SCORE_SCALE))
    ts = TickerScore(ticker=ticker, conviction=round(conviction, 1),
                     direction=direction, contributions=contribs, net_dir=abs(net_dir))
    _apply_gate(ts, floor if floor is not None else config.CONVICTION_FLOOR)
    return ts


def _apply_gate(ts: TickerScore, floor: float) -> None:
    if ts.net_dir < config.GATE_MIN_DIRECTION:
        ts.gate_reason = (f"no real direction signal (dir mag {ts.net_dir:.2f} < "
                          f"{config.GATE_MIN_DIRECTION})")
    elif ts.conviction < floor:
        ts.gate_reason = f"conviction {ts.conviction:.0f} < floor {floor:.0f}"
    else:
        ts.passed_gate = True
        ts.gate_reason = "passed"


def evaluate(log: EventLog, ticker: str, now: datetime | None = None,
             floor: float | None = None) -> TickerScore:
    """Full Layer 1+2 evaluation for one ticker off the event log, and append the Score.
    Returns the TickerScore (whether or not it passed the gate — the tracker shadow-grades
    names that scored but failed the gate, to check the gate filters noise not alpha)."""
    now = now or datetime.now(UTC)
    since = (now - timedelta(hours=config.GATE_WINDOW_HOURS)).isoformat()
    live = log.signals_since(since, ticker=ticker)
    weights = weights_mod.compute_all(log)
    ts = score_ticker(ticker, live, weights, now=now, floor=floor)

    prev = log.latest_score(ticker)
    delta = round(ts.conviction - prev.conviction, 1) if prev else ts.conviction
    log.append(Score(
        ts=now.isoformat(timespec="seconds"), ticker=ticker, conviction=ts.conviction,
        direction=ts.direction, contributors=ts.contributors, families=ts.families,
        delta=delta,
    ))
    return ts
