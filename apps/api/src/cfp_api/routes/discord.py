"""Discord alerts feed.

GET  /v1/discord/messages   — recent captured messages, newest first.
                              Filter by guild_name / channel_name / since.
GET  /v1/discord/sources    — configured (guild, channel) allowlist.
POST /v1/discord/sources    — add an entry to the allowlist.
DELETE /v1/discord/sources/{id} — remove an entry.

The ingestion side (apps/discord_listener) writes to discord_messages on its
own; the API only reads from it. Sources, on the other hand, are owned by the
UI — listener reloads the allowlist every 60s.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from cfp_api.db import get_pool
from cfp_api.discord_scoring import (
    ParsedPlay,
    TickerScore,
    Verdict,
    extract_tickers,
    parse_plays,
    score_ticker,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/discord", tags=["discord"])

# SSE lives on a separate router so it can accept the API key via query
# string — EventSource (browser API) can't set custom headers, so the
# standard Bearer/X-API-Key dependency that PROTECTED applies wouldn't work
# here. The stream router gets its own minimal auth check below.
stream_router = APIRouter(prefix="/v1/discord", tags=["discord"])


# ---------- response models ----------


class DiscordTickerScore(BaseModel):
    ticker: str
    # 'bull' | 'bear' | 'neutral' | None (None = no data for that signal)
    flow: str | None
    gex: str | None
    whale: str | None
    reddit: str | None
    cross_chat_count: int       # # distinct guilds mentioning this ticker in last 30min
    bull_count: int
    bear_count: int
    in_watchlist: bool = False  # ticker is in the user's custom_watchlist
    first_mover: bool = False   # this guild was first to mention this ticker today
    # P&L populated by the score_discord_plays job in apps/jobs (wave 2).
    side: str | None = None              # 'call' | 'put' | 'long' | 'short' | 'unknown'
    strike: float | None = None
    expiry: str | None = None            # ISO date
    entry_price: float | None = None
    entry_underlying: float | None = None
    current_underlying: float | None = None
    pnl_pct_underlying: float | None = None
    status: str | None = None            # 'open' | 'win_itm' | 'loss_otm' | 'expired_unknown'


class DiscordAuthorStats(BaseModel):
    author_id: str
    author_name: str
    total_plays: int               # all plays we've parsed for this author
    resolved_plays: int            # plays whose expiry has passed (win_itm or loss_otm)
    wins: int
    losses: int
    win_rate: float | None         # wins / resolved_plays, NULL when resolved < 5
    avg_pnl_pct: float | None      # mean direction-adjusted spot move
    lookback_days: int


class DiscordAuthorsResponse(BaseModel):
    authors: list[DiscordAuthorStats]


class DiscordMessage(BaseModel):
    message_id: str               # snowflakes can exceed JS safe-int range
    guild_id: str
    guild_name: str
    channel_id: str
    channel_name: str
    thread_id: str | None = None
    thread_name: str | None = None
    author_id: str
    author_name: str
    author_is_bot: bool
    content: str
    attachment_urls: list[str]
    posted_at: datetime
    tickers: list[str] = []                       # server-extracted, validated
    scores: list[DiscordTickerScore] = []         # one per ticker
    confluence: int = 0                           # max(bull_count, bear_count) across tickers
    has_parsed_play: bool = False                 # at least one ticker has a strike or side
    author_stats: DiscordAuthorStats | None = None  # null until the author has any plays


class DiscordMessagesResponse(BaseModel):
    messages: list[DiscordMessage]
    total: int


class DiscordSource(BaseModel):
    id: int
    guild_name: str
    channel_name: str
    label: str | None
    include_threads: bool
    enabled: bool
    created_at: datetime


class DiscordSourcesResponse(BaseModel):
    sources: list[DiscordSource]


class DiscordSourceCreate(BaseModel):
    guild_name: str = Field(min_length=1, max_length=128)
    channel_name: str = Field(min_length=1, max_length=128)
    label: str | None = Field(default=None, max_length=128)
    include_threads: bool = True


class InventoryChannel(BaseModel):
    channel_id: str
    channel_name: str
    is_thread: bool


class InventoryGuild(BaseModel):
    guild_id: str
    guild_name: str
    channels: list[InventoryChannel]


class DiscordInventoryResponse(BaseModel):
    guilds: list[InventoryGuild]
    refreshed_at: datetime | None


# ---------- routes ----------


@router.get("/messages", response_model=DiscordMessagesResponse)
async def get_messages(
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    since: Annotated[datetime | None, Query()] = None,
    guild_name: Annotated[str | None, Query()] = None,
    channel_name: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query(description="case-insensitive substring filter on content")] = None,
) -> DiscordMessagesResponse:
    pool = get_pool()

    where: list[str] = []
    params: list = []
    if since is not None:
        params.append(since)
        where.append(f"posted_at > ${len(params)}")
    if guild_name:
        params.append(guild_name)
        where.append(f"guild_name = ${len(params)}")
    if channel_name:
        params.append(channel_name)
        where.append(f"channel_name = ${len(params)}")
    if q:
        params.append(f"%{q}%")
        where.append(f"content ILIKE ${len(params)}")

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    params.append(limit)
    limit_param = f"${len(params)}"

    rows = await pool.fetch(
        f"""
        SELECT message_id, guild_id, guild_name, channel_id, channel_name,
               thread_id, thread_name, author_id, author_name, author_is_bot,
               content, attachment_urls, posted_at
        FROM discord_messages
        {where_sql}
        ORDER BY posted_at DESC
        LIMIT {limit_param}
        """,
        *params,
    )

    # First pass: build base messages and extract tickers per message.
    base: list[tuple[DiscordMessage, list[str]]] = []
    all_tickers: set[str] = set()
    for r in rows:
        msg = DiscordMessage(
            message_id=str(r["message_id"]),
            guild_id=str(r["guild_id"]),
            guild_name=r["guild_name"],
            channel_id=str(r["channel_id"]),
            channel_name=r["channel_name"],
            thread_id=str(r["thread_id"]) if r["thread_id"] is not None else None,
            thread_name=r["thread_name"],
            author_id=str(r["author_id"]),
            author_name=r["author_name"],
            author_is_bot=r["author_is_bot"],
            content=r["content"],
            attachment_urls=_coerce_urls(r["attachment_urls"]),
            posted_at=r["posted_at"],
        )
        tickers = await extract_tickers(pool, msg.content)
        msg.tickers = tickers
        all_tickers.update(tickers)
        base.append((msg, tickers))

    # Cross-server confluence: for each ticker we saw in the result set,
    # count distinct guilds that mentioned it within the last 30 minutes.
    # One query over the recent message window — cheap.
    cross_counts: dict[str, int] = {t: 0 for t in all_tickers}
    if all_tickers:
        cross_counts = await _compute_cross_chat_counts(pool, all_tickers)

    # Watchlist + first-mover lookups (cheap, both single queries).
    watchlist_set = await _load_watchlist_tickers(pool)
    first_mover_by_ticker = await _compute_first_movers(pool, all_tickers)

    # Persist any unparsed plays so the apps/jobs worker can backfill price
    # snapshots. Plays already in the table are left untouched — the worker
    # owns updates after capture.
    await _persist_parsed_plays(pool, base)

    # Pull current play state (P&L etc.) for every (message, ticker).
    plays_state = await _load_plays_state(pool, base)

    # Author trust stats — one batch query covering every distinct author
    # in the response. Authors with no plays yet get None.
    author_ids = {int(msg.author_id) for msg, _ in base}
    author_stats_by_id = await _load_author_stats(pool, author_ids)

    # Score each (message, ticker) pair, using the discord_alert_scores
    # cache when fresh (<10min) and recomputing otherwise.
    scores_by_msg: dict[int, list[DiscordTickerScore]] = {}
    for msg, tickers in base:
        if not tickers:
            scores_by_msg[int(msg.message_id)] = []
            continue
        out: list[DiscordTickerScore] = []
        for t in tickers:
            cached = await _fetch_cached_score(pool, int(msg.message_id), t)
            if cached is None:
                fresh = await score_ticker(pool, t, cross_counts.get(t, 0))
                await _persist_score(pool, int(msg.message_id), fresh)
                ts = _to_pydantic(fresh)
            else:
                cached.cross_chat_count = cross_counts.get(t, 0)
                ts = cached
            # Enrich with watchlist + first-mover + play state.
            ts.in_watchlist = t in watchlist_set
            ts.first_mover = first_mover_by_ticker.get(t) == int(msg.guild_id)
            play = plays_state.get((int(msg.message_id), t))
            if play is not None:
                ts.side = play.get("side")
                ts.strike = play.get("strike")
                ts.expiry = (
                    play["expiry"].isoformat()
                    if play.get("expiry") is not None
                    else None
                )
                ts.entry_price = play.get("entry_price")
                ts.entry_underlying = play.get("entry_underlying")
                ts.current_underlying = play.get("current_underlying")
                ts.pnl_pct_underlying = play.get("pnl_pct_underlying")
                ts.status = play.get("status")
            out.append(ts)
        scores_by_msg[int(msg.message_id)] = out

    # Finalize messages: attach scores + composite confluence + has_parsed_play
    # + author stats.
    messages: list[DiscordMessage] = []
    for msg, _t in base:
        msg.scores = scores_by_msg[int(msg.message_id)]
        if msg.scores:
            msg.confluence = max(
                max(s.bull_count, s.bear_count) for s in msg.scores
            )
            msg.has_parsed_play = any(
                s.side and s.side != "unknown" or s.strike is not None
                for s in msg.scores
            )
        else:
            msg.confluence = 0
            msg.has_parsed_play = False
        msg.author_stats = author_stats_by_id.get(int(msg.author_id))
        messages.append(msg)

    total_row = await pool.fetchrow("SELECT COUNT(*) AS n FROM discord_messages")
    return DiscordMessagesResponse(messages=messages, total=total_row["n"] if total_row else 0)


# ---------- scoring cache helpers ----------


_SCORE_TTL_SECONDS = 600  # 10 minutes


async def _fetch_cached_score(
    pool, message_id: int, ticker: str
) -> DiscordTickerScore | None:
    row = await pool.fetchrow(
        """
        SELECT flow_verdict, gex_verdict, whale_verdict, reddit_verdict,
               cross_chat_count, bull_count, bear_count, scored_at
        FROM discord_alert_scores
        WHERE message_id = $1 AND ticker = $2
        """,
        message_id,
        ticker,
    )
    if not row:
        return None
    age = (datetime.now(timezone.utc) - row["scored_at"]).total_seconds()
    if age > _SCORE_TTL_SECONDS:
        return None
    return DiscordTickerScore(
        ticker=ticker,
        flow=row["flow_verdict"],
        gex=row["gex_verdict"],
        whale=row["whale_verdict"],
        reddit=row["reddit_verdict"],
        cross_chat_count=row["cross_chat_count"] or 0,
        bull_count=row["bull_count"],
        bear_count=row["bear_count"],
    )


async def _persist_score(pool, message_id: int, score: TickerScore) -> None:
    await pool.execute(
        """
        INSERT INTO discord_alert_scores
            (message_id, ticker, flow_verdict, gex_verdict, whale_verdict,
             reddit_verdict, cross_chat_count, bull_count, bear_count, scored_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
        ON CONFLICT (message_id, ticker) DO UPDATE SET
            flow_verdict = EXCLUDED.flow_verdict,
            gex_verdict = EXCLUDED.gex_verdict,
            whale_verdict = EXCLUDED.whale_verdict,
            reddit_verdict = EXCLUDED.reddit_verdict,
            cross_chat_count = EXCLUDED.cross_chat_count,
            bull_count = EXCLUDED.bull_count,
            bear_count = EXCLUDED.bear_count,
            scored_at = now()
        """,
        message_id,
        score.ticker,
        score.flow,
        score.gex,
        score.whale,
        score.reddit,
        score.cross_chat_count,
        score.bull_count,
        score.bear_count,
    )


def _to_pydantic(s: TickerScore) -> DiscordTickerScore:
    return DiscordTickerScore(
        ticker=s.ticker,
        flow=s.flow,
        gex=s.gex,
        whale=s.whale,
        reddit=s.reddit,
        cross_chat_count=s.cross_chat_count,
        bull_count=s.bull_count,
        bear_count=s.bear_count,
    )


async def _compute_cross_chat_counts(pool, tickers: set[str]) -> dict[str, int]:
    """For each ticker, count distinct guilds whose messages in the last
    30 minutes contained that ticker (cashtag or word boundary). This is
    cheap because we run ONE query per unique ticker mentioning condition.

    We use a tilde-ILIKE pattern that matches either '$XYZ' or word-bounded
    'XYZ' to avoid pulling all messages back into Python."""
    if not tickers:
        return {}
    counts: dict[str, int] = {}
    for t in tickers:
        # \mXYZ\M is Postgres word-boundary regex. ILIKE for the cashtag is
        # fast on a short window.
        row = await pool.fetchrow(
            """
            SELECT COUNT(DISTINCT guild_id) AS n
            FROM discord_messages
            WHERE posted_at > now() - INTERVAL '30 minutes'
              AND (content ~* $1 OR content ILIKE $2)
            """,
            rf"\m{t}\M",
            f"%${t}%",
        )
        counts[t] = int(row["n"] if row else 0)
    return counts


@router.get("/inventory", response_model=DiscordInventoryResponse)
async def get_inventory() -> DiscordInventoryResponse:
    """Servers + channels the listener can currently see.

    Written by apps/discord_listener on connect and on guild/channel events.
    Empty until the listener has connected at least once. Used by the
    /discord/sources UI to render cascading dropdowns instead of free-text.
    """
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT guild_id, guild_name, channel_id, channel_name, is_thread, refreshed_at
        FROM discord_inventory
        ORDER BY guild_name, is_thread, channel_name
        """
    )

    by_guild: dict[int, InventoryGuild] = {}
    refreshed_at: datetime | None = None
    for r in rows:
        if refreshed_at is None or r["refreshed_at"] > refreshed_at:
            refreshed_at = r["refreshed_at"]
        g = by_guild.get(r["guild_id"])
        if g is None:
            g = InventoryGuild(
                guild_id=str(r["guild_id"]),
                guild_name=r["guild_name"],
                channels=[],
            )
            by_guild[r["guild_id"]] = g
        g.channels.append(
            InventoryChannel(
                channel_id=str(r["channel_id"]),
                channel_name=r["channel_name"],
                is_thread=r["is_thread"],
            )
        )

    return DiscordInventoryResponse(
        guilds=list(by_guild.values()), refreshed_at=refreshed_at
    )


