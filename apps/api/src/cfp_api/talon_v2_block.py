"""Talon v2 Phase 4.2 — dark pool block accumulation.

Queries the existing `uw_dark_pool_prints` table that powers /v1/smart-money/tape
and aggregates per ticker over the last 5 sessions:

  dp_buy_notional_5d     : sum of buy-side (above mid) dark pool $ over 5d
  dp_sell_notional_5d    : sum of sell-side (below mid) dark pool $ over 5d
  dp_net_notional_5d     : buy minus sell
  dp_n_blocks_5d         : count of prints
  dp_n_buy_blocks_5d     : count of buy-side prints
  dp_buy_ratio_5d        : buy_notional / (buy + sell)
  dp_largest_print_5d    : single biggest print $
  dp_block_flag          : True if buy_ratio >= 0.65 AND buy_notional >= $5M

Block accumulation is distinct from the options whale signal in Phase 1.3:
this is equity-side institutional positioning (vs derivatives positioning).
Both confirming = highest-conviction setup.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from cfp_api.db import get_pool

log = logging.getLogger(__name__)


async def _fetch_aggregates_async(tickers: list[str]) -> dict[str, dict]:
    if not tickers:
        return {}
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                ticker,
                COALESCE(SUM(CASE WHEN direction = 'buy'  THEN notional END), 0) AS buy_n,
                COALESCE(SUM(CASE WHEN direction = 'sell' THEN notional END), 0) AS sell_n,
                COUNT(*) AS n_blocks,
                COUNT(*) FILTER (WHERE direction = 'buy') AS n_buy_blocks,
                COALESCE(MAX(notional), 0) AS largest_print
            FROM uw_dark_pool_prints
            WHERE ts >= NOW() - INTERVAL '5 days'
              AND ticker = ANY($1::text[])
            GROUP BY ticker
            """,
            tickers,
        )
    out: dict[str, dict] = {}
    for r in rows:
        buy = float(r["buy_n"] or 0)
        sell = float(r["sell_n"] or 0)
        total = buy + sell
        buy_ratio = round(buy / total, 4) if total > 0 else None
        net = buy - sell
        flag = (buy_ratio is not None and buy_ratio >= 0.65 and buy >= 5_000_000)
        out[r["ticker"]] = {
            "dp_buy_notional_5d": round(buy, 2),
            "dp_sell_notional_5d": round(sell, 2),
            "dp_net_notional_5d": round(net, 2),
            "dp_n_blocks_5d": int(r["n_blocks"] or 0),
            "dp_n_buy_blocks_5d": int(r["n_buy_blocks"] or 0),
            "dp_buy_ratio_5d": buy_ratio,
            "dp_largest_print_5d": round(float(r["largest_print"] or 0), 2),
            "dp_block_flag": flag,
        }
    # Fill in zeroed defaults for tickers with no recent prints
    for t in tickers:
        out.setdefault(t, {
            "dp_buy_notional_5d": 0.0,
            "dp_sell_notional_5d": 0.0,
            "dp_net_notional_5d": 0.0,
            "dp_n_blocks_5d": 0,
            "dp_n_buy_blocks_5d": 0,
            "dp_buy_ratio_5d": None,
            "dp_largest_print_5d": 0.0,
            "dp_block_flag": False,
        })
    return out


def fetch_aggregates(tickers: list[str]) -> dict[str, dict]:
    """Sync wrapper for scanner phase. Returns empty dict on failure."""
    if not tickers:
        return {}
    try:
        return asyncio.run(_fetch_aggregates_async(tickers))
    except Exception as e:  # noqa: BLE001
        log.warning("v2 dark pool aggregates failed: %s", e)
        return {}
