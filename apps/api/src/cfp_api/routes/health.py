"""Deep health endpoint.

/v1/health/detailed reports table-level freshness so the dashboard's news-decay
and completeness guards aren't blind. We sample ``max(ts)`` for each table that
has a time column and ``count(*)`` for the smaller ones.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter

from cfp_api.db import get_pool
from cfp_api.settings import settings

router = APIRouter(prefix="/v1/health", tags=["health"])


# (table, time_column, fresh_threshold_hours, count?)
_TABLES: list[tuple[str, str | None, int | None, bool]] = [
    ("prices_daily", "ts", None, True),
    ("agent_signals", "run_ts", None, True),
    ("predictions", "run_ts", None, True),
    ("etf_holdings", "as_of", None, True),
    ("uw_flow_alerts", "created_at", None, True),
    ("uw_insider_transactions", "transaction_date", None, True),
    ("uw_earnings", "report_date", None, False),
    ("reddit_mentions", "ts", None, True),
    ("reddit_posts", "created_utc", None, True),
    ("news_items", "published_at", None, True),
    ("etf_breadth_snapshots", "as_of", None, True),
    ("whale_conviction", "as_of", None, True),
    ("run_evidence", "run_ts", None, False),
]


def _freshness_threshold(table: str) -> int:
    if table.startswith("prices") or table == "etf_breadth_snapshots":
        return settings.health_stale_hours_prices
    if table.startswith("agent_") or table == "predictions" or table == "run_evidence":
        return settings.health_stale_hours_signals
    if table in {"news_items", "reddit_mentions", "reddit_posts"}:
        return settings.health_stale_hours_news
    return 72


@router.get("/detailed")
async def detailed_health() -> dict[str, Any]:
    """Per-table freshness + row counts. Returns 200 always; clients inspect ``status_per_table``."""
    pool = get_pool()
    now = datetime.now(UTC)
    out: dict[str, Any] = {
        "status": "ok",
        "checked_at": now.isoformat(),
        "tables": [],
        "stale_tables": [],
    }
    overall_ok = True
    async with pool.acquire() as conn:
        for table, ts_col, _, want_count in _TABLES:
            row: dict[str, Any] = {"table": table, "exists": False}
            try:
                exists = await conn.fetchval(
                    "SELECT to_regclass($1) IS NOT NULL", f"public.{table}"
                )
                if not exists:
                    out["tables"].append(row)
                    continue
                row["exists"] = True
                if ts_col is not None:
                    max_ts = await conn.fetchval(
                        f"SELECT MAX({ts_col}) FROM {table}"  # noqa: S608 — table list is static
                    )
                    if max_ts is None:
                        row["max_ts"] = None
                        row["age_hours"] = None
                        row["fresh"] = False
                    else:
                        # ts_col may be DATE -> normalize to datetime UTC for delta math
                        if isinstance(max_ts, datetime):
                            if max_ts.tzinfo is None:
                                max_ts = max_ts.replace(tzinfo=UTC)
                            age_h = (now - max_ts).total_seconds() / 3600.0
                        else:
                            mt_dt = datetime(max_ts.year, max_ts.month, max_ts.day, tzinfo=UTC)
                            age_h = (now - mt_dt).total_seconds() / 3600.0
                        row["max_ts"] = str(max_ts)
                        row["age_hours"] = round(age_h, 2)
                        row["fresh"] = age_h <= _freshness_threshold(table)
                if want_count:
                    row["row_count"] = await conn.fetchval(
                        f"SELECT COUNT(*) FROM {table}"  # noqa: S608
                    )
                if row.get("fresh") is False:
                    overall_ok = False
                    out["stale_tables"].append(table)
            except Exception as e:  # pragma: no cover — never let one bad table 500 the endpoint
                row["error"] = f"{type(e).__name__}: {e}"
                overall_ok = False
            out["tables"].append(row)
    out["status"] = "ok" if overall_ok else "degraded"
    return out
