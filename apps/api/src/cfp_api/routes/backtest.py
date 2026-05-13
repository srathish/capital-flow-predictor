"""Monte Carlo backtest endpoint.

GET /v1/backtest/monte-carlo?ticker=NVDA&days=252&n_sims=2000&block_size=5

Pulls daily returns for `ticker` from prices_daily, bootstraps them via
`cfp_models.monte_carlo`, and returns the percentile distribution of total
return, max drawdown, Sharpe, and win rate. Used by the FE backtester modal
to answer "how fragile is this strategy's realized P&L?"
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from cfp_api.db import get_pool

router = APIRouter(prefix="/v1/backtest", tags=["backtest"])


@router.get("/monte-carlo")
async def monte_carlo(
    ticker: str = Query(..., min_length=1, max_length=12),
    days: int = Query(252, ge=30, le=2520, description="Lookback window in trading days"),
    n_sims: int = Query(2000, ge=100, le=20000, description="Bootstrap sample count"),
    block_size: int = Query(1, ge=1, le=60, description="Block bootstrap size; >1 preserves autocorrelation"),
    seed: int = Query(42),
) -> dict[str, Any]:
    """Return the bootstrap percentile distribution of return/DD/Sharpe/win-rate."""
    sym = ticker.strip().upper()
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ts, close FROM prices_daily
            WHERE symbol = $1
              AND ts >= NOW() - ($2 || ' days')::interval
            ORDER BY ts
            """,
            sym, str(days),
        )
    if len(rows) < 30:
        raise HTTPException(
            status_code=404,
            detail=f"not enough price history for {sym} (have {len(rows)} bars, need >= 30)",
        )

    closes = np.array([float(r["close"]) for r in rows if r["close"] is not None], dtype=float)
    if len(closes) < 30:
        raise HTTPException(status_code=404, detail="too many null closes")
    daily_returns = np.diff(closes) / closes[:-1]

    # Import here so the route loads even when numpy import is slow at boot.
    from cfp_models.monte_carlo import run_monte_carlo

    res = run_monte_carlo(
        daily_returns,
        n_sims=n_sims,
        block_size=block_size,
        seed=seed,
    )
    return {
        "ticker": sym,
        "lookback_days": days,
        "n_bars": len(closes),
        "realized": {
            "total_return": float(np.prod(1.0 + daily_returns) - 1.0),
            "mean_daily": float(np.mean(daily_returns)),
            "std_daily": float(np.std(daily_returns, ddof=1)),
        },
        "bootstrap": res.to_dict(),
    }
