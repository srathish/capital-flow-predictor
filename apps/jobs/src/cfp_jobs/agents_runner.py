"""Run the agent ensemble for a ticker: DB load -> graph invoke -> persist signals.

Phase 4b: just the analyst layer. Researcher/Trader/Risk/PM nodes land in 4c-4e.
Phase A (EvidenceBundle): build_evidence_bundle assembles a typed canonical
bundle once per run, threaded through AnalysisState["evidence"]. All agents
read the same bundle; personas no longer have extra_context() hooks.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

import pandas as pd
import psycopg
from cfp_agents.bundle_compute import compute_fundamentals_ctx, compute_price_context
from cfp_agents.graph import build_analyst_graph, build_full_graph
from cfp_agents.state import AgentSignal
from cfp_shared import (
    CatalystCtx,
    CongressTrade,
    DarkPoolCtx,
    EtfContextCtx,
    EvidenceBundle,
    InsiderActor,
    Instrument,
    MarketRegimeCtx,
    NewsHeadline,
    OptionsFlowCtx,
    PositioningCtx,
    RedditCtx,
    RedditPostExcerpt,
    RedditSubredditMentions,
    SmartMoneyCtx,
    TopTrade,
)
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect, to_psycopg_url
from cfp_jobs.skylit_bridge import (
    apply_structure_to_positioning,
    apply_trinity_to_positioning,
    fetch_structure,
    fetch_trinity,
)

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
                   ask_side_prem, bid_side_prem, alert_rule, option_chain
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
                "option_chain": row[8],
            }
            for row in cur.fetchall()
        ]

        # ---- OI stickiness — did flow alerts get absorbed into open interest?
        # Joins each 5d alert to the next-day OI change for the same option_symbol.
        # sticky_premium = $ premium where OI grew the next day in the same direction.
        # transient_premium = $ premium where OI was flat or shrank.
        cur.execute(
            """
            WITH alerts AS (
                SELECT option_chain,
                       option_type,
                       SUM(total_premium) AS premium,
                       MIN(created_at)::date AS alert_date
                FROM uw_flow_alerts
                WHERE ticker = %s AND created_at > NOW() - INTERVAL '5 days'
                GROUP BY option_chain, option_type
            ),
            joined AS (
                SELECT a.option_chain,
                       a.option_type,
                       a.premium,
                       COALESCE(o.oi_diff_plain, 0) AS oi_delta,
                       COALESCE(o.days_of_oi_increases, 0) AS days_up
                FROM alerts a
                LEFT JOIN uw_oi_change o
                  ON o.option_symbol = a.option_chain
                 AND o.curr_date >= a.alert_date
                 AND o.curr_date <= a.alert_date + INTERVAL '2 days'
            )
            SELECT
              COALESCE(SUM(CASE WHEN oi_delta > 0 THEN premium ELSE 0 END), 0) AS sticky_prem,
              COALESCE(SUM(CASE WHEN oi_delta <= 0 THEN premium ELSE 0 END), 0) AS transient_prem,
              COUNT(*) FILTER (WHERE oi_delta > 0) AS sticky_chains,
              COUNT(*) AS total_chains
            FROM joined
            """,
            (ticker,),
        )
        r = cur.fetchone() or (0, 0, 0, 0)
        sticky = float(r[0] or 0)
        transient = float(r[1] or 0)
        total_p = sticky + transient
        out["options_flow"]["sticky_premium_5d"] = sticky
        out["options_flow"]["transient_premium_5d"] = transient
        out["options_flow"]["sticky_pct"] = (sticky / total_p) if total_p > 0 else 0.5
        out["options_flow"]["sticky_chain_ratio"] = (
            float(r[2]) / float(r[3]) if r[3] else 0.5
        )

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

        # ---- skylit.ai / Heatseeker structural snapshot + 0DTE Trinity ----
        # Best-effort: missing repo / expired auth / no live poller -> silently skip.
        try:
            apply_structure_to_positioning(positioning, fetch_structure(ticker))
        except Exception as e:
            log.info("skylit structure fetch failed for %s: %s", ticker, e)
        try:
            apply_trinity_to_positioning(positioning, ticker, fetch_trinity())
        except Exception as e:
            log.info("skylit trinity fetch failed: %s", e)

        out["positioning"] = positioning

        # ---- smart_money: insider txns 30d ----
        # Aggregate the totals (buy/sell counts + signed net + unsigned totals)
        # and the unique-actor counts, so personas can frame asymmetry:
        # "5 buyers vs 1 seller, $1.2M bought / $200k sold" rather than just
        # "net +$1M". The signed-net stays because some downstream consumers
        # (regime ctx, sentiment proxies) rely on it.
        cur.execute(
            """
            SELECT
              COUNT(*) FILTER (WHERE transaction_code = 'P'),
              COUNT(*) FILTER (WHERE transaction_code = 'S'),
              COALESCE(SUM(CASE WHEN transaction_code = 'P' THEN amount * COALESCE(price, 0) END), 0),
              COALESCE(SUM(CASE WHEN transaction_code = 'S' THEN amount * COALESCE(price, 0) END), 0),
              COUNT(DISTINCT owner_name) FILTER (WHERE transaction_code = 'P'),
              COUNT(DISTINCT owner_name) FILTER (WHERE transaction_code = 'S')
            FROM uw_insider_transactions
            WHERE ticker = %s AND transaction_date > CURRENT_DATE - 30
            """,
            (ticker,),
        )
        r = cur.fetchone() or (0, 0, 0, 0, 0, 0)
        # SUM(amount * price): amount is signed (negative = sell), so the buy side
        # gives positive $ and the sell side gives negative $. Net = sum of both.
        buy_dollars = float(r[2] or 0)
        sell_dollars = float(r[3] or 0)
        out["smart_money"] = {
            "insider_buys_30d": int(r[0] or 0),
            "insider_sells_30d": int(r[1] or 0),
            "insider_net_amount_30d": buy_dollars + sell_dollars,
            # Unsigned totals — buy_dollars is already positive, sell_dollars
            # is negative (signed). abs() the sell side so personas read it as
            # "X bought, Y sold" with both as positive magnitudes.
            "insider_total_buy_amount_30d": buy_dollars,
            "insider_total_sell_amount_30d": abs(sell_dollars),
            "insider_unique_buyers_30d": int(r[4] or 0),
            "insider_unique_sellers_30d": int(r[5] or 0),
        }

        # Top actors per side — capped at 3 each so the prompt stays tight on
        # heavily-traded names. Ordered by total dollar magnitude.
        # Title is synthesized from the role flags (no free-text title column on
        # uw_insider_transactions). Officer > director > 10%-owner > "Insider".
        # bool_or aggregates so a single owner with mixed flags across rows
        # still gets the most-senior tag.
        cur.execute(
            """
            SELECT
              owner_name,
              CASE
                WHEN bool_or(is_officer)            THEN 'Officer'
                WHEN bool_or(is_director)           THEN 'Director'
                WHEN bool_or(is_ten_percent_owner)  THEN '10%% Owner'
                ELSE 'Insider'
              END                                                        AS title,
              CASE WHEN transaction_code = 'P' THEN 'buy' ELSE 'sell' END AS side,
              SUM(ABS(amount * COALESCE(price, 0)))                      AS total_amt,
              COUNT(*)                                                   AS n_txn
            FROM uw_insider_transactions
            WHERE ticker = %s AND transaction_date > CURRENT_DATE - 30
              AND owner_name IS NOT NULL
              AND transaction_code IN ('P', 'S')
            GROUP BY owner_name, transaction_code
            ORDER BY total_amt DESC NULLS LAST
            LIMIT 12
            """,
            (ticker,),
        )
        buyers: list[dict] = []
        sellers: list[dict] = []
        for row in cur.fetchall():
            actor = {
                "filer": row[0],
                "title": row[1],
                "side": row[2],
                "total_amount": float(row[3] or 0),
                "txn_count": int(row[4] or 0),
            }
            if row[2] == "buy" and len(buyers) < 3:
                buyers.append(actor)
            elif row[2] == "sell" and len(sellers) < 3:
                sellers.append(actor)
            if len(buyers) >= 3 and len(sellers) >= 3:
                break
        out["smart_money"]["top_insider_buyers"] = buyers
        out["smart_money"]["top_insider_sellers"] = sellers

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
                "transaction_date": row[4].isoformat() if row[4] else None,
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


def _resolve_instrument(database_url: str, ticker: str, sector_hint: str) -> dict:
    """Resolve a structured instrument frame for the persona prompts.

    Priority order:
      1. UW /stock/{ticker}/info (primary — covers exotic names like miners,
         quantum, AI infra; gives sector + issue_type + company name + tags
         + next_earnings_date in one call)
      2. FMP /profile (fallback for the rare ticker UW doesn't know)
      3. Local universe heuristic (PREDICTION_TARGETS = ETFs)
      4. Safe default: {type: "stock", sector: "Unknown"}

    Returns a dict the persona prompt template can render directly. Never
    falls back to an ETF symbol in the sector slot — that was the root
    cause of the "every unknown ticker is described as an ETF" bug.
    """
    from cfp_shared.universe import PREDICTION_TARGETS

    from cfp_jobs.settings import settings

    ticker = ticker.upper()
    out: dict = {
        "ticker": ticker,
        "type": "stock",
        "company_name": ticker,
        "sector": sector_hint or "Unknown",
        "industry": None,
        "marketcap_size": None,
        "short_description": None,
        "next_earnings_date": None,
    }

    # Hardcoded check — anything in our predictor universe is a sector ETF.
    if ticker in PREDICTION_TARGETS:
        out["type"] = "etf"

    # Try UW info first.
    uw_key = (settings.unusual_whales_api_key or "").strip()
    info: dict | None = None
    if uw_key:
        try:
            with connect(database_url) as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT issue_type, sector, full_name, short_name, marketcap_size,
                           short_description, next_earnings_date, uw_tags, last_fetched
                    FROM uw_stock_info
                    WHERE ticker = %s
                    """,
                    (ticker,),
                )
                row = cur.fetchone()
            from datetime import timedelta

            stale = row is None or row[8] < datetime.now(UTC) - timedelta(days=7)
            if stale:
                # Lazy refresh — single endpoint, cheap.
                from cfp_jobs.ingestion.unusualwhales import UwClient, _upsert_stock_info

                with UwClient(uw_key) as uw, connect(database_url) as conn:
                    fresh = uw.info(ticker)
                    if fresh:
                        _upsert_stock_info(conn, ticker, fresh)
                        conn.commit()
                with connect(database_url) as conn, conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT issue_type, sector, full_name, short_name, marketcap_size,
                               short_description, next_earnings_date, uw_tags, last_fetched
                        FROM uw_stock_info
                        WHERE ticker = %s
                        """,
                        (ticker,),
                    )
                    row = cur.fetchone()

            if row:
                issue_type, sector, full_name, short_name, mc_size, descr, nedate, tags, _ = row
                info = {
                    "issue_type": issue_type,
                    "sector": sector,
                    "full_name": full_name,
                    "short_name": short_name,
                    "marketcap_size": mc_size,
                    "short_description": descr,
                    "next_earnings_date": nedate,
                    "uw_tags": list(tags) if tags else [],
                }
        except Exception as e:
            log.warning("UW info lookup failed for %s: %s", ticker, e)

    if info:
        # UW issue_type drives the type frame. "Common Stock" -> stock,
        # "ETF" -> etf, anything else (ADR, REIT, etc.) -> stock for prompt
        # purposes (the personas can reason about REITs/ADRs as businesses).
        it = (info.get("issue_type") or "").lower()
        if "etf" in it or "fund" in it:
            out["type"] = "etf"
        else:
            out["type"] = "stock"
        out["company_name"] = info.get("full_name") or info.get("short_name") or ticker
        if info.get("sector"):
            out["sector"] = info["sector"]
        out["marketcap_size"] = info.get("marketcap_size")
        out["short_description"] = info.get("short_description")
        out["next_earnings_date"] = info.get("next_earnings_date")
        # uw_tags becomes industry hint when present.
        tags = info.get("uw_tags") or []
        if tags:
            out["industry"] = ", ".join(tags[:3])

    # FMP profile fallback for industry (UW often doesn't fill it).
    if out["industry"] is None:
        fmp_key = (settings.fmp_api_key or "").strip()
        if fmp_key:
            try:
                from cfp_jobs.ingestion.fmp import FmpClient

                with FmpClient(fmp_key) as client:
                    rows = client.profile(ticker)
                if rows:
                    out["industry"] = rows[0].get("industry") or None
                    if out["sector"] == "Unknown":
                        out["sector"] = (rows[0].get("sector") or "Unknown").strip()
            except Exception as e:
                log.warning("FMP profile fallback failed for %s: %s", ticker, e)

    return out


_YF_FIELD_TO_METRIC: dict[str, str] = {
    # yfinance .info field name -> our long-format metric name
    "totalRevenue": "revenue",
    "marketCap": "market_cap",
    "freeCashflow": "free_cash_flow",
    "operatingCashflow": "operating_cash_flow",
    "returnOnEquity": "roe",
    "returnOnAssets": "roa",
    "grossMargins": "gross_margin",
    "operatingMargins": "operating_margin",
    "profitMargins": "net_margin",
    "trailingPE": "pe_ratio",
    "priceToBook": "price_to_book",
    "priceToSalesTrailing12Months": "price_to_sales",
    "debtToEquity": "debt_to_equity",
    "currentRatio": "current_ratio",
    "quickRatio": "quick_ratio",
    "earningsGrowth": "earnings_growth",
    "revenueGrowth": "revenue_growth",
    "ebitda": "ebitda",
    "totalDebt": "total_debt",
    "totalCash": "cash",
    "enterpriseValue": "enterprise_value",
    "enterpriseToEbitda": "ev_to_ebitda",
}


def _yfinance_fundamentals_fallback(database_url: str, ticker: str) -> pd.DataFrame:
    """Pull yfinance .info, map known fields to our metric names, persist + return.

    yfinance scales some ratios oddly: debtToEquity comes back as 153.7 not 1.537
    (i.e. percent form). We normalize: anything matching a 'ratio' or 'margin' or
    'roe/roa/yield' metric and >|3| gets divided by 100. Bias to under-correct
    over-correct."""
    import yfinance as yf

    try:
        info = yf.Ticker(ticker).info or {}
    except Exception as e:
        log.warning("yfinance .info raise for %s: %s", ticker, e)
        return pd.DataFrame()

    if not info:
        return pd.DataFrame()

    today = datetime.now(UTC).date()
    rows: list[dict] = []
    for yf_field, metric in _YF_FIELD_TO_METRIC.items():
        v = info.get(yf_field)
        if v is None:
            continue
        try:
            value = float(v)
        except (TypeError, ValueError):
            continue
        # Normalize percent-form ratios. yfinance returns debtToEquity as
        # 153.7 meaning 1.537x; same for some margin/return fields. Apply
        # only when the metric is a ratio/margin/yield AND value > 3 (real
        # margins above 300% would be physically impossible).
        is_ratio_like = (
            metric in {"debt_to_equity", "current_ratio", "quick_ratio"}
            or "margin" in metric
            or metric in {"roe", "roa", "earnings_growth", "revenue_growth"}
        )
        if is_ratio_like and abs(value) > 3.0:
            value = value / 100.0
        rows.append({
            "ticker": ticker,
            "fiscal_period": today,
            "period_type": "A",
            "metric": metric,
            "value": value,
            "source": "yfinance",
            "last_fetched": datetime.now(UTC),
        })

    if not rows:
        return pd.DataFrame()

    # Persist via the existing upsert helper.
    from cfp_jobs.db import upsert_fundamentals

    with connect(database_url) as conn:
        upsert_fundamentals(conn, rows)
        conn.commit()

    log.info("yfinance .info: persisted %d metrics for %s", len(rows), ticker)
    with connect(database_url) as conn:
        return _load_fundamentals(conn, ticker)


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

    # FMP free tier returns 402 for many small-mid caps and ADRs (e.g. IREN).
    # When that happens we end up with empty fundamentals — fall back to
    # yfinance .info (free, no key) and synthesize a one-period row per
    # available metric so the personas have SOMETHING to reason about.
    if fundamentals.empty:
        log.info("agents: trying yfinance .info fallback for %s", ticker)
        try:
            fundamentals = _yfinance_fundamentals_fallback(database_url, ticker)
        except Exception as e:
            log.warning("yfinance fundamentals fallback failed for %s: %s", ticker, e)

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


# ============================================================================
# EvidenceBundle assembly (Phase A)
# ============================================================================
#
# All agents read the same bundle. Personas no longer have extra_context()
# hooks; they have a lens() method that picks fields from the same bundle.
# Built once per (ticker, run_ts), persisted to run_evidence for replay.


_REDDIT_BULLISH_KEYWORDS: tuple[str, ...] = (
    "partnership", "partner with", "deal with", "agreement with",
    "acquisition", "acquired", "acquires", "acquiring", "buyout", "takeover",
    "fda approval", "fda approves", "fda clearance",
    "raised guidance",
    "earnings beat", "beat estimates",
    "insider buy", "insider purchase",
    "contract", "contract win", "awarded",
    "buyback", "share repurchase", "dividend hike",
    "ipo",
)
_REDDIT_BEARISH_KEYWORDS: tuple[str, ...] = (
    "missed guidance", "cut guidance", "lowered guidance",
    "earnings miss", "missed estimates",
    "fda rejection", "fda denies", "fda crl", "complete response letter",
    "insider sell", "insider selling",
    "lawsuit", "sued", "fraud", "investigation",
    "recall",
    "going concern", "bankruptcy",
    "dilution", "share offering", "secondary offering",
    "downgrade",
)


def _build_reddit_ctx(database_url: str, ticker: str) -> RedditCtx:
    """Apewisdom snapshots over the last ~7 days + reddit_posts catalyst feed.
    Computes spike ratio (today vs 7d avg from the all-stocks aggregate),
    asymmetry flags, and a 7-day count of catalyst posts (so tickers absent
    from the Apewisdom top-150 still register as having chatter when the
    RSS-scraped feed has tagged posts about them — e.g. BTBT)."""
    out_subs: list[RedditSubredditMentions] = []
    mentions_today = 0
    mentions_7d_avg = 0.0
    spike_ratio: float | None = None
    rank_today: int | None = None
    rank_7d_ago: int | None = None
    rank_change_7d: int | None = None
    catalyst_posts_7d = 0
    catalyst_posts_bullish_7d = 0
    catalyst_posts_bearish_7d = 0
    recent_excerpts: list[dict] = []

    try:
        with connect(database_url) as conn, conn.cursor() as cur:
            # all-stocks aggregate — most reliable for the "top-N" rank position.
            cur.execute(
                """
                SELECT mentions, rank, rank_24h_ago, mentions_24h_ago
                FROM reddit_mentions
                WHERE ticker = %s AND subreddit = 'all-stocks'
                  AND snapshot_date = (
                      SELECT MAX(snapshot_date) FROM reddit_mentions
                      WHERE ticker = %s AND subreddit = 'all-stocks'
                  )
                """,
                (ticker, ticker),
            )
            row = cur.fetchone()
            if row:
                mentions_today = int(row[0] or 0)
                rank_today = int(row[1]) if row[1] is not None else None

            # 7-day average from the same aggregate.
            cur.execute(
                """
                SELECT AVG(mentions)::float, MIN(rank)
                FROM reddit_mentions
                WHERE ticker = %s AND subreddit = 'all-stocks'
                  AND snapshot_date >= CURRENT_DATE - 7
                """,
                (ticker,),
            )
            r2 = cur.fetchone()
            if r2:
                mentions_7d_avg = float(r2[0] or 0.0)

            # 7-day-ago rank for momentum.
            cur.execute(
                """
                SELECT rank FROM reddit_mentions
                WHERE ticker = %s AND subreddit = 'all-stocks'
                  AND snapshot_date <= CURRENT_DATE - 7
                ORDER BY snapshot_date DESC LIMIT 1
                """,
                (ticker,),
            )
            r3 = cur.fetchone()
            if r3 and r3[0] is not None:
                rank_7d_ago = int(r3[0])
                if rank_today is not None:
                    rank_change_7d = rank_today - rank_7d_ago

            # Per-subreddit slices for the lens — WSB hype vs broader stocks
            # attention shows different things.
            cur.execute(
                """
                SELECT subreddit, mentions, upvotes, rank, rank_24h_ago, mentions_24h_ago
                FROM reddit_mentions
                WHERE ticker = %s
                  AND snapshot_date = (
                      SELECT MAX(snapshot_date) FROM reddit_mentions WHERE ticker = %s
                  )
                ORDER BY mentions DESC
                """,
                (ticker, ticker),
            )
            for sub, m, u, rk, rk_y, m_y in cur.fetchall():
                if sub == "all-stocks":
                    continue  # already represented in the top-level fields
                out_subs.append(RedditSubredditMentions(
                    subreddit=sub,
                    mentions=int(m or 0),
                    upvotes=int(u or 0),
                    rank=int(rk) if rk is not None else None,
                    rank_24h_ago=int(rk_y) if rk_y is not None else None,
                    mentions_24h_ago=int(m_y) if m_y is not None else None,
                ))
            # Catalyst-feed chatter from reddit_posts (independent of Apewisdom).
            # Counts posts in the last 7 days that mention this ticker, plus a
            # bullish/bearish split via keyword-list overlap. Lets the analyst
            # see chatter that doesn't crack Apewisdom's top-150.
            cur.execute(
                """
                SELECT
                    COUNT(*)                                          AS n,
                    COUNT(*) FILTER (WHERE keywords && %s::text[])    AS n_bull,
                    COUNT(*) FILTER (WHERE keywords && %s::text[])    AS n_bear
                FROM reddit_posts
                WHERE %s = ANY(tickers)
                  AND created_at > NOW() - INTERVAL '7 days'
                """,
                (list(_REDDIT_BULLISH_KEYWORDS), list(_REDDIT_BEARISH_KEYWORDS), ticker),
            )
            r4 = cur.fetchone()
            if r4:
                catalyst_posts_7d = int(r4[0] or 0)
                catalyst_posts_bullish_7d = int(r4[1] or 0)
                catalyst_posts_bearish_7d = int(r4[2] or 0)

            # Fetch up to 5 most-engaged post excerpts. We rank by an
            # engagement composite (upvotes + 3 × num_comments) — comments
            # are scarcer than upvotes and signal real discussion, hence the
            # 3× weight. Falls back to recency when engagement is null.
            # body is trimmed to 300 chars at write time (below) to keep
            # the prompt budget bounded regardless of selftext length.
            cur.execute(
                """
                SELECT subreddit, title, body, upvotes, num_comments,
                       keywords, created_at, permalink
                FROM reddit_posts
                WHERE %s = ANY(tickers)
                  AND created_at > NOW() - INTERVAL '7 days'
                ORDER BY (COALESCE(upvotes, 0) + 3 * COALESCE(num_comments, 0)) DESC,
                         created_at DESC
                LIMIT 5
                """,
                (ticker,),
            )
            recent_excerpts = []
            for row in cur.fetchall():
                body = row[2] or ""
                if len(body) > 300:
                    body = body[:297].rstrip() + "..."
                recent_excerpts.append({
                    "subreddit": row[0],
                    "title": (row[1] or "")[:160],
                    "body_excerpt": body,
                    "upvotes": int(row[3]) if row[3] is not None else None,
                    "num_comments": int(row[4]) if row[4] is not None else None,
                    "keywords": list(row[5] or []),
                    "posted_at": row[6],
                    "permalink": row[7],
                })
    except Exception as e:
        log.warning("reddit ctx build failed for %s: %s", ticker, e)
        return RedditCtx()

    if mentions_7d_avg > 0:
        spike_ratio = mentions_today / mentions_7d_avg

    # Asymmetry flags. Calibrated to be conservative — only fire on clearly
    # elevated or clearly absent chatter.
    contrarian_warning = (
        spike_ratio is not None and spike_ratio > 3.0
        and rank_today is not None and rank_today <= 20
    )
    stealth = (
        mentions_today < 5 and (rank_today is None or rank_today > 100)
    )
    has_data = (
        mentions_today > 0
        or len(out_subs) > 0
        or rank_today is not None
        or catalyst_posts_7d > 0
    )

    return RedditCtx(
        has_data=has_data,
        mentions_today=mentions_today,
        mentions_7d_avg=mentions_7d_avg,
        spike_ratio=spike_ratio,
        rank_today=rank_today,
        rank_7d_ago=rank_7d_ago,
        rank_change_7d=rank_change_7d,
        is_contrarian_warning=contrarian_warning,
        is_stealth=stealth,
        by_subreddit=out_subs,
        catalyst_posts_7d=catalyst_posts_7d,
        catalyst_posts_bullish_7d=catalyst_posts_bullish_7d,
        catalyst_posts_bearish_7d=catalyst_posts_bearish_7d,
        recent_post_excerpts=[RedditPostExcerpt(**e) for e in recent_excerpts],
    )


def _build_catalyst_ctx(database_url: str, ticker: str, instrument: Instrument) -> CatalystCtx:
    """Pull last 5d UW news headlines for `ticker` plus earnings proximity from
    the resolved instrument.next_earnings_date."""
    headlines: list[NewsHeadline] = []
    sentiment_score: float | None = None
    try:
        with connect(database_url) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT created_at, source, headline, sentiment, is_major
                FROM uw_news
                WHERE %s = ANY(tickers) AND created_at > NOW() - INTERVAL '5 days'
                ORDER BY is_major DESC, created_at DESC
                LIMIT 8
                """,
                (ticker,),
            )
            for row in cur.fetchall():
                headlines.append(
                    NewsHeadline(
                        ts=row[0],
                        source=row[1],
                        headline=row[2],
                        sentiment=row[3],
                        is_major=bool(row[4]),
                    )
                )
            # Sentiment rollup over the same 5d window. Returns the raw counts
            # (kept as new fields so personas can read "3 positive / 1 neutral
            # / 0 negative" directly) AND the normalized score (legacy field
            # consumers may still use). The neutral count is a real signal —
            # 8/8 neutral is a meaningfully different state than 0/0.
            cur.execute(
                """
                SELECT
                  COUNT(*) FILTER (WHERE sentiment = 'positive'),
                  COUNT(*) FILTER (WHERE sentiment = 'neutral'),
                  COUNT(*) FILTER (WHERE sentiment = 'negative'),
                  COUNT(*) FILTER (WHERE sentiment IN ('positive', 'negative', 'neutral'))
                FROM uw_news
                WHERE %s = ANY(tickers) AND created_at > NOW() - INTERVAL '5 days'
                """,
                (ticker,),
            )
            r = cur.fetchone() or (0, 0, 0, 0)
            pos = int(r[0] or 0)
            neu = int(r[1] or 0)
            neg = int(r[2] or 0)
            total = int(r[3] or 0)
            if total > 0:
                sentiment_score = (pos - neg) / total
    except Exception as e:
        log.warning("catalyst news pull failed for %s: %s", ticker, e)

    next_earn = instrument.next_earnings_date
    days_to = None
    proximity = False
    if next_earn:
        from datetime import date as _date

        delta = (next_earn - _date.today()).days
        days_to = int(delta)
        proximity = 0 <= delta <= 7

    return CatalystCtx(
        next_earnings_date=next_earn,
        days_to_earnings=days_to,
        earnings_proximity=proximity,
        news_5d=headlines,
        sentiment_score_5d=sentiment_score,
        news_sentiment_positive_5d=pos,
        news_sentiment_neutral_5d=neu,
        news_sentiment_negative_5d=neg,
    )


