"""Multi-source news aggregator for the chatter leaderboard.

Pulls headlines lazily from every free source we have plumbing for:

  - FMP `news/stock` and `news/general` (FMP_API_KEY)
  - Polygon `reference/news` (POLYGON_API_KEY)
  - yfinance `Ticker.news` (no key — runs in thread pool)
  - Yahoo Finance RSS (no key)
  - Google News RSS (no key)
  - Seeking Alpha RSS (no key)

Normalized into a common `NewsItem` shape, deduped by URL host+title, scored
by recency × source-weight × sentiment-bias. Results live in a small in-memory
cache keyed by ticker so the UI can reopen the drawer without re-hammering
external APIs. Cache TTL is intentionally short (10 min) so the leaderboard
feels live without melting rate limits.

No DB writes — this is a read-through facade. If you want persistence, fold
it into `apps/jobs/src/cfp_jobs/ingestion/` as a scheduled job and read from
Postgres instead.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx

log = logging.getLogger(__name__)


# ---------- common shape ---------------------------------------------------


@dataclass
class NewsItem:
    source: str  # one of: fmp, polygon, yfinance, yahoo-rss, google-rss, seeking-alpha
    ticker: str
    title: str
    url: str
    publisher: str | None
    published_at: datetime
    summary: str | None = None
    image_url: str | None = None
    sentiment: float | None = None  # -1..1 where available

    def dedupe_key(self) -> str:
        # Hash of (lowercased title, stripped of punctuation). Same story
        # across two outlets collapses to one row in the UI.
        norm = re.sub(r"[^a-z0-9]+", " ", self.title.lower()).strip()
        return hashlib.sha1(norm.encode("utf-8")).hexdigest()

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "ticker": self.ticker,
            "title": self.title,
            "url": self.url,
            "publisher": self.publisher,
            "published_at": self.published_at.isoformat(),
            "summary": self.summary,
            "image_url": self.image_url,
            "sentiment": self.sentiment,
            "hours_old": max(
                0.0,
                (datetime.now(timezone.utc) - self.published_at).total_seconds() / 3600.0,
            ),
            "score": _score_item(self),
        }


# Source reputation weights — adjust empirically. FMP and Polygon are
# ticker-tagged at the source so they get a small boost over free-text RSS
# that we tag heuristically.
SOURCE_WEIGHT: dict[str, float] = {
    "fmp": 1.0,
    "polygon": 1.0,
    "yfinance": 0.9,
    "yahoo-rss": 0.8,
    "seeking-alpha": 0.8,
    "google-rss": 0.6,  # noisiest; lots of duplicates
}


def _score_item(item: NewsItem) -> float:
    """Composite score: recency × source × (1 + sentiment bias)."""
    age_h = (datetime.now(timezone.utc) - item.published_at).total_seconds() / 3600.0
    # exp decay with 24h half-life, floored at 0.1.
    recency = max(0.1, 2 ** (-age_h / 24.0))
    weight = SOURCE_WEIGHT.get(item.source, 0.5)
    bias = 1.0
    if item.sentiment is not None:
        # Both very positive and very negative are signal-worthy. Magnitude
        # matters, not sign.
        bias = 1.0 + min(1.0, abs(item.sentiment))
    return recency * weight * bias


# ---------- cache ----------------------------------------------------------


_CACHE_TTL_SEC = 600  # 10 min
_cache: dict[str, tuple[float, list[NewsItem]]] = {}
_cache_lock = asyncio.Lock()


def _cache_get(key: str) -> list[NewsItem] | None:
    rec = _cache.get(key)
    if rec is None:
        return None
    fetched_at, items = rec
    if time.time() - fetched_at > _CACHE_TTL_SEC:
        return None
    return items


def _cache_put(key: str, items: list[NewsItem]) -> None:
    _cache[key] = (time.time(), items)


# ---------- parsers --------------------------------------------------------


def _parse_dt(raw: str | None) -> datetime | None:
    """Best-effort RFC2822 / ISO 8601 parser. Returns UTC datetime or None."""
    if not raw:
        return None
    raw = raw.strip()
    # ISO 8601 (FMP, Polygon)
    try:
        # Python's fromisoformat handles "2026-05-21T13:45:00Z" via the Z swap.
        s = raw.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (ValueError, TypeError):
        pass
    # RFC 2822 (RSS pubDate)
    try:
        from email.utils import parsedate_to_datetime

        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (ValueError, TypeError):
        pass
    return None


# ---------- source fetchers ------------------------------------------------


async def _fetch_fmp(client: httpx.AsyncClient, ticker: str, limit: int) -> list[NewsItem]:
    """FMP /stable/news/stock — ticker-tagged at source."""
    key = os.environ.get("FMP_API_KEY", "")
    if not key:
        return []
    url = "https://financialmodelingprep.com/stable/news/stock"
    try:
        r = await client.get(
            url,
            params={"symbols": ticker, "limit": min(limit, 50), "apikey": key},
            timeout=8.0,
        )
        if r.status_code == 429:
            log.warning("FMP news rate-limited (250/day free tier)")
            return []
        r.raise_for_status()
        rows: list[dict[str, Any]] = r.json() or []
    except Exception as exc:
        log.warning("FMP news fetch failed for %s: %s", ticker, exc)
        return []
    out: list[NewsItem] = []
    for row in rows:
        title = (row.get("title") or "").strip()
        link = row.get("url") or ""
        if not title or not link:
            continue
        dt = _parse_dt(row.get("publishedDate")) or datetime.now(timezone.utc)
        out.append(
            NewsItem(
                source="fmp",
                ticker=ticker.upper(),
                title=title,
                url=link,
                publisher=row.get("site") or row.get("publisher"),
                published_at=dt,
                summary=row.get("text") or None,
                image_url=row.get("image") or None,
            )
        )
    return out


async def _fetch_polygon(
    client: httpx.AsyncClient, ticker: str, limit: int
) -> list[NewsItem]:
    """Polygon /v2/reference/news — ticker-tagged + sentiment when available."""
    key = os.environ.get("POLYGON_API_KEY", "")
    if not key:
        return []
    url = "https://api.polygon.io/v2/reference/news"
    try:
        r = await client.get(
            url,
            params={
                "ticker": ticker,
                "limit": min(limit, 50),
                "order": "desc",
                "sort": "published_utc",
                "apiKey": key,
            },
            timeout=8.0,
        )
        if r.status_code == 429:
            log.warning("Polygon news rate-limited (free tier = 5/min)")
            return []
        r.raise_for_status()
        payload = r.json() or {}
    except Exception as exc:
        log.warning("Polygon news fetch failed for %s: %s", ticker, exc)
        return []
    results = payload.get("results") or []
    out: list[NewsItem] = []
    for row in results:
        title = (row.get("title") or "").strip()
        link = row.get("article_url") or ""
        if not title or not link:
            continue
        dt = _parse_dt(row.get("published_utc")) or datetime.now(timezone.utc)
        # Polygon ships per-insight sentiment when its model has an opinion;
        # average across insights for this ticker.
        sentiment = None
        insights = row.get("insights") or []
        scores = []
        for ins in insights:
            if (ins.get("ticker") or "").upper() == ticker.upper():
                s = ins.get("sentiment")
                if s == "positive":
                    scores.append(0.5)
                elif s == "negative":
                    scores.append(-0.5)
                elif s == "neutral":
                    scores.append(0.0)
        if scores:
            sentiment = sum(scores) / len(scores)
        publisher = (row.get("publisher") or {}).get("name")
        out.append(
            NewsItem(
                source="polygon",
                ticker=ticker.upper(),
                title=title,
                url=link,
                publisher=publisher,
                published_at=dt,
                summary=row.get("description") or None,
                image_url=row.get("image_url") or None,
                sentiment=sentiment,
            )
        )
    return out


def _fetch_yfinance_sync(ticker: str) -> list[NewsItem]:
    """yfinance Ticker.news — free, no key, but blocking."""
    try:
        import yfinance as yf
    except ImportError:
        return []
    try:
        rows = yf.Ticker(ticker).news or []
    except Exception as exc:
        log.warning("yfinance news fetch failed for %s: %s", ticker, exc)
        return []
    out: list[NewsItem] = []
    for row in rows:
        # yfinance flips shape periodically: sometimes flat, sometimes
        # nested under "content". Handle both.
        content = row.get("content") if isinstance(row.get("content"), dict) else row
        title = (content.get("title") or row.get("title") or "").strip()
        link = (
            (content.get("canonicalUrl") or {}).get("url")
            if isinstance(content.get("canonicalUrl"), dict)
            else None
        ) or content.get("link") or row.get("link") or ""
        if not title or not link:
            continue
        # providerPublishTime (unix int) or pubDate (ISO).
        dt: datetime | None = None
        ts = row.get("providerPublishTime") or content.get("providerPublishTime")
        if isinstance(ts, (int, float)) and ts > 0:
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        if dt is None:
            dt = _parse_dt(content.get("pubDate") or row.get("pubDate"))
        if dt is None:
            dt = datetime.now(timezone.utc)
        publisher = content.get("publisher") or row.get("publisher")
        if isinstance(publisher, dict):
            publisher = publisher.get("displayName") or publisher.get("name")
        thumb = content.get("thumbnail") or row.get("thumbnail") or {}
        img = None
        if isinstance(thumb, dict):
            res = thumb.get("resolutions") or []
            if res and isinstance(res, list):
                img = res[0].get("url")
        out.append(
            NewsItem(
                source="yfinance",
                ticker=ticker.upper(),
                title=title,
                url=link,
                publisher=publisher,
                published_at=dt,
                summary=content.get("summary") or None,
                image_url=img,
            )
        )
    return out


async def _fetch_yfinance(ticker: str) -> list[NewsItem]:
    return await asyncio.to_thread(_fetch_yfinance_sync, ticker)


def _parse_rss(xml_text: str, source: str, ticker: str, limit: int) -> list[NewsItem]:
    """Generic RSS 2.0 / Atom parser. Returns up to `limit` items."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        log.warning("RSS parse failed for %s/%s: %s", source, ticker, exc)
        return []
    items: list[NewsItem] = []
    # RSS 2.0: <rss><channel><item>...
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = item.findtext("pubDate") or item.findtext("{http://purl.org/dc/elements/1.1/}date")
        desc = item.findtext("description")
        if not title or not link:
            continue
        dt = _parse_dt(pub) or datetime.now(timezone.utc)
        items.append(
            NewsItem(
                source=source,
                ticker=ticker.upper(),
                title=title,
                url=link,
                publisher=None,
                published_at=dt,
                summary=desc,
            )
        )
        if len(items) >= limit:
            return items
    # Atom: <feed><entry>...
    ns = {"a": "http://www.w3.org/2005/Atom"}
    for entry in root.findall("a:entry", ns):
        title_el = entry.find("a:title", ns)
        link_el = entry.find("a:link", ns)
        pub_el = entry.find("a:updated", ns) or entry.find("a:published", ns)
        title = (title_el.text or "").strip() if title_el is not None else ""
        link = (
            link_el.get("href")
            if link_el is not None and link_el.get("href")
            else ""
        )
        if not title or not link:
            continue
        dt = _parse_dt(pub_el.text if pub_el is not None else None) or datetime.now(
            timezone.utc
        )
        items.append(
            NewsItem(
                source=source,
                ticker=ticker.upper(),
                title=title,
                url=link,
                publisher=None,
                published_at=dt,
                summary=None,
            )
        )
        if len(items) >= limit:
            return items
    return items


