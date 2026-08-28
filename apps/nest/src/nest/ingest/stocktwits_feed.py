"""Stocktwits source (social family) — the retail-herd gauge that needs NO credentials
(unlike Reddit, which blocks datacenter IPs). Uses the public trending stream: aggregate
mentions + sentiment per symbol, and grade the RATE OF CHANGE of mentions against the prior
cycle (velocity, not raw count — brief §4). Direction from Stocktwits' own Bullish/Bearish
tags, with a keyword fallback.
"""

from __future__ import annotations

import json
import logging
import re

import httpx

from nest import config
from nest.events.schema import Signal

log = logging.getLogger(__name__)

_UA = {"User-Agent": "Mozilla/5.0 (ConvictionNest research)"}
_TRENDING = "https://api.stocktwits.com/api/2/streams/trending.json"
_BULL = ("buy", "long", "call", "bull", "moon", "breakout", "squeeze", "rip", "🚀", "🔥")
_BEAR = ("sell", "short", "put", "bear", "dump", "crash", "breakdown", "tank", "puts")
_COUNTS = "stocktwits_counts.json"


def feed_stocktwits() -> list[Signal]:
    """Trending-stream mentions → per-symbol velocity Signals. Returns [] on error."""
    counts: dict[str, int] = {}
    lean: dict[str, int] = {}
    try:
        r = httpx.get(_TRENDING, headers=_UA, timeout=20)
        if r.status_code != 200:
            return []
        for m in r.json().get("messages", []):
            body = str(m.get("body") or "")
            low = body.lower()
            tag = ((m.get("entities") or {}).get("sentiment") or {})
            basic = str(tag.get("basic") or "").lower() if isinstance(tag, dict) else ""
            if basic == "bullish":
                d = 1
            elif basic == "bearish":
                d = -1
            else:
                d = (1 if any(k in low for k in _BULL) else 0) - \
                    (1 if any(k in low for k in _BEAR) else 0)
            for sym in (m.get("symbols") or []):
                t = str(sym.get("symbol") or "").upper()
                if not t or not re.fullmatch(r"[A-Z]{1,5}", t):
                    continue
                counts[t] = counts.get(t, 0) + 1
                lean[t] = lean.get(t, 0) + d
    except httpx.HTTPError as e:
        log.warning("stocktwits fetch failed: %s", e)
        return []

    # velocity vs the previous cycle's counts (persisted)
    path = config.DATA_DIR / _COUNTS
    prev = {}
    if path.exists():
        try:
            prev = json.loads(path.read_text())
        except (ValueError, OSError):
            pass
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_text(json.dumps(counts))
    except OSError:
        pass

    out = []
    for t, n in counts.items():
        # heat = mention count now; velocity = change vs last cycle. Fire on either a hot
        # name (>=2 mentions in one trending pull) or a real acceleration.
        velocity = n - prev.get(t, 0)
        if n < 2 and velocity < 2:
            continue
        net = lean.get(t, 0)
        direction = "bull" if net >= 0 else "bear"
        out.append(Signal(source="stocktwits", ticker=t, direction=direction,
                          strength=min(1.0, (n + max(0, velocity)) / 8.0), ttl_hours=8,
                          meta={"mentions": n, "velocity": velocity, "net_sentiment": net}))
    return out
