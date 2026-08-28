"""Discord source (social family) — reads Bellwether's `discord_messages` table (populated
by apps/discord_listener). Every callout becomes a Signal `discord:<caller>`, so each caller
earns an INDIVIDUAL tracked weight from their record — never "discord" as a monolith
(brief §4). No new bot/token: it's a read of the pipeline that already exists.

Direction from a simple bull/bear keyword lexicon over the message; tickers from cashtags.
Activates only when DATABASE_URL is set — no-ops otherwise. Needs the discord_listener to
be running and capturing (allowlist configured in the dashboard).
"""

from __future__ import annotations

import asyncio
import logging
import os
import re

from nest.events.schema import Signal

log = logging.getLogger(__name__)

_CASHTAG = re.compile(r"\$([A-Za-z]{1,5})\b")
_BULL = ("call", "calls", "long", "buy", "buying", "bull", "bullish", "moon", "breakout",
         "ripping", "🚀", "green", "up ", "target", "squeeze", "run")
_BEAR = ("put", "puts", "short", "shorts", "sell", "selling", "bear", "bearish", "dump",
         "crash", "red", "down ", "breakdown", "tank")
_SLUG = re.compile(r"[^a-z0-9]+")


def _caller_id(author: str) -> str:
    base = _SLUG.sub("-", (author or "unknown").lower()).strip("-")[:32]
    return f"discord:{base or 'unknown'}"


async def _fetch(database_url: str, since_minutes: int) -> list[dict]:
    import asyncpg

    conn = await asyncpg.connect(database_url)
    try:
        rows = await conn.fetch(
            "SELECT author_name, content, posted_at FROM discord_messages "
            "WHERE posted_at > now() - ($1::text || ' minutes')::interval "
            "AND author_is_bot = FALSE AND content <> '' ORDER BY posted_at DESC LIMIT 400",
            str(since_minutes),
        )
        return [dict(r) for r in rows]
    finally:
        await conn.close()


def feed_discord(since_minutes: int = 180) -> list[Signal]:
    """Recent callouts → per-(caller, ticker) directional Signals. Returns [] if no
    DATABASE_URL or the read fails (the source simply doesn't participate)."""
    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        return []
    try:
        rows = asyncio.run(_fetch(database_url, since_minutes))
    except Exception as e:  # noqa: BLE001 — one dead source must not kill the cycle
        log.warning("discord feed failed: %s", e)
        return []

    # aggregate per (caller, ticker): net directional mentions
    agg: dict[tuple[str, str], dict] = {}
    for r in rows:
        text = str(r.get("content") or "")
        low = text.lower()
        tickers = {t.upper() for t in _CASHTAG.findall(text)}
        if not tickers:
            continue
        d = sum(k in low for k in _BULL) - sum(k in low for k in _BEAR)
        if d == 0:
            continue
        caller = _caller_id(str(r.get("author_name") or ""))
        for tkr in tickers:
            a = agg.setdefault((caller, tkr), {"net": 0.0, "n": 0})
            a["net"] += 1 if d > 0 else -1
            a["n"] += 1

    out = []
    for (caller, tkr), a in agg.items():
        if a["net"] == 0:
            continue
        out.append(Signal(
            source=caller, ticker=tkr, direction="bull" if a["net"] > 0 else "bear",
            strength=min(1.0, abs(a["net"]) / 3.0), ttl_hours=24,
            meta={"mentions": a["n"], "net": a["net"]},
        ))
    return out
