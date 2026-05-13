"""Score the brief / monitor plan calls against actual intraday price action.

Reads `gex_feed` for source='brief'|'monitor' entries, parses out the CALLS /
PUTS plan lines (break level, target, stop, R:R), pulls yfinance 1-min bars
for SPY / QQQ / ^GSPC (mapped to SPXW's index-level scale), determines:
  * Did spot cross the break level after the plan was posted?
  * Did target hit before stop, or vice versa?
  * Realized R:R vs predicted R:R

Writes one row per (feed_id, ticker, side) into ``gex_plan_outcomes``.
Idempotent — re-running on the same day updates rows rather than duplicating.

Pending plans (break level not yet crossed) are written with
``exit_reason='pending'`` and re-scored the next time the job runs.

Run via: ``cfp-jobs score-gex-plans [--days 7]``. Designed for the GH Actions
nightly cron at ~22:00 ET (after market close + intraday data settles).
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, date as date_t, datetime, timedelta
from typing import Any

import pandas as pd

from cfp_jobs.db import connect

log = logging.getLogger(__name__)

# yfinance ticker → "ticker shown in the brief". SPXW levels match ^GSPC.
_YF_TICKER: dict[str, str] = {"SPY": "SPY", "QQQ": "QQQ", "SPXW": "^GSPC"}

# Plan parser. Matches lines like:
#   "⬆ ABOVE `7410` → CALLS  →  target 7425, stop 7410.00, R:R 1.5"
#   "⬇ BELOW `7375` → PUTS   →  target 7370, stop 7375.00, R:R 0.5"
# Levels may have decimals; the side is the only token in capitals.
_PLAN_LINE = re.compile(
    r"^([⬆⬇])\s*(?:ABOVE|BELOW)\s*`?([\d.]+)`?\s*→\s*(CALLS|PUTS)"
    r"\s*→\s*target\s+([\d.]+),\s*stop\s+([\d.]+),\s*R:R\s+([\d.]+)",
    re.MULTILINE,
)


def _parse_plans_from_field(text: str) -> list[dict[str, Any]]:
    """Extract zero, one, or two plan dicts from a single field's value."""
    out: list[dict[str, Any]] = []
    for m in _PLAN_LINE.finditer(text or ""):
        arrow, lvl, side, target, stop, rr = m.groups()
        out.append({
            "side": side,
            "break_level": float(lvl),
            "target": float(target),
            "stop": float(stop),
            "predicted_rr": float(rr),
        })
    return out


def _ticker_from_field_name(name: str | None) -> str | None:
    if not name:
        return None
    # Field names look like "SPXW  •  PIN_ZONE" or "SPY  •  TREND".
    head = name.split("•", 1)[0].strip().upper()
    if head in ("SPY", "QQQ", "SPXW"):
        return head
    return None


def parse_feed_row(row: dict[str, Any]) -> list[dict[str, Any]]:
    """One gex_feed row → list of (ticker, side, params) plan dicts."""
    fields = row.get("fields")
    if isinstance(fields, str):
        import json
        fields = json.loads(fields)
    if not isinstance(fields, list):
        return []
    plans: list[dict[str, Any]] = []
    for f in fields:
        ticker = _ticker_from_field_name(f.get("name"))
        if not ticker:
            continue
        for p in _parse_plans_from_field(f.get("value") or ""):
            plans.append({
                "feed_id": row["id"],
                "ticker": ticker,
                "source": row["source"],
                "posted_at": row["created_at"],
                **p,
            })
    return plans