@router.get("/sources", response_model=DiscordSourcesResponse)
async def list_sources() -> DiscordSourcesResponse:
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT id, guild_name, channel_name, label, include_threads, enabled, created_at
        FROM discord_sources
        ORDER BY guild_name, channel_name
        """
    )
    return DiscordSourcesResponse(
        sources=[DiscordSource(**dict(r)) for r in rows]
    )


@router.post("/sources", response_model=DiscordSource, status_code=201)
async def add_source(body: DiscordSourceCreate) -> DiscordSource:
    pool = get_pool()
    try:
        row = await pool.fetchrow(
            """
            INSERT INTO discord_sources (guild_name, channel_name, label, include_threads)
            VALUES ($1, $2, $3, $4)
            RETURNING id, guild_name, channel_name, label, include_threads, enabled, created_at
            """,
            body.guild_name,
            body.channel_name,
            body.label,
            body.include_threads,
        )
    except Exception as e:  # asyncpg UniqueViolationError surfaces here
        log.warning("add_source failed: %s", e)
        raise HTTPException(status_code=409, detail="source_exists") from e
    return DiscordSource(**dict(row))


@router.delete("/sources/{source_id}", status_code=204)
async def delete_source(source_id: int) -> None:
    pool = get_pool()
    result = await pool.execute("DELETE FROM discord_sources WHERE id = $1", source_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="source_not_found")


class DiscordNotificationRule(BaseModel):
    id: int
    name: str
    min_confluence: int
    tickers: list[str]              # empty list = any ticker
    channel: str                    # 'ntfy' | 'discord_webhook'
    target: str                     # URL
    enabled: bool
    created_at: datetime


class DiscordNotificationRuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    min_confluence: int = Field(ge=1, le=4, default=3)
    tickers: list[str] = []
    channel: str = Field(pattern=r"^(ntfy|discord_webhook)$")
    target: str = Field(min_length=8, max_length=2048)


class DiscordNotificationRulesResponse(BaseModel):
    rules: list[DiscordNotificationRule]


@router.get("/notifications/rules", response_model=DiscordNotificationRulesResponse)
async def list_notification_rules() -> DiscordNotificationRulesResponse:
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT id, name, min_confluence, tickers, channel, target, enabled, created_at
        FROM discord_notification_rules
        ORDER BY id ASC
        """
    )
    rules = [
        DiscordNotificationRule(
            id=r["id"],
            name=r["name"],
            min_confluence=r["min_confluence"],
            tickers=list(r["tickers"] or []),
            channel=r["channel"],
            target=r["target"],
            enabled=r["enabled"],
            created_at=r["created_at"],
        )
        for r in rows
    ]
    return DiscordNotificationRulesResponse(rules=rules)


