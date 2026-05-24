"""Delphi feature composer — Stage 2.5 of the funnel.

Delphi v0.1 read 3 tables. Delphi v0.2 reads ~20: dark pool, insider, congress,
OI change, max pain, short data, earnings calendar, analyst ratings, 13F,
GEX by expiry, IV/RV/skew/NOPE, UW prediction APIs, news, seasonality,
macro_regime.

For every ticker present in the freshest uw_screener_stocks snapshot, we compose
one delphi_features row that delphi_rank reads in a single SELECT instead of
N joins. Single row keeps the ranker simple and gives us a clean ML feature
matrix downstream.

Conflict detection: when sources disagree (bullish flow + late-day dark-pool
selling at bid + insider clusters selling), we flag it in conflict_codes so
delphi_rank can dampen its probability and the conviction tab can surface
"high-agreement only" filters.

Wire-up: ``cfp-jobs delphi-features`` runs on the same :03/:18/:33/:48 RTH
slot as uw-screeners-ingest, immediately after. Idempotent — same snapshot
key = same row.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect
from cfp_jobs import delphi_price_action
from cfp_jobs import delphi_macro_spreads
from cfp_jobs import delphi_anomalies

log = logging.getLogger(__name__)


# Late-day window for dark-pool prints. Prints in the closing auction skew
# the next day's open and are a stronger institutional signal than mid-day.
# 19:30 UTC = 15:30 ET (final 30 min before close).
LATE_DAY_CUTOFF_UTC_HOUR = 19
LATE_DAY_CUTOFF_UTC_MIN = 30


@dataclass
class FeatureRow:
    ticker: str
    snapshot_ts: datetime
    spot_price: float | None
    iv_rank: float | None
    iv30: float | None
    rv30: float | None

    dp_net_premium_24h: float | None
    dp_print_count_24h: int
    dp_late_day_share: float | None

    insider_net_30d: float | None
    insider_buyers_30d: int
    insider_sellers_30d: int

    congress_buys_14d: int
    congress_sells_14d: int

    oi_delta_call_1d: int | None
    oi_delta_put_1d: int | None
    oi_opening_ratio: float | None

    max_pain_distance: float | None
    max_pain_expiry: date | None

    short_pct_float: float | None
    short_fee_rate: float | None
    short_utilization: float | None

    days_to_earnings: int | None
    earnings_in_horizon: bool

    analyst_revisions_30d: int
    analyst_net_upgrade: int

    inst_net_delta_shares: int | None

    gex_expiry_front: float | None

    rr_skew_25d: float | None
    nope_score: float | None

    uw_smart_money_score: float | None
    uw_whales_score: float | None

    news_count_24h: int
    news_sentiment_24h: float | None

    seasonality_avg_ret: float | None

    vol_regime: str | None
    trend_regime: str | None
    macro_regime: str | None

    has_conflict: bool
    conflict_codes: list[str]

    features: dict[str, Any]


# ----------------------------------------------------------------------------
# Per-source extractors. Each returns the relevant fields or sentinels for the
# given ticker; failures degrade silently (return None / 0). The composer
# tolerates missing tables — important during the migration window.
# ----------------------------------------------------------------------------


def _safe_fetchone(conn: psycopg.Connection, sql: str, params: tuple) -> tuple | None:
    """Run a SELECT inside a savepoint so a failure (missing table, bad cast) does
    not poison the outer transaction. Used because the composer touches ~20
    tables and any one might be missing during partial-migration windows.
    """
    try:
        with conn.transaction():
            return conn.execute(sql, params).fetchone()
    except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
        return None
    except Exception as e:  # noqa: BLE001
        log.debug("feature query failed: %s", e)
        return None


def _safe_fetchall(conn: psycopg.Connection, sql: str, params: tuple) -> list[tuple]:
    try:
        with conn.transaction():
            return conn.execute(sql, params).fetchall()
    except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
        return []
    except Exception as e:  # noqa: BLE001
        log.debug("feature query failed: %s", e)
        return []


def _dark_pool_24h(conn: psycopg.Connection, ticker: str) -> tuple[float | None, int, float | None]:
    """24h net dark-pool premium + late-day share."""
    since = datetime.now(UTC) - timedelta(hours=24)
    row = _safe_fetchone(
        conn,
        """
        SELECT
            COALESCE(SUM(premium), 0) AS net_premium,
            COUNT(*) AS n_prints,
            COALESCE(SUM(CASE WHEN EXTRACT(HOUR FROM executed_at) > %s
                              OR (EXTRACT(HOUR FROM executed_at) = %s
                                  AND EXTRACT(MINUTE FROM executed_at) >= %s)
                              THEN premium ELSE 0 END), 0) AS late_premium
        FROM uw_dark_pool_prints
        WHERE ticker = %s AND executed_at >= %s
        """,
        (LATE_DAY_CUTOFF_UTC_HOUR, LATE_DAY_CUTOFF_UTC_HOUR, LATE_DAY_CUTOFF_UTC_MIN, ticker, since),
    )
    if not row:
        return (None, 0, None)
    net, n, late = row
    n = int(n or 0)
    late_share = (float(late) / float(net)) if net and float(net) != 0 else None
    return (float(net) if net is not None else None, n, late_share)


def _insider_30d(conn: psycopg.Connection, ticker: str) -> tuple[float | None, int, int]:
    """30d net insider $ + buyer/seller counts.

    UW transaction_code A/P = acquisition (buy proxy), D/S/F = disposition (sell).
    amount column is shares; we proxy notional via amount * price."""
    since = (datetime.now(UTC) - timedelta(days=30)).date()
    row = _safe_fetchone(
        conn,
        """
        SELECT
            COALESCE(SUM(CASE
                WHEN transaction_code IN ('A','P') THEN COALESCE(amount,0) * COALESCE(price,0)
                WHEN transaction_code IN ('D','S','F') THEN -COALESCE(amount,0) * COALESCE(price,0)
                ELSE 0 END), 0) AS net_dollar,
            COUNT(DISTINCT CASE WHEN transaction_code IN ('A','P') THEN owner_name END) AS buyers,
            COUNT(DISTINCT CASE WHEN transaction_code IN ('D','S','F') THEN owner_name END) AS sellers
        FROM uw_insider_transactions
        WHERE ticker = %s AND transaction_date >= %s
        """,
        (ticker, since),
    )
    if not row:
        return (None, 0, 0)
    net, b, s = row
    return (float(net) if net is not None else None, int(b or 0), int(s or 0))


def _congress_14d(conn: psycopg.Connection, ticker: str) -> tuple[int, int]:
    since = (datetime.now(UTC) - timedelta(days=14)).date()
    row = _safe_fetchone(
        conn,
        """
        SELECT
            COUNT(*) FILTER (WHERE LOWER(COALESCE(txn_type, transaction_type, '')) LIKE '%buy%' OR LOWER(COALESCE(txn_type, transaction_type, '')) LIKE '%purchase%') AS buys,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(txn_type, transaction_type, '')) LIKE '%sale%' OR LOWER(COALESCE(txn_type, transaction_type, '')) LIKE '%sell%') AS sells
        FROM uw_congress_trades
        WHERE ticker = %s AND COALESCE(transaction_date, filing_date) >= %s
        """,
        (ticker, since),
    )
    if not row:
        return (0, 0)
    return (int(row[0] or 0), int(row[1] or 0))


def _oi_change_1d(conn: psycopg.Connection, ticker: str) -> tuple[int | None, int | None, float | None]:
    """Most recent day's OI delta split by call/put + opening ratio.

    Opening ratio approximates: how much of today's volume created new OI
    (gain in OI) vs closed it. > 0.5 = opening flow dominant (bullish for
    that side); < 0.3 = closing flow (less informative)."""
    row = _safe_fetchone(
        conn,
        """
        WITH latest AS (
            SELECT MAX(curr_date) AS d FROM uw_oi_change WHERE ticker = %s
        )
        SELECT
            COALESCE(SUM(CASE WHEN option_symbol LIKE '%C%' THEN oi_diff_plain ELSE 0 END), 0) AS dc,
            COALESCE(SUM(CASE WHEN option_symbol LIKE '%P%' THEN oi_diff_plain ELSE 0 END), 0) AS dp,
            CASE WHEN NULLIF(SUM(volume), 0) IS NULL THEN NULL
                 ELSE SUM(GREATEST(oi_diff_plain, 0))::float / NULLIF(SUM(volume), 0) END AS opening
        FROM uw_oi_change, latest
        WHERE ticker = %s AND curr_date = latest.d
        """,
        (ticker, ticker),
    )
    if not row:
        return (None, None, None)
    dc, dp, op = row
    return (
        int(dc) if dc is not None else None,
        int(dp) if dp is not None else None,
        float(op) if op is not None else None,
    )


def _max_pain(conn: psycopg.Connection, ticker: str, spot: float | None) -> tuple[float | None, date | None]:
    row = _safe_fetchone(
        conn,
        """
        SELECT max_pain, expiry
        FROM uw_max_pain
        WHERE ticker = %s AND expiry >= CURRENT_DATE
        ORDER BY expiry ASC LIMIT 1
        """,
        (ticker,),
    )
    if not row or row[0] is None or not spot:
        return (None, None)
    mp = float(row[0])
    return ((mp - spot) / spot, row[1])


def _short_data(conn: psycopg.Connection, ticker: str) -> tuple[float | None, float | None, float | None]:
    """Latest short data point. uw_short_data shape: ts, ticker, short_shares_available, fee_rate, rebate_rate.
    Short % float requires shares_outstanding from uw_stock_info."""
    row = _safe_fetchone(
        conn,
        """
        SELECT
            sd.short_shares_available,
            sd.fee_rate,
            si.outstanding
        FROM uw_short_data sd
        LEFT JOIN uw_stock_info si ON si.ticker = sd.ticker
        WHERE sd.ticker = %s
        ORDER BY sd.ts DESC LIMIT 1
        """,
        (ticker,),
    )
    if not row:
        return (None, None, None)
    avail, fee, outstanding = row
    pct = None
    if avail and outstanding and float(outstanding) > 0:
        # short_shares_available is shares left to borrow, NOT short interest.
        # Used as a utilization proxy: lower = more borrowed already.
        pct = max(0.0, 1.0 - float(avail) / float(outstanding))
    return (
        pct,
        float(fee) if fee is not None else None,
        pct,  # utilization same as pct here as proxy
    )


def _earnings(conn: psycopg.Connection, ticker: str) -> tuple[int | None, bool]:
    """Days until next earnings. Earnings 'in horizon' = within 90 days."""
    row = _safe_fetchone(
        conn,
        """
        SELECT report_date
        FROM uw_earnings
        WHERE ticker = %s AND report_date >= CURRENT_DATE
        ORDER BY report_date ASC LIMIT 1
        """,
        (ticker,),
    )
    if not row or row[0] is None:
        return (None, False)
    days = (row[0] - datetime.now(UTC).date()).days
    return (int(days), days <= 90)


def _analyst_30d(conn: psycopg.Connection, ticker: str) -> tuple[int, int]:
    """30d analyst revision count + net upgrade-downgrade."""
    since = (datetime.now(UTC) - timedelta(days=30)).date()
    row = _safe_fetchone(
        conn,
        """
        SELECT
            COUNT(*) AS n,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(action, '')) LIKE '%upgrade%')
            - COUNT(*) FILTER (WHERE LOWER(COALESCE(action, '')) LIKE '%downgrade%') AS net_up
        FROM uw_analyst_ratings
        WHERE ticker = %s AND COALESCE(rating_date, created_at::date) >= %s
        """,
        (ticker, since),
    )
    if not row:
        return (0, 0)
    return (int(row[0] or 0), int(row[1] or 0))


def _institutional(conn: psycopg.Connection, ticker: str) -> int | None:
    """Net 13F share delta in the latest filing window."""
    row = _safe_fetchone(
        conn,
        """
        SELECT COALESCE(SUM(change_in_shares), 0)
        FROM uw_institution_activity
        WHERE ticker = %s
          AND COALESCE(filing_date, created_at::date) >= CURRENT_DATE - 90
        """,
        (ticker,),
    )
    if not row or row[0] is None:
        return None
    return int(row[0])


def _gex_expiry_front(conn: psycopg.Connection, ticker: str) -> float | None:
    """Net GEX (call - put gamma) on the front expiry."""
    row = _safe_fetchone(
        conn,
        """
        SELECT COALESCE(SUM(call_gamma), 0) - COALESCE(SUM(put_gamma), 0)
        FROM uw_greek_exposure_expiry
        WHERE ticker = %s AND expiry = (
            SELECT MIN(expiry) FROM uw_greek_exposure_expiry
            WHERE ticker = %s AND expiry >= CURRENT_DATE
        )
        """,
        (ticker, ticker),
    )
    if not row or row[0] is None:
        return None
    return float(row[0])


def _skew_nope(conn: psycopg.Connection, ticker: str) -> tuple[float | None, float | None]:
    """25-delta risk-reversal skew + NOPE."""
    skew_row = _safe_fetchone(
        conn,
        """
        SELECT call_iv_25d - put_iv_25d
        FROM uw_risk_reversal_skew
        WHERE ticker = %s ORDER BY snapshot_date DESC LIMIT 1
        """,
        (ticker,),
    )
    nope_row = _safe_fetchone(
        conn,
        """
        SELECT nope_value FROM uw_nope
        WHERE ticker = %s ORDER BY snapshot_ts DESC LIMIT 1
        """,
        (ticker,),
    )
    skew = float(skew_row[0]) if skew_row and skew_row[0] is not None else None
    nope = float(nope_row[0]) if nope_row and nope_row[0] is not None else None
    return (skew, nope)


def _uw_predictions(conn: psycopg.Connection, ticker: str) -> tuple[float | None, float | None]:
    """UW's own prediction API scores (bullish probability)."""
    sm = _safe_fetchone(
        conn,
        """
        SELECT
            CASE direction WHEN 'bullish' THEN confidence
                           WHEN 'bearish' THEN 1 - confidence
                           ELSE NULL END
        FROM uw_predictions_api
        WHERE ticker = %s AND source = 'smart_money'
        ORDER BY snapshot_ts DESC LIMIT 1
        """,
        (ticker,),
    )
    wh = _safe_fetchone(
        conn,
        """
        SELECT
            CASE direction WHEN 'bullish' THEN confidence
                           WHEN 'bearish' THEN 1 - confidence
                           ELSE NULL END
        FROM uw_predictions_api
        WHERE ticker = %s AND source = 'whales'
        ORDER BY snapshot_ts DESC LIMIT 1
        """,
        (ticker,),
    )
    return (
        float(sm[0]) if sm and sm[0] is not None else None,
        float(wh[0]) if wh and wh[0] is not None else None,
    )


