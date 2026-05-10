"""Reddit catalyst-keyword feed via RSS.

Free, no OAuth. Each subreddit exposes /r/{name}/new.rss with the latest
~25 posts. We parse each post for:

  1. ALL-CAPS ticker mentions (1-5 chars, validated against the predictor
     universe + S&P 500 + a custom watchlist of small-mid caps the user
     trades, e.g. IREN, IONQ, RGTI, ASTS, RKLB).
  2. Catalyst keywords from a curated list (partnership, leak, rumor, FDA,
     acquisition, beat, guidance, insider, merger, contract, deal).
  3. A composite catalyst_score = log(1 + tickers) x log(1 + keywords) x
     recency_weight, normalized to 0..1.

Designed to surface posts like "Apple-Intel partnership rumors heating up"
hours before official news — exactly what mention-count tracking misses.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable
from datetime import UTC, datetime
from xml.etree import ElementTree as ET

import httpx
import psycopg

from cfp_jobs.db import connect

log = logging.getLogger(__name__)

# Subreddits we monitor for catalyst chatter. Excluded WSB by default —
# too much meme noise; keyword filter alone produces high false-positive
# rate. Add it back if needed.
SUBREDDITS = ("stocks", "investing", "options", "SecurityAnalysis", "ValueInvesting")

# Catalyst keywords. Lowercase, matched as whole words. Conservative —
# common meme phrases excluded so the feed isn't drowned in noise.
KEYWORDS: tuple[str, ...] = (
    "partnership", "partner with", "deal with", "agreement with",
    "acquisition", "acquired", "acquires", "acquiring", "buyout", "takeover",
    "merger", "merge with",
    "spinoff", "spin-off", "spin off",
    "fda approval", "fda approves", "fda clearance",
    "phase 3", "phase iii", "trial results", "trial fail",
    "guidance", "raised guidance", "lowered guidance",
    "earnings beat", "beat estimates", "missed estimates",
    "rumor", "rumored", "rumour",
    "leak", "leaked", "leaks",
    "insider buy", "insider selling", "insider purchase",
    "contract", "contract win", "awarded",
    "investigation", "lawsuit", "settlement",
    "ceo replaced", "ceo steps down", "new ceo",
    "ipo", "going public",
    "buyback", "share repurchase", "dividend hike",
    "halt", "halted", "delisted",
)

# Ticker-extraction regex: 1-5 uppercase letters, optionally with $ prefix,
# bounded by whitespace/punctuation. We then filter against a known-ticker
# whitelist to avoid matching common all-caps words like "I", "A", "ETF".
_TICKER_RE = re.compile(r"\$?\b([A-Z]{1,5})\b")

# Common all-caps words to exclude from ticker matching (would otherwise
# false-positive on every Reddit post).
_TICKER_BLACKLIST: frozenset[str] = frozenset({
    "I", "A", "ETF", "EPS", "ER", "PE", "PR", "DD", "TLDR", "FYI", "LOL",
    "IMO", "ATH", "ATL", "OG", "USA", "EU", "UK", "CEO", "CFO", "COO", "CTO",
    "FED", "CPI", "GDP", "ROE", "ROA", "ROI", "FCF", "OP", "EOD", "AH", "PM",
    "AI", "VR", "AR", "API", "URL", "FAQ", "RIP", "WTF", "SEC", "FDA", "DOJ",
    "NYSE", "NASDAQ", "SP", "NDX", "RUT", "VIX", "IPO", "M&A", "P&L",
    "USD", "EUR", "GBP", "CAD", "JPY", "CNY",
    "YOLO", "FOMO", "HODL", "MOON", "PUMP", "DUMP", "BUY", "SELL", "HOLD",
    "TLT", "GLD", "SLV", "USO",  # actual tickers but ETFs we'd rather not catalyst-tag
})


def _load_ticker_universe(conn: psycopg.Connection) -> set[str]:
    """Build the allowed-ticker set from prices_daily + uw_etf_holdings.
    We only flag tickers we have real data for."""
    with conn.cursor() as cur:
        cur.execute("SELECT DISTINCT symbol FROM prices_daily")
        prices = {r[0] for r in cur.fetchall()}
        cur.execute("SELECT DISTINCT ticker FROM uw_etf_holdings")
        holdings = {r[0] for r in cur.fetchall()}
    return prices | holdings


def _extract_tickers(text: str, universe: set[str]) -> list[str]:
    found: set[str] = set()
    for m in _TICKER_RE.finditer(text):
        tok = m.group(1).upper()
        if tok in _TICKER_BLACKLIST:
            continue
        if tok in universe:
            found.add(tok)
    return sorted(found)


def _extract_keywords(text: str) -> list[str]:
    lower = text.lower()
    hits: list[str] = []
    for kw in KEYWORDS:
        if kw in lower:
            hits.append(kw)
    return hits


def _catalyst_score(n_tickers: int, n_keywords: int, hours_old: float) -> float:
    """Composite score 0..1. Heavier on multi-ticker / multi-keyword posts.

    Recency: full weight if posted in last 6h, decays linearly to 0.2 at 48h."""
    import math
    if n_tickers == 0 or n_keywords == 0:
        return 0.0
    base = math.log(1 + n_tickers) * math.log(1 + n_keywords)
    # Normalize: most posts will be 1-2 tickers x 1-2 keywords -> base ~0.5-1.5
    # Cap base at 3.0 (3 tickers x 3 keywords) for the upper edge.
    base_norm = min(base / 3.0, 1.0)
    if hours_old <= 6:
        recency = 1.0
    elif hours_old >= 48:
        recency = 0.2
    else:
        recency = 1.0 - 0.8 * (hours_old - 6) / 42.0
    return base_norm * recency


def _parse_rss(xml_text: str) -> list[dict]:
    """Reddit RSS uses Atom format. Each entry has id/published/author/title/
    content. We extract id (t3_xxxx), title, content (HTML in <content>),
    permalink + url."""
    ns = {"a": "http://www.w3.org/2005/Atom"}
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        log.warning("RSS parse error: %s", e)
        return []
    entries: list[dict] = []
    for entry in root.findall("a:entry", ns):
        eid_el = entry.find("a:id", ns)
        title_el = entry.find("a:title", ns)
        content_el = entry.find("a:content", ns)
        published_el = entry.find("a:published", ns)
        author_el = entry.find("a:author/a:name", ns)
        link_el = entry.find("a:link", ns)
        if eid_el is None or title_el is None or published_el is None:
            continue
        # Reddit IDs come back as "t3_xxxx" or as full URI; normalize
        eid_raw = eid_el.text or ""
        eid = eid_raw.rsplit("/", 1)[-1] if "/" in eid_raw else eid_raw
        # Strip HTML from content for keyword matching
        content_html = content_el.text if content_el is not None else ""
        content_text = re.sub(r"<[^>]+>", " ", content_html or "") if content_html else ""
        try:
            published = datetime.fromisoformat((published_el.text or "").replace("Z", "+00:00"))
        except ValueError:
            continue
        permalink = link_el.attrib.get("href") if link_el is not None else None
        entries.append({
            "id": eid,
            "title": title_el.text or "",
            "body": content_text,
            "published": published,
            "author": author_el.text if author_el is not None else None,
            "permalink": permalink,
            "url": permalink,
        })
    return entries


def fetch_subreddit(client: httpx.Client, sub: str, limit: int = 50) -> list[dict]:
    url = f"https://www.reddit.com/r/{sub}/new.rss?limit={limit}"
    headers = {"User-Agent": "cfp-bot/0.1 (Capital Flow Predictor catalyst feed)"}
    try:
        r = client.get(url, headers=headers, timeout=20.0)
        if r.status_code != 200:
            log.warning("reddit RSS %s -> %s", sub, r.status_code)
            return []
        return _parse_rss(r.text)
    except Exception as e:
        log.warning("reddit RSS %s failed: %s", sub, e)
        return []


_UPSERT_SQL = """
    INSERT INTO reddit_posts (
        id, created_at, subreddit, author, title, body, permalink, url,
        upvotes, num_comments, flair, tickers, keywords, catalyst_score, last_fetched
    ) VALUES (
        %(id)s, %(created_at)s, %(subreddit)s, %(author)s, %(title)s, %(body)s,
        %(permalink)s, %(url)s, %(upvotes)s, %(num_comments)s, %(flair)s,
        %(tickers)s, %(keywords)s, %(catalyst_score)s, NOW()
    ) ON CONFLICT (id) DO UPDATE SET
        body = EXCLUDED.body,
        upvotes = COALESCE(EXCLUDED.upvotes, reddit_posts.upvotes),
        num_comments = COALESCE(EXCLUDED.num_comments, reddit_posts.num_comments),
        tickers = EXCLUDED.tickers,
        keywords = EXCLUDED.keywords,
        catalyst_score = EXCLUDED.catalyst_score,
        last_fetched = NOW()