def _fetch_intraday(yf_ticker: str, day: date_t) -> pd.DataFrame | None:
    """Fetch 1-min bars for the given trading day. yfinance restricts 1-min
    intraday to the last 7 days; for older days fall back to 5-min (60d) or
    daily OHLC (which gives only high/low/close — order of target vs stop is
    then indeterminate)."""
    import yfinance as yf

    today = date_t.today()
    age = (today - day).days
    if age <= 7:
        interval = "1m"
        period = "7d"
    elif age <= 59:
        interval = "5m"
        period = "60d"
    else:
        interval = "1d"
        period = "max"
    try:
        df = yf.download(
            yf_ticker, period=period, interval=interval,
            progress=False, auto_adjust=False, prepost=False,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("yfinance fetch failed for %s: %s", yf_ticker, e)
        return None
    if df is None or df.empty:
        return None
    # yfinance returns a tz-aware DatetimeIndex (UTC for intraday). Filter to day.
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC")
    et = df.index.tz_convert("America/New_York")
    df = df[et.date == day]
    return df if not df.empty else None


def _score_plan(plan: dict[str, Any], bars: pd.DataFrame | None) -> dict[str, Any]:
    """Walk the intraday bars after `posted_at` to determine the outcome."""
    out: dict[str, Any] = {
        "entered_at": None, "entered_spot": None,
        "exited_at": None, "exited_spot": None,
        "exit_reason": "pending",
        "realized_pct": None, "realized_rr": None,
        "hit_target": False, "hit_stop": False,
        "day_high": None, "day_low": None, "day_close": None,
    }
    if bars is None or bars.empty:
        return out

    # Day OHLC for context regardless of whether the plan triggered.
    try:
        out["day_high"] = float(bars["High"].max())
        out["day_low"] = float(bars["Low"].min())
        out["day_close"] = float(bars["Close"].iloc[-1])
    except Exception:  # noqa: BLE001
        pass

    posted = plan["posted_at"]
    if posted.tzinfo is None:
        posted = posted.replace(tzinfo=UTC)
    after = bars[bars.index >= posted]
    if after.empty:
        return out

    side = plan["side"]
    break_level = plan["break_level"]
    target = plan["target"]
    stop = plan["stop"]

    # Find first bar that crosses the break level (above for CALLS, below for PUTS).
    entered_idx = None
    for ts, row in after.iterrows():
        hi, lo = float(row["High"]), float(row["Low"])
        if side == "CALLS" and hi >= break_level:
            entered_idx = ts
            break
        if side == "PUTS" and lo <= break_level:
            entered_idx = ts
            break
    if entered_idx is None:
        return out  # still pending

    out["entered_at"] = entered_idx.to_pydatetime() if hasattr(entered_idx, "to_pydatetime") else entered_idx
    out["entered_spot"] = float(break_level)  # approximation: filled at the break

    # After entry, walk forward and check whether target or stop is hit first.
    post_entry = after.loc[entered_idx:]
    exit_at = None
    exit_spot = None
    exit_reason = "expired"
    for ts, row in post_entry.iterrows():
        hi, lo = float(row["High"]), float(row["Low"])
        if side == "CALLS":
            if lo <= stop:
                # Bar contained both stop and target — assume stop first (conservative)
                exit_at = ts
                exit_spot = stop
                exit_reason = "stop"
                out["hit_stop"] = True
                break
            if hi >= target:
                exit_at = ts
                exit_spot = target
                exit_reason = "target"
                out["hit_target"] = True
                break
        else:  # PUTS
            if hi >= stop:
                exit_at = ts
                exit_spot = stop
                exit_reason = "stop"
                out["hit_stop"] = True
                break
            if lo <= target:
                exit_at = ts
                exit_spot = target
                exit_reason = "target"
                out["hit_target"] = True
                break

    out["exited_at"] = (exit_at.to_pydatetime() if hasattr(exit_at, "to_pydatetime") else exit_at) if exit_at else None
    out["exited_spot"] = exit_spot
    out["exit_reason"] = exit_reason
    if exit_spot is not None and out["entered_spot"]:
        signed = (exit_spot - out["entered_spot"]) * (1 if side == "CALLS" else -1)
        out["realized_pct"] = signed / out["entered_spot"]
        risk = abs(stop - break_level)
        if risk > 0:
            out["realized_rr"] = abs(exit_spot - out["entered_spot"]) / risk * (1 if exit_reason == "target" else -1)
    return out


_INSERT_SQL = """
INSERT INTO gex_plan_outcomes (
    feed_id, ticker, trading_day, side, source, posted_at,
    break_level, target, stop, predicted_rr,
    entered_at, entered_spot, exited_at, exited_spot, exit_reason,
    realized_pct, realized_rr, hit_target, hit_stop,
    day_high, day_low, day_close, last_scored_at
) VALUES (
    %(feed_id)s, %(ticker)s, %(trading_day)s, %(side)s, %(source)s, %(posted_at)s,
    %(break_level)s, %(target)s, %(stop)s, %(predicted_rr)s,
    %(entered_at)s, %(entered_spot)s, %(exited_at)s, %(exited_spot)s, %(exit_reason)s,
    %(realized_pct)s, %(realized_rr)s, %(hit_target)s, %(hit_stop)s,
    %(day_high)s, %(day_low)s, %(day_close)s, NOW()
)
ON CONFLICT (feed_id, ticker, side) DO UPDATE SET
    entered_at = EXCLUDED.entered_at,
    entered_spot = EXCLUDED.entered_spot,
    exited_at = EXCLUDED.exited_at,
    exited_spot = EXCLUDED.exited_spot,
    exit_reason = EXCLUDED.exit_reason,
    realized_pct = EXCLUDED.realized_pct,
    realized_rr = EXCLUDED.realized_rr,
    hit_target = EXCLUDED.hit_target,
    hit_stop = EXCLUDED.hit_stop,
    day_high = EXCLUDED.day_high,
    day_low = EXCLUDED.day_low,
    day_close = EXCLUDED.day_close,
    last_scored_at = NOW()
"""


def run(database_url: str, *, days: int = 7) -> dict[str, Any]:
    """Score every brief/monitor plan posted in the last ``days`` calendar days.

    Returns a summary dict so the CLI can print row counts.
    """
    cutoff = datetime.now(UTC) - timedelta(days=days)
    summary: dict[str, Any] = {"plans_seen": 0, "scored": 0, "skipped": 0, "errors": 0}

    # 1) Pull all relevant gex_feed rows
    with connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, created_at, source, title, fields
            FROM gex_feed
            WHERE source IN ('brief', 'monitor')
              AND created_at >= %s
            ORDER BY created_at ASC
            """,
            (cutoff,),
        )
        cols = [d.name for d in cur.description]
        rows = [dict(zip(cols, r, strict=False)) for r in cur.fetchall()]

    # 2) Parse plans out of each row
    plans: list[dict[str, Any]] = []
    for r in rows:
        plans.extend(parse_feed_row(r))
    summary["plans_seen"] = len(plans)

    # 3) Group by (ticker, trading_day) so we fetch yfinance once per pair
    intraday_cache: dict[tuple[str, date_t], pd.DataFrame | None] = {}
    for p in plans:
        # ET trading day from posted_at
        posted = p["posted_at"]
        if posted.tzinfo is None:
            posted = posted.replace(tzinfo=UTC)
        et_day = posted.astimezone(__import__("zoneinfo").ZoneInfo("America/New_York")).date()
        p["trading_day"] = et_day

        cache_key = (p["ticker"], et_day)
        if cache_key not in intraday_cache:
            yf_ticker = _YF_TICKER.get(p["ticker"])
            intraday_cache[cache_key] = _fetch_intraday(yf_ticker, et_day) if yf_ticker else None

        bars = intraday_cache[cache_key]
        try:
            outcome = _score_plan(p, bars)
            row = {**p, **outcome}
            with connect(database_url) as conn, conn.cursor() as cur:
                cur.execute(_INSERT_SQL, row)
                conn.commit()
            summary["scored"] += 1
        except Exception as e:  # noqa: BLE001
            log.warning("score failed for feed_id=%s ticker=%s side=%s: %s",
                        p.get("feed_id"), p.get("ticker"), p.get("side"), e)
            summary["errors"] += 1

    summary["finished_at"] = datetime.now(UTC).isoformat()
    return summary
