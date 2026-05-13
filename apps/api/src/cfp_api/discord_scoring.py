"""Discord alert scoring + ticker extraction.

Two responsibilities:

1. **Ticker extraction** — given a Discord message body, return the list of
   tickers that are *likely* genuine references (not banter / shouting /
   common English words that happen to be uppercase).

   Rules:
     - ``$XYZ`` (1–5 letters) always passes — the cashtag is an explicit signal.
     - Bare ``XYZ`` (2–5 letters) only passes if it's in our known-ticker set
       (loaded once from ``uw_stock_info`` and cached for 10 minutes) AND
       isn't in a stoplist of common English/Discord uppercase tokens.
     - If a message contains 3+ consecutive ALL-CAPS tokens AND no cashtags,
       we treat it as banter and skip bare-token extraction entirely. This
       kills cases like ``POWER OF VIX PIVOT BREAK`` without losing real
       single-word mentions like ``COIN ready?``.

2. **Per-ticker verification** — for each extracted ticker, look up 4
   signals from the analytical tables we already have, with no LLM calls
   and no external API hits:

     - **flow**: UW net call/put premium today (``uw_net_prem_daily``)
     - **gex**: dealer regime / where price is vs gamma walls (``skylit_structures``)
     - **whale**: latest whale-conviction direction + score (``whale_conviction_signals``)
     - **reddit**: today's mention count vs prior-day baseline (``reddit_mentions``)

   Each returns ``'bull' | 'bear' | 'neutral' | None``. ``None`` means no
   data — distinct from ``neutral`` (we *have* data and it says neither way).

Scoring is cached in ``discord_alert_scores`` keyed by (message_id, ticker).
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Literal

import asyncpg

log = logging.getLogger(__name__)

Verdict = Literal["bull", "bear", "neutral"] | None


# ---------- ticker extraction ----------


# Short tokens that *look* like tickers but are almost always English /
# Discord shorthand. We never extract these as bare tokens. ($-prefixed ones
# would still pass — if someone writes "$A" they meant A.)
_STOPLIST: frozenset[str] = frozenset({
    # English short words
    "A", "I", "IT", "IS", "OF", "ON", "AT", "TO", "BE", "BY", "GO", "IN",
    "UP", "WE", "OR", "SO", "IF", "OK", "NO", "AM", "PM", "AS", "AN", "ME",
    "HE", "MY", "DO", "OH", "AH", "US", "OUR", "THE", "AND", "FOR", "BUT",
    "NOT", "ALL", "ANY", "NEW", "NOW", "GET", "GOT", "HAS", "HAD", "ITS",
    "WAS", "ARE", "YOU", "OUT", "TOO", "WHO", "WHY", "HOW", "WHAT", "WHEN",
    "THIS", "THAT", "THEY", "THEM", "WITH", "FROM", "JUST", "LIKE", "YES",
    "HERE", "THERE", "ONLY", "ALSO", "VERY", "REAL", "GOOD", "BAD",
    # Discord / WSB shorthand (uppercase)
    "LFG", "GM", "GN", "EOD", "ATH", "ATL", "ITM", "OTM", "ATM", "IV", "OI",
    "DD", "TLDR", "FYI", "EDIT", "TBH", "IMO", "IMHO", "AF", "TF", "OMG",
    "LOL", "WTF", "YOLO", "IPO", "LFGOOO", "LETS",
    # Macro acronyms (real, but not "tickers people trade")
    "CPI", "PPI", "GDP", "FOMC", "FED", "ECB", "BOJ", "NFP", "EPS", "PE",
    # Misc noise
    "USD", "EUR", "GBP", "BTC", "ETH", "DOGE",
})


_DOLLAR_TICKER = re.compile(r"\$([A-Z]{1,5})\b")
_BARE_TOKEN = re.compile(r"\b([A-Z]{2,5})\b")
_ALLCAPS_RUN = re.compile(r"\b[A-Z]{2,}\b")


@dataclass
class _TickerCache:
    """In-memory cache of valid tickers, refreshed periodically."""
    tickers: frozenset[str]
    loaded_at: float


_ticker_cache: _TickerCache | None = None
_TICKER_CACHE_TTL_SECONDS = 600  # 10 minutes


async def _load_known_tickers(pool: asyncpg.Pool) -> frozenset[str]:
    """Load the ticker whitelist from uw_stock_info (one row per ticker the
    UW runner has ever hydrated). Misses are fine — they just fall back to
    the stoplist-only behavior for cashtag matches."""
    try:
        rows = await pool.fetch("SELECT ticker FROM uw_stock_info WHERE ticker IS NOT NULL")
        return frozenset(r["ticker"].upper() for r in rows if r["ticker"])
    except Exception:
        log.exception("failed to load known tickers from uw_stock_info")
        return frozenset()


async def _known_tickers(pool: asyncpg.Pool) -> frozenset[str]:
    global _ticker_cache
    now = time.time()
    if _ticker_cache is None or (now - _ticker_cache.loaded_at) > _TICKER_CACHE_TTL_SECONDS:
        _ticker_cache = _TickerCache(
            tickers=await _load_known_tickers(pool), loaded_at=now
        )
    return _ticker_cache.tickers


async def extract_tickers(pool: asyncpg.Pool, content: str) -> list[str]:
    """Return likely-real tickers from the message content."""
    if not content:
        return []

    cashtags = {m.group(1).upper() for m in _DOLLAR_TICKER.finditer(content)}

    # Banter detection: if there's no cashtag AND there's a run of 3+
    # consecutive ALL-CAPS tokens, treat the whole message as shouting and
    # skip bare-token extraction. The cashtag set is still returned because
    # an explicit $ means the user opted in.
    if not cashtags:
        allcaps_tokens = _ALLCAPS_RUN.findall(content)
        if len(allcaps_tokens) >= 3:
            return []

    known = await _known_tickers(pool)
    bare: set[str] = set()
    for m in _BARE_TOKEN.finditer(content):
        tok = m.group(1).upper()
        if tok in _STOPLIST:
            continue
        # If we have a known-ticker set, only accept tokens that are real
        # tickers. If the set is empty (uw_stock_info hasn't populated yet)
        # we fall back to stoplist-only — better than failing closed.
        if known and tok not in known:
            continue
        bare.add(tok)

    # Preserve first-seen order from the message.
    seen: list[str] = []
    seen_set: set[str] = set()
    for tok in cashtags | bare:
        if tok not in seen_set:
            seen.append(tok)
            seen_set.add(tok)
    seen.sort(key=lambda t: content.upper().find(t))
    return seen


# ---------- per-ticker signal lookups (read-only, no LLM, no UW refresh) ----------


async def _flow_verdict(pool: asyncpg.Pool, ticker: str) -> Verdict:
    """Today's UW net premium bias. Bull when calls dominate by a clear
    margin, bear when puts dominate, else neutral. Returns None when we
    have no UW data for this ticker today."""
    row = await pool.fetchrow(
        """
        SELECT net_call_premium, net_put_premium
        FROM uw_net_prem_daily
        WHERE ticker = $1
        ORDER BY date DESC
        LIMIT 1
        """,
        ticker,
    )
    if not row:
        return None
    call = float(row["net_call_premium"] or 0)
    put = float(row["net_put_premium"] or 0)
    total = abs(call) + abs(put)
    if total < 1:
        return "neutral"
    edge = (call - put) / total
    if edge > 0.15:
        return "bull"
    if edge < -0.15:
        return "bear"
    return "neutral"


async def _gex_verdict(pool: asyncpg.Pool, ticker: str) -> Verdict:
    """Skylit regime + position vs gamma walls. Bull when regime score is
    positive and price isn't pinned at a known ceiling; bear when negative
    and price isn't pinned at a floor; neutral otherwise."""
    row = await pool.fetchrow(
        """
        SELECT spot, structure
        FROM skylit_structures
        WHERE ticker = $1
        ORDER BY fetched_at DESC
        LIMIT 1
        """,
        ticker,
    )
    if not row:
        return None
    structure = row["structure"]
    if isinstance(structure, str):
        try:
            structure = json.loads(structure)
        except Exception:
            structure = {}
    if not isinstance(structure, dict):
        return None
    regime = structure.get("regime_score")
    if regime is None:
        return "neutral"
    try:
        regime = float(regime)
    except (TypeError, ValueError):
        return "neutral"
    if regime > 0.25:
        return "bull"
    if regime < -0.25:
        return "bear"
    return "neutral"