@router.post("/notifications/rules", response_model=DiscordNotificationRule, status_code=201)
async def add_notification_rule(
    body: DiscordNotificationRuleCreate,
) -> DiscordNotificationRule:
    pool = get_pool()
    tickers_upper = [t.strip().upper() for t in body.tickers if t.strip()]
    row = await pool.fetchrow(
        """
        INSERT INTO discord_notification_rules
            (name, min_confluence, tickers, channel, target)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, name, min_confluence, tickers, channel, target, enabled, created_at
        """,
        body.name,
        body.min_confluence,
        tickers_upper or None,
        body.channel,
        body.target,
    )
    return DiscordNotificationRule(
        id=row["id"],
        name=row["name"],
        min_confluence=row["min_confluence"],
        tickers=list(row["tickers"] or []),
        channel=row["channel"],
        target=row["target"],
        enabled=row["enabled"],
        created_at=row["created_at"],
    )


@router.delete("/notifications/rules/{rule_id}", status_code=204)
async def delete_notification_rule(rule_id: int) -> None:
    pool = get_pool()
    result = await pool.execute(
        "DELETE FROM discord_notification_rules WHERE id = $1", rule_id
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="rule_not_found")


def _validate_stream_api_key(api_key: str | None) -> None:
    """Manual API-key check for the SSE endpoint. EventSource can't set
    custom headers, so we accept the key via ?api_key=… instead. When the
    server hasn't configured any keys (dev mode), this is a no-op — matches
    the PROTECTED dependency's behavior."""
    from cfp_api.settings import settings as _s
    raw = (_s.api_keys_raw or "").strip()
    if not raw:
        return
    valid = {k.strip() for k in raw.split(",") if k.strip()}
    if not api_key or api_key.strip() not in valid:
        raise HTTPException(status_code=401, detail="invalid_or_missing_key")


