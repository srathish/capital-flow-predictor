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

from cfp_api import talon_v2_scanner, talon_v2_store, talon_v2_top_plays
from cfp_api.db import get_pool

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/talon/v2", tags=["talon-v2"])


async def _price_lookup_db(ticker: str) -> float | None:
    pool = get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "SELECT close FROM prices_daily WHERE ticker = $1 "
            "ORDER BY ts DESC LIMIT 1",
            ticker,
        )


def _price_lookup_yf_batch(tickers: list[str]) -> dict[str, float]:
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


@router.get("/top-plays")
async def get_v2_top_plays(
    force_recompute: bool = Query(False, description="Skip cached enrichment"),
) -> dict[str, Any]:
    """Top ~20 setups from the latest v2 scan, enriched with current price,
    wall structure, and three contract tiers (defensive ITM / standard ATM /
    aggressive OTM) — anchored to whale concentration when available, with
    earnings IV-crush guardrails and MA-structure-aware tier sizing.

    Lazy: first call after a scan triggers enrichment (~30-60s for 20 tickers);
    subsequent calls return cached `result_json.v2_top_plays` instantly.
    """
    scan = await talon_v2_store.load_latest_v2_scan()
    if scan is None:
        raise HTTPException(404, "no_v2_scan_in_db")

    cached = scan.get("v2_top_plays")
    if cached and not force_recompute:
        return {
            "v2_scan_id": scan["v2_scan_id"],
            "scan_date": scan["scan_date"],
            "generated_at": scan["v2_generated_at"],
            "top_plays": cached,
            "_cache_hit": True,
        }

    # Select candidate tickers (top by combined v1 grade + whale + pattern)
    actionable = scan.get("actionable") or []
    whale_setups = scan.get("whale_setups") or []
    candidate_tickers: list[str] = []
    seen: set[str] = set()
    # Walk both lists prioritized by whale flag
    for r in whale_setups + actionable:
        t = r.get("ticker")
        if t and t not in seen:
            seen.add(t)
            candidate_tickers.append(t)
        if len(candidate_tickers) >= talon_v2_top_plays.TOP_N * 2:
            break
    if not candidate_tickers:
        raise HTTPException(422, "no_actionable_or_whale_setups_to_enrich")

    # Price lookup
    db_prices: dict[str, float] = {}
    for t in candidate_tickers:
        try:
            p = await _price_lookup_db(t)
            if p is not None:
                db_prices[t] = float(p)
        except Exception:  # noqa: BLE001
            pass
    missing = [t for t in candidate_tickers if t not in db_prices]
    yf_prices = await asyncio.to_thread(_price_lookup_yf_batch, missing) if missing else {}
    prices = {**db_prices, **yf_prices}

    def lookup(ticker: str) -> float | None:
        return prices.get(ticker)

    plays = await asyncio.to_thread(
        talon_v2_top_plays.compute_v2_top_plays, scan, lookup
    )
    await talon_v2_store.update_v2_scan_top_plays(scan["v2_scan_id"], plays)
    return {
        "v2_scan_id": scan["v2_scan_id"],
        "scan_date": scan["scan_date"],
        "generated_at": scan["v2_generated_at"],
        "top_plays": plays,
        "_cache_hit": False,
    }


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