def _news_24h(conn: psycopg.Connection, ticker: str) -> tuple[int, float | None]:
    """24h news count + average sentiment (-1..+1)."""
    since = datetime.now(UTC) - timedelta(hours=24)
    row = _safe_fetchone(
        conn,
        """
        SELECT
            COUNT(*),
            AVG(CASE sentiment
                WHEN 'bullish' THEN 1.0
                WHEN 'positive' THEN 1.0
                WHEN 'bearish' THEN -1.0
                WHEN 'negative' THEN -1.0
                ELSE 0.0 END)
        FROM uw_news
        WHERE %s = ANY(tickers) AND created_at >= %s
        """,
        (ticker, since),
    )
    if not row:
        return (0, None)
    return (int(row[0] or 0), float(row[1]) if row[1] is not None else None)


def _seasonality(conn: psycopg.Connection, ticker: str) -> float | None:
    """Average return for the current calendar month over the last 5 years.

    Uses prices_daily. Cheap-and-good: not pulling UW seasonality endpoint
    because we already have the prices."""
    now = datetime.now(UTC)
    month = now.month
    five_y_ago = now - timedelta(days=365 * 5)
    row = _safe_fetchone(
        conn,
        """
        WITH monthly AS (
            SELECT date_trunc('month', ts) AS m,
                   (LAST_VALUE(close) OVER (PARTITION BY date_trunc('month', ts) ORDER BY ts
                       RANGE BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
                   - FIRST_VALUE(close) OVER (PARTITION BY date_trunc('month', ts) ORDER BY ts
                       RANGE BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)) /
                   NULLIF(FIRST_VALUE(close) OVER (PARTITION BY date_trunc('month', ts) ORDER BY ts
                       RANGE BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING), 0) AS ret
            FROM prices_daily
            WHERE symbol = %s AND ts >= %s AND EXTRACT(MONTH FROM ts) = %s
        )
        SELECT AVG(DISTINCT ret) FROM monthly
        """,
        (ticker, five_y_ago, month),
    )
    if not row or row[0] is None:
        return None
    return float(row[0])