async def _fetch_yahoo_rss(
    client: httpx.AsyncClient, ticker: str, limit: int
) -> list[NewsItem]:
    url = "https://feeds.finance.yahoo.com/rss/2.0/headline"
    try:
        r = await client.get(
            url,
            params={"s": ticker, "region": "US", "lang": "en-US"},
            timeout=6.0,
        )
        r.raise_for_status()
    except Exception as exc:
        log.warning("Yahoo RSS fetch failed for %s: %s", ticker, exc)
        return []
    return _parse_rss(r.text, "yahoo-rss", ticker, limit)


async def _fetch_google_rss(
    client: httpx.AsyncClient, ticker: str, limit: int
) -> list[NewsItem]:
    # Quote the $TICKER + "stock" query to bias Google News toward finance
    # context and away from generic mentions of the ticker letters.
    q = quote(f"${ticker} stock")
    url = (
        f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
    )
    try:
        r = await client.get(url, timeout=6.0)
        r.raise_for_status()
    except Exception as exc:
        log.warning("Google News RSS fetch failed for %s: %s", ticker, exc)
        return []
    return _parse_rss(r.text, "google-rss", ticker, limit)


async def _fetch_seeking_alpha(
    client: httpx.AsyncClient, ticker: str, limit: int
) -> list[NewsItem]:
    # SA exposes a per-symbol RSS combining news + opinion analyses.
    url = f"https://seekingalpha.com/api/sa/combined/{ticker.upper()}.xml"
    try:
        r = await client.get(
            url,
            headers={"User-Agent": "Mozilla/5.0 (capital-flow-predictor news aggregator)"},
            timeout=6.0,
        )
        if r.status_code == 403:
            # SA sometimes blocks egress IPs — fail soft.
            return []
        r.raise_for_status()
    except Exception as exc:
        log.warning("Seeking Alpha RSS fetch failed for %s: %s", ticker, exc)
        return []
    return _parse_rss(r.text, "seeking-alpha", ticker, limit)