def _build_market_regime_ctx(
    database_url: str,
    ticker: str,
    smart_money_dict: dict,
    dark_pool_ctx: DarkPoolCtx,
) -> MarketRegimeCtx:
    """Compute the SPY/VIX regime label + structural risk signals.

    Every input is best-effort: if SPY history is missing or the regime
    computation throws, we return an "unknown" regime with a 0.5 risk
    multiplier (chop-equivalent) so the ensemble still produces a defensible
    size. Insider / dark-pool numbers are copied through from the already-
    computed contexts; reddit velocity is computed here from reddit_mentions.
    """
    regime_label = "unknown"
    risk_mult = 0.5
    breadth: float | None = None
    spy50: bool | None = None
    spy200: bool | None = None
    vix: float | None = None
    spx_trend: str | None = None

    try:
        from cfp_features.regime import label_regimes

        with connect(database_url) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT ts, symbol, close FROM prices_daily
                WHERE symbol IN ('SPY', '^VIX')
                  AND ts >= NOW() - INTERVAL '400 days'
                ORDER BY ts
                """,
            )
            rows = cur.fetchall()
        if rows:
            df = pd.DataFrame(rows, columns=["ts", "symbol", "close"])
            wide = df.pivot_table(index="ts", columns="symbol", values="close", aggfunc="last")
            if "SPY" in wide.columns:
                wide = wide.sort_index()
                out = label_regimes(wide)
                last = out.iloc[-1]
                regime_label = str(last["regime"])
                risk_mult = float(last["risk_multiplier"])
                spy50 = bool(last["spy_above_50d"]) if pd.notna(last["spy_above_50d"]) else None
                spy200 = bool(last["spy_above_200d"]) if pd.notna(last["spy_above_200d"]) else None
                if pd.notna(last["vix_level"]):
                    vix = float(last["vix_level"])
                spx_trend = "up" if spy50 else "down"
    except Exception as e:
        log.warning("regime computation failed for %s: %s", ticker, e)

    # Reddit mention velocity (7d slope) — best-effort, returns None on miss.
    reddit_velocity: float | None = None
    try:
        from cfp_features.signals import reddit_mention_velocity

        with connect(database_url) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT ts::date AS ts, ticker, COUNT(*)::int AS count
                FROM reddit_mentions
                WHERE ticker = %s
                  AND ts >= NOW() - INTERVAL '21 days'
                GROUP BY ts::date, ticker
                ORDER BY ts
                """,
                (ticker,),
            )
            rows = cur.fetchall()
        if rows and len(rows) >= 7:
            df = pd.DataFrame(rows, columns=["ts", "ticker", "count"])
            vel = reddit_mention_velocity(df, window=7)
            if not vel.empty and ticker in vel.columns:
                val = vel[ticker].dropna()
                if not val.empty:
                    reddit_velocity = float(val.iloc[-1])
    except Exception as e:
        log.debug("reddit velocity computation failed for %s: %s", ticker, e)

    # Pass-through aggregates from already-computed contexts.
    insider_net = smart_money_dict.get("insider_net_amount_30d")
    dark_ratio = getattr(dark_pool_ctx, "dark_pool_pct_30d", None) or getattr(
        dark_pool_ctx, "dark_pool_ratio", None
    )

    return MarketRegimeCtx(
        vix=vix,
        spx_trend=spx_trend,
        regime=regime_label,
        risk_multiplier=risk_mult,
        breadth_pct_above_50d=breadth,
        spy_above_50d=spy50,
        spy_above_200d=spy200,
        insider_net_buy_30d_usd=float(insider_net) if insider_net is not None else None,
        dark_pool_volume_ratio=float(dark_ratio) if dark_ratio is not None else None,
        reddit_mention_velocity_7d=reddit_velocity,
    )


