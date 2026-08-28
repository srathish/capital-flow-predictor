"""Per-ticker enrichment — the expensive reads that can't come from a market-wide feed,
run only on the top-N names the feeds already surfaced (see orchestrator). Today that's
GEX by strike (the levels family); it's what gives a name a second, independent source
family so the convergence gate can fire. Field names validated against live UW (2026-08-28).
"""

from __future__ import annotations

import logging

from nest.events.schema import Signal
from nest.ingest.uw_client import UWClient

log = logging.getLogger(__name__)


def _f(d: dict, *keys: str, default: float = 0.0) -> float:
    for k in keys:
        v = d.get(k)
        if v is not None:
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
    return default


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def enrich_gex(uw: UWClient, ticker: str) -> list[Signal]:
    """GEX by strike → a levels-family Signal. Net gamma per strike = call_gex + put_gex.
    A dominant +gamma wall below spot is a dealer-supported floor (bull); a dominant
    -gamma pocket above spot is squeeze fuel (bull). Strength is scale-free: the node's
    share of total |gamma| in the surface, faded by distance from spot."""
    try:
        state = uw.get("stock_state", ticker=ticker) or {}
        spot = _f(state, "close", "last", "price")
        rows = uw.get("greek_exposure_strike", ticker=ticker) or []
        if not spot or not rows:
            return []

        def net_gex(r: dict) -> float:
            return _f(r, "call_gex") + _f(r, "put_gex")

        total_abs = sum(abs(net_gex(r)) for r in rows) or 1.0
        node = max(rows, key=lambda r: abs(net_gex(r)))
        strike = _f(node, "strike")
        g = net_gex(node)
        if not strike or g == 0:
            return []
        below = strike <= spot
        if g > 0:
            direction = "bull" if below else "bear"
        else:
            direction = "bull" if not below else "bear"
        dist = abs(strike - spot) / spot
        share = abs(g) / total_abs
        strength = _clamp(share * max(0.0, 1 - dist / 0.05))
        if strength < 0.03:
            return []
        return [Signal(
            source="uw_gex", ticker=ticker, direction=direction, strength=strength,
            ttl_hours=24,
            meta={"wall_strike": round(strike, 2), "gamma_sign": "pos" if g > 0 else "neg",
                  "share": round(share, 3), "spot": round(spot, 2),
                  "dist_pct": round(dist * 100, 2)},
        )]
    except Exception as e:  # noqa: BLE001 — one bad enrichment must not kill the cycle
        log.warning("enrich_gex %s failed: %s", ticker, e)
        return []


def _sma(vals: list[float], n: int) -> float | None:
    return sum(vals[-n:]) / n if len(vals) >= n else None


def enrich_chart(uw: UWClient, ticker: str) -> list[Signal]:
    """Chart/technical read from daily candles → a chart-family Signal. Bull when price is
    in an uptrend (close > SMA20 > SMA50) with positive 20-day momentum and near its recent
    high; bear on the mirror. Self-computed from OHLC — no fragile indicator endpoint."""
    try:
        bars = uw.get("ohlc", params={"limit": 70}, ticker=ticker, candle_size="1d") or []
        closes = [_f(b, "close") for b in bars if _f(b, "close") > 0]
        if len(closes) < 50:
            return []
        px = closes[-1]
        sma20, sma50 = _sma(closes, 20), _sma(closes, 50)
        if not sma20 or not sma50:
            return []
        mom = (px - closes[-21]) / closes[-21] if len(closes) >= 21 else 0.0
        hi = max(closes[-60:])
        from_hi = (px - hi) / hi  # 0 = at high, negative = below
        up = px > sma20 > sma50 and mom > 0
        down = px < sma20 < sma50 and mom < 0
        if not up and not down:
            return []
        direction = "bull" if up else "bear"
        # strength: momentum magnitude + trend cleanliness + proximity to high (bull)
        base = _clamp(abs(mom) / 0.15)
        if up:
            base = _clamp(base + max(0.0, 1 + from_hi / 0.10) * 0.2)
        strength = _clamp(base)
        if strength < 0.05:
            return []
        return [Signal(
            source="uw_chart", ticker=ticker, direction=direction, strength=strength,
            ttl_hours=48,
            meta={"px": round(px, 2), "sma20": round(sma20, 2), "sma50": round(sma50, 2),
                  "mom20_pct": round(mom * 100, 1), "from_60d_high_pct": round(from_hi * 100, 1)},
        )]
    except Exception as e:  # noqa: BLE001
        log.warning("enrich_chart %s failed: %s", ticker, e)
        return []


def enrich_fundamentals(uw: UWClient, ticker: str) -> list[Signal]:
    """Fundamental read from income statements → a fundamental-family Signal. Bull on
    accelerating revenue AND positive/expanding net income; bear on deteriorating revenue.
    Slow-moving context, so a long TTL. Defensive: unknown field shapes → no signal."""
    try:
        fin = uw.get("financials", ticker=ticker) or {}
        income = fin.get("income_statements") or []
        # rows are period-ordered; pull revenue + net income series defensively
        def val(row: dict, *keys: str) -> float:
            return _f(row, *keys)

        revs, nets = [], []
        for row in income[:8]:
            r = val(row, "total_revenue", "revenue", "totalRevenue")
            n = val(row, "net_income", "netIncome", "net_income_loss")
            if r:
                revs.append(r)
            nets.append(n)
        if len(revs) < 2:
            return []
        # income statements are typically newest-first; compare latest vs prior
        rev_growth = (revs[0] - revs[1]) / abs(revs[1]) if revs[1] else 0.0
        net_latest = nets[0] if nets else 0.0
        if abs(rev_growth) < 0.02 and net_latest == 0:
            return []
        bull = rev_growth > 0.03 and net_latest > 0
        bear = rev_growth < -0.03
        if not bull and not bear:
            return []
        direction = "bull" if bull else "bear"
        strength = _clamp(abs(rev_growth) / 0.25 + (0.15 if net_latest > 0 else 0.0))
        return [Signal(
            source="uw_fundamentals", ticker=ticker, direction=direction, strength=strength,
            ttl_hours=480,  # fundamentals move on the earnings cadence, ~20 days
            meta={"rev_growth_qoq_pct": round(rev_growth * 100, 1),
                  "net_income_positive": net_latest > 0},
        )]
    except Exception as e:  # noqa: BLE001
        log.warning("enrich_fundamentals %s failed: %s", ticker, e)
        return []


# per-ticker enrichment run on each surfaced name (add "financials" to the client whitelist)
ENRICHERS = [enrich_gex, enrich_chart, enrich_fundamentals]


def enrich(uw: UWClient, ticker: str) -> list[Signal]:
    """All per-ticker enrichment for one surfaced name."""
    signals: list[Signal] = []
    for fn in ENRICHERS:
        signals.extend(fn(uw, ticker))
    return signals
