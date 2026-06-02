"""Talon v2 scanner routes — adds chart structure on top of v1's flow gates.

Mirrors the v1 endpoint surface so the v2 UI can follow the same patterns.
v1 endpoints under /v1/talon/* remain untouched.

GET  /v1/talon/v2/scan/latest       → latest v2 scan from Postgres (or 404)
POST /v1/talon/v2/scan               → trigger a fresh v2 scan (~10-15 min)
GET  /v1/talon/v2/scan/progress      → real-time v2 scan progress
GET  /v1/talon/v2/scan/recent        → headers for recent v2 scans
GET  /v1/talon/v2/scan/{scan_id}     → full v2 payload by id
GET  /v1/talon/v2/themes             → theme-level coiled-basket summary
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from cfp_api import talon_v2_scanner, talon_v2_store

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/talon/v2", tags=["talon-v2"])


@router.get("/scan/latest")
async def get_latest_v2_scan() -> dict[str, Any]:
    scan = await talon_v2_store.load_latest_v2_scan()
    if scan is None:
        raise HTTPException(404, "no_v2_scan_in_db")
    return scan


@router.post("/scan")
async def run_v2_scan() -> dict[str, Any]:
    """Trigger a v2 scan — runs v1 first, then enriches with chart signals.

    Expected duration: v1 (~7-10 min) + candle prewarm (~2-3 min for 504
    tickers via UW REST) + chart signal compute (<30s). Total ~10-15 min.
    """
    scan = await asyncio.to_thread(talon_v2_scanner.run_v2_scan)
    await talon_v2_store.save_v2_scan(scan)
    return scan


@router.get("/scan/progress")
async def get_v2_scan_progress() -> dict[str, Any]:
    return talon_v2_scanner.get_v2_scan_progress()


@router.get("/scan/recent")
async def get_recent_v2_scans(limit: int = Query(20, ge=1, le=100)) -> dict[str, Any]:
    rows = await talon_v2_store.list_recent_v2_scans(limit)
    return {"count": len(rows), "scans": rows}


@router.get("/scan/{scan_id}")
async def get_v2_scan_by_id(scan_id: str) -> dict[str, Any]:
    scan = await talon_v2_store.load_v2_scan_by_id(scan_id)
    if scan is None:
        raise HTTPException(404, f"v2_scan_not_found:{scan_id}")
    return scan


@router.get("/themes")
async def get_themes_summary() -> dict[str, Any]:
    """Theme-level coiled-basket summary from the latest v2 scan."""
    scan = await talon_v2_store.load_latest_v2_scan()
    if scan is None:
        raise HTTPException(404, "no_v2_scan_in_db")
    return {
        "v2_scan_id": scan["v2_scan_id"],
        "scan_date": scan["scan_date"],
        "generated_at": scan["v2_generated_at"],
        "themes_summary": scan.get("themes_summary", {}),
        "coiled_themes": scan.get("coiled_themes", []),
    }
