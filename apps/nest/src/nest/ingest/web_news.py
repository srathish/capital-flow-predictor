"""Web-news source (filings family) — scrapes Google News per stock for the freshest
headlines UW might miss, and scores their sentiment. Free, no credentials, datacenter-OK
(Google's public RSS). HONEST WEIGHTING: news sentiment is noisy for direction (the repo
proved it — momentum is the edge), so this is a low-weight CONFIRMATION/catalyst source that
earns or decays via the tracker. Its real value is the "why now" — the actual headlines are
surfaced in the stock's detail drawer.
"""

from __future__ import annotations

import logging
import re
import time

import httpx

from nest.events.schema import Signal

log = logging.getLogger(__name__)

_UA = {"User-Agent": "Mozilla/5.0 (compatible; ConvictionNest/1.0; research)"}
_RSS = "https://news.google.com/rss/search"
_TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
_PUB_RE = re.compile(r"<pubDate>(.*?)</pubDate>")

_BULL = ("beat", "beats", "surge", "surges", "soar", "soars", "jump", "jumps", "upgrade",
         "upgraded", "raise", "raises", "raised", "breakout", "record", "record high", "wins",
         "approval", "approved", "outperform", "buy rating", "rally", "rallies", "tops",
         "strong", "boost", "boosts", "acquire", "acquisition", "buyback", "beat estimates")
_BEAR = ("miss", "misses", "plunge", "plunges", "sink", "sinks", "drop", "drops", "downgrade",
         "downgraded", "cut", "cuts", "lawsuit", "probe", "investigation", "recall", "warns",
         "warning", "falls", "tumble", "tumbles", "slump", "sell rating", "fraud", "bankruptcy",
         "layoffs", "guidance cut", "disappoints", "weak", "slashes", "halts")
# cache: ticker -> (epoch, signal|None). news moves slowly; refresh every ~30 min.
_cache: dict[str, tuple[float, object]] = {}
_TTL = 1800.0


def _headlines(ticker: str) -> list[tuple[str, str]]:
    q = f"{ticker} stock when:5d"
    r = httpx.get(_RSS, params={"q": q, "hl": "en-US", "gl": "US", "ceid": "US:en"},
                  headers=_UA, timeout=15, follow_redirects=True)
    if r.status_code != 200:
        return []
    titles = _TITLE_RE.findall(r.text)
    pubs = _PUB_RE.findall(r.text)
    out = []
    for i, t in enumerate(titles):
        clean = re.sub(r"\s*-\s*[^-]+$", "", t).strip()  # strip trailing " - Source"
        low = clean.lower()
        if not clean or low in ("google news", ticker.lower()) or "when:" in low \
                or low.startswith(ticker.lower() + " stock"):
            continue
        out.append((clean, pubs[i][:16] if i < len(pubs) else ""))
        if len(out) >= 10:
            break
    return out


def news_for(ticker: str) -> tuple[list[tuple[str, str]], int]:
    """(headlines, net_sentiment) for a ticker, cached."""
    now = time.monotonic()
    hit = _cache.get("hl:" + ticker)
    if hit and now - hit[0] < _TTL:
        return hit[1]  # type: ignore[return-value]
    try:
        heads = _headlines(ticker)
    except httpx.HTTPError as e:
        log.warning("web_news %s failed: %s", ticker, e)
        return [], 0
    net = 0
    for title, _ in heads:
        low = title.lower()
        net += sum(k in low for k in _BULL) - sum(k in low for k in _BEAR)
    res = (heads, net)
    _cache["hl:" + ticker] = (now, res)
    return res


def enrich_web_news(uw, ticker: str) -> list[Signal]:  # noqa: ANN001 — uw unused, signature parity
    """Google-News headline sentiment → a filings-family Signal (confirmation/catalyst)."""
    heads, net = news_for(ticker)
    if not heads or net == 0:
        return []
    return [Signal(
        source="web_news", ticker=ticker, direction="bull" if net > 0 else "bear",
        strength=min(1.0, abs(net) / 4.0), ttl_hours=18,
        meta={"net_sentiment": net, "headlines": [h for h, _ in heads[:5]],
              "latest": heads[0][0] if heads else ""},
    )]
