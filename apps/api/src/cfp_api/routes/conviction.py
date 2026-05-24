"""Conviction Board — multi-source agreement screen.

GET /v1/conviction/board
    Tickers where Delphi + dark pool + insider + congress + UW smart-money
    + UW whales all point the same way. Sorted by # of confirming sources.
    Replaces the manual 8-section pre-trade checklist.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

from cfp_api.db import get_pool


router = APIRouter(tags=["conviction"], prefix="/v1/conviction")


class ConvictionRow(BaseModel):
    ticker: str
    spot_price: float | None
    agreement_direction: str        # 'bullish' | 'bearish' | 'mixed'
    sources_agreeing: int
    sources_total: int
    sources: dict[str, str]         # {'delphi':'bullish', 'dark_pool':'bullish', ...}
    has_conflict: bool
    conflict_codes: list[str]
    delphi_probability: float | None
    delphi_score: float | None
    regime: str | None


@router.get("/board", response_model=list[ConvictionRow])
async def board(
    direction: str | None = Query(None, regex="^(bullish|bearish)$"),
    min_sources: int = Query(3, ge=1, le=8),
    exclude_conflicts: bool = Query(False),
    limit: int = Query(50, ge=1, le=300),
) -> list[ConvictionRow]:
    """Join the latest delphi_features + latest delphi prediction per ticker.
    Count sources agreeing with `direction` (or whichever direction has more
    agreement when `direction` is None)."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            WITH f AS (
                SELECT DISTINCT ON (ticker) *
                FROM delphi_features
                ORDER BY ticker, snapshot_ts DESC
            ),
            d AS (
                SELECT DISTINCT ON (ticker) ticker, bias, probability, delphi_score, regime
                FROM delphi_predictions
                WHERE forecast_horizon = '1w'
                ORDER BY ticker, created_at DESC
            )
            SELECT f.ticker, f.spot_price, f.has_conflict, f.conflict_codes,
                   f.uw_smart_money_score, f.uw_whales_score,
                   f.dp_net_premium_24h, f.insider_buyers_30d, f.insider_sellers_30d,
                   f.congress_buys_14d, f.congress_sells_14d,
                   f.inst_net_delta_shares,
                   d.bias, d.probability, d.delphi_score, d.regime
            FROM f
            LEFT JOIN d USING (ticker)
            """
        )

    out: list[ConvictionRow] = []
    for r in rows:
        sources: dict[str, str] = {}
        if r["bias"]:
            sources["delphi"] = r["bias"]
        if r["dp_net_premium_24h"]:
            sources["dark_pool"] = "bullish" if r["dp_net_premium_24h"] > 0 else "bearish"
        if (r["insider_buyers_30d"] or 0) > (r["insider_sellers_30d"] or 0):
            sources["insider"] = "bullish"
        elif (r["insider_sellers_30d"] or 0) > (r["insider_buyers_30d"] or 0):
            sources["insider"] = "bearish"
        if (r["congress_buys_14d"] or 0) > (r["congress_sells_14d"] or 0):
            sources["congress"] = "bullish"
        elif (r["congress_sells_14d"] or 0) > (r["congress_buys_14d"] or 0):
            sources["congress"] = "bearish"
        if r["inst_net_delta_shares"] and r["inst_net_delta_shares"] > 0:
            sources["13F"] = "bullish"
        elif r["inst_net_delta_shares"] and r["inst_net_delta_shares"] < 0:
            sources["13F"] = "bearish"
        if r["uw_smart_money_score"] is not None:
            sources["uw_smart_money"] = "bullish" if r["uw_smart_money_score"] >= 0.5 else "bearish"
        if r["uw_whales_score"] is not None:
            sources["uw_whales"] = "bullish" if r["uw_whales_score"] >= 0.5 else "bearish"
        if not sources:
            continue

        n_bull = sum(1 for v in sources.values() if v == "bullish")
        n_bear = sum(1 for v in sources.values() if v == "bearish")
        if n_bull > n_bear:
            agree_dir = "bullish"
            n_agree = n_bull
        elif n_bear > n_bull:
            agree_dir = "bearish"
            n_agree = n_bear
        else:
            agree_dir = "mixed"
            n_agree = max(n_bull, n_bear)

        if direction and agree_dir != direction:
            continue
        if n_agree < min_sources:
            continue
        if exclude_conflicts and r["has_conflict"]:
            continue

        out.append(ConvictionRow(
            ticker=r["ticker"],
            spot_price=r["spot_price"],
            agreement_direction=agree_dir,
            sources_agreeing=n_agree,
            sources_total=len(sources),
            sources=sources,
            has_conflict=bool(r["has_conflict"]),
            conflict_codes=list(r["conflict_codes"] or []),
            delphi_probability=r["probability"],
            delphi_score=r["delphi_score"],
            regime=r["regime"],
        ))
    out.sort(key=lambda x: (x.sources_agreeing, x.delphi_score or 0), reverse=True)
    return out[:limit]
