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


def enrich_short(uw: UWClient, ticker: str) -> list[Signal]:
    """Short-squeeze fuel → a positioning-family Signal. Driven by cost-to-borrow (live) +
    borrow scarcity; short-interest %float / days-to-cover are added only when fresh (the
    interest-float series is stale on our tier). Expensive, hard-to-borrow names are crowded
    shorts prone to a squeeze (bull lean). Bidirectional in truth → modest prior."""
    try:
        data = uw.get("short_data", params={"limit": 1}, ticker=ticker) or []
        fee = _f(data[0], "fee_rate") if data else 0.0        # cost-to-borrow %
        avail = _f(data[0], "short_shares_available") if data else 1e9
        # short interest only if the latest snapshot is recent (< ~90d); else it's stale
        si_pct = dtc = 0.0
        rows = uw.get("short_interest_float", ticker=ticker) or []
        if rows:
            from datetime import UTC, datetime, timedelta
            latest = max(rows, key=lambda r: str(r.get("market_date") or ""))
            md = str(latest.get("market_date") or "")
            try:
                fresh = datetime.fromisoformat(md).replace(tzinfo=UTC) > datetime.now(UTC) - timedelta(days=90)
            except ValueError:
                fresh = False
            if fresh:
                si_pct = _f(latest, "percent_returned")
                dtc = _f(latest, "days_to_cover_returned")
        if fee < 5 and si_pct < 15:  # cheap, uncrowded borrow — no squeeze fuel
            return []
        score = _clamp(fee / 30.0 + si_pct / 40.0 + dtc / 20.0 + (0.15 if avail < 1e6 else 0.0))
        if score < 0.1:
            return []
        return [Signal(
            source="uw_short", ticker=ticker, direction="bull", strength=score,
            ttl_hours=168,
            meta={"cost_to_borrow": round(fee, 1), "si_pct_float": round(si_pct, 1),
                  "days_to_cover": round(dtc, 1), "shares_available": int(avail)},
        )]
    except Exception as e:  # noqa: BLE001
        log.warning("enrich_short %s failed: %s", ticker, e)
        return []


def _greek_magnet(uw: UWClient, ticker: str, source: str, call_key: str, put_key: str,
                  ttl: float, prior_min: float) -> list[Signal]:
    """Shared magnet read over the greek-exposure/strike surface: the dominant |net greek|
    strike pulls price toward it (magnet above spot → bull, below → bear). Powers vex/charm."""
    try:
        state = uw.get("stock_state", ticker=ticker) or {}
        spot = _f(state, "close", "last", "price")
        rows = uw.get("greek_exposure_strike", ticker=ticker) or []
        if not spot or not rows:
            return []

        def net(r: dict) -> float:
            return _f(r, call_key) + _f(r, put_key)

        total = sum(abs(net(r)) for r in rows) or 1.0
        node = max(rows, key=lambda r: abs(net(r)))
        strike = _f(node, "strike")
        if not strike or net(node) == 0:
            return []
        dist = abs(strike - spot) / spot
        share = abs(net(node)) / total
        strength = _clamp(share * max(0.0, 1 - dist / 0.06))
        if strength < prior_min:
            return []
        direction = "bull" if strike >= spot else "bear"
        return [Signal(source=source, ticker=ticker, direction=direction, strength=strength,
                       ttl_hours=ttl, meta={"magnet": round(strike, 2), "spot": round(spot, 2),
                                            "share": round(share, 3)})]
    except Exception as e:  # noqa: BLE001
        log.warning("%s %s failed: %s", source, ticker, e)
        return []


def enrich_vex(uw: UWClient, ticker: str) -> list[Signal]:
    """Vanna magnet (levels) — the dominant net-vanna strike."""
    return _greek_magnet(uw, ticker, "uw_vex", "call_vanna", "put_vanna", 24, 0.04)


def enrich_charm(uw: UWClient, ticker: str) -> list[Signal]:
    """Charm magnet (levels) — subtle delta-decay pull into expiry; low weight."""
    return _greek_magnet(uw, ticker, "uw_charm", "call_charm", "put_charm", 24, 0.05)


def enrich_maxpain(uw: UWClient, ticker: str) -> list[Signal]:
    """Max-pain gravity (levels) — nearest expiry. Spot below max-pain pulls up (bull)."""
    try:
        rows = uw.get("max_pain", ticker=ticker) or []
        if not rows:
            return []
        r = rows[0]  # nearest expiry
        mp = _f(r, "max_pain")
        close = _f(r, "close")
        if not mp or not close:
            return []
        gap = (mp - close) / close
        if abs(gap) < 0.005:
            return []
        return [Signal(source="uw_maxpain", ticker=ticker,
                       direction="bull" if gap > 0 else "bear",
                       strength=_clamp(abs(gap) / 0.05), ttl_hours=24,
                       meta={"max_pain": round(mp, 2), "close": round(close, 2),
                             "gap_pct": round(gap * 100, 1)})]
    except Exception as e:  # noqa: BLE001
        log.warning("enrich_maxpain %s failed: %s", ticker, e)
        return []


def _bars(uw: UWClient, ticker: str, n: int = 70) -> list[dict]:
    return uw.get("ohlc", params={"limit": n}, ticker=ticker, candle_size="1d") or []


