"""Watchlist orchestrator (Phase 4e).

Pipeline:
  1. Read top-N sector predictions from the latest xgb_v1 run (configurable horizon)
  2. For each top sector, pull top-K constituents from sector_holdings
  3. For each (sector, ticker), run the full agent ensemble
     (4 analysts + 13 personas + Trader + Risk + PM)
  4. Take the Portfolio Manager's final decision and write a watchlists row
     ranked within the sector by (confidence * target_weight)

Cost & latency (Moonshot Haiku-class): ~$0.015 + ~38s per ticker.
With defaults (top 3 sectors * top 5 names = 15 tickers): ~10 min, ~$0.22/run.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import pandas as pd
import psycopg

from cfp_jobs import agents_runner
from cfp_jobs.db import connect, to_psycopg_url, upsert_watchlist

log = logging.getLogger(__name__)


def _load_top_sectors(
    conn: psycopg.Connection,
    *,
    horizon: int,
    model: str,
    n_top: int,
) -> list[str]:
    """Top-N sectors from the latest run of the given model + horizon."""
    sql = """
        WITH latest AS (
            SELECT MAX(run_ts) AS run_ts
            FROM predictions
            WHERE horizon_d = %s AND model = %s
        )
        SELECT p.symbol
        FROM predictions p, latest
        WHERE p.run_ts = latest.run_ts
          AND p.horizon_d = %s
          AND p.model = %s
        ORDER BY p.target_ts DESC, p.rank ASC
        LIMIT %s
    """
    with conn.cursor() as cur:
        cur.execute(sql, (horizon, model, horizon, model, n_top))
        rows = cur.fetchall()
    if not rows:
        return []
    # The query above returns top-ranked predictions across the latest run.
    # For each row, the symbol is a candidate sector. Dedup preserving order.
    seen: set[str] = set()
    sectors: list[str] = []
    for (sym,) in rows:
        if sym not in seen:
            seen.add(sym)
            sectors.append(sym)
        if len(sectors) >= n_top:
            break
    return sectors


def _load_top_sectors_for_latest_target_ts(
    conn: psycopg.Connection,
    *,
    horizon: int,
    model: str,
    n_top: int,
) -> list[str]:
    """Cleaner version: top-N by rank for the most recent target_ts in the latest run."""
    sql = """
        SELECT symbol, rank
        FROM predictions
        WHERE (run_ts, target_ts) = (
            SELECT run_ts, MAX(target_ts) FROM predictions
            WHERE run_ts = (SELECT MAX(run_ts) FROM predictions WHERE horizon_d = %s AND model = %s)
              AND horizon_d = %s AND model = %s
            GROUP BY run_ts
        )
        AND horizon_d = %s AND model = %s
        ORDER BY rank ASC
        LIMIT %s
    """
    with conn.cursor() as cur:
        cur.execute(sql, (horizon, model, horizon, model, horizon, model, n_top))
        rows = cur.fetchall()
    return [sym for (sym, _rank) in rows]


def _load_constituents(
    conn: psycopg.Connection, sector: str, k: int
) -> list[str]:
    """Top-K constituents of `sector` by weight from sector_holdings."""
    sql = """
        SELECT constituent
        FROM sector_holdings
        WHERE sector_etf = %s
          AND constituent IS NOT NULL
        ORDER BY weight DESC NULLS LAST
        LIMIT %s
    """
    with conn.cursor() as cur:
        cur.execute(sql, (sector, k))
        rows = cur.fetchall()
    return [c for (c,) in rows]


def _pm_to_watchlist_row(
    pm_summary: dict, sector: str, ticker: str, run_ts: datetime
) -> dict | None:
    """Extract the Portfolio Manager's signal from a run_analysts() summary."""
    pm_entries = [s for s in pm_summary.get("signals", []) if s["agent"] == "portfolio_manager"]
    if not pm_entries:
        return None
    pm = pm_entries[0]

    # We don't carry the full PM payload through run_analysts' summary dict —
    # re-load from DB to get target_weight + reasoning_notes.
    # Cheap: one row by primary key.
    return {
        "run_ts": run_ts,
        "sector": sector,
        "ticker": ticker,
        "rank": 0,  # filled in below after sorting within sector
        "final_signal": _signal_to_final(pm["signal"]),
        "final_confidence": float(pm["confidence"]),
        "target_weight": 0.0,  # filled by _attach_pm_payload
        "rationale": {"summary": pm["rationale"]},
    }


def _signal_to_final(signal: str) -> str:
    """Translate AgentSignal.signal -> watchlists.final_signal vocabulary."""
    return {"bullish": "long", "bearish": "short", "neutral": "avoid"}.get(signal, "avoid")


