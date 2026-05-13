"""gexester-vexster integration endpoints.

Three concerns, deliberately co-located so the gex tab has one routes module:

  /v1/gex/feed          Mirror of Discord embeds. gexester POSTs every embed
                        here in parallel with the Discord webhook; the UI tab
                        reads back newest-first with optional source filter.

  /v1/skylit/status     Health log for the Clerk/Heatseeker auth path. gexester
                        POSTs on every JWT refresh + on every cookie rotation;
                        UI badge reads the most-recent row.

  /v1/skylit/reauth/*   Queue for "open a browser and re-auth" triggers. The
                        UI POSTs to /request; the cfp-jobs skylit-watch
                        daemon long-polls /pending, runs Playwright, then POSTs
                        to /complete to close the row.

No cookie/secret values cross this surface. The cookie continues to live in
gexester's local .env (now properly persisted across rotations post-Layer-1).
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from cfp_api.db import get_pool

router = APIRouter(tags=["gex"])

# Tickers we surface in the feed. Kept narrow — gexester is SPY/QQQ/SPXW only.
# Extracted from each embed's title + description + field names so the UI can
# filter the feed without re-parsing on read.
_TICKER_RE = re.compile(r"\b(SPY|QQQ|SPX|SPXW|ES)\b")

FeedSource = Literal["brief", "monitor", "scanner", "decision", "structure", "other"]


# ---------- /v1/gex/feed ----------


class GexFeedField(BaseModel):
    """Mirrors Discord's embed field shape (name/value/inline)."""
    name: str = ""
    value: str = ""
    inline: bool = False


class GexFeedPostIn(BaseModel):
    """What gexester POSTs to mirror one Discord embed.

    Field names match Discord's embed schema so gexester can pass-through the
    same object it sends to the webhook (plus `source` and optional `tickers`).
    """
    source: FeedSource = "other"
    title: str | None = None
    description: str | None = None
    fields: list[GexFeedField] = Field(default_factory=list)
    color: int | None = None
    footer: str | None = None
    # Optional explicit ticker list; if omitted we parse from title/desc/fields.
    tickers: list[str] | None = None
    # Optional original Discord payload for debugging / future-proofing.
    raw: dict[str, Any] | None = None


class GexFeedItem(BaseModel):
    id: int
    ts: datetime
    source: str
    title: str | None
    description: str | None
    fields: list[GexFeedField]
    color: int | None
    footer: str | None
    tickers: list[str]


class GexFeedResponse(BaseModel):
    items: list[GexFeedItem]
    n: int


def _extract_tickers(post: GexFeedPostIn) -> list[str]:
    """Pull SPY/QQQ/SPX/SPXW out of the embed text. Used when the poster
    didn't supply an explicit tickers list. De-duped, order-preserved."""
    parts: list[str] = []
    if post.title: parts.append(post.title)
    if post.description: parts.append(post.description)
    for f in post.fields:
        parts.append(f.name)
        parts.append(f.value)
    seen: dict[str, None] = {}
    for blob in parts:
        for m in _TICKER_RE.finditer(blob):
            t = m.group(1)
            # Normalize: SPX → SPXW since gexester treats them as one universe.
            if t == "SPX":
                t = "SPXW"
            if t not in seen:
                seen[t] = None
    return list(seen.keys())