def _regime(conn: psycopg.Connection) -> tuple[str | None, str | None, str | None]:
    row = _safe_fetchone(
        conn,
        """
        SELECT vol_regime, trend_regime, macro_regime
        FROM macro_regime
        ORDER BY asof_date DESC LIMIT 1
        """,
        (),
    )
    if not row:
        return (None, None, None)
    return (row[0], row[1], row[2])


def _flow_detail_24h(conn: psycopg.Connection, ticker: str) -> dict[str, Any]:
    """24h options flow detail. ~12 features.

    Reads uw_flow_alerts directly. Returns flat dict; composer merges into
    features JSONB. None values when no flow today (treat as missing, not 0)."""
    since = datetime.now(UTC) - timedelta(hours=24)
    row = _safe_fetchone(
        conn,
        """
        SELECT
            COUNT(*) AS n,
            COUNT(*) FILTER (WHERE has_sweep)        AS n_sweep,
            COUNT(*) FILTER (WHERE has_floor)        AS n_floor,
            COUNT(*) FILTER (WHERE has_multileg)     AS n_ml,
            COUNT(*) FILTER (WHERE has_singleleg)    AS n_sl,
            COUNT(*) FILTER (WHERE all_opening_trades) AS n_opening,
            COALESCE(SUM(CASE WHEN option_type = 'call' THEN volume ELSE 0 END), 0) AS call_v,
            COALESCE(SUM(CASE WHEN option_type = 'put'  THEN volume ELSE 0 END), 0) AS put_v,
            COALESCE(SUM(CASE WHEN option_type = 'call' THEN total_premium ELSE 0 END), 0) AS call_p,
            COALESCE(SUM(CASE WHEN option_type = 'put'  THEN total_premium ELSE 0 END), 0) AS put_p,
            COALESCE(SUM(bid_side_prem), 0) AS bid_p,
            COALESCE(SUM(ask_side_prem), 0) AS ask_p,
            COALESCE(AVG(total_premium), 0) AS avg_prem,
            COALESCE(MAX(total_size),    0) AS largest_size
        FROM uw_flow_alerts
        WHERE ticker = %s AND created_at >= %s
        """,
        (ticker, since),
    )
    if not row or not row[0]:
        return {}
    (n, n_sw, n_fl, n_ml, n_sl, n_op, call_v, put_v, call_p, put_p, bid_p, ask_p, avg_p, big) = row
    n = int(n or 0)
    return {
        "flow_alerts_24h": n,
        "sweep_count_24h": int(n_sw or 0),
        "floor_count_24h": int(n_fl or 0),
        "multi_leg_share_24h": (float(n_ml) / n) if n else None,
        "single_leg_share_24h": (float(n_sl) / n) if n else None,
        "opening_trades_share_24h": (float(n_op) / n) if n else None,
        "call_put_volume_ratio_24h":
            (float(call_v) / float(put_v)) if put_v and float(put_v) > 0 else None,
        "call_put_premium_ratio_24h":
            (float(call_p) / float(put_p)) if put_p and float(put_p) > 0 else None,
        "bid_ask_premium_ratio_24h":
            (float(bid_p) / float(ask_p)) if ask_p and float(ask_p) > 0 else None,
        "avg_premium_per_trade_24h": float(avg_p or 0),
        "largest_trade_size_24h": int(big or 0),
        "total_premium_24h": float((call_p or 0) + (put_p or 0)),
    }