def _attach_pm_payload(
    conn: psycopg.Connection, row: dict, run_ts: datetime
) -> None:
    """Mutate `row` in place: pull target_weight + reasoning notes from agent_signals."""
    sql = """
        SELECT payload, rationale
        FROM agent_signals
        WHERE run_ts = %s AND ticker = %s AND agent = 'portfolio_manager'
        LIMIT 1
    """
    with conn.cursor() as cur:
        cur.execute(sql, (run_ts, row["ticker"]))
        result = cur.fetchone()
    if result:
        payload, rationale_text = result
        if isinstance(payload, dict):
            row["target_weight"] = float(payload.get("target_weight", 0.0))
            row["rationale"] = {
                "summary": rationale_text,
                "final_signal": payload.get("final_signal"),
                "target_weight": payload.get("target_weight"),
                "reasoning_notes": payload.get("reasoning_notes", []),
            }


def build_watchlist(
    database_url: str,
    *,
    n_top_sectors: int = 3,
    k_per_sector: int = 5,
    horizon: int = 10,
    model: str = "xgb_v1",
) -> dict:
    """Build a watchlist run end-to-end. Returns summary stats."""
    run_ts = datetime.now(UTC)

    with connect(database_url) as conn:
        sectors = _load_top_sectors_for_latest_target_ts(
            conn, horizon=horizon, model=model, n_top=n_top_sectors
        )

    if not sectors:
        log.warning("watchlist: no predictions found for horizon=%d model=%s", horizon, model)
        return {"run_ts": run_ts.isoformat(), "n_sectors": 0, "n_tickers": 0, "n_rows": 0}

    log.info("watchlist: top %d sectors = %s", n_top_sectors, sectors)

    rows_by_sector: dict[str, list[dict]] = {}
    n_tickers_processed = 0

    for sector in sectors:
        with connect(database_url) as conn:
            constituents = _load_constituents(conn, sector, k_per_sector)
        if not constituents:
            log.warning("watchlist: no constituents in sector_holdings for %s; skipping", sector)
            continue

        log.info("watchlist: sector %s -> %d constituents: %s", sector, len(constituents), constituents)
        sector_rows: list[dict] = []

        for ticker in constituents:
            try:
                pm_summary = agents_runner.run_analysts(
                    database_url, ticker, sector=sector, include_personas=True
                )
            except Exception as e:
                log.warning("watchlist: ensemble failed for %s/%s: %s", sector, ticker, e)
                continue
            n_tickers_processed += 1

            row = _pm_to_watchlist_row(pm_summary, sector, ticker, run_ts)
            if row is None:
                continue

            # Pull the full PM payload from the just-written agent_signals row
            with connect(database_url) as conn:
                # The runner uses its own run_ts; find the most recent one for this ticker
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT MAX(run_ts) FROM agent_signals WHERE ticker = %s AND agent = 'portfolio_manager'",
                        (ticker,),
                    )
                    pm_run_ts_row = cur.fetchone()
                if pm_run_ts_row and pm_run_ts_row[0]:
                    _attach_pm_payload(conn, row, pm_run_ts_row[0])

            sector_rows.append(row)

        # Rank within sector by (confidence * target_weight) desc; ties broken by confidence
        sector_rows.sort(
            key=lambda r: (r["final_confidence"] * r["target_weight"], r["final_confidence"]),
            reverse=True,
        )
        for i, r in enumerate(sector_rows, start=1):
            r["rank"] = i

        rows_by_sector[sector] = sector_rows

    all_rows = [r for rs in rows_by_sector.values() for r in rs]
    if all_rows:
        with connect(database_url) as conn:
            n = upsert_watchlist(conn, all_rows)
            conn.commit()
    else:
        n = 0

    log.info(
        "watchlist: %d sectors, %d tickers processed, %d rows persisted",
        len(rows_by_sector), n_tickers_processed, n,
    )
    return {
        "run_ts": run_ts.isoformat(),
        "n_sectors": len(rows_by_sector),
        "n_tickers": n_tickers_processed,
        "n_rows": n,
        "sectors": list(rows_by_sector.keys()),
    }


def latest_watchlist(database_url: str) -> pd.DataFrame:
    """Read the latest watchlist as a DataFrame for display."""
    sql = """
        SELECT run_ts, sector, rank, ticker, final_signal, final_confidence,
               target_weight, rationale
        FROM watchlists
        WHERE run_ts = (SELECT MAX(run_ts) FROM watchlists)
        ORDER BY sector, rank
    """
    with psycopg.connect(to_psycopg_url(database_url)) as conn, conn.cursor() as cur:
        cur.execute(sql)
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=cols)
