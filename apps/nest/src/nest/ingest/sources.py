"""UW source adapters — Tier 1 (already owned, wired first). Each function pulls one
endpoint and emits normalized Signals. Field access is defensive: UW payload keys
drift, and a source that returns nothing must degrade to [] rather than crash the
cycle. Strength scaling is source-native and deliberately conservative — the tracker
recalibrates each source's *weight* from its record; strength is just the raw read.
"""

from __future__ import annotations

import logging

from nest.events.schema import Signal
from nest.ingest.uw_client import UWClient

log = logging.getLogger(__name__)


def _f(d: dict, *keys: str, default: float = 0.0) -> float:
    """First present numeric key, coerced to float."""
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


def _safe(fn, ticker: str, source: str) -> list[Signal]:
    try:
        return fn()
    except Exception as e:  # noqa: BLE001 — one bad source must not kill the cycle
        log.warning("ingest %s/%s failed: %s", source, ticker, e)
        return []


# --- flow (family: flow) -----------------------------------------------------

def ingest_flow(uw: UWClient, ticker: str) -> list[Signal]:
    """Options flow alerts. Only ask-side *opening* premium counts as conviction —
    a repo rule: big premium alone is a lean, not proof. Bid-side / closing is skipped.
    """
    def run() -> list[Signal]:
        rows = uw.get("flow_alerts", params={"limit": 50}, ticker=ticker) or []
        bull = bear = 0.0
        for r in rows:
            side = str(r.get("side") or r.get("aggressor_side") or "").lower()
            opening = r.get("is_opening", r.get("open_interest_change", 0))
            prem = _f(r, "total_premium", "premium")
            is_call = str(r.get("type") or r.get("option_type") or "").lower().startswith("c")
            # opening ask-side only
            if side not in ("ask", "a") or not opening:
                continue
            if is_call:
                bull += prem
            else:
                bear += prem
        net = bull - bear
        if abs(net) < 1e6:  # under $1M net opening premium is noise
            return []
        direction = "bull" if net > 0 else "bear"
        strength = _clamp(abs(net) / 1.0e7)  # $10M net -> saturates
        return [Signal(
            source="uw_flow", ticker=ticker, direction=direction, strength=strength,
            ttl_hours=48,
            meta={"net_opening_premium": round(net), "bull": round(bull), "bear": round(bear)},
        )]

    return _safe(run, ticker, "uw_flow")


def ingest_darkpool(uw: UWClient, ticker: str) -> list[Signal]:
    """Dark-pool prints. Large prints below spot at a repeated level read as accumulation.
    We emit one Signal per notable price level, so distinct levels don't dedupe together.
    """
    def run() -> list[Signal]:
        rows = uw.get("darkpool_ticker", params={"limit": 100}, ticker=ticker) or []
        out: list[Signal] = []
        for r in rows:
            size = _f(r, "size", "volume")
            price = _f(r, "price")
            notional = size * price
            if notional < 5.0e6:  # only prints >$5M notional
                continue
            strength = _clamp(notional / 5.0e7)  # $50M -> saturates
            out.append(Signal(
                source="uw_darkpool", ticker=ticker, direction="bull", strength=strength,
                ttl_hours=48,
                meta={"print_size": int(size), "price_level": round(price, 2),
                      "notional": round(notional)},
            ))
        # keep the three biggest — the rest is chop
        out.sort(key=lambda s: s.strength, reverse=True)
        return out[:3]

    return _safe(run, ticker, "uw_darkpool")


# --- levels (family: levels) -------------------------------------------------

