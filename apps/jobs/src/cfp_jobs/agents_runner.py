"""Run the agent ensemble for a ticker: DB load -> graph invoke -> persist signals.

Phase 4b: just the analyst layer. Researcher/Trader/Risk/PM nodes land in 4c-4e.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import pandas as pd
import psycopg
from cfp_agents.graph import build_analyst_graph, build_full_graph
from cfp_agents.state import AgentSignal
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect, to_psycopg_url

log = logging.getLogger(__name__)


AGENT_SIGNAL_UPSERT = """
INSERT INTO agent_signals (run_ts, ticker, agent, signal, confidence, rationale, payload)
VALUES (%(run_ts)s, %(ticker)s, %(agent)s, %(signal)s, %(confidence)s, %(rationale)s, %(payload)s)
ON CONFLICT (run_ts, ticker, agent) DO UPDATE SET
    signal = EXCLUDED.signal,
    confidence = EXCLUDED.confidence,
    rationale = EXCLUDED.rationale,
    payload = EXCLUDED.payload
"""


def _load_prices(conn: psycopg.Connection, ticker: str, lookback_days: int = 365) -> pd.DataFrame:
    sql = """
        SELECT ts, open, high, low, close, volume
        FROM prices_daily
        WHERE symbol = %s AND ts >= NOW() - (%s || ' days')::interval
        ORDER BY ts
    """
    with conn.cursor() as cur:
        cur.execute(sql, (ticker, str(lookback_days)))
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=cols)


def _load_fundamentals(conn: psycopg.Connection, ticker: str) -> pd.DataFrame:
    sql = """
        SELECT fiscal_period, period_type, metric, value, source, last_fetched
        FROM fundamentals
        WHERE ticker = %s
        ORDER BY fiscal_period
    """
    with conn.cursor() as cur:
        cur.execute(sql, (ticker,))
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=cols)


def _ensure_prices(database_url: str, ticker: str) -> pd.DataFrame:
    """Load prices from DB; if empty, pull a year via yfinance and upsert.

    The constituent-stock universe is much wider than our predictor universe,
    so most agent-targeted tickers won't have prices_daily rows yet.
    """
    with connect(database_url) as conn:
        prices = _load_prices(conn, ticker)
    if not prices.empty:
        return prices

    log.info("agents: no prices for %s in DB; pulling 1y via yfinance", ticker)
    from datetime import timedelta

    from cfp_jobs.ingestion import prices as prices_ingest

    start = datetime.now(UTC) - timedelta(days=400)
    prices_ingest.ingest(database_url, [ticker], start=start)
    with connect(database_url) as conn:
        prices = _load_prices(conn, ticker)
    return prices


def _build_flow_context(database_url: str, ticker: str, sector: str) -> dict:
    """Pull a structured Unusual Whales snapshot for the agents.

    The flow analyst node + select personas (Burry, Druckenmiller, Taleb, Buffett's
    insider lens) read this dict in their `extra_context()` hook. Shape is stable;
    missing UW data => empty sub-dicts so callers can defensively .get().

    Lazy ingestion: if the UW key is set and we haven't seen this ticker recently,
    we hit UW first to refresh — same UX as `_ensure_prices`. Skipped silently
    when the key is absent (so dev runs without a UW subscription still work).
    """
    from cfp_jobs.settings import settings

    uw_key = (settings.unusual_whales_api_key or "").strip()
    if not uw_key:
        return {}

    # Lazy refresh — only if there's no flow_alerts row for this ticker in the
    # last 24h. Avoids re-hitting UW on every chat refresh.
    try:
        with connect(database_url) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT MAX(created_at) FROM uw_flow_alerts WHERE ticker = %s",
                (ticker,),
            )
            row = cur.fetchone()
        latest = row[0] if row else None
        from datetime import timedelta

        if latest is None or latest < datetime.now(UTC) - timedelta(hours=24):
            log.info("agents: UW data for %s is stale or missing; refreshing", ticker)
            from cfp_jobs.ingestion import unusualwhales as uw_ingest

            try:
                uw_ingest.ingest_ticker(database_url, uw_key, ticker)
            except Exception as e:
                log.warning("UW lazy refresh failed for %s: %s", ticker, e)
    except Exception as e:
        log.warning("UW staleness check failed for %s: %s", ticker, e)

    # --- read aggregates back ---
    return _load_flow_context(database_url, ticker, sector)


def _load_flow_context(database_url: str, ticker: str, sector: str) -> dict:
    """SQL aggregations over the UW tables. Cheap and re-runnable."""
    out: dict = {}

    with connect(database_url) as conn, conn.cursor() as cur:
        # ---- options_flow ----
        cur.execute(
            """
            SELECT
              COUNT(*),
              COALESCE(SUM(CASE WHEN option_type='call' THEN ask_side_prem - bid_side_prem ELSE 0 END), 0),
              COALESCE(SUM(CASE WHEN option_type='put'  THEN ask_side_prem - bid_side_prem ELSE 0 END), 0),
              COALESCE(SUM(CASE WHEN option_type='call' AND expiry > CURRENT_DATE + INTERVAL '90 days'
                                THEN total_premium ELSE 0 END), 0),
              COALESCE(SUM(CASE WHEN option_type='put'  AND expiry > CURRENT_DATE + INTERVAL '90 days'
                                THEN total_premium ELSE 0 END), 0),
              COALESCE(AVG(CASE WHEN option_type='call' AND total_premium > 0
                                THEN ask_side_prem / total_premium END), 0.5),
              COALESCE(AVG(CASE WHEN option_type='put'  AND total_premium > 0
                                THEN ask_side_prem / total_premium END), 0.5)
            FROM uw_flow_alerts
            WHERE ticker = %s AND created_at > NOW() - INTERVAL '5 days'
            """,
            (ticker,),
        )
        r = cur.fetchone() or (0, 0, 0, 0, 0, 0.5, 0.5)
        out["options_flow"] = {
            "alert_count_5d": int(r[0] or 0),
            "net_call_premium_5d": float(r[1] or 0),
            "net_put_premium_5d": float(r[2] or 0),
            "leap_call_premium_5d": float(r[3] or 0),
            "leap_put_premium_5d": float(r[4] or 0),
            "call_at_ask_pct": float(r[5] or 0.5),
            "put_at_ask_pct": float(r[6] or 0.5),
        }

        # ---- top trades (cite-able) ----
        cur.execute(
            """
            SELECT created_at, option_type, expiry, strike, total_premium,
                   ask_side_prem, bid_side_prem, alert_rule
            FROM uw_flow_alerts
            WHERE ticker = %s AND created_at > NOW() - INTERVAL '5 days'
            ORDER BY total_premium DESC NULLS LAST
            LIMIT 5
            """,
            (ticker,),
        )
        out["options_flow"]["top_trades"] = [
            {
                "ts": (row[0].isoformat() if row[0] else None),
                "type": row[1],
                "expiry": (row[2].isoformat() if row[2] else None),
                "strike": float(row[3]) if row[3] is not None else None,
                "total_premium": float(row[4]) if row[4] is not None else None,
                "ask_prem": float(row[5]) if row[5] is not None else None,
                "bid_prem": float(row[6]) if row[6] is not None else None,
                "alert": row[7],
            }
            for row in cur.fetchall()
        ]

        # ---- dark pool ----
        cur.execute(
            """
            SELECT
              COUNT(*),
              COALESCE(SUM(premium), 0),
              COALESCE(AVG(CASE WHEN nbbo_ask > 0 AND nbbo_bid > 0
                                THEN CASE WHEN price > (nbbo_ask + nbbo_bid)/2 THEN 1.0 ELSE 0.0 END END), 0.5)
            FROM uw_dark_pool_prints
            WHERE ticker = %s AND executed_at > NOW() - INTERVAL '5 days' AND NOT canceled
            """,
            (ticker,),
        )
        r = cur.fetchone() or (0, 0, 0.5)
        out["dark_pool"] = {
            "prints_5d": int(r[0] or 0),
            "premium_5d": float(r[1] or 0),
            "above_vwap_pct": float(r[2] or 0.5),
        }

        # ---- positioning ----
        cur.execute(
            """
            SELECT short_shares_available, fee_rate, rebate_rate
            FROM uw_short_data WHERE ticker = %s
            ORDER BY ts DESC LIMIT 1
            """,
            (ticker,),
        )
        r = cur.fetchone()
        positioning: dict = {}
        if r:
            positioning.update({
                "short_shares_available": int(r[0]) if r[0] is not None else None,
                "fee_rate": float(r[1]) if r[1] is not None else None,
                "rebate_rate": float(r[2]) if r[2] is not None else None,
            })

        cur.execute(
            """
            SELECT date, call_delta, put_delta, call_gamma, put_gamma
            FROM uw_greek_exposure WHERE ticker = %s
            ORDER BY date DESC LIMIT 1
            """,
            (ticker,),
        )
        r = cur.fetchone()
        if r:
            call_g = float(r[3]) if r[3] is not None else 0.0
            put_g = float(r[4]) if r[4] is not None else 0.0
            positioning.update({
                "as_of_date": r[0].isoformat() if r[0] else None,
                "call_delta": float(r[1]) if r[1] is not None else None,
                "put_delta": float(r[2]) if r[2] is not None else None,
                "call_gamma": call_g,
                "put_gamma": put_g,
                "gex_total": call_g + put_g,
            })
        out["positioning"] = positioning

        # ---- smart_money: insider txns 30d ----
        cur.execute(
            """
            SELECT
              COUNT(*) FILTER (WHERE transaction_code = 'P'),
              COUNT(*) FILTER (WHERE transaction_code = 'S'),
              COALESCE(SUM(CASE WHEN transaction_code = 'P' THEN amount * COALESCE(price, 0) END), 0),
              COALESCE(SUM(CASE WHEN transaction_code = 'S' THEN amount * COALESCE(price, 0) END), 0)
            FROM uw_insider_transactions
            WHERE ticker = %s AND transaction_date > CURRENT_DATE - 30
            """,
            (ticker,),
        )
        r = cur.fetchone() or (0, 0, 0, 0)
        # SUM(amount * price): amount is signed (negative = sell), so the buy side
        # gives positive $ and the sell side gives negative $. Net = sum of both.
        buy_dollars = float(r[2] or 0)
        sell_dollars = float(r[3] or 0)
        out["smart_money"] = {
            "insider_buys_30d": int(r[0] or 0),
            "insider_sells_30d": int(r[1] or 0),
            "insider_net_amount_30d": buy_dollars + sell_dollars,
        }

        # ---- congress trades on this ticker, 30d ----
        cur.execute(
            """
            SELECT name, member_type, txn_type, amounts, transaction_date
            FROM uw_congress_trades
            WHERE ticker = %s AND transaction_date > CURRENT_DATE - 60
            ORDER BY transaction_date DESC
            LIMIT 5
            """,
            (ticker,),
        )
        out["smart_money"]["congress_trades"] = [
            {
                "name": row[0],
                "chamber": row[1],
                "type": row[2],
                "amount_band": row[3],
                "date": row[4].isoformat() if row[4] else None,
            }
            for row in cur.fetchall()
        ]

        # ---- etf_context — ETF flow for the sector this ticker rolls up to ----
        if sector:
            cur.execute(
                """
                SELECT
                  COALESCE(SUM(change_prem), 0),
                  COUNT(*)
                FROM uw_etf_flow
                WHERE ticker = %s AND date > CURRENT_DATE - 5
                """,
                (sector,),
            )
            r = cur.fetchone() or (0, 0)
            out["etf_context"] = {
                "sector_etf": sector,
                "in_flow_5d": float(r[0] or 0),
                "n_days": int(r[1] or 0),
            }

    return out


def _ensure_fundamentals_and_sector(
    database_url: str, ticker: str, sector: str
) -> tuple[pd.DataFrame, str]:
    """Lazy-load fundamentals + resolve sector for any ticker.

    Mirrors `_ensure_prices`: if the fundamentals table has nothing for this
    ticker, hit FMP and upsert. If `sector` wasn't supplied (the API run
    endpoint defaults to ""), look it up from FMP's company profile.

    Without this, an out-of-universe ticker (anything not a top-10 sector-ETF
    constituent) runs with empty fundamentals + 'unspecified' sector, and the
    personas hallucinate that the ticker is an ETF. See base persona prompt.
    """
    from cfp_jobs.settings import settings

    with connect(database_url) as conn:
        fundamentals = _load_fundamentals(conn, ticker)

    fmp_key = (settings.fmp_api_key or "").strip()

    if fundamentals.empty and fmp_key:
        log.info("agents: no fundamentals for %s; fetching from FMP", ticker)
        try:
            from cfp_jobs.ingestion import fundamentals as fund_ingest

            fund_ingest.ingest(database_url, fmp_key, [ticker], force=True)
            with connect(database_url) as conn:
                fundamentals = _load_fundamentals(conn, ticker)
        except Exception as e:
            log.warning("FMP fundamentals lookup failed for %s: %s", ticker, e)

    if not sector and fmp_key:
        try:
            from cfp_jobs.ingestion.fmp import FmpClient

            with FmpClient(fmp_key) as client:
                rows = client.profile(ticker)
            if rows:
                sector = (rows[0].get("sector") or "").strip()
                log.info("agents: resolved sector for %s -> %r via FMP profile", ticker, sector)
        except Exception as e:
            log.warning("FMP profile lookup failed for %s: %s", ticker, e)

    return fundamentals, sector


def upsert_agent_signals(conn: psycopg.Connection, run_ts: datetime, ticker: str, signals: list[AgentSignal]) -> int:
    if not signals:
        return 0
    rows = []
    for s in signals:
        r = s.to_db_row(run_ts, ticker)
        r["payload"] = Jsonb(r["payload"])
        rows.append(r)
    with conn.cursor() as cur:
        cur.executemany(AGENT_SIGNAL_UPSERT, rows)
    return len(rows)


def run_analysts(database_url: str, ticker: str, sector: str = "", *, include_personas: bool = False) -> dict:
    """Run the agent ensemble on `ticker`. Returns a summary dict.

    Args:
        include_personas: when False (Phase 4b behavior), runs only the 4 analyst
            nodes. When True (Phase 4d), runs the full graph — 4 analysts +
            13 personas + Trader + Risk Manager + Portfolio Manager — and persists
            every agent's signal.

    Side effect: writes to agent_signals table.
    """
    prices = _ensure_prices(database_url, ticker)
    fundamentals, sector = _ensure_fundamentals_and_sector(database_url, ticker, sector)
    flow_context = _build_flow_context(database_url, ticker, sector)

    graph = build_full_graph() if include_personas else build_analyst_graph()
    state = {
        "ticker": ticker,
        "sector": sector,
        "prices": prices,
        "fundamentals": fundamentals,
        "flow_context": flow_context,
        "analyst_signals": [],
        "persona_signals": [],
    }
    result = graph.invoke(state)

    analyst_sigs: list[AgentSignal] = result.get("analyst_signals", []) or []
    persona_sigs: list[AgentSignal] = result.get("persona_signals", []) or []

    synth_sigs: list[AgentSignal] = []
    for key in ("trader_decision", "risk_assessment", "portfolio_decision"):
        v = result.get(key)
        if isinstance(v, AgentSignal):
            synth_sigs.append(v)

    all_signals = analyst_sigs + persona_sigs + synth_sigs

    run_ts = datetime.now(UTC)
    with connect(database_url) as conn:
        n = upsert_agent_signals(conn, run_ts, ticker, all_signals)
        conn.commit()

    log.info(
        "agents/%s: %d signals persisted (%d analyst, %d persona, %d synth)",
        ticker, n, len(analyst_sigs), len(persona_sigs), len(synth_sigs),
    )

    def _kind(s: AgentSignal) -> str:
        if s in analyst_sigs:
            return "analyst"
        if s in persona_sigs:
            return "persona"
        return "synthesis"

    return {
        "ticker": ticker,
        "run_ts": run_ts.isoformat(),
        "n_signals": n,
        "n_analysts": len(analyst_sigs),
        "n_personas": len(persona_sigs),
        "n_synth": len(synth_sigs),
        "signals": [
            {
                "agent": s.agent,
                "signal": s.signal,
                "confidence": s.confidence,
                "rationale": s.rationale,
                "kind": _kind(s),
            }
            for s in all_signals
        ],
    }


# Total agents in the full ensemble: 5 analysts + 13 personas + 3 synthesis.
# Used by callers (the API) to compute is_complete during a streaming run.
EXPECTED_AGENT_COUNT_FULL = 5 + 13 + 3
EXPECTED_AGENT_COUNT_ANALYSTS_ONLY = 5


def run_analysts_streaming(
    database_url: str,
    ticker: str,
    sector: str = "",
    *,
    run_ts: datetime,
    include_personas: bool = True,
) -> dict:
    """Run the ensemble and write each signal to the DB as it lands.

    Designed to drive a live UI: the frontend polls GET /v1/agents/{ticker}
    with ?run_ts=<this run_ts> every ~1.5s and watches the agent_signals
    rows accrue from 0 to 20.

    All signals share the supplied ``run_ts`` so a poll can fetch them in
    one query. The PM signal is written last (synthesis stage runs sequentially
    after all parallel nodes), so its presence == "run is complete".
    """
    prices = _ensure_prices(database_url, ticker)
    fundamentals, sector = _ensure_fundamentals_and_sector(database_url, ticker, sector)
    flow_context = _build_flow_context(database_url, ticker, sector)

    graph = build_full_graph() if include_personas else build_analyst_graph()
    state: dict = {
        "ticker": ticker,
        "sector": sector,
        "prices": prices,
        "fundamentals": fundamentals,
        "flow_context": flow_context,
        "analyst_signals": [],
        "persona_signals": [],
    }

    n_persisted = 0
    # graph.stream() yields one chunk per node completion. Each chunk is
    # {node_name: state_delta} where state_delta is the fields that node added.
    for chunk in graph.stream(state):
        for _node_name, delta in chunk.items():
            if not isinstance(delta, dict):
                continue

            new_signals: list[AgentSignal] = []
            new_signals.extend(delta.get("analyst_signals", []) or [])
            new_signals.extend(delta.get("persona_signals", []) or [])
            for key in ("trader_decision", "risk_assessment", "portfolio_decision"):
                v = delta.get(key)
                if isinstance(v, AgentSignal):
                    new_signals.append(v)

            if not new_signals:
                continue

            try:
                with connect(database_url) as conn:
                    upsert_agent_signals(conn, run_ts, ticker, new_signals)
                    conn.commit()
                n_persisted += len(new_signals)
                log.info(
                    "streaming run %s/%s: +%d signals (total %d)",
                    ticker, run_ts.isoformat(), len(new_signals), n_persisted,
                )
            except Exception as e:
                log.warning("streaming write failed for %s: %s", ticker, e)

    return {
        "ticker": ticker,
        "run_ts": run_ts.isoformat(),
        "n_signals": n_persisted,
        "complete": True,
    }


def latest_signals(database_url: str, ticker: str) -> pd.DataFrame:
    """Return the most-recent signals for `ticker` across all agents."""
    sql = """
        SELECT a.run_ts, a.agent, a.signal, a.confidence, a.rationale
        FROM agent_signals a
        WHERE a.ticker = %s
          AND a.run_ts = (SELECT MAX(run_ts) FROM agent_signals WHERE ticker = %s)
        ORDER BY a.agent
    """
    with psycopg.connect(to_psycopg_url(database_url)) as conn, conn.cursor() as cur:
        cur.execute(sql, (ticker, ticker))
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=cols)
