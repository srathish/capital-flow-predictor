"""Full ingest universe = static config + every ticker UW has stored in
uw_etf_holdings (with proper exchange suffixes preserved).

Why this exists: the heatmap drill-down (/sectors/[etf]/holdings) shows
ETF constituents from uw_etf_holdings, including international names
like 3800.HK / SLR.MC / ENLT.TA. The display computes 5d/20d/60d returns
by joining prices_daily — and for tickers we never ingest, the join
returns null and the UI shows '—'.

Solving it by stuffing the entire UW holdings universe into the daily
yfinance pull. yfinance handles standard exchange suffixes (.HK, .TA,
.MC, .DE, .T, .KS, .SZ, .SS) natively. Tickers without a suffix that
are pure numbers — typically Asian local codes UW stored unhydrated —
get filtered out because yfinance can't resolve them anyway.

The function returns a de-duped list. fetch_prices() in
ingestion/prices.py logs a WARNING and skips any symbol yfinance can't
resolve, so it's safe to pass everything and let yfinance do the
filtering on the rest.
"""
from __future__ import annotations

import logging
import re

import psycopg
from cfp_shared import all_yfinance_symbols

log = logging.getLogger(__name__)

_PURE_NUMERIC = re.compile(r"^[0-9]+$")


def _load_holdings_tickers(conn: psycopg.Connection) -> list[str]:
    """Every distinct UW-stored ticker for our ETF universe, minus the
    pure-numeric ones (local Asian codes without exchange info)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT DISTINCT ticker FROM uw_etf_holdings "
            "WHERE ticker IS NOT NULL AND ticker !~ '^[0-9]+$'"
        )
        return [row[0] for row in cur.fetchall()]


def full_ingest_universe(database_url: str) -> list[str]:
    """Static universe ∪ uw_etf_holdings tickers, de-duped, sorted.

    Falls back to the static universe alone if the DB read fails — the
    daily/backfill jobs should still make progress on the core symbols
    even when the holdings table is unreachable.
    """
    from cfp_jobs.db import connect, to_psycopg_url

    static = list(all_yfinance_symbols())
    try:
        with connect(to_psycopg_url(database_url)) as conn:
            extra = _load_holdings_tickers(conn)
    except Exception as e:
        log.warning(
            "full_ingest_universe: holdings read failed (%s); using static universe only", e
        )
        return sorted(set(static))

    union = set(static) | set(extra)
    # Defensive filter — connect() / _load_holdings_tickers should already
    # skip these, but anything with embedded whitespace or empty strings
    # would break yfinance's space-separated multi-symbol fetch.
    cleaned = sorted(s for s in union if s and not s.isspace() and not _PURE_NUMERIC.match(s) or s in static)
    return cleaned
