"""The cycle — emergent universe.

  1. INGEST market-wide feeds (flow / darkpool / insider / congress / news) → fan out
     into per-ticker Signals for every active name in the market.
  2. REGIME: assess the macro dial (Fed/FOMC news + calendar) → effective conviction floor.
  3. ENRICH the top-N most-active names (+ pinned core) with per-ticker reads (GEX, chart,
     fundamentals) — the expensive calls, bounded so the cycle stays cheap.
  4. SCORE every ticker with live signals (Layers 1+2). Only gate-crossers reach Layer 3
     synthesis, and only then does the scarcity budget decide whether a Call fires.

The watchlist is not curated — any name a feed surfaces can accumulate conviction and,
eventually, page you. It does not trade. A Call is advisory, never an instruction.
"""

from __future__ import annotations

import logging
from collections import Counter
from datetime import UTC, datetime, timedelta

from nest import config
from nest.delivery import discord
from nest.engine import conviction as engine
from nest.engine import macro
from nest.engine.conviction import TickerScore
from nest.engine.synthesis import RateLimiter, synthesize
from nest.events.log import EventLog
from nest.events.schema import Call
from nest.ingest import feeds, sources
from nest.ingest.uw_client import UWClient
from nest.tracker import grader

log = logging.getLogger(__name__)


def _ref_price(ts: TickerScore) -> float | None:
    for c in ts.contributions:
        for key in ("spot", "px"):
            v = c.signal.meta.get(key)
            if v:
                return float(v)
    return None


def _active_set(new_signals) -> list[str]:
    """Names to enrich this cycle: the most-active from this cycle's feed fan-out, plus the
    pinned core. Bounded to ENRICH_TOP_N to keep per-ticker calls cheap."""
    counts = Counter(s.ticker for s in new_signals if s.ticker != macro.MACRO_TICKER)
    top = [t for t, _ in counts.most_common(config.ENRICH_TOP_N)]
    for t in config.PINNED:
        if t not in top:
            top.append(t)
    return top


def _cooldown_ok(log_db: EventLog, ts: TickerScore) -> bool:
    prior = log_db.last_call(ts.ticker)
    if not prior:
        return True
    sessions = len(log_db.conn.execute(
        "SELECT 1 FROM events WHERE type='score' AND ticker=? AND ts>?",
        (ts.ticker, prior.ts)).fetchall())
    if sessions >= config.COOLDOWN_SESSIONS:
        return True
    if ts.conviction - prior.conviction >= config.COOLDOWN_OVERRIDE_DELTA:
        return True
    return False


def run_cycle(log_db: EventLog, uw: UWClient | None, limiter: RateLimiter | None = None,
              now: datetime | None = None, deliver: bool = True) -> dict:
    """One full emergent-universe cycle. Returns a summary dict."""
    now = now or datetime.now(UTC)
    limiter = limiter or RateLimiter()
    day_iso = now.date().isoformat()
    kill = config.KILL_FILE.exists()
    calls_today = log_db.calls_today(day_iso)

    summary = {"ts": now.isoformat(timespec="seconds"), "feed_signals": 0, "enriched": 0,
               "scored": 0, "gated": 0, "calls": [], "suppressed": [], "kill": kill,
               "regime": None, "floor": config.CONVICTION_FLOOR}

    # --- 1. market-wide ingest (skipped offline) ---
    new_signals = []
    if uw is not None:
        new_signals = feeds.collect_all(uw)
        # non-UW sources: EDGAR offerings (free) + Discord callers (Bellwether Postgres) +
        # Reddit velocity (needs OAuth creds). Each no-ops when unavailable.
        from nest.ingest import discord_feed, edgar, reddit_feed, stocktwits_feed
        new_signals += edgar.feed_edgar()
        new_signals += discord_feed.feed_discord()
        new_signals += reddit_feed.feed_reddit()
        new_signals += stocktwits_feed.feed_stocktwits()
        for s in new_signals:
            log_db.append(s)
        summary["feed_signals"] = len(new_signals)

    # --- 2. regime dial ---
    reg = None
    if uw is not None:
        reg = macro.refresh(log_db, uw, now)
        summary["regime"] = {"score": reg.score, "tone": reg.tone,
                             "floor_delta": reg.floor_delta, "note": reg.note}
    floor = macro.effective_floor(reg)
    summary["floor"] = floor

    # --- 3. enrich the active set ---
    active = _active_set(new_signals)
    if uw is not None:
        for tkr in active:
            for s in sources.enrich(uw, tkr):
                log_db.append(s)
                summary["enriched"] += 1

    # --- 4. score every ticker with live signals in the window ---
    since = (now - timedelta(hours=config.GATE_WINDOW_HOURS)).isoformat()
    live_tickers = sorted({
        s.ticker for s in log_db.signals_since(since)
        if s.ticker and s.ticker != macro.MACRO_TICKER
    })
    for tkr in live_tickers:
        ts = engine.evaluate(log_db, tkr, now=now, floor=floor)
        summary["scored"] += 1
        if not ts.passed_gate:
            continue
        summary["gated"] += 1

        if kill:
            summary["suppressed"].append((tkr, "kill switch"))
            continue
        if calls_today >= config.MAX_CALLS_PER_DAY:
            summary["suppressed"].append((tkr, "daily call budget spent"))
            continue
        if not _cooldown_ok(log_db, ts):
            summary["suppressed"].append((tkr, "cooldown"))
            continue

        ref = _ref_price(ts)
        syn = synthesize(ts, ref, limiter=limiter)
        note = grader.calibration_note(log_db, syn.conviction, "5d")
        call = Call(
            ts=now.isoformat(timespec="seconds"), ticker=tkr, conviction=syn.conviction,
            direction=ts.direction, ref_price=ref, thesis=syn.thesis,
            entry_zone=syn.entry_zone, invalidation=syn.invalidation,
            signals=[c.signal.model_dump() for c in ts.contributions
                     if c.direction == ts.direction],
            calibration_note=note,
        )
        log_db.append(call)
        calls_today += 1
        if deliver:
            discord.send_call(call)
        summary["calls"].append({"ticker": tkr, "conviction": syn.conviction,
                                 "used_llm": syn.used_llm, "direction": ts.direction})

    return summary