def _flow_5d(conn: psycopg.Connection, ticker: str) -> dict[str, Any]:
    """5d rolling flow signal. ~4 features. Reads uw_net_prem_daily."""
    since = (datetime.now(UTC) - timedelta(days=5)).date()
    row = _safe_fetchone(
        conn,
        """
        SELECT
            COALESCE(SUM(call_volume), 0) AS cv,
            COALESCE(SUM(put_volume), 0)  AS pv,
            COALESCE(SUM(net_call_premium), 0) AS net_cp,
            COALESCE(SUM(net_put_premium), 0)  AS net_pp,
            COALESCE(SUM(net_delta), 0) AS net_d
        FROM uw_net_prem_daily
        WHERE ticker = %s AND date >= %s
        """,
        (ticker, since),
    )
    if not row:
        return {}
    cv, pv, net_cp, net_pp, net_d = row
    return {
        "call_put_volume_ratio_5d": (float(cv) / float(pv)) if pv and float(pv) > 0 else None,
        "net_call_premium_5d": float(net_cp or 0),
        "net_put_premium_5d":  float(net_pp or 0),
        "net_delta_5d":        float(net_d or 0),
    }


def _gex_detail(conn: psycopg.Connection, ticker: str) -> dict[str, Any]:
    """GEX breakdown across the strike surface. ~10 features.

    Reads uw_greek_exposure_strike (per-strike) + uw_greek_exposure (per-day
    aggregates). The latter has charm/vanna columns."""
    # Per-day aggregates
    agg = _safe_fetchone(
        conn,
        """
        SELECT call_gamma, put_gamma, call_charm, put_charm, call_vanna, put_vanna,
               call_delta, put_delta
        FROM uw_greek_exposure
        WHERE ticker = %s
        ORDER BY date DESC LIMIT 1
        """,
        (ticker,),
    )
    out: dict[str, Any] = {}
    if agg:
        cg, pg, cc, pc, cv, pv, cd, pd_ = agg
        out["total_gex"]   = float((cg or 0) - (pg or 0))
        out["call_gex"]    = float(cg) if cg is not None else None
        out["put_gex"]     = float(pg) if pg is not None else None
        out["net_charm"]   = float((cc or 0) - (pc or 0))
        out["net_vanna"]   = float((cv or 0) - (pv or 0))
        out["call_delta_total"] = float(cd) if cd is not None else None
        out["put_delta_total"]  = float(pd_) if pd_ is not None else None

    # Strike-level: walls counted + biggest call/put gex magnitudes
    walls = _safe_fetchone(
        conn,
        """
        WITH latest AS (
            SELECT MAX(snapshot_date) AS d FROM uw_greek_exposure_strike WHERE ticker = %s
        ), spot AS (
            SELECT COALESCE(
                (SELECT last_price FROM uw_screener_stocks WHERE ticker = %s
                 ORDER BY snapshot_ts DESC LIMIT 1),
                (SELECT close FROM prices_daily WHERE symbol = %s
                 ORDER BY ts DESC LIMIT 1)
            ) AS p
        )
        SELECT
            COUNT(*) FILTER (WHERE strike > (SELECT p FROM spot) AND call_gex IS NOT NULL) AS call_walls_above,
            COUNT(*) FILTER (WHERE strike < (SELECT p FROM spot) AND put_gex IS NOT NULL)  AS put_walls_below,
            MAX(call_gex) FILTER (WHERE strike > (SELECT p FROM spot)) AS biggest_call_wall,
            MAX(put_gex)  FILTER (WHERE strike < (SELECT p FROM spot)) AS biggest_put_wall
        FROM uw_greek_exposure_strike, latest
        WHERE ticker = %s AND snapshot_date = latest.d
        """,
        (ticker, ticker, ticker, ticker),
    )
    if walls:
        out["call_walls_above_count"] = int(walls[0] or 0)
        out["put_walls_below_count"]  = int(walls[1] or 0)
        out["biggest_call_wall_size"] = float(walls[2]) if walls[2] is not None else None
        out["biggest_put_wall_size"]  = float(walls[3]) if walls[3] is not None else None
    return out