@router.post("/v1/gex/feed", response_model=GexFeedItem)
async def post_gex_feed(post: GexFeedPostIn) -> GexFeedItem:
    """Mirror one Discord embed into gex_feed. Authenticated like every other
    write endpoint via the global X-API-Key dependency on the router include."""
    pool = get_pool()
    tickers = post.tickers if post.tickers is not None else _extract_tickers(post)
    fields_json = json.dumps([f.model_dump() for f in post.fields])
    raw_json = json.dumps(post.raw) if post.raw is not None else None

    sql = """
        INSERT INTO gex_feed (source, title, description, fields, color, footer, tickers, raw)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb)
        RETURNING id, ts, source, title, description, fields, color, footer, tickers
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            sql, post.source, post.title, post.description, fields_json,
            post.color, post.footer, tickers, raw_json,
        )
    if row is None:
        raise HTTPException(status_code=500, detail="insert returned no row")
    return GexFeedItem(
        id=row["id"],
        ts=row["ts"],
        source=row["source"],
        title=row["title"],
        description=row["description"],
        fields=[GexFeedField(**f) for f in (json.loads(row["fields"]) if isinstance(row["fields"], str) else row["fields"] or [])],
        color=row["color"],
        footer=row["footer"],
        tickers=list(row["tickers"] or []),
    )


@router.get("/v1/gex/feed", response_model=GexFeedResponse)
async def get_gex_feed(
    limit: int = Query(50, ge=1, le=200),
    source: FeedSource | None = Query(None),
    ticker: str | None = Query(None, description="Filter to embeds mentioning this ticker"),
) -> GexFeedResponse:
    """Newest-first feed for the UI tab. Up to 200 rows per call; the tab can
    paginate on `ts < lastSeen` by passing `before` (not yet implemented — add
    when scroll-to-load matters; for now 200 covers a day's volume)."""
    pool = get_pool()
    where: list[str] = []
    params: list[Any] = []
    if source is not None:
        params.append(source)
        where.append(f"source = ${len(params)}")
    if ticker:
        params.append(ticker.upper())
        where.append(f"${len(params)} = ANY(tickers)")
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    params.append(limit)
    sql = f"""
        SELECT id, ts, source, title, description, fields, color, footer, tickers
        FROM gex_feed
        {where_sql}
        ORDER BY ts DESC
        LIMIT ${len(params)}
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)

    items = [
        GexFeedItem(
            id=r["id"],
            ts=r["ts"],
            source=r["source"],
            title=r["title"],
            description=r["description"],
            fields=[GexFeedField(**f) for f in (json.loads(r["fields"]) if isinstance(r["fields"], str) else r["fields"] or [])],
            color=r["color"],
            footer=r["footer"],
            tickers=list(r["tickers"] or []),
        )
        for r in rows
    ]
    return GexFeedResponse(items=items, n=len(items))


# ---------- /v1/skylit/status ----------


class SkylitStatusPostIn(BaseModel):
    """What gexester POSTs on auth events. All fields optional except `method`
    so a lightweight heartbeat (just method='clerk-auto-refresh' + jwt_ttl)
    is acceptable, and a full rotation event can include cookie_rotated_at +
    persist_ok."""
    method: Literal["clerk-auto-refresh", "static-jwt", "none"]
    jwt_ttl_seconds: int | None = None
    cookie_rotated_at: datetime | None = None
    persist_ok: bool | None = None
    persist_error: str | None = None
    sse_state: Literal["open", "closed", "reconnecting", "unknown"] | None = None
    note: str | None = None


class SkylitStatusResponse(BaseModel):
    """Latest row from skylit_status. The UI badge reads this and converts
    cookie_rotated_at + posted_at to relative timestamps client-side."""
    posted_at: datetime | None
    method: str | None
    jwt_ttl_seconds: int | None
    cookie_rotated_at: datetime | None
    persist_ok: bool | None
    persist_error: str | None
    sse_state: str | None
    note: str | None
    # Health rollup the server computes from the latest row so the UI doesn't
    # have to re-derive it. Levels: green / yellow / red / unknown.
    health: Literal["green", "yellow", "red", "unknown"]
    health_reason: str


def _rollup_health(row: dict | None) -> tuple[str, str]:
    """Translate the latest skylit_status row into a single traffic-light tag.

    Rules:
      - No status row ever posted: unknown.
      - method='none' or persist_ok=False (with persist_error set): red — auth
        is broken or rotation isn't persisting, both are operator-must-act.
      - posted_at older than 30 min: yellow — gexester probably stopped reporting.
      - Otherwise green.
    """
    if row is None:
        return "unknown", "no skylit_status rows yet"
    if row.get("method") == "none":
        return "red", "no Clerk credentials configured"
    if row.get("persist_ok") is False:
        return "red", f"cookie rotation NOT persisting: {row.get('persist_error') or 'unknown error'}"
    posted_at = row.get("posted_at")
    if posted_at is not None:
        now = datetime.now(tz=posted_at.tzinfo or UTC)
        age_s = (now - posted_at).total_seconds()
        if age_s > 30 * 60:
            return "yellow", f"no heartbeat for {int(age_s // 60)} minutes — is gexester running?"
    return "green", "auth healthy"


@router.post("/v1/skylit/status", response_model=SkylitStatusResponse)
async def post_skylit_status(payload: SkylitStatusPostIn) -> SkylitStatusResponse:
    """gexester reports auth state. Appends one row per call; the UI reads
    the most recent. We keep history (not just upsert) so future debugging
    can see "the cookie rotated at 14:02 but persist_ok=False — that's when
    things started breaking"."""
    pool = get_pool()
    sql = """
        INSERT INTO skylit_status
            (method, jwt_ttl_seconds, cookie_rotated_at, persist_ok, persist_error, sse_state, note)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING posted_at, method, jwt_ttl_seconds, cookie_rotated_at,
                  persist_ok, persist_error, sse_state, note
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            sql, payload.method, payload.jwt_ttl_seconds, payload.cookie_rotated_at,
            payload.persist_ok, payload.persist_error, payload.sse_state, payload.note,
        )
    d = dict(row) if row else None
    health, reason = _rollup_health(d)
    return SkylitStatusResponse(
        posted_at=d["posted_at"] if d else None,
        method=d["method"] if d else None,
        jwt_ttl_seconds=d["jwt_ttl_seconds"] if d else None,
        cookie_rotated_at=d["cookie_rotated_at"] if d else None,
        persist_ok=d["persist_ok"] if d else None,
        persist_error=d["persist_error"] if d else None,
        sse_state=d["sse_state"] if d else None,
        note=d["note"] if d else None,
        health=health,
        health_reason=reason,
    )


@router.get("/v1/skylit/status", response_model=SkylitStatusResponse)
async def get_skylit_status() -> SkylitStatusResponse:
    """Latest status row + traffic-light rollup. Returns health=unknown when
    no row has been posted yet (cold start)."""
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT posted_at, method, jwt_ttl_seconds, cookie_rotated_at, "
            "persist_ok, persist_error, sse_state, note "
            "FROM skylit_status ORDER BY posted_at DESC LIMIT 1"
        )
    d = dict(row) if row else None
    health, reason = _rollup_health(d)
    return SkylitStatusResponse(
        posted_at=d["posted_at"] if d else None,
        method=d["method"] if d else None,
        jwt_ttl_seconds=d["jwt_ttl_seconds"] if d else None,
        cookie_rotated_at=d["cookie_rotated_at"] if d else None,
        persist_ok=d["persist_ok"] if d else None,
        persist_error=d["persist_error"] if d else None,
        sse_state=d["sse_state"] if d else None,
        note=d["note"] if d else None,
        health=health,
        health_reason=reason,
    )


# ---------- /v1/skylit/credentials ----------


class SkylitCredentialsIn(BaseModel):
    """Body the skylit-watch daemon POSTs after a successful Playwright capture.

    This replaces the daemon's old "write to local .env" path. With the gex
    service now running on Railway, the credential must live in Postgres so
    a deploy doesn't lose it.
    """
    client_cookie: str = Field(..., min_length=10, max_length=2000)
    client_uat: str = Field(default="", max_length=2000)
    session_id: str = Field(..., min_length=5, max_length=200)
    # Free-text tag: 'skylit-watch' for normal daemon captures, 'bootstrap'
    # for the one-time seed from a local .env. Surfaced in skylit_credentials
    # so we can audit who wrote what.
    source: str = Field(default="skylit-watch", max_length=64)


class SkylitCredentialsStatusOut(BaseModel):
    """Read shape — never returns the cookie value itself, only metadata."""
    present: bool
    captured_at: datetime | None
    session_id_prefix: str | None  # first 24 chars only, for UI display
    source: str | None


@router.post("/v1/skylit/credentials", response_model=SkylitCredentialsStatusOut)
async def upsert_skylit_credentials(payload: SkylitCredentialsIn) -> SkylitCredentialsStatusOut:
    """Upsert the single-row skylit credential. Called by:
      1. cfp-jobs skylit-watch after a Playwright capture (source='skylit-watch')
      2. The cfp-jobs skylit-bootstrap script when seeding from a local .env
         (source='bootstrap'), one-time after the monorepo migration.

    The gex Railway service reads this row at boot via direct Postgres access
    (no HTTP hop) — see apps/gex/src/store/pg.js loadSkylitCredentials.
    """
    pool = get_pool()
    sql = """
        INSERT INTO skylit_credentials
            (id, client_cookie, client_uat, session_id, captured_at, source)
        VALUES (1, $1, $2, $3, NOW(), $4)
        ON CONFLICT (id) DO UPDATE SET
            client_cookie = EXCLUDED.client_cookie,
            client_uat    = EXCLUDED.client_uat,
            session_id    = EXCLUDED.session_id,
            captured_at   = EXCLUDED.captured_at,
            source        = EXCLUDED.source
        RETURNING captured_at, session_id, source
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            sql, payload.client_cookie, payload.client_uat,
            payload.session_id, payload.source,
        )
    if row is None:
        raise HTTPException(status_code=500, detail="upsert returned no row")
    return SkylitCredentialsStatusOut(
        present=True,
        captured_at=row["captured_at"],
        session_id_prefix=row["session_id"][:24],
        source=row["source"],
    )


