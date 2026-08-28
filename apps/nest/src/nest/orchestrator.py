"""The cycle. Per ticker: ingest -> Layer 1 accumulate -> Layer 2 gate. Only gate-crossers
reach Layer 3 synthesis, and only then subject to the scarcity budget (floor, max/day,
per-ticker cooldown) does a Call fire and deliver. The budget is enforced here in code —
it is a property of the system, not of prompt discipline.

It does not trade. A Call is advisory: an input to your judgment, never an instruction.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from nest import config
from nest.delivery import discord
from nest.engine import conviction as engine
from nest.engine.conviction import TickerScore
from nest.engine.synthesis import RateLimiter, synthesize
from nest.events.log import EventLog
from nest.events.schema import Call
from nest.ingest import sources
from nest.ingest.uw_client import UWClient
from nest.tracker import grader

log = logging.getLogger(__name__)


def _ref_price(ts: TickerScore) -> float | None:
    """Spot from any GEX signal's meta (already fetched this cycle) — avoids a round-trip."""
    for c in ts.contributions:
        spot = c.signal.meta.get("spot")
        if spot:
            return float(spot)
    return None


def _cooldown_ok(log: EventLog, ts: TickerScore, now: datetime) -> bool:
    """Per-ticker cooldown of COOLDOWN_SESSIONS unless conviction rose by the override
    delta on new evidence. Sessions are approximated by prior Calls on this ticker."""
    prior = log.last_call(ts.ticker)
    if not prior:
        return True
    # count scores since the last call as "sessions elapsed"
    last_dt = datetime.fromisoformat(prior.ts)
    sessions = len([s for s in _scores_since(log, ts.ticker, prior.ts)])
    if sessions >= config.COOLDOWN_SESSIONS:
        return True
    if ts.conviction - prior.conviction >= config.COOLDOWN_OVERRIDE_DELTA:
        return True
    logging.getLogger(__name__).info(
        "cooldown: %s called %d sessions ago at %.0f, now %.0f (last %s)",
        ts.ticker, sessions, prior.conviction, ts.conviction, last_dt.isoformat())
    return False


def _scores_since(log: EventLog, ticker: str, since_iso: str):
    rows = log.conn.execute(
        "SELECT payload FROM events WHERE type='score' AND ticker=? AND ts>? ORDER BY ts",
        (ticker, since_iso),
    ).fetchall()
    return rows


def run_cycle(log: EventLog, uw: UWClient | None, tickers: list[str],
              limiter: RateLimiter | None = None, now: datetime | None = None,
              deliver: bool = True) -> dict:
    """One full cycle over the watchlist. Returns a summary dict."""
    now = now or datetime.now(UTC)
    limiter = limiter or RateLimiter()
    day_iso = now.date().isoformat()
    kill = config.KILL_FILE.exists()
    calls_today = log.calls_today(day_iso)
    summary = {"ts": now.isoformat(timespec="seconds"), "evaluated": 0, "gated": 0,
               "calls": [], "suppressed": [], "kill": kill}

    for ticker in tickers:
        # --- ingest (skipped if no UW client, e.g. offline replay) ---
        if uw is not None:
            for sig in sources.collect(uw, ticker):
                log.append(sig)  # dedupe happens in the log

        # --- Layer 1 + 2 ---
        ts = engine.evaluate(log, ticker, now=now)
        summary["evaluated"] += 1
        if not ts.passed_gate:
            continue
        summary["gated"] += 1

        # --- scarcity budget (before spending an LLM call) ---
        if kill:
            summary["suppressed"].append((ticker, "kill switch"))
            continue
        if calls_today >= config.MAX_CALLS_PER_DAY:
            summary["suppressed"].append((ticker, "daily call budget spent"))
            continue
        if not _cooldown_ok(log, ts, now):
            summary["suppressed"].append((ticker, "cooldown"))
            continue

        # --- Layer 3 synthesis (gated + rate-limited) ---
        ref = _ref_price(ts)
        syn = synthesize(ts, ref, limiter=limiter)
        note = grader.calibration_note(log, syn.conviction, "5d")
        call = Call(
            ts=now.isoformat(timespec="seconds"), ticker=ticker, conviction=syn.conviction,
            direction=ts.direction, ref_price=ref, thesis=syn.thesis,
            entry_zone=syn.entry_zone, invalidation=syn.invalidation,
            signals=[c.signal.model_dump() for c in ts.contributions
                     if c.direction == ts.direction],
            calibration_note=note,
        )
        log.append(call)
        calls_today += 1
        if deliver:
            discord.send_call(call)
        summary["calls"].append({"ticker": ticker, "conviction": syn.conviction,
                                 "used_llm": syn.used_llm, "direction": ts.direction})

    return summary