def build_evidence_bundle(
    database_url: str, ticker: str, sector: str, run_ts: datetime
) -> tuple[EvidenceBundle, pd.DataFrame, pd.DataFrame]:
    """Assemble the canonical EvidenceBundle for one (ticker, run_ts).

    Returns the bundle plus the raw prices / fundamentals DataFrames so the
    runner can keep them in AnalysisState for callers that still want them
    (the synthesizer layer prints raw analyst signals too).

    Lazy fetches: prices via yfinance, fundamentals via FMP, UW data via the
    UW client. All gated by the corresponding API key being set.
    """
    ticker = ticker.upper()

    prices = _ensure_prices(database_url, ticker)
    fundamentals_df, sector = _ensure_fundamentals_and_sector(database_url, ticker, sector)

    # Resolve instrument frame (UW /info primary, FMP /profile fallback).
    inst_dict = _resolve_instrument(database_url, ticker, sector)
    if inst_dict.get("sector") and inst_dict["sector"] != "Unknown":
        sector = inst_dict["sector"]

    # Coerce next_earnings_date to date (might already be).
    nedate = inst_dict.get("next_earnings_date")
    if isinstance(nedate, datetime):
        nedate = nedate.date()
    instrument = Instrument(
        ticker=inst_dict.get("ticker") or ticker,
        type=inst_dict.get("type") or "stock",
        company_name=inst_dict.get("company_name") or ticker,
        sector=inst_dict.get("sector") or "Unknown",
        industry=inst_dict.get("industry"),
        marketcap_size=inst_dict.get("marketcap_size"),
        short_description=inst_dict.get("short_description"),
        next_earnings_date=nedate,
    )

    # Lazy-refresh UW data + read the structured snapshot back.
    flow_dict = _build_flow_context(database_url, ticker, sector)

    options_flow = OptionsFlowCtx(
        **{
            **(flow_dict.get("options_flow") or {}),
            # top_trades dicts → TopTrade models
            "top_trades": [
                TopTrade(**t) for t in (flow_dict.get("options_flow") or {}).get("top_trades", [])
            ],
        }
    ) if flow_dict.get("options_flow") else OptionsFlowCtx()

    dark_pool = DarkPoolCtx(**(flow_dict.get("dark_pool") or {}))
    positioning = PositioningCtx(**(flow_dict.get("positioning") or {}))
    smart_money_dict = flow_dict.get("smart_money") or {}
    smart_money = SmartMoneyCtx(
        insider_buys_30d=int(smart_money_dict.get("insider_buys_30d", 0)),
        insider_sells_30d=int(smart_money_dict.get("insider_sells_30d", 0)),
        insider_net_amount_30d=float(smart_money_dict.get("insider_net_amount_30d", 0.0)),
        insider_total_buy_amount_30d=float(smart_money_dict.get("insider_total_buy_amount_30d", 0.0)),
        insider_total_sell_amount_30d=float(smart_money_dict.get("insider_total_sell_amount_30d", 0.0)),
        insider_unique_buyers_30d=int(smart_money_dict.get("insider_unique_buyers_30d", 0)),
        insider_unique_sellers_30d=int(smart_money_dict.get("insider_unique_sellers_30d", 0)),
        top_insider_buyers=[InsiderActor(**a) for a in smart_money_dict.get("top_insider_buyers", [])],
        top_insider_sellers=[InsiderActor(**a) for a in smart_money_dict.get("top_insider_sellers", [])],
        congress_trades=[CongressTrade(**ct) for ct in smart_money_dict.get("congress_trades", [])],
    )
    etf_context = EtfContextCtx(**(flow_dict.get("etf_context") or {}))

    catalysts = _build_catalyst_ctx(database_url, ticker, instrument)
    reddit = _build_reddit_ctx(database_url, ticker)
    market_regime = _build_market_regime_ctx(database_url, ticker, smart_money_dict, dark_pool)

    bundle = EvidenceBundle(
        run_ts=run_ts,
        instrument=instrument,
        price_context=compute_price_context(prices),
        fundamentals=compute_fundamentals_ctx(fundamentals_df),
        options_flow=options_flow,
        dark_pool=dark_pool,
        positioning=positioning,
        smart_money=smart_money,
        catalysts=catalysts,
        etf_context=etf_context,
        reddit=reddit,
        market_regime=market_regime,
    )

    return bundle, prices, fundamentals_df