def _institutional_detail(conn: psycopg.Connection, ticker: str) -> dict[str, Any]:
    """Buyer/seller counts on 13F activity. ~4 features."""
    row = _safe_fetchone(
        conn,
        """
        SELECT
            COUNT(*) FILTER (WHERE change_in_shares > 0) AS buyers,
            COUNT(*) FILTER (WHERE change_in_shares < 0) AS sellers,
            COUNT(*) FILTER (WHERE COALESCE(prev_shares, 0) = 0
                             AND COALESCE(change_in_shares, 0) > 0) AS new_positions,
            COUNT(*) FILTER (WHERE COALESCE(change_in_shares, 0) < 0
                             AND COALESCE(prev_shares, 0) + change_in_shares = 0) AS closed_positions
        FROM uw_institution_activity
        WHERE ticker = %s
          AND COALESCE(filing_date, created_at::date) >= CURRENT_DATE - 90
        """,
        (ticker,),
    )
    if not row:
        return {}
    return {
        "inst_buyers_count_90d":  int(row[0] or 0),
        "inst_sellers_count_90d": int(row[1] or 0),
        "inst_new_positions_90d": int(row[2] or 0),
        "inst_closed_positions_90d": int(row[3] or 0),
    }


def _iv_stats(conn: psycopg.Connection, ticker: str) -> tuple[float | None, float | None, float | None]:
    """iv30, rv30, iv_rank from uw_volatility_stats."""
    row = _safe_fetchone(
        conn,
        """
        SELECT iv30, rv30, iv_rank
        FROM uw_volatility_stats
        WHERE ticker = %s
        ORDER BY snapshot_date DESC LIMIT 1
        """,
        (ticker,),
    )
    if not row:
        return (None, None, None)
    return (
        float(row[0]) if row[0] is not None else None,
        float(row[1]) if row[1] is not None else None,
        float(row[2]) if row[2] is not None else None,
    )


# ----------------------------------------------------------------------------
# Conflict detector — when sources point opposite ways.
# ----------------------------------------------------------------------------


def _detect_conflicts(f: FeatureRow) -> tuple[bool, list[str]]:
    """Return (has_conflict, codes). Each code is a named source-disagreement.

    Conflicts dampen probability in delphi_rank and surface in the Conviction
    tab as a "filter to no-conflict" toggle.
    """
    codes: list[str] = []

    # 1. Late-day dark-pool selling beneath positive flow ranking
    if (
        f.dp_late_day_share is not None
        and f.dp_late_day_share > 0.6
        and f.dp_net_premium_24h is not None
        and f.dp_net_premium_24h < 0
        and f.uw_smart_money_score is not None
        and f.uw_smart_money_score > 0.6
    ):
        codes.append("CONFLICT_LATEDAY_DP_VS_FLOW")

    # 2. Insider selling cluster while flow is bullish
    if (
        f.insider_sellers_30d >= 3
        and f.insider_buyers_30d == 0
        and f.uw_smart_money_score is not None
        and f.uw_smart_money_score > 0.55
    ):
        codes.append("CONFLICT_INSIDER_SELL_VS_BULL_FLOW")

    # 3. Bearish max-pain pin against bullish ranking (short-horizon only signal)
    if (
        f.max_pain_distance is not None
        and f.max_pain_distance < -0.04
        and f.uw_smart_money_score is not None
        and f.uw_smart_money_score > 0.6
    ):
        codes.append("CONFLICT_MAX_PAIN_BELOW_BULL")

    # 4. Negative analyst revisions with positive flow
    if (
        f.analyst_net_upgrade < -1
        and f.uw_smart_money_score is not None
        and f.uw_smart_money_score > 0.55
    ):
        codes.append("CONFLICT_ANALYST_DOWN_VS_BULL_FLOW")

    # 5. UW smart money and whales pointing opposite ways
    if (
        f.uw_smart_money_score is not None
        and f.uw_whales_score is not None
        and abs(f.uw_smart_money_score - f.uw_whales_score) > 0.35
    ):
        codes.append("CONFLICT_UW_SMART_VS_WHALES")

    return (len(codes) > 0, codes)


