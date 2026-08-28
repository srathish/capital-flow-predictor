"""The regime dial — macro context that scales overall alert aggressiveness, NOT
per-ticker scores (brief §4/§5). Fed/FOMC commentary (Warsh, Goolsbee, Powell), CPI/PCE
prints, and rate decisions don't pick a stock; they set how risk-on the tape is, which
shifts the effective conviction floor: hawkish surprise / imminent high-impact event →
raise the floor (fewer Calls); dovish / risk-on → loosen it.

Inputs (both from UW, already owned):
  - news headlines filtered to Fed/macro keywords → a hawkish/dovish tone read
  - the economic calendar → proximity to a high-impact event (FOMC/CPI/NFP/PCE)

Output: a Regime(score 0-100, tone, floor_delta, note) plus a persisted __MACRO__ Score
event so the dial is visible in the log and the UI.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from nest import config
from nest.events.log import EventLog
from nest.events.schema import Score
from nest.ingest.uw_client import UWClient

log = logging.getLogger(__name__)

MACRO_TICKER = "__MACRO__"

# Fed / macro relevance filter for market-wide headlines
_FED_TERMS = ("fed", "fomc", "warsh", "powell", "goolsbee", "rate", "inflation", "cpi",
              "pce", "jobs", "payroll", "jackson hole", "hawkish", "dovish", "treasury")
_HAWKISH = ("hawkish", "hot", "sticky", "higher for longer", "concerning", "elevated",
            "surprise to the upside", "no cut", "hold rates", "tightening")
_DOVISH = ("dovish", "cut", "cooling", "easing", "soft", "slowing", "below expectations",
           "rate cut", "cools", "disinflation")
# high-impact scheduled events that warrant caution as they approach
_HIGH_IMPACT = ("fomc", "rate decision", "cpi", "pce", "nonfarm", "non-farm", "payroll",
                "unemployment", "jackson hole", "fed chair", "gdp")


@dataclass
class Regime:
    score: float  # 0-100 risk appetite (50 = neutral)
    tone: str  # "hawkish" | "dovish" | "neutral"
    floor_delta: float  # points to add to the base conviction floor
    note: str
    imminent_event: str | None = None


def _fed_tone(uw: UWClient) -> tuple[int, int, str]:
    """(hawkish_hits, dovish_hits, latest_fed_headline) from market-wide news."""
    rows = uw.get("news_headlines", params={"limit": 100}) or []
    hawk = dov = 0
    latest = ""
    for r in rows:
        h = str(r.get("headline") or "").lower()
        if not any(t in h for t in _FED_TERMS):
            continue
        if not latest:
            latest = str(r.get("headline") or "")[:200]
        sent = str(r.get("sentiment") or "").lower()
        hawk += sum(t in h for t in _HAWKISH)
        dov += sum(t in h for t in _DOVISH)
        # a "negative" sentiment Fed headline reads risk-off (hawkish-leaning) and vice versa
        if sent == "negative":
            hawk += 1
        elif sent == "positive":
            dov += 1
    return hawk, dov, latest


def _tide_tilt(uw: UWClient) -> tuple[float, str]:
    """Market breadth from the options tape: net call vs net put premium (latest tick).
    Returns (tilt in [-1,1] risk-on positive, note). Risk-on tape loosens the floor a touch;
    risk-off tightens it — breadth context on top of the Fed-tone read."""
    rows = uw.get("market_tide") or []
    if not rows:
        return 0.0, ""
    last = rows[-1]
    call = float(last.get("net_call_premium") or 0)
    put = float(last.get("net_put_premium") or 0)
    denom = abs(call) + abs(put) or 1.0
    tilt = max(-1.0, min(1.0, (call - put) / denom))
    return tilt, f"tide {'risk-on' if tilt > 0.1 else 'risk-off' if tilt < -0.1 else 'flat'}"


def _imminent_event(uw: UWClient, now: datetime) -> str | None:
    """Name of a high-impact scheduled event within the next ~24h, if any."""
    rows = uw.get("economic_calendar") or []
    best = None
    for r in rows:
        event = str(r.get("event") or "")
        if not any(t in event.lower() for t in _HIGH_IMPACT):
            continue
        t = r.get("time")
        if not t:
            continue
        try:
            when = datetime.fromisoformat(str(t).replace("Z", "+00:00"))
        except ValueError:
            continue
        hrs = (when - now).total_seconds() / 3600.0
        if 0 <= hrs <= 24:
            best = event
    return best


def assess(uw: UWClient, now: datetime | None = None) -> Regime:
    """Compute the regime dial from Fed news tone + calendar proximity."""
    now = now or datetime.now(UTC)
    hawk, dov, latest = _fed_tone(uw)
    imminent = _imminent_event(uw, now)
    tilt, tide_note = _tide_tilt(uw)

    # tone score: 50 neutral, hawkish pulls down (risk-off), dovish pulls up (risk-on);
    # breadth tilt nudges it further either way
    net = dov - hawk
    score = 50 + max(-40, min(40, net * 6)) + tilt * 8
    tone = "hawkish" if net < -1 else "dovish" if net > 1 else "neutral"

    # floor delta: risk-off raises the floor; an imminent high-impact event adds caution;
    # a risk-off tape tightens, a risk-on tape loosens (bounded)
    floor_delta = 0.0
    if tone == "hawkish":
        floor_delta += min(10.0, hawk * 2.0)
    elif tone == "dovish":
        floor_delta -= min(5.0, dov * 1.0)
    floor_delta -= max(-3.0, min(3.0, tilt * 3.0))  # risk-on tilt lowers floor
    if imminent:
        floor_delta += 5.0
        score -= 5

    note_bits = [f"tone={tone} (hawk {hawk}/dov {dov})", tide_note]
    if imminent:
        note_bits.append(f"imminent: {imminent}")
    if latest:
        note_bits.append(f"latest: {latest[:120]}")
    return Regime(score=round(max(0, min(100, score)), 1), tone=tone,
                  floor_delta=round(floor_delta, 1),
                  note=" · ".join(b for b in note_bits if b),
                  imminent_event=imminent)


def refresh(log_db: EventLog, uw: UWClient, now: datetime | None = None) -> Regime:
    """Assess the regime and persist it as a __MACRO__ Score event (visible in log/UI)."""
    now = now or datetime.now(UTC)
    reg = assess(uw, now)
    log_db.append(Score(
        ts=now.isoformat(timespec="seconds"), ticker=MACRO_TICKER, conviction=reg.score,
        direction="bull" if reg.tone == "dovish" else "bear" if reg.tone == "hawkish" else "neutral",
        contributors=[reg.tone], families=["macro"], delta=reg.floor_delta,
        meta={"tone": reg.tone, "floor_delta": reg.floor_delta, "note": reg.note,
              "imminent_event": reg.imminent_event},
    ))
    return reg


def effective_floor(reg: Regime | None) -> float:
    """Base conviction floor adjusted by the regime dial, clamped to a sane band."""
    base = config.CONVICTION_FLOOR
    if not reg:
        return base
    return max(60.0, min(88.0, base + reg.floor_delta))
