"""Macro spread + breadth features for the Delphi composer.

Three groups of features that we have the data for but Delphi has never read:

1. **VIX term structure** (VX1/VX2): backwardation = market stress, contango
   = normal carry. Reads UVXY/VIXY/VXX/VIX prices when available; falls back
   to VIX-only when VX futures aren't ingested.

2. **Cross-asset spreads** that predict equity returns:
     HYG/LQD ratio — credit risk-on/off (HYG = junk, LQD = investment grade)
     TLT/SPY ratio — duration vs equity (negative = rotation into bonds)
     GLD/DXY ratio — safe haven flow
     XLU/SPY ratio — defensive rotation (utilities)

3. **SPY breadth** — % of S&P above 50d MA. Above 70 = healthy trend;
   below 30 = oversold bounce setup.

These are MACRO-level (one value per snapshot, not per ticker), so they get
denormalized into every delphi_features row as features that the regime tagger
already partly captures. Adding them as raw features lets the ML model learn
non-linear interactions the regime label flattens out.

Reads only what we already ingest (macro_daily + prices_daily). No new UW
endpoints. Used by the composer; updated whenever prices_daily refreshes.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg

log = logging.getLogger(__name__)


def _ratio(conn: psycopg.Connection, num: str, den: str, days: int = 5) -> tuple[float | None, float | None]:
    """Latest (num / den) ratio + 5d Z-score against the prior 60 days."""
    row = conn.execute(
        """
        WITH joined AS (
            SELECT n.ts::date AS d, n.close AS num, dd.close AS den
            FROM prices_daily n
            JOIN prices_daily dd ON dd.ts::date = n.ts::date
            WHERE n.symbol = %s AND dd.symbol = %s
              AND n.close IS NOT NULL AND dd.close IS NOT NULL AND dd.close <> 0
              AND n.ts >= NOW() - INTERVAL '90 days'
        )
        SELECT
            (num/den) AS latest_ratio,
            (SELECT AVG(num/den) FROM joined) AS avg_60d,
            (SELECT STDDEV(num/den) FROM joined) AS sd_60d
        FROM joined ORDER BY d DESC LIMIT 1
        """,
        (num, den),
    ).fetchone()
    if not row or row[0] is None:
        return (None, None)
    ratio, avg, sd = float(row[0]), row[1], row[2]
    z = ((ratio - float(avg)) / float(sd)) if sd and float(sd) > 0 else None
    return (ratio, z)


def _vx_term_structure(conn: psycopg.Connection) -> float | None:
    """VX1/VX2 ratio proxy. Uses VXX (1m proxy) / VIXM (5m proxy) when present,
    falls back to VIXY/VXZ when not. Returns None when no pair is available.
    A value < 1.0 = backwardation (stress), > 1.0 = contango (normal carry).
    """
    for num_sym, den_sym in (("VXX", "VIXM"), ("VIXY", "VXZ"), ("UVXY", "VIXM")):
        ratio, _ = _ratio(conn, num_sym, den_sym)
        if ratio is not None:
            return ratio
    return None


def _spy_breadth(conn: psycopg.Connection) -> float | None:
    """% of S&P sector ETF holdings above their 50d MA.

    Computed from uw_etf_holdings + prices_daily. Returns None when sparse.
    """
    rows = conn.execute(
        """
        WITH constituents AS (
            SELECT DISTINCT ticker FROM uw_etf_holdings
            WHERE etf IN ('SPY','XLF','XLK','XLY','XLP','XLE','XLV','XLI','XLU','XLB','XLRE','XLC')
              AND ticker IS NOT NULL
            LIMIT 500
        ),
        latest AS (
            SELECT symbol, MAX(ts) AS ts FROM prices_daily
            WHERE symbol IN (SELECT ticker FROM constituents)
            GROUP BY symbol
        ),
        ma AS (
            SELECT p.symbol,
                   AVG(p.close) FILTER (WHERE p.ts >= l.ts - INTERVAL '70 days') AS ma50,
                   (ARRAY_AGG(p.close ORDER BY p.ts DESC))[1] AS last
            FROM prices_daily p
            JOIN latest l USING (symbol)
            WHERE p.ts >= l.ts - INTERVAL '70 days'
            GROUP BY p.symbol
        )
        SELECT
            AVG(CASE WHEN last > ma50 THEN 1.0 ELSE 0.0 END) AS pct_above_50,
            COUNT(*) AS n
        FROM ma WHERE ma50 IS NOT NULL AND last IS NOT NULL
        """,
    ).fetchone()
    if not rows or rows[0] is None or (rows[1] or 0) < 50:
        return None
    return float(rows[0])


def compute(conn: psycopg.Connection) -> dict[str, Any]:
    """Compute all macro/breadth features. Returns flat dict for composer
    to merge into the JSONB. Empty values stay None — never invent."""
    hyg_lqd, hyg_lqd_z = _ratio(conn, "HYG", "LQD")
    tlt_spy, tlt_spy_z = _ratio(conn, "TLT", "SPY")
    gld_dxy, gld_dxy_z = _ratio(conn, "GLD", "UUP")  # UUP = DXY ETF proxy
    xlu_spy, xlu_spy_z = _ratio(conn, "XLU", "SPY")
    vx_ts = _vx_term_structure(conn)
    breadth = _spy_breadth(conn)

    return {
        "macro_hyg_lqd":     hyg_lqd,
        "macro_hyg_lqd_z":   hyg_lqd_z,
        "macro_tlt_spy":     tlt_spy,
        "macro_tlt_spy_z":   tlt_spy_z,
        "macro_gld_dxy":     gld_dxy,
        "macro_gld_dxy_z":   gld_dxy_z,
        "macro_xlu_spy":     xlu_spy,
        "macro_xlu_spy_z":   xlu_spy_z,
        "macro_vx_term":     vx_ts,
        "macro_spy_breadth": breadth,
    }
