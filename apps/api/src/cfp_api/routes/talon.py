"""Talon scanner routes — Phase 3-validated flow gates over 504-ticker universe.

GET  /v1/talon/scan/latest           → latest scan from Postgres (or 404 if none)
POST /v1/talon/scan                  → trigger a fresh live UW fetch + scan (~7-10 min)
GET  /v1/talon/scan/progress         → real-time progress of the in-flight scan
GET  /v1/talon/scan/recent           → header info for the N most recent scans
GET  /v1/talon/scan/{scan_id}        → full payload for one specific scan
GET  /v1/talon/universe              → list the configured 504-ticker universe

The scan always live-fetches UW. The 15-min in-process cache was removed —
every click is a fresh fetch. Concurrent clicks share the in-flight scan via
an internal lock; they don't double-fetch.
"""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from cfp_api import talon_scanner, talon_store

router = APIRouter(prefix="/v1/talon", tags=["talon"])


@router.get("/scan/latest")
async def get_latest_scan() -> dict[str, Any]:
    scan = await talon_store.load_latest_scan()
    if scan is None:
        raise HTTPException(404, "no_scan_in_db")
    return scan


@router.post("/scan")
async def run_scan() -> dict[str, Any]:
    """Trigger a new scan synchronously.

    Every click triggers a fresh UW fetch for all 504 tickers. Takes ~7-10 min
    on a cold start, ~30 s if a concurrent caller is already running one.

    Use GET /scan/progress in parallel to show progress to the user.
    """
    scan = await asyncio.to_thread(talon_scanner.run_scan)
    await talon_store.save_scan(scan)
    return scan


@router.get("/scan/progress")
async def get_scan_progress() -> dict[str, Any]:
    """Real-time scan progress. Returns {"status": "idle"|"running"|"complete"|"error", ...}."""
    return talon_scanner.get_scan_progress()


@router.get("/scan/recent")
async def get_recent_scans(limit: int = Query(20, ge=1, le=100)) -> dict[str, Any]:
    rows = await talon_store.list_recent_scans(limit)
    return {"count": len(rows), "scans": rows}


@router.get("/scan/{scan_id}")
async def get_scan_by_id(scan_id: str) -> dict[str, Any]:
    scan = await talon_store.load_scan_by_id(scan_id)
    if scan is None:
        raise HTTPException(404, f"scan_not_found:{scan_id}")
    return scan


@router.get("/universe")
async def get_universe() -> dict[str, Any]:
    universe = talon_scanner.load_universe()
    return {"count": len(universe), "tickers": universe}