# ----------------------------------------------------------------------------
# Composer entry point
# ----------------------------------------------------------------------------


def _candidate_tickers(conn: psycopg.Connection) -> list[tuple[str, float | None]]:
    """Tickers from the freshest screener snapshot + their spot price."""
    row = _safe_fetchone(
        conn, "SELECT MAX(snapshot_ts) FROM uw_screener_stocks", ()
    )
    if not row or row[0] is None:
        return []
    snap = row[0]
    rows = _safe_fetchall(
        conn,
        """
        SELECT ticker,
               COALESCE(last_price,
                        (payload->>'last_price')::float,
                        (payload->>'price')::float,
                        (payload->>'close')::float)
        FROM uw_screener_stocks
        WHERE snapshot_ts = %s
        """,
        (snap,),
    )
    return [(r[0], float(r[1]) if r[1] is not None else None) for r in rows]


def _compose_ticker(conn: psycopg.Connection, ticker: str, spot: float | None) -> FeatureRow:
    iv30, rv30, iv_rank = _iv_stats(conn, ticker)
    dp_net, dp_n, dp_late = _dark_pool_24h(conn, ticker)
    ins_net, ins_b, ins_s = _insider_30d(conn, ticker)
    cong_b, cong_s = _congress_14d(conn, ticker)
    oi_c, oi_p, oi_open = _oi_change_1d(conn, ticker)
    mp_dist, mp_exp = _max_pain(conn, ticker, spot)
    sh_pct, sh_fee, sh_util = _short_data(conn, ticker)
    days_e, earn_in_h = _earnings(conn, ticker)
    an_rev, an_up = _analyst_30d(conn, ticker)
    inst_d = _institutional(conn, ticker)
    gex_front = _gex_expiry_front(conn, ticker)
    skew, nope = _skew_nope(conn, ticker)
    sm, wh = _uw_predictions(conn, ticker)
    news_n, news_s = _news_24h(conn, ticker)
    season = _seasonality(conn, ticker)
    vol_r, trend_r, macro_r = _regime(conn)

    f = FeatureRow(
        ticker=ticker,
        snapshot_ts=datetime.now(UTC),
        spot_price=spot,
        iv_rank=iv_rank,
        iv30=iv30,
        rv30=rv30,
        dp_net_premium_24h=dp_net,
        dp_print_count_24h=dp_n,
        dp_late_day_share=dp_late,
        insider_net_30d=ins_net,
        insider_buyers_30d=ins_b,
        insider_sellers_30d=ins_s,
        congress_buys_14d=cong_b,
        congress_sells_14d=cong_s,
        oi_delta_call_1d=oi_c,
        oi_delta_put_1d=oi_p,
        oi_opening_ratio=oi_open,
        max_pain_distance=mp_dist,
        max_pain_expiry=mp_exp,
        short_pct_float=sh_pct,
        short_fee_rate=sh_fee,
        short_utilization=sh_util,
        days_to_earnings=days_e,
        earnings_in_horizon=earn_in_h,
        analyst_revisions_30d=an_rev,
        analyst_net_upgrade=an_up,
        inst_net_delta_shares=inst_d,
        gex_expiry_front=gex_front,
        rr_skew_25d=skew,
        nope_score=nope,
        uw_smart_money_score=sm,
        uw_whales_score=wh,
        news_count_24h=news_n,
        news_sentiment_24h=news_s,
        seasonality_avg_ret=season,
        vol_regime=vol_r,
        trend_regime=trend_r,
        macro_regime=macro_r,
        has_conflict=False,
        conflict_codes=[],
        features={},
    )
    has_conflict, codes = _detect_conflicts(f)
    f.has_conflict = has_conflict
    f.conflict_codes = codes

    # Compose the JSONB features — start with derived ratios, then merge in
    # the heavy feature blocks (price action, flow detail, GEX detail,
    # institutional detail). Each block returns an empty dict when data is
    # missing, so composition stays safe.
    f.features = {
        "iv_rv_ratio": (iv30 / rv30) if (iv30 and rv30 and rv30 > 0) else None,
        "call_put_oi_delta_ratio": (
            (oi_c / oi_p) if (oi_c is not None and oi_p not in (None, 0)) else None
        ),
        "earnings_inside_eod": days_e == 0,
        "earnings_inside_1w": days_e is not None and days_e <= 7,
    }
    try:
        f.features.update(delphi_price_action.compute(conn, ticker))
    except Exception as e:  # noqa: BLE001
        log.debug("price_action failed for %s: %s", ticker, e)
    f.features.update(_flow_detail_24h(conn, ticker))
    f.features.update(_flow_5d(conn, ticker))
    f.features.update(_gex_detail(conn, ticker))
    f.features.update(_institutional_detail(conn, ticker))

    # Anomalies (PEAD, 12-1 momentum, idiosyncratic vol) — well-replicated
    # academic alphas. Always computed per-ticker. Empty dict on missing data.
    try:
        f.features.update(delphi_anomalies.compute(conn, ticker))
    except Exception as e:  # noqa: BLE001
        log.debug("anomalies failed for %s: %s", ticker, e)

    # Backfill spot_price from price_action if the screener gave us None.
    if f.spot_price is None and f.features.get("last_close"):
        f.spot_price = float(f.features["last_close"])

    # Record feature count for observability — easier to spot a regression
    # in the composer (e.g. "tickers losing 30 features overnight").
    f.features["_feature_count"] = sum(1 for v in f.features.values() if v is not None)

    return f