def enrich_breakout(uw: UWClient, ticker: str) -> list[Signal]:
    """Range breakout on volume (chart) — close pressing the 60-day high with a volume
    expansion is a bull breakout; pressing the low, a bear breakdown."""
    try:
        bars = _bars(uw, ticker)
        if len(bars) < 40:
            return []
        highs = [_f(b, "high") for b in bars]
        lows = [_f(b, "low") for b in bars]
        vols = [_f(b, "volume") for b in bars]
        close = _f(bars[-1], "close")
        hi = max(highs[-60:])
        lo = min(lows[-60:])
        avgvol = sum(vols[-20:]) / min(20, len(vols)) or 1.0
        surge = vols[-1] > 1.3 * avgvol
        if not surge or not close:
            return []
        if close >= 0.985 * hi:
            direction, ref = "bull", hi
        elif close <= 1.015 * lo:
            direction, ref = "bear", lo
        else:
            return []
        return [Signal(source="uw_breakout", ticker=ticker, direction=direction,
                       strength=_clamp(vols[-1] / avgvol / 3.0), ttl_hours=48,
                       meta={"close": round(close, 2), "ref": round(ref, 2),
                             "rel_vol": round(vols[-1] / avgvol, 2)})]
    except Exception as e:  # noqa: BLE001
        log.warning("enrich_breakout %s failed: %s", ticker, e)
        return []


def enrich_volsurge(uw: UWClient, ticker: str) -> list[Signal]:
    """Relative-volume surge (chart) — today's volume >> 20d average, directional by the
    day's close vs open."""
    try:
        bars = _bars(uw, ticker, 30)
        if len(bars) < 20:
            return []
        vols = [_f(b, "volume") for b in bars]
        avg = sum(vols[-20:]) / 20 or 1.0
        ratio = vols[-1] / avg
        if ratio < 1.5:
            return []
        o, c = _f(bars[-1], "open"), _f(bars[-1], "close")
        if not o or c == o:
            return []
        return [Signal(source="uw_volsurge", ticker=ticker,
                       direction="bull" if c > o else "bear",
                       strength=_clamp((ratio - 1) / 2.0), ttl_hours=36,
                       meta={"rel_vol": round(ratio, 2), "day_pct": round((c - o) / o * 100, 1)})]
    except Exception as e:  # noqa: BLE001
        log.warning("enrich_volsurge %s failed: %s", ticker, e)
        return []


def enrich_netprem(uw: UWClient, ticker: str) -> list[Signal]:
    """Intraday net-premium tilt (flow) — net call vs net put premium on the tape (latest)."""
    try:
        rows = uw.get("net_prem_ticks", ticker=ticker) or []
        if not rows:
            return []
        last = rows[-1]
        call_p = _f(last, "net_call_premium")
        put_p = _f(last, "net_put_premium")
        net = call_p - put_p
        if abs(net) < 5.0e5:
            return []
        return [Signal(source="uw_netprem", ticker=ticker,
                       direction="bull" if net > 0 else "bear",
                       strength=_clamp(abs(net) / 1.0e7), ttl_hours=12,
                       meta={"net_prem": round(net), "call": round(call_p), "put": round(put_p)})]
    except Exception as e:  # noqa: BLE001
        log.warning("enrich_netprem %s failed: %s", ticker, e)
        return []


def enrich_earnings(uw: UWClient, ticker: str) -> list[Signal]:
    """Earnings-proximity catalyst (the 'why-now' layer). A name reporting within ~7 sessions
    carries a live catalyst; direction leans with pre-earnings drift (5-day momentum, a real
    if weak effect). The Call's gate also uses this to avoid knife-catching into the print
    (see orchestrator). Low strength — it's a timing flag, not a thesis."""
    try:
        from datetime import UTC, date, datetime

        info = uw.get("stock_info", ticker=ticker) or {}
        ned = str(info.get("next_earnings_date") or "")
        if not ned:
            return []
        try:
            edate = date.fromisoformat(ned[:10])
        except ValueError:
            return []
        days = (edate - datetime.now(UTC).date()).days
        if days < 0 or days > 10:
            return []
        # drift direction from 5-day momentum
        bars = _bars(uw, ticker, 12)
        closes = [_f(b, "close") for b in bars if _f(b, "close") > 0]
        if len(closes) < 6:
            return []
        drift = (closes[-1] - closes[-6]) / closes[-6]
        if abs(drift) < 0.005:
            return []
        return [Signal(source="uw_earnings", ticker=ticker,
                       direction="bull" if drift > 0 else "bear",
                       strength=_clamp(0.15 + (10 - days) / 10 * 0.25), ttl_hours=48,
                       meta={"days_to_earnings": days, "drift_5d_pct": round(drift * 100, 1),
                             "announce": info.get("announce_time")})]
    except Exception as e:  # noqa: BLE001
        log.warning("enrich_earnings %s failed: %s", ticker, e)
        return []


# per-ticker enrichment run on each surfaced name
ENRICHERS = [enrich_gex, enrich_vex, enrich_charm, enrich_maxpain, enrich_chart,
             enrich_breakout, enrich_volsurge, enrich_fundamentals, enrich_short,
             enrich_netprem, enrich_earnings]


# index / non-stock symbols that don't support the per-ticker stock endpoints
_SKIP_ENRICH = {"SPX", "SPXW", "NDX", "RUT", "VIX", "XSP", "VVIX", "DJX"}


def enrich(uw: UWClient, ticker: str) -> list[Signal]:
    """All per-ticker enrichment for one surfaced name (index symbols skipped)."""
    if ticker in _SKIP_ENRICH:
        return []
    signals: list[Signal] = []
    for fn in ENRICHERS:
        signals.extend(fn(uw, ticker))
    return signals