def persist_evidence(database_url: str, bundle: EvidenceBundle) -> None:
    """Save the bundle JSON + denormalized columns for fast filtering."""
    sql = """
        INSERT INTO run_evidence (
            run_ts, ticker, schema_version, bundle,
            instrument_type, sector, next_earnings_date, earnings_proximity
        ) VALUES (
            %(run_ts)s, %(ticker)s, %(schema_version)s, %(bundle)s,
            %(instrument_type)s, %(sector)s, %(next_earnings_date)s, %(earnings_proximity)s
        ) ON CONFLICT (run_ts, ticker) DO UPDATE SET
            bundle = EXCLUDED.bundle,
            schema_version = EXCLUDED.schema_version,
            instrument_type = EXCLUDED.instrument_type,
            sector = EXCLUDED.sector,
            next_earnings_date = EXCLUDED.next_earnings_date,
            earnings_proximity = EXCLUDED.earnings_proximity
    """
    payload = bundle.model_dump(mode="json")
    try:
        with connect(database_url) as conn, conn.cursor() as cur:
            cur.execute(
                sql,
                {
                    "run_ts": bundle.run_ts,
                    "ticker": bundle.instrument.ticker,
                    "schema_version": bundle.schema_version,
                    "bundle": Jsonb(payload),
                    "instrument_type": bundle.instrument.type,
                    "sector": bundle.instrument.sector,
                    "next_earnings_date": bundle.instrument.next_earnings_date,
                    "earnings_proximity": bundle.catalysts.earnings_proximity,
                },
            )
            conn.commit()
    except Exception as e:
        # Migration 0006 may not be applied yet; don't fail the run.
        log.warning("persist_evidence skipped (run still proceeds): %s", e)


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
    from cfp_agents.observability import flush as _lf_flush
    from cfp_agents.observability import trace_run

    run_ts = datetime.now(UTC)
    bundle, prices, fundamentals = build_evidence_bundle(database_url, ticker, sector, run_ts)
    persist_evidence(database_url, bundle)

    graph = build_full_graph() if include_personas else build_analyst_graph()
    state = {
        "ticker": ticker,
        "sector": bundle.instrument.sector,
        "prices": prices,
        "fundamentals": fundamentals,
        "evidence": bundle,
        "analyst_signals": [],
        "persona_signals": [],
    }
    with trace_run(
        name="ensemble_run",
        metadata={
            "ticker": ticker,
            "sector": bundle.instrument.sector,
            "run_ts": run_ts.isoformat(),
            "include_personas": include_personas,
            "mode": "invoke",
        },
    ):
        # max_concurrency lets LangGraph run all 13 personas (and the parallel
        # rebuttals + researchers) at the same time instead of in batches of
        # ~CPU count. LLM calls are I/O-bound, so 20 concurrent threads is fine.
        result = graph.invoke(state, config={"max_concurrency": 20})
    _lf_flush()

    analyst_sigs: list[AgentSignal] = result.get("analyst_signals", []) or []
    persona_sigs: list[AgentSignal] = result.get("persona_signals", []) or []

    synth_sigs: list[AgentSignal] = []
    for key in (
        "bull_rebuttal",
        "bear_rebuttal",
        "bull_research",
        "bear_research",
        "trader_decision",
        "risk_assessment",
        "portfolio_decision",
    ):
        v = result.get(key)
        if isinstance(v, AgentSignal):
            synth_sigs.append(v)

    all_signals = analyst_sigs + persona_sigs + synth_sigs

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