def _upsert(conn: psycopg.Connection, f: FeatureRow) -> None:
    conn.execute(
        """
        INSERT INTO delphi_features (
            ticker, snapshot_ts,
            spot_price, iv_rank, iv30, rv30,
            dp_net_premium_24h, dp_print_count_24h, dp_late_day_share,
            insider_net_30d, insider_buyers_30d, insider_sellers_30d,
            congress_buys_14d, congress_sells_14d,
            oi_delta_call_1d, oi_delta_put_1d, oi_opening_ratio,
            max_pain_distance, max_pain_expiry,
            short_pct_float, short_fee_rate, short_utilization,
            days_to_earnings, earnings_in_horizon,
            analyst_revisions_30d, analyst_net_upgrade,
            inst_net_delta_shares,
            gex_expiry_front,
            rr_skew_25d, nope_score,
            uw_smart_money_score, uw_whales_score,
            news_count_24h, news_sentiment_24h,
            seasonality_avg_ret,
            vol_regime, trend_regime, macro_regime,
            has_conflict, conflict_codes, features
        ) VALUES (
            %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s,
            %s, %s, %s,
            %s, %s,
            %s, %s, %s,
            %s, %s,
            %s, %s,
            %s,
            %s,
            %s, %s,
            %s, %s,
            %s, %s,
            %s,
            %s, %s, %s,
            %s, %s, %s
        )
        ON CONFLICT (ticker, snapshot_ts) DO NOTHING
        """,
        (
            f.ticker, f.snapshot_ts,
            f.spot_price, f.iv_rank, f.iv30, f.rv30,
            f.dp_net_premium_24h, f.dp_print_count_24h, f.dp_late_day_share,
            f.insider_net_30d, f.insider_buyers_30d, f.insider_sellers_30d,
            f.congress_buys_14d, f.congress_sells_14d,
            f.oi_delta_call_1d, f.oi_delta_put_1d, f.oi_opening_ratio,
            f.max_pain_distance, f.max_pain_expiry,
            f.short_pct_float, f.short_fee_rate, f.short_utilization,
            f.days_to_earnings, f.earnings_in_horizon,
            f.analyst_revisions_30d, f.analyst_net_upgrade,
            f.inst_net_delta_shares,
            f.gex_expiry_front,
            f.rr_skew_25d, f.nope_score,
            f.uw_smart_money_score, f.uw_whales_score,
            f.news_count_24h, f.news_sentiment_24h,
            f.seasonality_avg_ret,
            f.vol_regime, f.trend_regime, f.macro_regime,
            f.has_conflict, f.conflict_codes, Jsonb(f.features),
        ),
    )


# Numeric features in delphi_features that get a cross-sectional rank
# computed across the universe at each snapshot. The rank is the percentile
# (0..1) of this ticker's value among non-null values today. Stored back
# into features JSONB as f"xs_rank_{name}". Rank features are regime-
# invariant — "top decile by 24h dark-pool premium" means the same thing
# in any vol regime, unlike the raw $ value.
_XS_FEATURES: list[str] = [
    "dp_net_premium_24h", "dp_print_count_24h", "dp_late_day_share",
    "insider_net_30d", "insider_buyers_30d", "insider_sellers_30d",
    "congress_buys_14d", "oi_opening_ratio",
    "max_pain_distance", "short_pct_float", "short_fee_rate",
    "analyst_net_upgrade", "inst_net_delta_shares",
    "gex_expiry_front", "rr_skew_25d", "nope_score",
    "uw_smart_money_score", "uw_whales_score",
    "news_sentiment_24h",
]
# Same idea but for features stored inside the JSONB `features` dict.
_XS_FEATURES_JSON: list[str] = [
    "ret_5d", "ret_20d", "ret_60d", "ret_vs_spy_5d", "ret_vs_spy_20d",
    "rsi_14", "macd_histogram", "atr_pct", "bb_pct_position",
    "volume_vs_30d", "volume_z_30d", "obv_slope_20",
    "ts_momentum_12_1", "pead_signal", "idio_vol_60d",
    "total_premium_24h", "call_put_premium_ratio_24h",
    "total_gex", "biggest_call_wall_size", "biggest_put_wall_size",
]


def _percentile_ranks(values: list[float | None]) -> list[float | None]:
    """Return percentile rank (0..1) of each non-null value among the population.
    Nulls map to None. Ties get the average rank."""
    indexed = [(i, v) for i, v in enumerate(values) if v is not None and isinstance(v, (int, float))]
    if len(indexed) < 5:
        return [None] * len(values)
    sorted_vals = sorted(indexed, key=lambda x: x[1])
    n = len(sorted_vals)
    ranks: list[float | None] = [None] * len(values)
    # Average rank for ties
    i = 0
    while i < n:
        j = i
        while j + 1 < n and sorted_vals[j + 1][1] == sorted_vals[i][1]:
            j += 1
        avg_rank = (i + j) / 2.0 / max(1, n - 1)
        for k in range(i, j + 1):
            ranks[sorted_vals[k][0]] = avg_rank
        i = j + 1
    return ranks