# ---------- public API -----------------------------------------------------


async def fetch_news_for_ticker(
    ticker: str,
    limit: int = 30,
    sources: list[str] | None = None,
) -> list[NewsItem]:
    """Return up to `limit` deduped, ranked news items for `ticker`.

    Hits the in-process cache when possible. On miss, fans out to every
    configured source in parallel and merges results.
    """
    ticker = ticker.upper().strip()
    if not ticker or not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", ticker):
        return []

    cache_key = f"ticker:{ticker}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached[:limit]

    async with _cache_lock:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached[:limit]

        per_source_limit = min(50, max(limit, 20))
        async with httpx.AsyncClient(
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (capital-flow-predictor news aggregator)"},
        ) as client:
            fetchers: list[asyncio.Future[list[NewsItem]]] = []
            wanted = set(sources) if sources else None

            def want(name: str) -> bool:
                return wanted is None or name in wanted

            if want("fmp"):
                fetchers.append(_fetch_fmp(client, ticker, per_source_limit))
            if want("polygon"):
                fetchers.append(_fetch_polygon(client, ticker, per_source_limit))
            if want("yahoo-rss"):
                fetchers.append(_fetch_yahoo_rss(client, ticker, per_source_limit))
            if want("google-rss"):
                fetchers.append(_fetch_google_rss(client, ticker, per_source_limit))
            if want("seeking-alpha"):
                fetchers.append(_fetch_seeking_alpha(client, ticker, per_source_limit))
            if want("yfinance"):
                fetchers.append(_fetch_yfinance(ticker))

            results = await asyncio.gather(*fetchers, return_exceptions=True)

        merged: list[NewsItem] = []
        for res in results:
            if isinstance(res, Exception):
                log.warning("news source raised: %s", res)
                continue
            merged.extend(res)

        # Dedupe by normalized title hash, keeping the highest-weighted source
        # for each cluster (so the FMP/Polygon copy wins over Google News).
        deduped: dict[str, NewsItem] = {}
        for it in merged:
            key = it.dedupe_key()
            existing = deduped.get(key)
            if existing is None:
                deduped[key] = it
                continue
            if SOURCE_WEIGHT.get(it.source, 0.5) > SOURCE_WEIGHT.get(
                existing.source, 0.5
            ):
                deduped[key] = it

        ranked = sorted(deduped.values(), key=_score_item, reverse=True)
        _cache_put(cache_key, ranked)
        return ranked[:limit]