def ingest_gex(uw: UWClient, ticker: str) -> list[Signal]:
    """GEX by strike. A large positive-gamma wall just below spot is dealer support
    (bullish floor); a large negative-gamma pocket above spot is a squeeze lane. We
    read the nearest dominant wall relative to spot.
    """
    def run() -> list[Signal]:
        state = uw.get("stock_state", ticker=ticker) or {}
        spot = _f(state, "last", "close", "price")
        rows = uw.get("greek_exposure_strike", ticker=ticker) or []
        if not spot or not rows:
            return []
        # dominant |gamma| node
        def gamma(r: dict) -> float:
            return _f(r, "gamma_exposure", "gex", "call_gamma_exposure")
        node = max(rows, key=lambda r: abs(gamma(r)))
        strike = _f(node, "strike", "price")
        g = gamma(node)
        if not strike or abs(g) < 1e6:
            return []
        below = strike <= spot
        # +gamma floor below spot = bullish; +gamma ceiling above = pin/resistance
        if g > 0:
            direction = "bull" if below else "bear"
        else:  # -gamma above spot = squeeze fuel (bullish), below = air pocket (bearish)
            direction = "bull" if not below else "bear"
        dist = abs(strike - spot) / spot
        strength = _clamp((abs(g) / 5.0e8) * max(0.0, 1 - dist / 0.05))  # fades past 5% away
        if strength < 0.05:
            return []
        return [Signal(
            source="uw_gex", ticker=ticker, direction=direction, strength=strength,
            ttl_hours=24,  # positioning re-reads daily
            meta={"wall_strike": round(strike, 2), "gamma_sign": "pos" if g > 0 else "neg",
                  "spot": round(spot, 2), "dist_pct": round(dist * 100, 2)},
        )]

    return _safe(run, ticker, "uw_gex")


# --- positioning (family: positioning) ---------------------------------------

def ingest_oi(uw: UWClient, ticker: str) -> list[Signal]:
    """Open-interest change — growing call OI vs put OI over the last session."""
    def run() -> list[Signal]:
        rows = uw.get("oi_change", params={"limit": 100}, ticker=ticker) or []
        call_oi = put_oi = 0.0
        for r in rows:
            d = _f(r, "oi_change", "oi_diff")
            is_call = str(r.get("option_type") or r.get("type") or "").lower().startswith("c")
            if d <= 0:
                continue
            if is_call:
                call_oi += d
            else:
                put_oi += d
        net = call_oi - put_oi
        total = call_oi + put_oi
        if total < 1000:
            return []
        direction = "bull" if net > 0 else "bear"
        strength = _clamp(abs(net) / total)  # share of net-new OI on one side
        return [Signal(
            source="uw_oi", ticker=ticker, direction=direction, strength=strength,
            ttl_hours=72,
            meta={"net_oi_change": int(net), "call_oi": int(call_oi), "put_oi": int(put_oi)},
        )]

    return _safe(run, ticker, "uw_oi")


def ingest_insider(uw: UWClient, ticker: str) -> list[Signal]:
    """Form-4 insider transactions. Opening *purchases* (not sells, not option grants)
    are the highest base-rate bullish tell in the stack — hence the highest prior."""
    def run() -> list[Signal]:
        rows = uw.get("insider_ticker", ticker=ticker) or []
        buys = sells = 0.0
        for r in rows:
            code = str(r.get("transaction_code") or r.get("code") or "").upper()
            value = _f(r, "transaction_value", "value", "amount")
            is_buy = code == "P" or str(r.get("transaction_type") or "").lower() == "buy"
            is_sell = code == "S" or str(r.get("transaction_type") or "").lower() == "sell"
            if is_buy:
                buys += value
            elif is_sell:
                sells += value
        net = buys - sells
        if buys < 1.0e5:  # need a real open-market buy, >$100k
            return []
        direction = "bull" if net > 0 else "bear"
        strength = _clamp(buys / 5.0e6)  # $5M cluster -> saturates
        return [Signal(
            source="uw_insider", ticker=ticker, direction=direction, strength=strength,
            ttl_hours=240,  # a Form-4 buy stays relevant ~10 days
            meta={"buys": round(buys), "sells": round(sells)},
        )]

    return _safe(run, ticker, "uw_insider")


# Registry — the active Tier-1 ingestors run each cycle per ticker.
INGESTORS = {
    "uw_flow": ingest_flow,
    "uw_darkpool": ingest_darkpool,
    "uw_gex": ingest_gex,
    "uw_oi": ingest_oi,
    "uw_insider": ingest_insider,
}


def collect(uw: UWClient, ticker: str) -> list[Signal]:
    """Run every active ingestor for one ticker, returning all emitted Signals."""
    signals: list[Signal] = []
    for fn in INGESTORS.values():
        signals.extend(fn(uw, ticker))
    return signals
