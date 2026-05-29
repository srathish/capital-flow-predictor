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
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from cfp_api import talon_scanner, talon_store, talon_top_plays
from cfp_api.db import get_pool

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/talon", tags=["talon"])


async def _price_lookup_db(ticker: str) -> float | None:
    """Latest close from prices_daily; returns None if not seeded."""
    pool = get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "SELECT close FROM prices_daily WHERE ticker = $1 "
            "ORDER BY ts DESC LIMIT 1",
            ticker,
        )


def _price_lookup_yf_batch(tickers: list[str]) -> dict[str, float]:
    """Bulk yfinance fallback for tickers missing from prices_daily."""
    try:
        import yfinance as yf
    except ImportError:
        return {}
    if not tickers:
        return {}
    out: dict[str, float] = {}
    try:
        df = yf.download(
            " ".join(tickers), period="5d", progress=False, auto_adjust=False
        )["Close"]
        if hasattr(df, "columns"):
            for t in tickers:
                if t in df.columns:
                    s = df[t].dropna()
                    if not s.empty:
                        out[t] = float(s.iloc[-1])
        elif not df.empty:
            out[tickers[0]] = float(df.dropna().iloc[-1])
    except Exception as e:  # noqa: BLE001
        log.warning("yfinance fallback failed: %s", e)
    return out


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


@router.get("/top-plays")
async def get_top_plays(
    force_recompute: bool = Query(False, description="Skip cached enrichment"),
) -> dict[str, Any]:
    """Top 20 actionable setups from the latest scan, enriched with current price,
    chain levels (soft inval / ST target / swing targets), and three contract
    tiers (defensive ITM / standard ATM-OTM / aggressive OTM lottery) — each
    pick defensible by actual UW flow-alert data.

    Lazy: first call after a scan triggers enrichment (~30s for 20 tickers);
    subsequent calls return from the cached `result_json.top_plays` instantly.
    """
    scan = await talon_store.load_latest_scan()
    if scan is None:
        raise HTTPException(404, "no_scan_in_db")

    cached = scan.get("top_plays")
    if cached and not force_recompute:
        return {
            "scan_id": scan["scan_id"],
            "scan_date": scan["scan_date"],
            "generated_at": scan["generated_at"],
            "top_plays": cached,
            "_cache_hit": True,
        }

    setups = scan.get("actionable") or []
    if not setups:
        raise HTTPException(422, "no_actionable_setups_to_enrich")

    # Build price lookup: DB first (free), yfinance for misses
    tickers = [s["ticker"] for s in setups[: talon_top_plays.TOP_N]]
    db_prices: dict[str, float] = {}
    for t in tickers:
        try:
            p = await _price_lookup_db(t)
            if p is not None:
                db_prices[t] = float(p)
        except Exception:  # noqa: BLE001
            pass
    missing = [t for t in tickers if t not in db_prices]
    yf_prices = await asyncio.to_thread(_price_lookup_yf_batch, missing) if missing else {}
    prices = {**db_prices, **yf_prices}

    def lookup(ticker: str) -> float | None:
        return prices.get(ticker)

    # Run enrichment off the event loop (does sync httpx calls inside)
    plays = await asyncio.to_thread(talon_top_plays.compute_top_plays, setups, lookup)
    await talon_store.update_scan_top_plays(scan["scan_id"], plays)
    return {
        "scan_id": scan["scan_id"],
        "scan_date": scan["scan_date"],
        "generated_at": scan["generated_at"],
        "top_plays": plays,
        "_cache_hit": False,
    }
