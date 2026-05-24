"""Daily regime tagger — composite regime label for Delphi stratification.

Today delphi_predictions.regime is always NULL. The learning tables key on
regime, so without it we average calibration buckets across regimes that
behave nothing alike (a 70%-probability bullish call in a VIX-15 uptrend is
not the same statistical object as one in a VIX-32 downtrend). Stratifying
by regime is the single biggest accuracy lever on the table.

This module writes one row to macro_regime per calendar date. It reads:
  - macro_daily (FRED yield curve, VIX, DXY, Fed funds; already ingested)
  - prices_daily (SPY for trend regime)

Composite regime is a 3-slot tuple persisted as one string so it joins cleanly
back into delphi_predictions.regime:

  vol_regime   ∈ {low, normal, high, crisis}     from VIX absolute + Z-30
  trend_regime ∈ {uptrend, rangebound, downtrend} from SPY vs MAs
  macro_regime ∈ {risk_on, neutral, risk_off}    from yield-curve + DXY + Fed

  composite = '{trend}_{vol}_{macro}'
  e.g. 'uptrend_normal_risk_on', 'downtrend_high_risk_off'.

Cron: daily at 22:15 UTC (15 min after prices-daily lands at 22:00). The
output drives Delphi's regime stratification for the NEXT trading day.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect

log = logging.getLogger(__name__)


# FRED series IDs we depend on. These match the codes our macro ingest writes.
SERIES_VIX = "VIXCLS"
SERIES_2Y = "DGS2"
SERIES_10Y = "DGS10"
SERIES_DXY = "DTWEXBGS"
SERIES_FED = "DFF"


def _latest_macro(conn: psycopg.Connection, series: str) -> tuple[float | None, date | None]:
    row = conn.execute(
        """
        SELECT value, ts::date
        FROM macro_daily
        WHERE series_id = %s AND value IS NOT NULL
        ORDER BY ts DESC LIMIT 1
        """,
        (series,),
    ).fetchone()
    if not row:
        return (None, None)
    return (float(row[0]) if row[0] is not None else None, row[1])


def _vix_zscore_30d(conn: psycopg.Connection, vix_now: float) -> float | None:
    row = conn.execute(
        """
        SELECT AVG(value) AS m, STDDEV(value) AS s
        FROM macro_daily
        WHERE series_id = %s
          AND ts >= NOW() - INTERVAL '60 days'
          AND value IS NOT NULL
        """,
        (SERIES_VIX,),
    ).fetchone()
    if not row or row[0] is None or row[1] in (None, 0):
        return None
    return float((vix_now - float(row[0])) / float(row[1]))


def _spy_ma_distances(conn: psycopg.Connection) -> tuple[float | None, dict[str, bool | None]]:
    """Latest SPY close + above-MA flags for 20/50/200."""
    rows = conn.execute(
        """
        SELECT ts::date, close
        FROM prices_daily
        WHERE symbol = 'SPY' AND close IS NOT NULL
        ORDER BY ts DESC LIMIT 220
        """
    ).fetchall()
    if not rows or len(rows) < 50:
        return (None, {"spy_above_20d": None, "spy_above_50d": None, "spy_above_200d": None})
    closes = [float(r[1]) for r in rows]
    closes.reverse()
    last = closes[-1]
    ma20 = sum(closes[-20:]) / 20 if len(closes) >= 20 else None
    ma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else None
    ma200 = sum(closes[-200:]) / 200 if len(closes) >= 200 else None
    return (
        last,
        {
            "spy_above_20d":  bool(ma20 and last > ma20),
            "spy_above_50d":  bool(ma50 and last > ma50),
            "spy_above_200d": bool(ma200 and last > ma200) if ma200 else None,
        },
    )


def _classify_vol(vix: float | None, z: float | None) -> str:
    """VIX absolute + Z-score thresholds. Crisis trigger is rare (>2σ AND >30)."""
    if vix is None:
        return "normal"
    if vix >= 30 and (z or 0) >= 2.0:
        return "crisis"
    if vix >= 22:
        return "high"
    if vix <= 14 and (z or 0) <= -0.5:
        return "low"
    return "normal"


def _classify_trend(flags: dict[str, bool | None]) -> str:
    above = [v for v in flags.values() if v is True]
    below = [v for v in flags.values() if v is False]
    if len(above) >= 2:
        return "uptrend"
    if len(below) >= 2:
        return "downtrend"
    return "rangebound"


def _classify_macro(yc_2_10: float | None, dxy: float | None, fed: float | None) -> str:
    """Heuristic macro regime.

    Risk-off when: yield curve inverted (2-10 < 0) OR DXY rapidly strengthening
    OR Fed funds > 5.25 (restrictive). Risk-on when curve normal + Fed < 4.5.
    """
    if yc_2_10 is not None and yc_2_10 < -0.10:
        return "risk_off"
    if fed is not None and fed > 5.25:
        return "risk_off"
    if (
        yc_2_10 is not None and yc_2_10 > 0.20
        and fed is not None and fed < 4.5
    ):
        return "risk_on"
    return "neutral"


def tag_today(database_url: str, *, target_date: date | None = None) -> dict[str, Any]:
    """Write one regime row for `target_date` (defaults to today UTC)."""
    asof = target_date or datetime.now(UTC).date()

    with connect(database_url) as conn:
        vix, _    = _latest_macro(conn, SERIES_VIX)
        y2, _     = _latest_macro(conn, SERIES_2Y)
        y10, _    = _latest_macro(conn, SERIES_10Y)
        dxy, _    = _latest_macro(conn, SERIES_DXY)
        fed, _    = _latest_macro(conn, SERIES_FED)
        z         = _vix_zscore_30d(conn, vix) if vix is not None else None
        spy_close, spy_flags = _spy_ma_distances(conn)
        yc        = (y10 - y2) if (y10 is not None and y2 is not None) else None

        vol_regime   = _classify_vol(vix, z)
        trend_regime = _classify_trend(spy_flags)
        macro_regime = _classify_macro(yc, dxy, fed)
        composite    = f"{trend_regime}_{vol_regime}_{macro_regime}"

        conn.execute(
            """
            INSERT INTO macro_regime (
                asof_date,
                vix_close, vix_z_30d, vol_regime,
                spy_close, spy_above_20d, spy_above_50d, spy_above_200d, trend_regime,
                yield_curve_2_10, dxy_close, fed_funds_rate, macro_regime,
                composite_regime, payload
            ) VALUES (
                %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s
            ) ON CONFLICT (asof_date) DO UPDATE SET
                vix_close        = EXCLUDED.vix_close,
                vix_z_30d        = EXCLUDED.vix_z_30d,
                vol_regime       = EXCLUDED.vol_regime,
                spy_close        = EXCLUDED.spy_close,
                spy_above_20d    = EXCLUDED.spy_above_20d,
                spy_above_50d    = EXCLUDED.spy_above_50d,
                spy_above_200d   = EXCLUDED.spy_above_200d,
                trend_regime     = EXCLUDED.trend_regime,
                yield_curve_2_10 = EXCLUDED.yield_curve_2_10,
                dxy_close        = EXCLUDED.dxy_close,
                fed_funds_rate   = EXCLUDED.fed_funds_rate,
                macro_regime     = EXCLUDED.macro_regime,
                composite_regime = EXCLUDED.composite_regime,
                payload          = EXCLUDED.payload,
                updated_at       = NOW()
            """,
            (
                asof,
                vix, z, vol_regime,
                spy_close, spy_flags["spy_above_20d"], spy_flags["spy_above_50d"],
                spy_flags["spy_above_200d"], trend_regime,
                yc, dxy, fed, macro_regime,
                composite,
                Jsonb({
                    "inputs": {
                        "vix": vix, "vix_z_30d": z,
                        "y2": y2, "y10": y10, "yc_2_10": yc,
                        "dxy": dxy, "fed_funds": fed,
                        "spy_close": spy_close,
                    },
                    "decided_at": datetime.now(UTC).isoformat(),
                }),
            ),
        )
        conn.commit()

    return {
        "asof_date": asof.isoformat(),
        "vol_regime": vol_regime,
        "trend_regime": trend_regime,
        "macro_regime": macro_regime,
        "composite_regime": composite,
        "vix": vix,
        "vix_z_30d": z,
        "yield_curve_2_10": yc,
        "spy_above_20d": spy_flags["spy_above_20d"],
        "spy_above_50d": spy_flags["spy_above_50d"],
        "spy_above_200d": spy_flags["spy_above_200d"],
    }


def backfill(database_url: str, days: int = 90) -> dict[str, Any]:
    """Tag the last `days` calendar dates using each day's available data.

    Used at first install so the macro_regime time series is not empty when
    delphi-features starts reading it. Idempotent — uses ON CONFLICT.
    """
    end = datetime.now(UTC).date()
    out = []
    for i in range(days):
        d = end - timedelta(days=i)
        try:
            r = tag_today(database_url, target_date=d)
            out.append(r)
        except Exception as e:  # noqa: BLE001
            log.warning("regime backfill failed for %s: %s", d, e)
    return {"days_written": len(out), "first_date": out[-1]["asof_date"] if out else None,
            "last_date": out[0]["asof_date"] if out else None}
