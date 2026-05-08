"""ETF holdings ingestion via yfinance.

We previously planned FMP for this, but FMP's /etf/holdings endpoint moved
behind a paid tier in late 2025. yfinance returns top-10 holdings with
weights for free, no key. Top-10 is sufficient for our top-down -> bottom-up
watchlist use case (Phase 4e).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import yfinance as yf

from cfp_jobs.db import connect, upsert_holdings

log = logging.getLogger(__name__)
SOURCE = "yfinance"


def _to_float(v: object) -> float | None:
    if v is None:
        return None
    try:
        return float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def fetch_holdings(etf: str) -> list[dict]:
    """Fetch top holdings for one ETF via yfinance.

    yfinance >= 0.2.40 exposes Ticker.funds_data with .top_holdings, a DataFrame
    indexed by symbol with columns ['Name', 'Holding Percent']. Holding Percent
    is a fraction (0.121 = 12.1%); we store as a percentage to match FMP shape.
    """
    now = datetime.now(UTC)
    try:
        df = yf.Ticker(etf).funds_data.top_holdings
    except Exception as e:
        log.warning("yfinance funds_data failed for %s: %s", etf, e)
        return []

    if df is None or df.empty:
        return []

    rows: list[dict] = []
    for symbol, row in df.iterrows():
        constituent = str(symbol)
        weight_frac = _to_float(row.get("Holding Percent"))
        weight_pct = weight_frac * 100.0 if weight_frac is not None else None
        rows.append(
            {
                "sector_etf": etf,
                "constituent": constituent,
                "weight": weight_pct,
                "last_updated": now,
                "source": SOURCE,
            }
        )
    return rows


def ingest(database_url: str, etfs: list[str]) -> int:
    """Fetch holdings for each ETF and upsert. Returns total rows written."""
    total = 0
    with connect(database_url) as conn:
        for etf in etfs:
            rows = fetch_holdings(etf)
            n = upsert_holdings(conn, rows)
            total += n
            log.info("holdings %s: %d rows", etf, n)
        conn.commit()
    return total