# Total agents in the full ensemble:
#   5 analysts + 13 personas + 2 rebuttals (debate) + 2 researchers + 3 synthesis
# Used by callers (the API) to compute is_complete during a streaming run.
EXPECTED_AGENT_COUNT_FULL = 5 + 13 + 2 + 2 + 3
EXPECTED_AGENT_COUNT_ANALYSTS_ONLY = 5


def run_analysts_streaming(
    database_url: str,
    ticker: str,
    sector: str = "",
    *,
    run_ts: datetime,
    include_personas: bool = True,
    llm_override: dict[str, str] | None = None,
) -> dict:
    """Run the ensemble and write each signal to the DB as it lands.

    Designed to drive a live UI: the frontend polls GET /v1/agents/{ticker}
    with ?run_ts=<this run_ts> every ~1.5s and watches the agent_signals
    rows accrue from 0 to 20.

    All signals share the supplied ``run_ts`` so a poll can fetch them in
    one query. The PM signal is written last (synthesis stage runs sequentially
    after all parallel nodes), so its presence == "run is complete".

    ``llm_override`` (Deep Analysis button) routes every LLM call in this run
    to the given provider/model instead of the process-wide default.
    """
    from cfp_agents.observability import flush as _lf_flush
    from cfp_agents.observability import trace_run

    bundle, prices, fundamentals = build_evidence_bundle(database_url, ticker, sector, run_ts)
    persist_evidence(database_url, bundle)

    graph = build_full_graph() if include_personas else build_analyst_graph()
    state: dict = {
        "ticker": ticker,
        "sector": bundle.instrument.sector,
        "prices": prices,
        "fundamentals": fundamentals,
        "evidence": bundle,
        "analyst_signals": [],
        "persona_signals": [],
    }
    if llm_override:
        state["llm_override"] = llm_override

    n_persisted = 0
    # Wrap the entire ensemble run in one Langfuse trace so all per-persona
    # generations nest under it. No-op if Langfuse env vars aren't set.
    with trace_run(
        name="ensemble_run",
        metadata={
            "ticker": ticker,
            "sector": bundle.instrument.sector,
            "run_ts": run_ts.isoformat(),
            "include_personas": include_personas,
            "llm_override": llm_override,
        },
    ):
        # max_concurrency=20 lets LangGraph run all 13 personas + parallel
        # rebuttal/researcher pairs at the same time (LLM calls are I/O-bound).
        # graph.stream() yields one chunk per node completion. Each chunk is
        # {node_name: state_delta} where state_delta is the fields that node added.
        for chunk in graph.stream(state, config={"max_concurrency": 20}):
            for _node_name, delta in chunk.items():
                if not isinstance(delta, dict):
                    continue

                new_signals: list[AgentSignal] = []
                new_signals.extend(delta.get("analyst_signals", []) or [])
                new_signals.extend(delta.get("persona_signals", []) or [])
                for key in (
                    "bull_rebuttal",
                    "bear_rebuttal",
                    "bull_research",
                    "bear_research",
                    "trader_decision",
                    "risk_assessment",
                    "portfolio_decision",
                ):
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

    # Force-flush so short-lived API calls don't lose traces.
    _lf_flush()

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