@router.get("/v1/skylit/credentials/status", response_model=SkylitCredentialsStatusOut)
async def get_skylit_credentials_status() -> SkylitCredentialsStatusOut:
    """Metadata-only read — confirms whether a credential exists and how fresh
    it is. The actual cookie + session id are never returned over this surface
    (the only consumer that needs the values is the gex service, which reads
    them via direct Postgres access)."""
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT captured_at, session_id, source FROM skylit_credentials WHERE id = 1"
        )
    if row is None:
        return SkylitCredentialsStatusOut(
            present=False, captured_at=None, session_id_prefix=None, source=None,
        )
    return SkylitCredentialsStatusOut(
        present=True,
        captured_at=row["captured_at"],
        session_id_prefix=row["session_id"][:24],
        source=row["source"],
    )


# ---------- /v1/skylit/reauth/* ----------


class ReauthRequestIn(BaseModel):
    requested_by: str = Field(default="ui_button", max_length=64)


class ReauthRequestItem(BaseModel):
    id: int
    requested_at: datetime
    requested_by: str
    status: str
    claimed_at: datetime | None
    completed_at: datetime | None
    result: str | None


class ReauthCompleteIn(BaseModel):
    """Daemon reports back. ok=True for completed, False for failed. Result is
    a one-line summary surfaced to the UI ('Captured session ses_xxx' or
    'Discord OAuth timed out after 5 min')."""
    ok: bool
    result: str = Field(..., max_length=500)