def _compute_xs_ranks(rows: list[FeatureRow]) -> None:
    """Mutate each row's features dict to add xs_rank_<name> percentiles.

    Two passes: promoted scalars (read from row attributes) and JSONB features.
    Universe percentiles for the batch get stashed in delphi_xs_universe_stats
    so the API can show distributional context per feature.
    """
    if not rows:
        return
    # Promoted scalars
    for name in _XS_FEATURES:
        vals = [getattr(r, name, None) for r in rows]
        try:
            ranks = _percentile_ranks(vals)
        except Exception:  # noqa: BLE001
            ranks = [None] * len(rows)
        for r, rk in zip(rows, ranks, strict=True):
            if rk is not None:
                r.features[f"xs_rank_{name}"] = rk
    # JSONB features
    for name in _XS_FEATURES_JSON:
        vals = [r.features.get(name) for r in rows]
        try:
            ranks = _percentile_ranks(vals)
        except Exception:  # noqa: BLE001
            ranks = [None] * len(rows)
        for r, rk in zip(rows, ranks, strict=True):
            if rk is not None:
                r.features[f"xs_rank_{name}"] = rk


def _write_universe_stats(conn: psycopg.Connection, snapshot_ts: datetime, rows: list[FeatureRow]) -> None:
    """Persist universe percentiles for each tracked feature so the API can
    surface "top decile of X" badges per ticker without recomputing."""
    import statistics
    for name in (_XS_FEATURES + _XS_FEATURES_JSON):
        if name in _XS_FEATURES:
            vals = [getattr(r, name, None) for r in rows]
        else:
            vals = [r.features.get(name) for r in rows]
        vals = [float(v) for v in vals if v is not None and isinstance(v, (int, float))]
        if len(vals) < 5:
            continue
        vals_sorted = sorted(vals)
        n = len(vals_sorted)
        def q(p: float) -> float:
            idx = max(0, min(n - 1, int(round(p * (n - 1)))))
            return vals_sorted[idx]
        try:
            conn.execute(
                """
                INSERT INTO delphi_xs_universe_stats (
                    snapshot_ts, feature_name, n_tickers,
                    pct10, pct25, pct50, pct75, pct90,
                    mean_val, stddev_val
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (snapshot_ts, feature_name) DO NOTHING
                """,
                (
                    snapshot_ts, name, n,
                    q(0.10), q(0.25), q(0.50), q(0.75), q(0.90),
                    statistics.fmean(vals),
                    statistics.pstdev(vals) if n > 1 else 0.0,
                ),
            )
        except psycopg.errors.UndefinedTable:
            return  # migration 0038 not applied yet


def compose(database_url: str, *, max_tickers: int = 200) -> dict[str, Any]:
    """Compose features for every ticker in the freshest screener snapshot.

    Returns a summary dict. Idempotent — same (ticker, snapshot_ts) PK skips
    duplicates within the same minute.

    Two-pass design:
      1. Per-ticker compose: pulls ~120 raw features into FeatureRow objects.
         Macro spreads computed once per batch (broadcast into every row).
      2. Cross-sectional rank pass: for each tracked numeric feature, compute
         the percentile rank across the batch and add xs_rank_<name> into
         the JSONB. This is what makes features regime-invariant.
      3. Universe stats: persist percentile breakpoints for the API.
      4. Bulk upsert.
    """
    written = 0
    conflict_n = 0
    by_conflict: dict[str, int] = {}
    with connect(database_url) as conn:
        candidates = _candidate_tickers(conn)
        if not candidates:
            log.warning("delphi-features: no candidates — screener_stocks empty?")
            return {"composed": 0}

        # One-shot macro/breadth pull — broadcast into every ticker row so
        # the ML model can interact macro × per-ticker features.
        try:
            macro_block = delphi_macro_spreads.compute(conn)
        except Exception as e:  # noqa: BLE001
            log.warning("delphi-features: macro spreads failed: %s", e)
            macro_block = {}

        rows: list[FeatureRow] = []
        for ticker, spot in candidates[:max_tickers]:
            try:
                f = _compose_ticker(conn, ticker, spot)
                f.features.update(macro_block)
                rows.append(f)
                if f.has_conflict:
                    conflict_n += 1
                    for code in f.conflict_codes:
                        by_conflict[code] = by_conflict.get(code, 0) + 1
            except Exception as e:  # noqa: BLE001
                log.warning("delphi-features composer failed for %s: %s", ticker, e)

        # Pass 2: cross-sectional ranks. Mutates each row's features JSONB
        # in place. Regime-invariance trick from the cross-sectional quant
        # playbook.
        _compute_xs_ranks(rows)

        # Pass 3: persist universe distribution for the API.
        if rows:
            snap = rows[0].snapshot_ts
            _write_universe_stats(conn, snap, rows)

        # Pass 4: bulk write.
        for f in rows:
            try:
                _upsert(conn, f)
                written += 1
            except Exception as e:  # noqa: BLE001
                log.warning("delphi-features upsert failed for %s: %s", f.ticker, e)

        conn.commit()
    return {
        "composed": written,
        "conflicts": conflict_n,
        "by_conflict_code": by_conflict,
        "macro_keys": list(macro_block.keys()) if macro_block else [],
    }
