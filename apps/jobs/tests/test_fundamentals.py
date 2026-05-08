from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from unittest.mock import MagicMock

from cfp_jobs.ingestion.fundamentals import (
    _expand,
    fetch_one,
    needs_refresh,
)


def test_expand_filters_missing_values() -> None:
    statements = [
        {"date": "2024-09-30", "revenue": 95000000, "netIncome": 14000000},
        {"date": "2023-09-30", "revenue": 89000000, "netIncome": None},
        {"date": "bad-date", "revenue": 1, "netIncome": 1},  # parse fail -> skipped
    ]
    rows = _expand(statements, {"revenue": "revenue", "netIncome": "net_income"}, "A", "AAPL")
    # 2 valid revenue + 1 valid net_income (the second's net_income is None) = 3
    assert len(rows) == 3
    metrics_by_period = {(r["fiscal_period"], r["metric"]): r["value"] for r in rows}
    assert metrics_by_period[(date(2024, 9, 30), "revenue")] == 95000000
    assert metrics_by_period[(date(2024, 9, 30), "net_income")] == 14000000
    assert metrics_by_period[(date(2023, 9, 30), "revenue")] == 89000000
    assert (date(2023, 9, 30), "net_income") not in metrics_by_period


def test_needs_refresh_no_data() -> None:
    assert needs_refresh(None) is True


def test_needs_refresh_recent_data() -> None:
    recent = datetime.now(UTC).date() - timedelta(days=30)
    assert needs_refresh(recent, min_age_days=90) is False


def test_needs_refresh_stale_data() -> None:
    stale = datetime.now(UTC).date() - timedelta(days=120)
    assert needs_refresh(stale, min_age_days=90) is True


def test_fetch_one_calls_all_five_endpoints() -> None:
    """fetch_one should hit income, balance, cash_flow, key_metrics, and ratios.

    Under the /stable/ API, P/E and P/B live on /ratios, not /key-metrics, so
    we call both.
    """
    client = MagicMock()
    client.income_statement.return_value = [{"date": "2024-09-30", "revenue": 1.0}]
    client.balance_sheet.return_value = [{"date": "2024-09-30", "totalAssets": 2.0}]
    client.cash_flow.return_value = [{"date": "2024-09-30", "freeCashFlow": 3.0}]
    client.key_metrics.return_value = [{"date": "2024-09-30", "returnOnEquity": 0.5}]
    client.ratios.return_value = [{"date": "2024-09-30", "priceToEarningsRatio": 25.0}]

    rows = fetch_one(client, "AAPL")
    for method in ("income_statement", "balance_sheet", "cash_flow", "key_metrics", "ratios"):
        assert getattr(client, method).called, f"{method} was not called"
    metrics = {r["metric"] for r in rows}
    assert {"revenue", "total_assets", "free_cash_flow", "roe", "pe_ratio"}.issubset(metrics)