"""


def ingest(database_url: str, subreddits: Iterable[str] = SUBREDDITS, min_score: float = 0.05) -> dict:
    """Pull RSS for each subreddit, extract tickers + keywords, score,
    persist posts that score above `min_score`. Returns summary dict."""
    counts: dict[str, int] = {}
    n_filtered = 0
    n_kept = 0
    now = datetime.now(UTC)
    with httpx.Client() as client, connect(database_url) as conn:
        universe = _load_ticker_universe(conn)
        for sub in subreddits:
            entries = fetch_subreddit(client, sub)
            kept = 0
            with conn.cursor() as cur:
                for e in entries:
                    text = f"{e['title']}\n{e['body']}"
                    tickers = _extract_tickers(text, universe)
                    keywords = _extract_keywords(text)
                    if not tickers or not keywords:
                        n_filtered += 1
                        continue
                    hours_old = max(0.0, (now - e["published"]).total_seconds() / 3600)
                    score = _catalyst_score(len(tickers), len(keywords), hours_old)
                    if score < min_score:
                        n_filtered += 1
                        continue
                    cur.execute(_UPSERT_SQL, {
                        "id": e["id"],
                        "created_at": e["published"],
                        "subreddit": sub,
                        "author": e["author"],
                        "title": e["title"],
                        "body": e["body"][:4000] if e["body"] else None,
                        "permalink": e["permalink"],
                        "url": e["url"],
                        "upvotes": None,        # RSS doesn't expose upvotes
                        "num_comments": None,
                        "flair": None,
                        "tickers": tickers,
                        "keywords": keywords,
                        "catalyst_score": score,
                    })
                    kept += 1
            counts[sub] = len(entries)
            n_kept += kept
        # Prune: drop scored posts older than 7 days to keep the table small.
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM reddit_posts WHERE created_at < NOW() - INTERVAL '7 days'"
            )
        conn.commit()
    return {
        "per_subreddit_pulled": counts,
        "n_filtered_out": n_filtered,
        "n_kept": n_kept,
    }