async def fetch_news_for_tickers(
    tickers: list[str],
    per_ticker_limit: int = 10,
    concurrency: int = 8,
) -> dict[str, list[NewsItem]]:
    """Batch fetch for the chatter leaderboard. Bounded concurrency to keep
    free-tier rate limits sane."""
    sem = asyncio.Semaphore(concurrency)

    async def one(t: str) -> tuple[str, list[NewsItem]]:
        async with sem:
            items = await fetch_news_for_ticker(t, limit=per_ticker_limit)
        return t.upper(), items

    pairs = await asyncio.gather(
        *(one(t) for t in tickers), return_exceptions=False
    )
    return dict(pairs)


# ---------- catalyst classification ----------------------------------------
#
# Mirrors apps/web/lib/catalyst-categories.ts and reddit.py's
# _CATALYST_CATEGORY_RULES. Keep all three in sync. Order matters: more
# specific buckets first so "fda approval" lands in `regulatory` not
# `partnership`.

_CATALYST_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("regulatory", (
        "fda", "approval", "approved", "clinical", "trial", "phase 3",
        "phase 2", "phase iii", "phase ii", "recall", "doj", "antitrust",
        "lawsuit", "sued", "settlement", "ftc", "sec", "investigation",
        "subpoena",
    )),
    ("earnings", (
        "earnings", "beat", "miss", "missed", "guidance", "guide", "guides",
        "eps", "revenue", "raised guidance", "lowered guidance", "raises",
        "lowered", "preannounce", "pre-announce",
    )),
    ("insider", (
        "insider", "form 4", "13d", "13g", "ceo sell", "cfo sell", "ceo buy",
        "insider buy", "insider sell",
    )),
    ("mna", (
        "acquisition", "acquire", "acquires", "acquired", "merger", "merge",
        "buyout", "takeover", "take private", "spinoff", "spin-off",
    )),
    ("partnership", (
        "partnership", "partner", "partners", "deal", "contract", "awarded",
        "supplier", "win", "wins",
    )),
    ("product", (
        "launch", "launches", "release", "released", "unveil", "unveils",
        "announce", "announces", "announced", "reveal", "reveals", "rollout",
    )),
    ("leak", (
        "leak", "leaked", "rumor", "rumored", "scoop", "alleged", "report",
        "reports", "sources say", "according to sources",
    )),
]


