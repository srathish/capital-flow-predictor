"""Mark-to-market for parsed Discord plays.

For every row in ``discord_alert_plays`` with ``status='open'``:

1. If ``entry_underlying`` is NULL, snapshot the underlying price as of the
   message's ``captured_at`` timestamp. For captures within the last 7 days
   we fall back to the most recent intraday bar (1m); for older captures we
   use the daily close on that date.

2. Refresh ``current_underlying`` to the latest available print.

3. Compute ``pnl_pct_underlying``, direction-adjusted: a put or short
   profits when the underlying drops.

4. If ``expiry`` is set and has passed, mark the final status:
     - ``win_itm`` if strike is on the right side of current_underlying
       (and we have a strike to compare against)
     - ``loss_otm`` if strike is on the wrong side
     - ``expired_unknown`` if there's no strike

We use yfinance for prices — same source the rest of the jobs use. No UW
calls (the user has explicitly asked us to keep API costs out of this loop).

Run via: ``cfp-jobs score-discord-plays [--days 30]`` or via a Railway cron.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, date as date_t, datetime, timedelta
from typing import Any

import pandas as pd
import yfinance as yf

from cfp_jobs.db import connect

log = logging.getLogger(__name__)


@dataclass
class _PlayRow:
    message_id: int
    ticker: str
    side: str
    strike: float | None
    expiry: date_t | None
    entry_underlying: float | None
    captured_at: datetime


def _direction_multiplier(side: str) -> float:
    s = (side or "").lower()
    if s in ("put", "short"):
        return -1.0
    if s in ("call", "long"):
        return 1.0
    # 'unknown' — assume long bias (most chat alerts are bullish), but mark
    # the result as low-confidence by leaving status='open' so the user can
    # see we couldn't determine direction. The +1 here just avoids inverting
    # the sign on a coin-flip.
    return 1.0


def _spot_at(ticker: str, when: datetime, now_cache: dict[str, pd.DataFrame], hist_cache: dict[str, pd.DataFrame]) -> float | None:
    """Get the underlying price closest to ``when`` for ``ticker``.

    For "now-ish" (last 7 days) we want intraday resolution so a 10:32 ET
    alert doesn't snapshot the 9:30 open. For older captures we accept the
    daily close.
    """
    now = datetime.now(UTC)
    if now - when < timedelta(days=7):
        # 1-minute bars, last 7 days.
        bars = now_cache.get(ticker)
        if bars is None:
            try:
                bars = yf.Ticker(ticker).history(period="7d", interval="1m", auto_adjust=False)
            except Exception:
                bars = pd.DataFrame()
            now_cache[ticker] = bars
        if bars is None or bars.empty:
            return None
        if bars.index.tz is None:
            idx = bars.index.tz_localize("UTC")
        else:
            idx = bars.index.tz_convert("UTC")
        bars = bars.copy()
        bars.index = idx
        # Pick the last bar at-or-before the timestamp; if 'when' is in the
        # future relative to our last bar, fall back to the latest close.
        before = bars[bars.index <= when]
        if before.empty:
            return float(bars["Close"].iloc[-1])
        return float(before["Close"].iloc[-1])

    # Older capture — daily close.
    hist = hist_cache.get(ticker)
    if hist is None:
        try:
            hist = yf.Ticker(ticker).history(period="1y", interval="1d", auto_adjust=False)
        except Exception:
            hist = pd.DataFrame()
        hist_cache[ticker] = hist
    if hist is None or hist.empty:
        return None
    target = when.date()
    before = hist[hist.index.date <= target]
    if before.empty:
        return float(hist["Close"].iloc[-1])
    return float(before["Close"].iloc[-1])


def _current_spot(ticker: str, now_cache: dict[str, pd.DataFrame]) -> float | None:
    bars = now_cache.get(ticker)
    if bars is None:
        try:
            bars = yf.Ticker(ticker).history(period="1d", interval="1m", auto_adjust=False)
        except Exception:
            bars = pd.DataFrame()
        now_cache[ticker] = bars
    if bars is None or bars.empty:
        return None
    return float(bars["Close"].iloc[-1])


def _final_status(side: str, strike: float | None, current: float | None) -> str:
    if strike is None or current is None:
        return "expired_unknown"
    s = (side or "").lower()
    if s == "call":
        return "win_itm" if current > strike else "loss_otm"
    if s == "put":
        return "win_itm" if current < strike else "loss_otm"
    return "expired_unknown"


def run(database_url: str, *, days: int = 30) -> dict[str, Any]:
    """Score all open plays captured in the last ``days`` days. Returns a
    summary dict of counts for logging."""
    cutoff = datetime.now(UTC) - timedelta(days=days)
    today = date_t.today()
    updated = 0
    closed = 0
    seen = 0

    now_cache: dict[str, pd.DataFrame] = {}
    hist_cache: dict[str, pd.DataFrame] = {}

    with connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT message_id, ticker, side, strike, expiry, entry_underlying, captured_at
            FROM discord_alert_plays
            WHERE status = 'open' AND captured_at >= %s
            ORDER BY captured_at ASC
            """,
            (cutoff,),
        )
        rows = [
            _PlayRow(
                message_id=int(r[0]),
                ticker=r[1],
                side=r[2],
                strike=float(r[3]) if r[3] is not None else None,
                expiry=r[4],
                entry_underlying=float(r[5]) if r[5] is not None else None,
                captured_at=r[6],
            )
            for r in cur.fetchall()
        ]

        for play in rows:
            seen += 1
            try:
                entry = play.entry_underlying or _spot_at(
                    play.ticker, play.captured_at, now_cache, hist_cache
                )
                current = _current_spot(play.ticker, now_cache)
                if entry is None or current is None:
                    continue
                direction = _direction_multiplier(play.side)
                pnl = direction * (current - entry) / entry

                # Decide whether this play has expired.
                next_status = "open"
                if play.expiry is not None and play.expiry < today:
                    next_status = _final_status(play.side, play.strike, current)
                    closed += 1

                cur.execute(
                    """
                    UPDATE discord_alert_plays
                    SET entry_underlying = %s,
                        current_underlying = %s,
                        pnl_pct_underlying = %s,
                        status = %s,
                        marked_at = now()
                    WHERE message_id = %s AND ticker = %s
                    """,
                    (
                        entry,
                        current,
                        pnl,
                        next_status,
                        play.message_id,
                        play.ticker,
                    ),
                )
                updated += 1
            except Exception:
                log.exception(
                    "score_discord_plays failed for message_id=%s ticker=%s",
                    play.message_id,
                    play.ticker,
                )
        conn.commit()

    return {
        "seen": seen,
        "updated": updated,
        "closed": closed,
        "finished_at": datetime.now(UTC).isoformat(),
    }