# Long-poll knobs. 25s is just under typical proxy/CDN idle cutoffs (Cloudflare
# is 100s, but Railway's HTTP timeout is shorter); the daemon retries
# immediately on empty so this only adds latency at the tail.
_LONGPOLL_MAX_S = 25
_LONGPOLL_TICK_S = 1.0


@router.post("/v1/skylit/reauth/request", response_model=ReauthRequestItem)
async def request_reauth(payload: ReauthRequestIn | None = None) -> ReauthRequestItem:
    """UI button -> enqueue a pending re-auth row. Idempotent-ish: if a row
    is already pending (no daemon claimed it yet) we return that existing row
    rather than stacking duplicates. Once a row is in_progress, a fresh
    request makes sense (operator may have refreshed the page); we create a
    new one."""
    pool = get_pool()
    requested_by = (payload.requested_by if payload else "ui_button")[:64]
    async with pool.acquire() as conn:
        # Reuse an existing pending row if one exists — operator hitting the
        # button twice shouldn't fan out to two daemon claims.
        existing = await conn.fetchrow(
            "SELECT id, requested_at, requested_by, status, claimed_at, completed_at, result "
            "FROM skylit_reauth_request WHERE status='pending' "
            "ORDER BY requested_at DESC LIMIT 1"
        )
        if existing:
            return ReauthRequestItem(**dict(existing))
        row = await conn.fetchrow(
            "INSERT INTO skylit_reauth_request (requested_by) VALUES ($1) "
            "RETURNING id, requested_at, requested_by, status, claimed_at, completed_at, result",
            requested_by,
        )
    if row is None:
        raise HTTPException(status_code=500, detail="insert returned no row")
    return ReauthRequestItem(**dict(row))