@stream_router.get("/stream")
async def stream_messages(
    since_id: Annotated[int | None, Query(description="Last message_id the client has seen.")] = None,
    api_key: Annotated[str | None, Query(description="API key (EventSource cannot set headers).")] = None,
):
    """SSE stream of newly-captured Discord messages.

    The client opens this endpoint once and the server emits a JSON payload
    (matching ``DiscordMessage``, minus scoring) for every new
    ``discord_messages`` row whose ``message_id`` is greater than the
    largest ID the client has acknowledged. A keepalive comment is sent
    every 15s so reverse proxies don't time out the connection.

    This is a tail-poll over Postgres (2-second cadence) rather than
    LISTEN/NOTIFY — simpler, no extra schema, and the staleness ceiling is
    well below the user's perception threshold for a 'live' feed. Scoring
    is intentionally NOT computed here; the client refreshes the main
    ``/messages`` view in the background to pick up enriched fields.
    """
    _validate_stream_api_key(api_key)
    import asyncio
    import json as _json
    pool = get_pool()

    async def _gen():
        last_id = since_id or 0
        if last_id == 0:
            row = await pool.fetchrow("SELECT COALESCE(MAX(message_id), 0) AS m FROM discord_messages")
            last_id = int(row["m"] or 0)
        heartbeat_every = 15
        last_heartbeat = 0
        try:
            while True:
                rows = await pool.fetch(
                    """
                    SELECT message_id, guild_id, guild_name, channel_id, channel_name,
                           thread_id, thread_name, author_id, author_name, author_is_bot,
                           content, attachment_urls, posted_at
                    FROM discord_messages
                    WHERE message_id > $1
                    ORDER BY message_id ASC
                    LIMIT 50
                    """,
                    last_id,
                )
                for r in rows:
                    payload = {
                        "message_id": str(r["message_id"]),
                        "guild_id": str(r["guild_id"]),
                        "guild_name": r["guild_name"],
                        "channel_id": str(r["channel_id"]),
                        "channel_name": r["channel_name"],
                        "thread_id": str(r["thread_id"]) if r["thread_id"] is not None else None,
                        "thread_name": r["thread_name"],
                        "author_id": str(r["author_id"]),
                        "author_name": r["author_name"],
                        "author_is_bot": r["author_is_bot"],
                        "content": r["content"],
                        "attachment_urls": _coerce_urls(r["attachment_urls"]),
                        "posted_at": r["posted_at"].isoformat(),
                    }
                    yield f"event: message\ndata: {_json.dumps(payload)}\n\n"
                    last_id = int(r["message_id"])
                # Heartbeat so reverse proxies don't drop the connection.
                last_heartbeat += 2
                if last_heartbeat >= heartbeat_every:
                    yield ": keepalive\n\n"
                    last_heartbeat = 0
                await asyncio.sleep(2)
        except asyncio.CancelledError:
            return

    return StreamingResponse(_gen(), media_type="text/event-stream")


