"""Layer 3 — LLM synthesis. Only a ticker that PASSED the convergence gate ever reaches
this layer. Haiku writes the two-sentence thesis, sanity-checks the evidence stack for
contradictions (e.g. bullish flow into a lockup expiry), sets the final conviction, and
defines entry zone + invalidation.

The rate limiter is load-bearing: the only way to blow the ~$1/day budget is letting the
LLM into the hot loop. Its state persists to disk so the ceiling holds across the separate
CLI invocations a cron/launchd cadence produces. If anthropic is unavailable, no key is
set, or the limiter is exhausted, we fall back to a deterministic mechanical thesis and
still emit the Call — the gate already earned it.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from nest import config
from nest.engine.conviction import TickerScore

log = logging.getLogger(__name__)


@dataclass
class Synthesis:
    thesis: str
    conviction: float
    entry_zone: list[float]
    invalidation: float | None
    used_llm: bool


class RateLimiter:
    """Persistent min-interval + daily-ceiling guard for the synthesis client."""

    def __init__(self, state_path: Path | None = None):
        self.path = state_path or (config.DATA_DIR / "llm_rate.json")

    def _load(self) -> dict:
        if self.path.exists():
            try:
                return json.loads(self.path.read_text())
            except (ValueError, OSError):
                pass
        return {"day": "", "count": 0, "last_epoch": 0.0}

    def _save(self, state: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(state))

    def allow(self, now: datetime | None = None) -> bool:
        now = now or datetime.now(UTC)
        today = now.date().isoformat()
        epoch = now.timestamp()
        st = self._load()
        if st["day"] != today:
            st = {"day": today, "count": 0, "last_epoch": 0.0}
        if st["count"] >= config.LLM_MAX_PER_DAY:
            log.info("LLM daily ceiling (%d) reached — mechanical fallback", config.LLM_MAX_PER_DAY)
            return False
        if epoch - st["last_epoch"] < config.LLM_MIN_INTERVAL_S:
            log.info("LLM min-interval not elapsed — mechanical fallback")
            return False
        st["count"] += 1
        st["last_epoch"] = epoch
        self._save(st)
        return True


def _mechanical(ts: TickerScore, ref_price: float | None) -> Synthesis:
    """Deterministic thesis when the LLM is unavailable/exhausted — the gate already
    justified the Call, so we still ship it, just without prose reasoning."""
    fams = ", ".join(ts.families)
    srcs = ", ".join(ts.contributors[:4])
    thesis = (
        f"{ts.ticker} {ts.direction.upper()}: {len(ts.contributors)} sources across "
        f"{len(ts.families)} families ({fams}) converged — {srcs}. "
        f"Mechanical conviction {ts.conviction:.0f}; no LLM synthesis this cycle."
    )
    zone = inval = None
    if ref_price:
        if ts.direction == "bull":
            zone = [round(ref_price * 0.985, 2), round(ref_price * 1.01, 2)]
            inval = round(ref_price * 0.94, 2)
        else:
            zone = [round(ref_price * 0.99, 2), round(ref_price * 1.015, 2)]
            inval = round(ref_price * 1.06, 2)
    return Synthesis(thesis, ts.conviction, zone or [], inval, used_llm=False)


_PROMPT = """You are the synthesis layer of a conviction daemon. A ticker has passed a \
mechanical convergence gate: independent signal families agree on a direction. Your job \
is a skeptical two-sentence thesis, NOT cheerleading.

Ticker: {ticker}
Mechanical direction: {direction}
Mechanical conviction (0-100): {conviction}
Reference price: {ref_price}
Evidence stack (source | family | signed_contribution | meta):
{stack}

Return STRICT JSON, no prose outside it:
{{"thesis": "<two sentences: what converged and the single biggest risk/contradiction \
in the stack>", "conviction": <0-100 int, lower than mechanical if the stack has a \
contradiction>, "entry_zone": [<lo>, <hi>], "invalidation": <price>}}"""


def _stack_lines(ts: TickerScore) -> str:
    lines = []
    for c in sorted(ts.contributions, key=lambda c: abs(c.signed), reverse=True):
        lines.append(f"{c.source} | {c.family} | {c.signed:+.3f} | {c.signal.meta}")
    return "\n".join(lines)


def synthesize(ts: TickerScore, ref_price: float | None,
               limiter: RateLimiter | None = None) -> Synthesis:
    limiter = limiter or RateLimiter()
    if not os.environ.get(config.ANTHROPIC_KEY_ENV) or not limiter.allow():
        return _mechanical(ts, ref_price)
    try:
        import anthropic
    except ImportError:
        return _mechanical(ts, ref_price)
    try:
        client = anthropic.Anthropic()
        prompt = _PROMPT.format(
            ticker=ts.ticker, direction=ts.direction, conviction=round(ts.conviction),
            ref_price=ref_price, stack=_stack_lines(ts),
        )
        resp = client.messages.create(
            model=config.SYNTH_MODEL,
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        data = json.loads(text[text.index("{"): text.rindex("}") + 1])
        return Synthesis(
            thesis=str(data.get("thesis", ""))[:1500],
            conviction=float(data.get("conviction", ts.conviction)),
            entry_zone=[float(x) for x in data.get("entry_zone", [])][:2],
            invalidation=data.get("invalidation"),
            used_llm=True,
        )
    except Exception as e:  # noqa: BLE001 — never let synthesis crash a cycle
        log.warning("LLM synthesis failed (%s) — mechanical fallback", e)
        return _mechanical(ts, ref_price)