@router.get("/v1/skylit/reauth/pending", response_model=ReauthRequestItem | None)
async def poll_reauth(
    wait: int = Query(0, ge=0, le=_LONGPOLL_MAX_S, description="Long-poll seconds; 0 = immediate"),
) -> ReauthRequestItem | None:
    """Daemon long-polls this endpoint. Atomically claims the oldest pending
    row (transitions pending->in_progress and stamps claimed_at) so two
    daemons can't race on the same trigger.

    Returns null if no pending row appears within `wait` seconds.
    """
    pool = get_pool()
    deadline = asyncio.get_running_loop().time() + wait
    while True:
        async with pool.acquire() as conn:
            # SKIP LOCKED ensures concurrent pollers each get a different row.
            row = await conn.fetchrow("""
                UPDATE skylit_reauth_request
                SET status = 'in_progress', claimed_at = NOW()
                WHERE id = (
                    SELECT id FROM skylit_reauth_request
                    WHERE status = 'pending'
                    ORDER BY requested_at ASC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id, requested_at, requested_by, status, claimed_at, completed_at, result
            """)
        if row is not None:
            return ReauthRequestItem(**dict(row))
        if asyncio.get_running_loop().time() >= deadline:
            return None
        await asyncio.sleep(_LONGPOLL_TICK_S)


@router.post("/v1/skylit/reauth/complete/{req_id}", response_model=ReauthRequestItem)
async def complete_reauth(req_id: int, payload: ReauthCompleteIn) -> ReauthRequestItem:
    """Daemon reports the outcome. Transitions in_progress -> completed/failed.
    Refuses to update a row that's not in_progress (operator can't 'complete'
    a pending row without a daemon claiming it first)."""
    pool = get_pool()
    new_status = "completed" if payload.ok else "failed"
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE skylit_reauth_request
            SET status = $2, completed_at = NOW(), result = $3
            WHERE id = $1 AND status = 'in_progress'
            RETURNING id, requested_at, requested_by, status, claimed_at, completed_at, result
        """, req_id, new_status, payload.result[:500])
    if row is None:
        raise HTTPException(
            status_code=409,
            detail=f"request {req_id} is not in_progress (already finalized or not claimed)",
        )
    return ReauthRequestItem(**dict(row))


@router.get("/v1/skylit/reauth/recent", response_model=list[ReauthRequestItem])
async def recent_reauths(limit: int = Query(10, ge=1, le=50)) -> list[ReauthRequestItem]:
    """Most recent re-auth requests in any state. UI shows the last N to give
    the operator visibility into 'did my button press do anything?'."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, requested_at, requested_by, status, claimed_at, completed_at, result "
            "FROM skylit_reauth_request ORDER BY requested_at DESC LIMIT $1",
            limit,
        )
    return [ReauthRequestItem(**dict(r)) for r in rows]
