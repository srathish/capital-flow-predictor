"""Stock fundamentals ingestion (FMP).

Strategy: cache aggressively. Fundamentals only update when a company files
its quarterly/annual report, so we skip fetching if the latest fiscal_period
in the DB is fresher than `min_period_age_days`. This keeps daily FMP usage
near zero in steady state.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import UTC, date, datetime

import psycopg

from cfp_jobs.db import connect, upsert_fundamentals
from cfp_jobs.ingestion.fmp import FmpClient

log = logging.getLogger(__name__)
SOURCE = "fmp"

# Map FMP statement field names -> our metric names. Keep this list lean —
# we expand as agents need more fields.
INCOME_FIELDS = {
    "revenue": "revenue",
    "grossProfit": "gross_profit",
    "operatingIncome": "operating_income",
    "netIncome": "net_income",
    "eps": "eps",
    "ebitda": "ebitda",
}
BALANCE_FIELDS = {
    "totalAssets": "total_assets",
    "totalLiabilities": "total_liabilities",
    "totalStockholdersEquity": "total_equity",
    "totalDebt": "total_debt",
    "cashAndCashEquivalents": "cash",
}
CASHFLOW_FIELDS = {
    "operatingCashFlow": "operating_cash_flow",
    "freeCashFlow": "free_cash_flow",
    "capitalExpenditure": "capex",
}
# /stable/key-metrics — return / yield / capital-efficiency
METRICS_FIELDS = {
    "returnOnEquity": "roe",
    "returnOnAssets": "roa",
    "returnOnInvestedCapital": "roic",
    "freeCashFlowYield": "fcf_yield",
    "earningsYield": "earnings_yield",
    "evToEBITDA": "ev_to_ebitda",
    "evToSales": "ev_to_sales",
    "marketCap": "market_cap",
    "enterpriseValue": "enterprise_value",
}

# /stable/ratios — valuation multiples & leverage (P/E, P/B, debt ratios moved here)
RATIO_FIELDS = {
    "priceToEarningsRatio": "pe_ratio",
    "priceToBookRatio": "price_to_book",
    "priceToSalesRatio": "price_to_sales",
    "debtToEquityRatio": "debt_to_equity",
    "debtToAssetsRatio": "debt_to_assets",
    "currentRatio": "current_ratio",
    "quickRatio": "quick_ratio",
    "interestCoverageRatio": "interest_coverage",
    "grossProfitMargin": "gross_margin",
    "operatingProfitMargin": "operating_margin",
    "netProfitMargin": "net_margin",
    "dividendYield": "dividend_yield",
}


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s).date()
    except (TypeError, ValueError):
        return None


def _to_float(v: object) -> float | None:
    if v is None:
        return None
    try:
        return float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _expand(
    statements: list[dict],
    field_map: dict[str, str],
    period_type: str,
    ticker: str,
) -> list[dict]:
    now = datetime.now(UTC)
    rows: list[dict] = []
    for stmt in statements:
        fp = _parse_date(stmt.get("date"))
        if fp is None:
            continue
        for fmp_key, metric_name in field_map.items():
            value = _to_float(stmt.get(fmp_key))
            if value is None:
                continue
            rows.append(
                {
                    "ticker": ticker,
                    "fiscal_period": fp,
                    "period_type": period_type,
                    "metric": metric_name,
                    "value": value,
                    "source": SOURCE,
                    "last_fetched": now,
                }
            )
    return rows


def latest_fiscal_period(conn: psycopg.Connection, ticker: str) -> date | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT MAX(fiscal_period) FROM fundamentals WHERE ticker = %s",
            (ticker,),
        )
        row = cur.fetchone()
    return row[0] if row and row[0] else None


def needs_refresh(latest: date | None, min_age_days: int = 90) -> bool:
    """If we have nothing or our latest period is older than `min_age_days`, refresh."""
    if latest is None:
        return True
    age = (datetime.now(UTC).date() - latest).days
    return age > min_age_days


def fetch_one(client: FmpClient, ticker: str, period: str = "annual", limit: int = 5) -> list[dict]:
    """Fetch all statement types for a single ticker. 5 FMP calls per ticker."""
    period_type = "A" if period == "annual" else "Q"
    rows: list[dict] = []
    rows.extend(_expand(client.income_statement(ticker, period, limit), INCOME_FIELDS, period_type, ticker))
    rows.extend(_expand(client.balance_sheet(ticker, period, limit), BALANCE_FIELDS, period_type, ticker))
    rows.extend(_expand(client.cash_flow(ticker, period, limit), CASHFLOW_FIELDS, period_type, ticker))
    rows.extend(_expand(client.key_metrics(ticker, period, limit), METRICS_FIELDS, period_type, ticker))
    rows.extend(_expand(client.ratios(ticker, period, limit), RATIO_FIELDS, period_type, ticker))
    return rows


def ingest(
    database_url: str,
    api_key: str,
    tickers: Iterable[str],
    *,
    period: str = "annual",
    limit: int = 5,
    force: bool = False,
    min_age_days: int = 90,
) -> dict:
    """Ingest fundamentals for `tickers`. Returns {tickers_fetched, tickers_skipped, rows}."""
    fetched = 0
    skipped = 0
    total_rows = 0
    fmp_calls = 0

    with FmpClient(api_key) as client, connect(database_url) as conn:
        for ticker in tickers:
            if not force:
                latest = latest_fiscal_period(conn, ticker)
                if not needs_refresh(latest, min_age_days):
                    skipped += 1
                    continue
            try:
                rows = fetch_one(client, ticker, period=period, limit=limit)
                fmp_calls += 5  # 5 endpoints per ticker (income/balance/cash/key/ratios)
            except Exception as e:
                log.warning("FMP fundamentals fail for %s: %s", ticker, e)
                continue
            n = upsert_fundamentals(conn, rows)
            total_rows += n
            fetched += 1
            log.info("fundamentals %s: %d rows", ticker, n)
        conn.commit()

    return {
        "tickers_fetched": fetched,
        "tickers_skipped": skipped,
        "rows": total_rows,
        "fmp_calls": fmp_calls,
    }
