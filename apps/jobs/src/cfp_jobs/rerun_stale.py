"""Catalyst-triggered ensemble re-runs.

The screener can only be as fresh as the underlying agent_signals rows. This
job picks the *intersection of "tickers worth re-analyzing"* — based on
whether something material changed in the last 24h — and runs the ensemble
on each. Cheaper and more focused than scanning a fixed universe daily.

Inclusion criteria (union of sources, deduped):
  * Custom watchlist (any session) — user explicitly opted in
  * Recent unusual flow (uw_flow_alerts > $premium threshold in last 24h)
  * Insider buys in the last 24h (uw_insider_transactions, transaction_code=P)
  * Earnings tomorrow (uw_earnings.report_date = CURRENT_DATE + 1)
  * Anything whose PM run is older than `--stale-hours` (default 48)

Cap at `--max-tickers` to bound cost (default 30 — Sonnet at ~$0.15/run = $4.50/day).

Run via: `cfp-jobs ensemble-rerun-stale`. Scheduled at 06:00 ET on weekdays.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime
from typing import Any

from cfp_jobs.db import connect

log = logging.getLogger(__name__)

DEFAULT_FLOW_PREMIUM_THRESHOLD = 1_000_000.0  # $1M premium = institutional-sized
DEFAULT_STALE_HOURS = 48
DEFAULT_MAX_TICKERS = 30


def collect_candidates(
    database_url: str,
    *,
    flow_premium_threshold: float = DEFAULT_FLOW_PREMIUM_THRESHOLD,
    stale_hours: int = DEFAULT_STALE_HOURS,
) -> dict[str, list[str]]:
    """Return a dict of (source_name -> list of tickers). Each source is
    independent; the caller dedups across them."""
    out: dict[str, list[str]] = {}
    with connect(database_url) as conn, conn.cursor() as cur:
        # 1. custom_watchlist (any session)
        try:
            cur.execute(
                "SELECT DISTINCT ticker FROM custom_watchlist ORDER BY ticker"
            )
            out["custom_watchlist"] = [r[0] for r in cur.fetchall()]
        except Exception as e:
            log.warning("custom_watchlist lookup failed: %s", e)
            out["custom_watchlist"] = []

        # 2. Recent big flow alerts
        try:
            cur.execute(
                """
                SELECT DISTINCT ticker FROM uw_flow_alerts
                WHERE created_at > NOW() - INTERVAL '24 hours'
                  AND total_premium >= %s
                ORDER BY ticker
                """,
                (flow_premium_threshold,),
            )
            out["flow_alerts_24h"] = [r[0] for r in cur.fetchall()]
        except Exception as e:
            log.warning("flow_alerts lookup failed: %s", e)
            out["flow_alerts_24h"] = []

        # 3. Insider buys in last 24h
        try:
            cur.execute(
                """
                SELECT DISTINCT ticker FROM uw_insider_transactions
                WHERE transaction_date > CURRENT_DATE - 1
                  AND transaction_code = 'P'
                ORDER BY ticker
                """
            )
            out["insider_buys_24h"] = [r[0] for r in cur.fetchall()]
        except Exception as e:
            log.warning("insider buys lookup failed: %s", e)
            out["insider_buys_24h"] = []

        # 4. Earnings tomorrow
        try:
            cur.execute(
                """
                SELECT DISTINCT ticker FROM uw_earnings
                WHERE report_date = CURRENT_DATE + 1
                ORDER BY ticker
                """
            )
            out["earnings_tomorrow"] = [r[0] for r in cur.fetchall()]
        except Exception as e:
            log.warning("earnings tomorrow lookup failed: %s", e)
            out["earnings_tomorrow"] = []

        # 5. Stale PM signals — tickers we've covered but haven't reanalyzed
        # in `stale_hours`. We don't add brand-new tickers from this source —
        # that's what the other four are for.
        try:
            cur.execute(
                """
                SELECT ticker FROM (
                    SELECT DISTINCT ON (ticker) ticker, run_ts
                    FROM agent_signals
                    WHERE agent = 'portfolio_manager'
                    ORDER BY ticker, run_ts DESC
                ) latest
                WHERE run_ts < NOW() - (%s || ' hours')::interval
                ORDER BY ticker
                """,
                (str(stale_hours),),
            )
            out["stale_pm"] = [r[0] for r in cur.fetchall()]
        except Exception as e:
            log.warning("stale-PM lookup failed: %s", e)
            out["stale_pm"] = []

    return out


def dedupe_with_priority(sources: dict[str, list[str]], cap: int) -> list[tuple[str, str]]:
    """Return [(ticker, source)] in priority order, deduplicated. Earlier
    sources win when a ticker appears in multiple. Cap at `cap`."""
    priority = [
        "earnings_tomorrow",   # most time-sensitive
        "insider_buys_24h",
        "flow_alerts_24h",
        "custom_watchlist",
        "stale_pm",            # least urgent — just a refresh
    ]
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for source in priority:
        for t in sources.get(source, []):
            if t in seen:
                continue
            seen.add(t)
            out.append((t, source))
            if len(out) >= cap:
                return out
    return out


def run(
    database_url: str,
    *,
    max_tickers: int = DEFAULT_MAX_TICKERS,
    flow_premium_threshold: float = DEFAULT_FLOW_PREMIUM_THRESHOLD,
    stale_hours: int = DEFAULT_STALE_HOURS,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Pick candidates → optionally invoke the ensemble. Returns a summary dict
    so the CLI can print row counts; reads cleanly in tests as well."""
    sources = collect_candidates(
        database_url,
        flow_premium_threshold=flow_premium_threshold,
        stale_hours=stale_hours,
    )
    queue = dedupe_with_priority(sources, max_tickers)

    summary: dict[str, Any] = {
        "started_at": datetime.now(UTC).isoformat(),
        "sources": {k: len(v) for k, v in sources.items()},
        "queue": [{"ticker": t, "source": s} for t, s in queue],
        "max_tickers": max_tickers,
        "dry_run": dry_run,
        "ran": [],
        "failed": [],
    }
    if dry_run or not queue:
        return summary

    # Lazy import — agents_runner pulls in heavy LangGraph deps.
    from cfp_jobs import agents_runner

    for ticker, source in queue:
        t0 = time.monotonic()
        try:
            run_ts = datetime.now(UTC)
            agents_runner.run_analysts_streaming(
                database_url, ticker, sector="", run_ts=run_ts, include_personas=True,
            )
            elapsed = time.monotonic() - t0
            summary["ran"].append({"ticker": ticker, "source": source, "elapsed_s": round(elapsed, 1)})
            log.info("rerun-stale %s (%s) ok in %.1fs", ticker, source, elapsed)
        except Exception as e:
            elapsed = time.monotonic() - t0
            summary["failed"].append({"ticker": ticker, "source": source, "error": str(e)[:200]})
            log.warning("rerun-stale %s (%s) failed after %.1fs: %s", ticker, source, elapsed, e)

    summary["finished_at"] = datetime.now(UTC).isoformat()
    return summary
