"""Reddit mention tracking via Apewisdom (free, no OAuth).

Apewisdom polls a fixed set of subreddits and exposes daily 24h mention
counts + upvotes per ticker. We snapshot once a day per subreddit so the
agent ensemble can detect:

  - Mention spike ratio (today vs 7d avg) — flags retail discovery
  - Rank momentum (today's rank vs 24h ago) — confirms direction
  - Asymmetry signals: high chatter + bullish technicals = contrarian
    warning; low chatter + bullish technicals = stealth setup

Endpoints:
  GET https://apewisdom.io/api/v1.0/filter/{filter}/page/{page}
    filters: 'all-stocks', 'wallstreetbets', 'stocks', 'options', 'investing',
             'cryptos', 'all-crypto'
    paged 50 results per page; 'all-stocks' has ~1100 tickers across ~12 pages.

No API key, generous rate limits. We pull a few subreddits + ~3 pages each
to cover the top ~150 names — enough for the predictor universe.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import UTC, date, datetime

import httpx
import psycopg

from cfp_jobs.db import connect

log = logging.getLogger(__name__)

BASE_URL = "https://apewisdom.io/api/v1.0"

# Subreddits we care about. 'all-stocks' is the union; the others give us a
# per-source breakdown so we can tell WSB-only hype from broader retail
# attention.
SUBREDDITS = ("all-stocks", "wallstreetbets", "stocks", "options", "investing")

# Pull this many pages (50 per page) per subreddit. 3 pages = top 150
# tickers — covers everything in our predictor universe with margin.
PAGES_PER_SUBREDDIT = 3


def _to_int(v: object) -> int | None:
    if v is None:
        return None
    try:
        return int(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def fetch_subreddit_page(client: httpx.Client, sub: str, page: int) -> list[dict]:
    url = f"{BASE_URL}/filter/{sub}/page/{page}"
    r = client.get(url, timeout=20.0)
    if r.status_code == 429:
        log.warning("apewisdom rate-limited on %s page %s", sub, page)
        return []
    r.raise_for_status()
    body = r.json()
    return body.get("results", []) or []


def _upsert_rows(
    conn: psycopg.Connection,
    snapshot_date: date,
    sub: str,
    rows: Iterable[dict],
) -> int:
    sql = """
        INSERT INTO reddit_mentions (
            snapshot_date, ticker, subreddit, rank, mentions, upvotes,
            rank_24h_ago, mentions_24h_ago, name, last_fetched
        ) VALUES (
            %(snapshot_date)s, %(ticker)s, %(subreddit)s, %(rank)s,
            %(mentions)s, %(upvotes)s, %(rank_24h_ago)s, %(mentions_24h_ago)s,
            %(name)s, NOW()
        ) ON CONFLICT (snapshot_date, ticker, subreddit) DO UPDATE SET
            rank = EXCLUDED.rank,
            mentions = EXCLUDED.mentions,
            upvotes = EXCLUDED.upvotes,
            rank_24h_ago = EXCLUDED.rank_24h_ago,
            mentions_24h_ago = EXCLUDED.mentions_24h_ago,
            name = EXCLUDED.name,
            last_fetched = NOW()
    """
    n = 0
    with conn.cursor() as cur:
        for r in rows:
            ticker = (r.get("ticker") or "").strip().upper()
            if not ticker:
                continue
            cur.execute(
                sql,
                {
                    "snapshot_date": snapshot_date,
                    "ticker": ticker,
                    "subreddit": sub,
                    "rank": _to_int(r.get("rank")),
                    "mentions": _to_int(r.get("mentions")),
                    "upvotes": _to_int(r.get("upvotes")),
                    "rank_24h_ago": _to_int(r.get("rank_24h_ago")),
                    "mentions_24h_ago": _to_int(r.get("mentions_24h_ago")),
                    "name": r.get("name"),
                },
            )
            n += 1
    return n


def ingest(database_url: str, subreddits: Iterable[str] = SUBREDDITS, pages: int = PAGES_PER_SUBREDDIT) -> dict:
    """Snapshot today's Apewisdom rankings for each subreddit.

    Idempotent on (snapshot_date, ticker, subreddit) so re-running within
    the same day refreshes the latest counts."""
    today = datetime.now(UTC).date()
    counts: dict[str, int] = {}
    with httpx.Client() as client, connect(database_url) as conn:
        for sub in subreddits:
            n_total = 0
            for page in range(1, pages + 1):
                try:
                    rows = fetch_subreddit_page(client, sub, page)
                except Exception as e:
                    log.warning("apewisdom %s page %d failed: %s", sub, page, e)
                    continue
                if not rows:
                    break
                n_total += _upsert_rows(conn, today, sub, rows)
            counts[sub] = n_total
        conn.commit()
    return counts
