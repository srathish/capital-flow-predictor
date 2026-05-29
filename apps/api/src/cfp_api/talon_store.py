"""Postgres persistence for Talon scans.

The scanner produces a JSON-shaped result. We persist the whole payload to
``talon_scans.result_json`` plus a few normalized counters for cheap "latest
scan" lookups and admin filtering. Survives Railway redeploys.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from cfp_api.db import get_pool


async def save_scan(scan: dict[str, Any]) -> None:
    """Insert one scan row. Idempotent on scan_id (ON CONFLICT DO NOTHING).

    The scanner generates a fresh scan_id per run, so collisions don't happen
    in practice — the guard is purely defensive.
    """
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO talon_scans (
                scan_id, scan_date, started_at, completed_at, elapsed_seconds,
                universe_total, with_gex_data, actionable_count,
                watchlist_count, skip_count, result_json
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
            ON CONFLICT (scan_id) DO NOTHING
            """,
            scan["scan_id"],
            datetime.fromisoformat(scan["scan_date"]).date(),
            datetime.fromisoformat(scan["started_at"]),
            datetime.fromisoformat(scan["generated_at"]),
            scan["elapsed_seconds"],
            scan["universe_total"],
            scan["with_gex_data"],
            scan["actionable_count"],
            scan["watchlist_count"],
            scan["skip_count"],
            json.dumps(scan),
        )


async def update_scan_top_plays(scan_id: str, top_plays: list[dict]) -> None:
    """Patch the cached scan's result_json with a freshly-computed top_plays list.

    Implementation note: legacy rows store result_json as a JSON-encoded *string*
    inside the jsonb column (double-encoding side-effect of how save_scan binds
    text via asyncpg). jsonb_set won't work on a scalar string, so we read the
    full payload, mutate, and rewrite. Payload is 50-150KB — acceptable for an
    operation that runs once per scan.
    """
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT result_json FROM talon_scans WHERE scan_id = $1", scan_id
        )
        if not row:
            return
        payload = row["result_json"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        payload["top_plays"] = top_plays
        await conn.execute(
            "UPDATE talon_scans SET result_json = $2::jsonb WHERE scan_id = $1",
            scan_id,
            json.dumps(payload),
        )


async def load_latest_scan() -> dict[str, Any] | None:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT result_json FROM talon_scans ORDER BY completed_at DESC LIMIT 1"
        )
    if not row:
        return None
    payload = row["result_json"]
    if isinstance(payload, str):
        return json.loads(payload)
    return payload


async def load_scan_by_id(scan_id: str) -> dict[str, Any] | None:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT result_json FROM talon_scans WHERE scan_id = $1", scan_id
        )
    if not row:
        return None
    payload = row["result_json"]
    if isinstance(payload, str):
        return json.loads(payload)
    return payload


async def list_recent_scans(limit: int = 20) -> list[dict[str, Any]]:
    """Recent scans (header info only — no full result blob)."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT scan_id, scan_date, completed_at, elapsed_seconds,
                   universe_total, with_gex_data,
                   actionable_count, watchlist_count, skip_count
            FROM talon_scans ORDER BY completed_at DESC LIMIT $1
            """,
            limit,
        )
    return [dict(r) for r in rows]