def classify_headline(text: str) -> tuple[str, list[str]]:
    """Scan a headline (title + optional summary) for catalyst keywords.

    Returns (primary_category, matched_keywords_in_order). Uses substring
    matching with word-boundary heuristics so "FDA" matches but "INFRARED"
    doesn't fire `fda`. Empty list and "other" for headlines that don't fit
    any bucket — these get filtered out before hitting the catalyst feed.
    """
    if not text:
        return "other", []
    lowered = text.lower()
    matched_by_cat: dict[str, list[str]] = {}
    for cat_id, tokens in _CATALYST_RULES:
        for t in tokens:
            # Word-ish boundary: require non-alphanum on both sides for short
            # tokens, plain substring for multi-word ones (they're inherently
            # specific enough).
            if " " in t:
                if t in lowered:
                    matched_by_cat.setdefault(cat_id, []).append(t)
            else:
                # Cheap word-boundary check without regex compilation overhead.
                idx = 0
                while True:
                    pos = lowered.find(t, idx)
                    if pos < 0:
                        break
                    left_ok = pos == 0 or not lowered[pos - 1].isalnum()
                    end = pos + len(t)
                    right_ok = end == len(lowered) or not lowered[end].isalnum()
                    if left_ok and right_ok:
                        matched_by_cat.setdefault(cat_id, []).append(t)
                        break
                    idx = pos + 1
    if not matched_by_cat:
        return "other", []
    # Pick the most-specific bucket = first category in _CATALYST_RULES that
    # matched. Collect every matched keyword (across all buckets) for display.
    primary = next(c for c, _ in _CATALYST_RULES if c in matched_by_cat)
    all_keywords: list[str] = []
    seen: set[str] = set()
    for _, kws in matched_by_cat.items():
        for k in kws:
            if k not in seen:
                seen.add(k)
                all_keywords.append(k)
    return primary, all_keywords


def score_news_catalyst(
    item: NewsItem,
    matched_keywords: list[str],
    n_tickers: int = 1,
) -> tuple[float, dict[str, Any]]:
    """Compute a catalyst_score on the same scale as Reddit posts.

    Mirrors apps/jobs/.../reddit_rss.py:_catalyst_score:
        base = min(log(1+n_t)*log(1+n_k)/3, 1)
        recency = 1.0 (≤6h) → 0.2 (≥48h) linear
        trust = source weight (proxy for author trust in Reddit case)
    """
    import math

    n_kw = len(matched_keywords)
    if n_kw == 0 or n_tickers == 0:
        return 0.0, {"base": 0.0, "recency": 0.0, "trust": None,
                     "n_tickers": n_tickers, "n_keywords": n_kw}
    base = min(math.log(1 + n_tickers) * math.log(1 + n_kw) / 3.0, 1.0)
    age_h = (datetime.now(timezone.utc) - item.published_at).total_seconds() / 3600.0
    if age_h <= 6:
        recency = 1.0
    elif age_h >= 48:
        recency = 0.2
    else:
        recency = 1.0 - 0.8 * (age_h - 6) / 42.0
    # Source weight → trust proxy, clamped to the same 0.5..1.0 band as Reddit.
    raw_trust = SOURCE_WEIGHT.get(item.source, 0.5)
    trust = max(0.5, min(1.0, raw_trust))
    # Sentiment magnitude as a small multiplier — both strong + and strong -
    # signals are catalyst-worthy.
    sent_boost = 1.0
    if item.sentiment is not None:
        sent_boost = 1.0 + min(0.5, abs(item.sentiment))
    score = base * recency * trust * sent_boost
    return score, {
        "base": base,
        "recency": recency,
        "trust": trust,
        "n_tickers": n_tickers,
        "n_keywords": n_kw,
    }


@dataclass
class TickerNewsAggregate:
    ticker: str
    items: list[NewsItem] = field(default_factory=list)

    @property
    def n_items(self) -> int:
        return len(self.items)

    @property
    def top_score(self) -> float:
        return max((_score_item(i) for i in self.items), default=0.0)

    @property
    def sum_score(self) -> float:
        return sum(_score_item(i) for i in self.items)

    @property
    def newest_hours_old(self) -> float:
        if not self.items:
            return float("inf")
        return min(
            (datetime.now(timezone.utc) - i.published_at).total_seconds() / 3600.0
            for i in self.items
        )


def aggregate(items_by_ticker: dict[str, list[NewsItem]]) -> list[TickerNewsAggregate]:
    return [
        TickerNewsAggregate(ticker=t, items=items)
        for t, items in items_by_ticker.items()
    ]
