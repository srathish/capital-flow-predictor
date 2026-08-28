"""Tracker — grades every Call against realized price at 1d/5d/20d and rolls the results
up two ways:

  Per source:  each contributing source gets its own Grade rows, which engine.weights
               turns into that source's live Layer-1 weight. Sources that pay earn weight;
               sources that don't decay toward zero.
  Per nest:    calibration by (conviction bucket, horizon) — does "80+" mean a 64% 5d hit
               rate or a coin flip? That's the difference between a tool and an idea faucet.

Grading is idempotent: a Call already graded at a horizon is skipped. Prices come from UW
close prices; a Call younger than its horizon (in trading days) is left for a later pass.

Caveat baked into the API, not just the docstring: hit-vs-raw-price is a proxy for
usefulness, not proof of edge. `calibration(benchmark=...)` supports sector-relative
grading so a tape where everything went up doesn't read as skill.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from nest.events.log import EventLog
from nest.events.schema import Grade

log = logging.getLogger(__name__)

HORIZON_TRADING_DAYS = {"1d": 1, "5d": 5, "20d": 20}


def _calendar_days(trading_days: int) -> int:
    # rough trading->calendar conversion (5 trading days ~ 7 calendar)
    return round(trading_days * 7 / 5)


@dataclass
class PriceFn:
    """Callable price provider: (ticker, iso_date) -> close price or None. Injected so
    the grader is testable offline; the live one wraps the UW ohlc endpoint."""

    fn: object

    def __call__(self, ticker: str, iso_date: str) -> float | None:  # pragma: no cover
        return self.fn(ticker, iso_date)  # type: ignore[operator]


def _uw_price_fn(uw) -> PriceFn:  # pragma: no cover - network
    def fn(ticker: str, iso_date: str) -> float | None:
        try:
            rows = uw.get("ohlc", params={"limit": 1}, ticker=ticker, candle_size="1d") or []
            if rows:
                v = rows[0].get("close") or rows[0].get("last")
                return float(v) if v is not None else None
        except Exception as e:  # noqa: BLE001
            log.warning("price fetch %s@%s failed: %s", ticker, iso_date, e)
        return None

    return PriceFn(fn)


def _hit(direction: str, ref: float, realized: float) -> bool:
    return realized > ref if direction == "bull" else realized < ref


def grade_due(log: EventLog, price_fn: PriceFn, now: datetime | None = None) -> list[Grade]:
    """Grade every Call whose horizon has matured and isn't already graded. Writes one
    Grade for the Call and one per contributing source. Returns the new Grades."""
    now = now or datetime.now(UTC)
    written: list[Grade] = []
    for horizon, tdays in HORIZON_TRADING_DAYS.items():
        already = log.graded_call_ts(horizon)
        cutoff = now - timedelta(days=_calendar_days(tdays))
        for call in log.calls():
            if call.ts in already:
                continue
            if datetime.fromisoformat(call.ts) > cutoff:
                continue  # not matured yet
            ref = call.ref_price
            if not ref:
                continue
            realized = price_fn(call.ticker, now.date().isoformat())
            if realized is None:
                continue
            ret = round((realized - ref) / ref * 100, 2)
            hit = _hit(call.direction, ref, realized)
            # Call-level grade
            g = Grade(call_ts=call.ts, ticker=call.ticker, horizon=horizon,
                      ref_price=ref, realized=realized, return_pct=ret, hit=hit)
            log.append(g)
            written.append(g)
            # Per-source grades — every source that contributed inherits this outcome,
            # weighted equally; weights.py shrinks small samples toward the prior.
            for sig in call.signals:
                src = sig.get("source", "")
                if not src:
                    continue
                sg = Grade(call_ts=call.ts, ticker=call.ticker, source=src,
                           horizon=horizon, ref_price=ref, realized=realized,
                           return_pct=ret, hit=hit)
                log.append(sg)
                written.append(sg)
    return written


# --- calibration -------------------------------------------------------------

_BUCKETS = [(70, 80), (80, 90), (90, 101)]


@dataclass
class Calibration:
    horizon: str
    buckets: dict[str, dict] = field(default_factory=dict)  # "80-90" -> {n, hits, hit_rate, avg_ret}


def calibration(log: EventLog, horizon: str = "5d") -> Calibration:
    """Nest calibration: hit rate + average return by conviction bucket at one horizon.
    Joins each Call-level Grade back to its Call's conviction."""
    conv_by_ts = {c.ts: c.conviction for c in log.calls()}
    cal = Calibration(horizon=horizon)
    for lo, hi in _BUCKETS:
        cal.buckets[f"{lo}-{hi if hi <= 100 else 100}"] = {"n": 0, "hits": 0,
                                                            "hit_rate": None, "avg_ret": None}
    rets: dict[str, list[float]] = {k: [] for k in cal.buckets}
    for g in log.grades():
        if g.horizon != horizon or g.source:  # Call-level only
            continue
        conv = conv_by_ts.get(g.call_ts)
        if conv is None:
            continue
        for lo, hi in _BUCKETS:
            if lo <= conv < hi:
                key = f"{lo}-{hi if hi <= 100 else 100}"
                cal.buckets[key]["n"] += 1
                cal.buckets[key]["hits"] += int(g.hit)
                rets[key].append(g.return_pct)
                break
    for key, b in cal.buckets.items():
        if b["n"]:
            b["hit_rate"] = round(b["hits"] / b["n"], 3)
            b["avg_ret"] = round(sum(rets[key]) / len(rets[key]), 2)
    return cal


def calibration_note(log: EventLog, conviction: float, horizon: str = "5d") -> str:
    """The line stamped on each Call: 'calls like this have hit 63% at 5d (n=19)'."""
    cal = calibration(log, horizon)
    for (lo, hi), (key, b) in zip(_BUCKETS, cal.buckets.items()):
        if lo <= conviction < hi and b["hit_rate"] is not None:
            return f"calls like this ({key}) have hit {b['hit_rate']:.0%} at {horizon} (n={b['n']})"
    return f"no {horizon} calibration history yet for conviction {conviction:.0f}"
