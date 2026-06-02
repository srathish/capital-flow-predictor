"""Postgres persistence for Talon v2 scans.

Mirrors talon_store.py but writes to a separate `talon2_scans` table so v1
and v2 results don't interleave. Same JSONB blob pattern for the full payload
plus a few normalized counters for cheap "latest scan" lookups.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from cfp_api.db import get_pool


async def save_v2_scan(scan: dict[str, Any]) -> None:
    """Insert one v2 scan row. Idempotent on v2_scan_id."""
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO talon2_scans (
                v2_scan_id, scan_date, started_at, completed_at, elapsed_seconds,
                universe_total, with_gex_data, actionable_count,
                watchlist_count, coiled_count, result_json
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
            ON CONFLICT (v2_scan_id) DO NOTHING
            """,
            scan["v2_scan_id"],
            datetime.fromisoformat(scan["scan_date"]).date(),
            datetime.fromisoformat(scan["started_at"]),
            datetime.fromisoformat(scan["v2_generated_at"]),
            scan.get("v2_elapsed_seconds") or scan.get("elapsed_seconds"),
            scan["universe_total"],
            scan["with_gex_data"],
            scan["actionable_count"],
            scan["watchlist_count"],
            scan.get("coiled_count", 0),
            json.dumps(scan),
        )


async def load_latest_v2_scan() -> dict[str, Any] | None:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT result_json FROM talon2_scans ORDER BY completed_at DESC LIMIT 1"
        )
    if not row:
        return None
    payload = row["result_json"]
    if isinstance(payload, str):
        return json.loads(payload)
    return payload


async def load_v2_scan_by_id(scan_id: str) -> dict[str, Any] | None:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT result_json FROM talon2_scans WHERE v2_scan_id = $1", scan_id
        )
    if not row:
        return None
    payload = row["result_json"]
    if isinstance(payload, str):
        return json.loads(payload)
    return payload


async def list_recent_v2_scans(limit: int = 20) -> list[dict[str, Any]]:
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT v2_scan_id, scan_date, completed_at, elapsed_seconds,
                   universe_total, with_gex_data,
                   actionable_count, watchlist_count, coiled_count
            FROM talon2_scans ORDER BY completed_at DESC LIMIT $1
            """,
            limit,
        )
    return [dict(r) for r in rows]