@router.get("/authors", response_model=DiscordAuthorsResponse)
async def list_authors(
    lookback_days: Annotated[int, Query(ge=1, le=365)] = 90,
    min_resolved: Annotated[int, Query(ge=0, le=200)] = 5,
) -> DiscordAuthorsResponse:
    """Leaderboard of Discord authors by trust score, computed from
    parsed plays. Only authors with at least ``min_resolved`` plays whose
    expiry has passed get a win_rate; below the threshold we still surface
    total_plays so you can see who's active but not yet measurable.

    Direction-adjusted P&L is the underlying-move proxy from the
    score_discord_plays worker — not actual option PnL.
    """
    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT
            m.author_id,
            m.author_name,
            COUNT(*) AS total_plays,
            COUNT(*) FILTER (
                WHERE p.status IN ('win_itm', 'loss_otm')
            ) AS resolved_plays,
            COUNT(*) FILTER (WHERE p.status = 'win_itm') AS wins,
            COUNT(*) FILTER (WHERE p.status = 'loss_otm') AS losses,
            AVG(p.pnl_pct_underlying) FILTER (
                WHERE p.status IN ('win_itm', 'loss_otm')
            ) AS avg_pnl_pct
        FROM discord_messages m
        JOIN discord_alert_plays p ON p.message_id = m.message_id
        WHERE m.posted_at > now() - ($1::int || ' days')::interval
        GROUP BY m.author_id, m.author_name
        ORDER BY
            COUNT(*) FILTER (WHERE p.status = 'win_itm')::float
                / NULLIF(COUNT(*) FILTER (WHERE p.status IN ('win_itm', 'loss_otm')), 0)
                DESC NULLS LAST,
            COUNT(*) DESC
        """,
        lookback_days,
    )
    authors: list[DiscordAuthorStats] = []
    for r in rows:
        resolved = int(r["resolved_plays"] or 0)
        wins = int(r["wins"] or 0)
        win_rate = (wins / resolved) if resolved >= min_resolved else None
        authors.append(
            DiscordAuthorStats(
                author_id=str(r["author_id"]),
                author_name=r["author_name"],
                total_plays=int(r["total_plays"] or 0),
                resolved_plays=resolved,
                wins=wins,
                losses=int(r["losses"] or 0),
                win_rate=win_rate,
                avg_pnl_pct=float(r["avg_pnl_pct"]) if r["avg_pnl_pct"] is not None else None,
                lookback_days=lookback_days,
            )
        )
    return DiscordAuthorsResponse(authors=authors)


# ---------- watchlist + first-mover + plays helpers ----------


async def _load_watchlist_tickers(pool) -> set[str]:
    """Single-user app: union of every ticker ever added to custom_watchlist
    across all sessions. Cheap query, small table."""
    try:
        rows = await pool.fetch("SELECT DISTINCT ticker FROM custom_watchlist")
        return {r["ticker"].upper() for r in rows if r["ticker"]}
    except Exception:
        log.exception("watchlist lookup failed")
        return set()


async def _compute_first_movers(pool, tickers: set[str]) -> dict[str, int]:
    """For each ticker, return the guild_id that was first to mention it
    today (UTC trading day). One query, indexed scan."""
    if not tickers:
        return {}
    rows = await pool.fetch(
        """
        SELECT DISTINCT ON (m.matched_ticker)
            m.matched_ticker AS ticker,
            m.guild_id
        FROM (
            SELECT guild_id, posted_at, t AS matched_ticker
            FROM discord_messages,
                 UNNEST($1::TEXT[]) AS t
            WHERE posted_at >= date_trunc('day', now())
              AND (content ~* ('\\m' || t || '\\M') OR content ILIKE ('%$' || t || '%'))
        ) m
        ORDER BY m.matched_ticker, m.posted_at ASC
        """,
        list(tickers),
    )
    return {r["ticker"]: int(r["guild_id"]) for r in rows}


async def _persist_parsed_plays(pool, base) -> None:
    """For messages with at least one parsed strike/side/expiry/entry, write
    a discord_alert_plays row per ticker. ON CONFLICT DO NOTHING so we never
    clobber a worker-updated row with stale parser output."""
    rows_to_insert: list[tuple] = []
    for msg, tickers in base:
        plays = parse_plays(msg.content, tickers)
        for p in plays:
            # Only persist if the parser found *something* beyond the
            # ticker — otherwise we'd write 'unknown' rows for every
            # ticker mention, which the worker would burn time on.
            if p.strike is None and p.side == "unknown" and p.entry_price is None:
                continue
            rows_to_insert.append(
                (
                    int(msg.message_id),
                    p.ticker,
                    p.side,
                    p.strike,
                    p.expiry,  # the worker normalizes; we store ISO date as TEXT-cast date below
                    p.entry_price,
                    msg.posted_at,
                )
            )
    if not rows_to_insert:
        return
    try:
        await pool.executemany(
            """
            INSERT INTO discord_alert_plays
                (message_id, ticker, side, strike, expiry, entry_price, captured_at)
            VALUES ($1, $2, $3, $4, $5::date, $6, $7)
            ON CONFLICT (message_id, ticker) DO NOTHING
            """,
            rows_to_insert,
        )
    except Exception:
        log.exception("persist_parsed_plays failed (count=%d)", len(rows_to_insert))


async def _load_author_stats(
    pool, author_ids: set[int], lookback_days: int = 90, min_resolved: int = 5
) -> dict[int, DiscordAuthorStats]:
    """For each author_id in the result set, compute rolling-window trust
    stats from discord_alert_plays. One query, returns {} when no plays
    exist yet (e.g., before the price worker has run). Authors below the
    ``min_resolved`` threshold get a stats object with ``win_rate=None``
    so the UI can render 'N plays · ?' instead of fake precision."""
    if not author_ids:
        return {}
    rows = await pool.fetch(
        """
        SELECT
            m.author_id,
            m.author_name,
            COUNT(*) AS total_plays,
            COUNT(*) FILTER (
                WHERE p.status IN ('win_itm', 'loss_otm')
            ) AS resolved_plays,
            COUNT(*) FILTER (WHERE p.status = 'win_itm') AS wins,
            COUNT(*) FILTER (WHERE p.status = 'loss_otm') AS losses,
            AVG(p.pnl_pct_underlying) FILTER (
                WHERE p.status IN ('win_itm', 'loss_otm')
            ) AS avg_pnl_pct
        FROM discord_messages m
        JOIN discord_alert_plays p ON p.message_id = m.message_id
        WHERE m.author_id = ANY($1::BIGINT[])
          AND m.posted_at > now() - ($2::int || ' days')::interval
        GROUP BY m.author_id, m.author_name
        """,
        list(author_ids),
        lookback_days,
    )
    out: dict[int, DiscordAuthorStats] = {}
    for r in rows:
        resolved = int(r["resolved_plays"] or 0)
        wins = int(r["wins"] or 0)
        win_rate = (wins / resolved) if resolved >= min_resolved else None
        out[int(r["author_id"])] = DiscordAuthorStats(
            author_id=str(r["author_id"]),
            author_name=r["author_name"],
            total_plays=int(r["total_plays"] or 0),
            resolved_plays=resolved,
            wins=wins,
            losses=int(r["losses"] or 0),
            win_rate=win_rate,
            avg_pnl_pct=float(r["avg_pnl_pct"]) if r["avg_pnl_pct"] is not None else None,
            lookback_days=lookback_days,
        )
    return out


async def _load_plays_state(pool, base) -> dict[tuple[int, str], dict]:
    """Pull current play state for every (message_id, ticker) in the result
    set. Empty when no plays have been persisted yet — caller defaults to
    None on missing keys."""
    keys = [
        (int(msg.message_id), t)
        for msg, tickers in base
        for t in tickers
    ]
    if not keys:
        return {}
    msg_ids = [k[0] for k in keys]
    rows = await pool.fetch(
        """
        SELECT message_id, ticker, side, strike, expiry, entry_price,
               entry_underlying, current_underlying, pnl_pct_underlying,
               status
        FROM discord_alert_plays
        WHERE message_id = ANY($1::BIGINT[])
        """,
        msg_ids,
    )
    out: dict[tuple[int, str], dict] = {}
    for r in rows:
        out[(int(r["message_id"]), r["ticker"])] = dict(r)
    return out


# ---------- helpers ----------


def _coerce_urls(raw) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw]
    if isinstance(raw, str):
        # asyncpg without jsonb codec returns the raw JSON string.
        import json
        try:
            parsed = json.loads(raw)
            return [str(x) for x in parsed] if isinstance(parsed, list) else []
        except Exception:
            return []
    return []
