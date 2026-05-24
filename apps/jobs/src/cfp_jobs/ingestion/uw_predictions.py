"""Pull UW's own prediction endpoints into uw_predictions_api.

UW exposes several "prediction" endpoints that summarize their view from
their full warehouse:

  /predictions/smart-money       — biggest unusual flow w/ direction + conviction
  /predictions/whales            — large-block options consensus
  /predictions/market            — overall market direction
  /predictions/insiders          — insider-buying flagged tickers
  /predictions/unusual-markets   — rare flow patterns

Each is used as an additional voter in the Delphi ensemble. The voter signal
is a probability of bullish outcome over UW's reported horizon (defaults to
1w when UW doesn't report one).

Schema (uw_predictions_api):
    (snapshot_ts, ticker, source) PK
    direction       'bullish' | 'bearish' | 'neutral'
    confidence      0..1
    horizon         'EOD','1w','1mo' or NULL
    payload         JSONB (full UW response for replay)

Cron: every 30 min during RTH on the existing :00/:30 slot.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from cfp_jobs.db import connect, to_psycopg_url
from cfp_jobs.ingestion.unusualwhales import UwClient

log = logging.getLogger(__name__)


# Endpoints we hit and the `source` column we tag them with. Each must return
# a list of {ticker, direction, confidence/score, ...} shaped rows; UW shapes
# vary so we normalize in _normalize_row().
ENDPOINTS: dict[str, str] = {
    "smart_money":      "/predictions/smart-money",
    "whales":           "/predictions/whales",
    "market":           "/predictions/market",
    "insiders":         "/predictions/insiders",
    "unusual_markets":  "/predictions/unusual-markets",
}


def _normalize_row(raw: dict) -> dict[str, Any]:
    """Coerce a UW prediction row to our canonical shape.

    UW returns mixed field names (direction vs side vs sentiment;
    confidence vs score vs probability vs strength). This handles the
    common ones and stashes the original in payload for later inspection.
    """
    ticker = raw.get("ticker") or raw.get("symbol") or raw.get("underlying")
    if not ticker:
        return {}

    direction = (
        raw.get("direction")
        or raw.get("side")
        or raw.get("sentiment")
        or ""
    ).lower()
    if direction in ("buy", "long", "call", "bull"):
        direction = "bullish"
    elif direction in ("sell", "short", "put", "bear"):
        direction = "bearish"
    elif direction not in ("bullish", "bearish", "neutral"):
        direction = "neutral"

    # Confidence: try common variants. Score may be 0..100; normalize to 0..1.
    conf = None
    for key in ("confidence", "probability", "prob", "strength", "score"):
        v = raw.get(key)
        if v is None:
            continue
        try:
            v = float(v)
        except (TypeError, ValueError):
            continue
        # Some UW endpoints return 0..100, others 0..1. Heuristic.
        if v > 1.0:
            v = v / 100.0
        conf = max(0.0, min(1.0, v))
        break

    horizon = raw.get("horizon") or raw.get("timeframe") or raw.get("window")
    return {
        "ticker": str(ticker).upper(),
        "direction": direction,
        "confidence": conf,
        "horizon": horizon,
        "raw": raw,
    }


def _upsert(conn: psycopg.Connection, source: str, rows: list[dict], snapshot_ts: datetime) -> int:
    written = 0
    for raw in rows:
        norm = _normalize_row(raw)
        if not norm:
            continue
        conn.execute(
            """
            INSERT INTO uw_predictions_api (
                snapshot_ts, ticker, source, direction, confidence, horizon, payload
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (snapshot_ts, ticker, source) DO UPDATE SET
                direction = EXCLUDED.direction,
                confidence = EXCLUDED.confidence,
                horizon = EXCLUDED.horizon,
                payload = EXCLUDED.payload
            """,
            (
                snapshot_ts,
                norm["ticker"],
                source,
                norm["direction"],
                norm["confidence"],
                norm["horizon"],
                Jsonb(norm["raw"]),
            ),
        )
        written += 1
    return written


def ingest(database_url: str, api_key: str) -> dict[str, int]:
    """Hit all 5 prediction endpoints; upsert one snapshot row per ticker per source.

    Per-endpoint failure is non-fatal — if UW changes a path or our tier
    blocks one, the rest still populate.
    """
    snapshot_ts = datetime.now(UTC).replace(microsecond=0)
    counts: dict[str, int] = {}
    with UwClient(api_key) as uw, psycopg.connect(to_psycopg_url(database_url)) as conn:
        for source, path in ENDPOINTS.items():
            try:
                body = uw._get(path) or []  # noqa: SLF001
                if isinstance(body, dict) and "data" in body:
                    body = body["data"]
                if not isinstance(body, list):
                    log.info("uw-predictions %s: non-list body, skipping", source)
                    counts[source] = 0
                    continue
                counts[source] = _upsert(conn, source, body, snapshot_ts)
            except Exception as e:  # noqa: BLE001
                log.warning("uw-predictions %s failed: %s", source, e)
                counts[source] = 0
        conn.commit()
    return counts