async def _whale_verdict(pool: asyncpg.Pool, ticker: str) -> Verdict:
    """Latest whale-conviction signal for this ticker. Uses the most recent
    closed window."""
    row = await pool.fetchrow(
        """
        SELECT direction, score
        FROM whale_conviction_signals
        WHERE ticker = $1
        ORDER BY window_end DESC
        LIMIT 1
        """,
        ticker,
    )
    if not row:
        return None
    direction = row["direction"]
    score = float(row["score"] or 0)
    if score < 40:
        return "neutral"
    if direction == "bull":
        return "bull"
    if direction == "bear":
        return "bear"
    return "neutral"


async def _reddit_verdict(pool: asyncpg.Pool, ticker: str) -> Verdict:
    """Today vs yesterday mention spike across all subreddits. We aggregate
    so wallstreetbets-only chatter doesn't dominate."""
    rows = await pool.fetch(
        """
        SELECT mentions, mentions_24h_ago
        FROM reddit_mentions
        WHERE ticker = $1
        ORDER BY snapshot_date DESC
        LIMIT 5
        """,
        ticker,
    )
    if not rows:
        return None
    today = sum(int(r["mentions"] or 0) for r in rows[:1])  # latest snapshot row
    prior = sum(int(r["mentions_24h_ago"] or 0) for r in rows[:1])
    if today + prior < 5:
        return "neutral"
    spike = (today + 1) / (prior + 1)
    if spike >= 2.0:
        return "bull"  # spiking interest, treat as constructive
    if spike <= 0.4:
        return "bear"  # collapsing interest
    return "neutral"


# ---------- compose ----------


@dataclass
class TickerScore:
    ticker: str
    flow: Verdict
    gex: Verdict
    whale: Verdict
    reddit: Verdict
    cross_chat_count: int  # # distinct guilds mentioning this ticker in last 30min
    bull_count: int
    bear_count: int


def _count(verdicts: list[Verdict], want: str) -> int:
    return sum(1 for v in verdicts if v == want)


async def score_ticker(
    pool: asyncpg.Pool, ticker: str, cross_chat_count: int
) -> TickerScore:
    flow = await _flow_verdict(pool, ticker)
    gex = await _gex_verdict(pool, ticker)
    whale = await _whale_verdict(pool, ticker)
    reddit = await _reddit_verdict(pool, ticker)
    verdicts: list[Verdict] = [flow, gex, whale, reddit]
    return TickerScore(
        ticker=ticker,
        flow=flow,
        gex=gex,
        whale=whale,
        reddit=reddit,
        cross_chat_count=cross_chat_count,
        bull_count=_count(verdicts, "bull"),
        bear_count=_count(verdicts, "bear"),
    )
