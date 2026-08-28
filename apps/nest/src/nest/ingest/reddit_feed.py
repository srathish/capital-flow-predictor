"""Reddit velocity source (social family). Retail-herd gauge: the RATE OF CHANGE of a
ticker's mention count across finance subreddits, not the raw count (brief §4). A cashtag
spiking in mentions is a crowding signal; direction leans with the bull/bear lexicon in the
posts it appears in.

Reddit blocks unauthenticated datacenter traffic, so this needs a script-app OAuth token:
set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT (and optionally REDDIT_SUBS,
comma-separated; default wallstreetbets,stocks,options). No-ops without creds. Velocity is
measured against the previous cycle's counts, persisted in NEST_HOME/reddit_counts.json.
"""

from __future__ import annotations

import json
import logging
import os
import re

import httpx

from nest import config
from nest.events.schema import Signal

log = logging.getLogger(__name__)

_CASHTAG = re.compile(r"\$([A-Za-z]{1,5})\b")
_BULL = ("call", "long", "buy", "bull", "moon", "breakout", "squeeze", "rip", "🚀")
_BEAR = ("put", "short", "sell", "bear", "dump", "crash", "breakdown", "tank")
_COUNTS = lambda: config.DATA_DIR / "reddit_counts.json"  # noqa: E731


def _token() -> str | None:
    cid = os.environ.get("REDDIT_CLIENT_ID")
    secret = os.environ.get("REDDIT_CLIENT_SECRET")
    ua = os.environ.get("REDDIT_USER_AGENT", "ConvictionNest/0.1")
    if not cid or not secret:
        return None
    try:
        r = httpx.post("https://www.reddit.com/api/v1/access_token",
                       data={"grant_type": "client_credentials"},
                       auth=(cid, secret), headers={"User-Agent": ua}, timeout=15)
        r.raise_for_status()
        return r.json().get("access_token")
    except httpx.HTTPError as e:
        log.warning("reddit auth failed: %s", e)
        return None


def feed_reddit() -> list[Signal]:
    """Mention-velocity Signals per ticker. Returns [] without creds or on error."""
    token = _token()
    if not token:
        return []
    ua = os.environ.get("REDDIT_USER_AGENT", "ConvictionNest/0.1")
    subs = os.environ.get("REDDIT_SUBS", "wallstreetbets,stocks,options").split(",")
    counts: dict[str, int] = {}
    lean: dict[str, int] = {}
    try:
        with httpx.Client(headers={"Authorization": f"Bearer {token}", "User-Agent": ua},
                          timeout=20) as c:
            for sub in subs:
                r = c.get(f"https://oauth.reddit.com/r/{sub.strip()}/new",
                          params={"limit": 100})
                if r.status_code != 200:
                    continue
                for post in r.json().get("data", {}).get("children", []):
                    d = post.get("data", {})
                    text = f"{d.get('title', '')} {d.get('selftext', '')}"
                    low = text.lower()
                    tone = sum(k in low for k in _BULL) - sum(k in low for k in _BEAR)
                    for t in {m.upper() for m in _CASHTAG.findall(text)}:
                        counts[t] = counts.get(t, 0) + 1
                        lean[t] = lean.get(t, 0) + (1 if tone > 0 else -1 if tone < 0 else 0)
    except httpx.HTTPError as e:
        log.warning("reddit fetch failed: %s", e)
        return []

    # velocity = current count minus previous cycle's count
    path = _COUNTS()
    prev = {}
    if path.exists():
        try:
            prev = json.loads(path.read_text())
        except (ValueError, OSError):
            pass
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(counts))

    out = []
    for t, n in counts.items():
        velocity = n - prev.get(t, 0)
        if velocity < 3:  # need a real acceleration in mentions
            continue
        direction = "bull" if lean.get(t, 0) >= 0 else "bear"
        out.append(Signal(source="reddit_velocity", ticker=t, direction=direction,
                          strength=min(1.0, velocity / 20.0), ttl_hours=12,
                          meta={"mentions": n, "velocity": velocity}))
    return out
