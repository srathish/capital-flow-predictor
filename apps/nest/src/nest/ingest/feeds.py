"""Market-wide feed ingestors — the emergent-universe firehoses. Each pulls ONE
market-wide UW endpoint and fans it out into per-ticker Signals, so a handful of calls
per cycle produce signals for every active name in the market. This is what lets the
Nest "watch everything" without a per-ticker loop over thousands of names.

Field names validated against live UW payloads (2026-08-28). ETFs/indexes are excluded
from stock signals. Everything is defensive: a malformed row is skipped, a dead feed
degrades to [].
"""

from __future__ import annotations

import logging
import re

from nest import config
from nest.events.schema import Signal
from nest.ingest.uw_client import UWClient

log = logging.getLogger(__name__)

# congress amount range "$1,001 - $15,000" -> midpoint
_AMT_RE = re.compile(r"\$([\d,]+)")


def _f(v, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _safe(fn, name: str) -> list[Signal]:
    try:
        return fn()
    except Exception as e:  # noqa: BLE001 — one bad feed must not kill the cycle
        log.warning("feed %s failed: %s", name, e)
        return []


def _emit_group(agg: dict[str, dict], source: str, ttl: float,
                strength_fn, meta_fn) -> list[Signal]:
    """Turn a {ticker: accumulator} map into Signals, dropping neutral/again-below-thresh."""
    out: list[Signal] = []
    for tkr, a in agg.items():
        net = a.get("net", 0.0)
        if net == 0:
            continue
        strength = strength_fn(a)
        if strength <= 0:
            continue
        out.append(Signal(
            source=source, ticker=tkr, direction="bull" if net > 0 else "bear",
            strength=_clamp(strength), ttl_hours=ttl, meta=meta_fn(a),
        ))
    return out


# --- flow (family: flow) -----------------------------------------------------

def feed_flow(uw: UWClient, limit: int = 200) -> list[Signal]:
    """Market-wide options flow alerts → per-ticker net directional premium. Single-leg,
    ask-side-dominant, opening-ish (volume > OI) only ([flow_conviction_multileg]); ETFs
    excluded. all_opening_trades is rarely set on this feed, so volume_oi_ratio>1 is the
    opening proxy — fresh positioning, not closing an existing line."""
    def run() -> list[Signal]:
        rows = uw.get("flow_alerts_market", params={"limit": limit}) or []
        agg: dict[str, dict] = {}
        for r in rows:
            if r.get("has_multileg"):
                continue
            if str(r.get("issue_type", "")) in config.EXCLUDE_ISSUE_TYPES:
                continue
            opening = r.get("all_opening_trades") or _f(r.get("volume_oi_ratio")) > 1.0
            if not opening:
                continue
            ask = _f(r.get("total_ask_side_prem"))
            bid = _f(r.get("total_bid_side_prem"))
            if ask <= bid:  # need buyer-initiated (ask-side) dominance
                continue
            tkr = str(r.get("ticker") or "")
            if not tkr:
                continue
            cp = str(r.get("type", "")).lower()
            directional = (ask - bid) * (1 if cp == "call" else -1 if cp == "put" else 0)
            a = agg.setdefault(tkr, {"net": 0.0, "gross": 0.0})
            a["net"] += directional
            a["gross"] += ask - bid
        return _emit_group(
            agg, "uw_flow", 48,
            strength_fn=lambda a: abs(a["net"]) / 3.0e6 if abs(a["net"]) >= 3e5 else 0.0,
            meta_fn=lambda a: {"net_ask_prem": round(a["net"]), "gross_ask_prem": round(a["gross"])},
        )

    return _safe(run, "uw_flow")


def feed_darkpool(uw: UWClient, limit: int = 200) -> list[Signal]:
    """Recent dark-pool prints → per-ticker block accumulation (weak bull lean). Skips
    canceled and average-price (VWAP) prints; keeps names with >$5M of real block notional."""
    def run() -> list[Signal]:
        rows = uw.get("darkpool_recent", params={"limit": limit}) or []
        agg: dict[str, dict] = {}
        for r in rows:
            if r.get("canceled") or "average_price" in str(r.get("sale_cond_codes") or ""):
                continue
            tkr = str(r.get("ticker") or "")
            notional = _f(r.get("premium"))
            if not tkr or notional <= 0:
                continue
            a = agg.setdefault(tkr, {"net": 0.0, "notional": 0.0})
            a["net"] += notional  # accumulation lean = positive
            a["notional"] += notional
        return _emit_group(
            agg, "uw_darkpool", 48,
            strength_fn=lambda a: a["notional"] / 5.0e7 if a["notional"] >= 5e6 else 0.0,
            meta_fn=lambda a: {"block_notional": round(a["notional"])},
        )

    return _safe(run, "uw_darkpool")


# --- positioning (family: positioning) ---------------------------------------

def feed_insider(uw: UWClient, limit: int = 500) -> list[Signal]:
    """Market-wide insider transactions → per-ticker net open-market buying. `amount` is
    signed (shares); notional = |amount|*price. Officer/director buys carry the signal."""
    def run() -> list[Signal]:
        rows = uw.get("insider_transactions", params={"limit": limit}) or []
        agg: dict[str, dict] = {}
        for r in rows:
            tkr = str(r.get("ticker") or "")
            amt = _f(r.get("amount"))
            price = _f(r.get("price"))
            if not tkr or amt == 0 or price <= 0:
                continue
            notional = abs(amt) * price
            a = agg.setdefault(tkr, {"net": 0.0, "buys": 0.0, "sells": 0.0})
            if amt > 0:
                a["net"] += notional
                a["buys"] += notional
            else:
                a["net"] -= notional
                a["sells"] += notional
        return _emit_group(
            agg, "uw_insider", 240,
            # only surface names with a real net buy cluster; net selling isn't a short lean here
            strength_fn=lambda a: a["buys"] / 5.0e6 if a["buys"] >= 1e5 and a["net"] > 0 else 0.0,
            meta_fn=lambda a: {"buys": round(a["buys"]), "sells": round(a["sells"])},
        )

    return _safe(run, "uw_insider")


def feed_congress(uw: UWClient, limit: int = 200) -> list[Signal]:
    """Recent congress trades → per-ticker net buy/sell by disclosed amount midpoint.
    Low prior — a lagging, weak positioning tell, but occasionally an early one."""
    def run() -> list[Signal]:
        rows = uw.get("congress_recent", params={"limit": limit}) or []
        agg: dict[str, dict] = {}
        for r in rows:
            tkr = str(r.get("ticker") or "")
            txn = str(r.get("txn_type") or "").lower()
            if not tkr or "buy" not in txn and "sell" not in txn:
                continue
            nums = [int(x.replace(",", "")) for x in _AMT_RE.findall(str(r.get("amounts") or ""))]
            mid = sum(nums) / len(nums) if nums else 15000.0
            a = agg.setdefault(tkr, {"net": 0.0})
            a["net"] += mid if "buy" in txn else -mid
        return _emit_group(
            agg, "uw_congress", 168,
            strength_fn=lambda a: _clamp(abs(a["net"]) / 2.5e5),
            meta_fn=lambda a: {"net_disclosed": round(a["net"])},
        )

    return _safe(run, "uw_congress")


# --- filings/news (family: filings) ------------------------------------------

_POS = {"positive", "bullish", "pos"}
_NEG = {"negative", "bearish", "neg"}


def feed_news(uw: UWClient, limit: int = 100) -> list[Signal]:
    """Market-wide news → per-ticker sentiment Signals (fanned across each headline's
    tickers[]). Macro/Fed headlines (empty tickers) are ignored here — engine.macro reads
    them separately for the regime dial."""
    def run() -> list[Signal]:
        rows = uw.get("news_headlines", params={"limit": limit}) or []
        agg: dict[str, dict] = {}
        for r in rows:
            sent = str(r.get("sentiment") or "").lower()
            major = bool(r.get("is_major"))
            delta = 1 if sent in _POS else -1 if sent in _NEG else 0
            if delta == 0:
                continue
            for tkr in (r.get("tickers") or []):
                a = agg.setdefault(str(tkr), {"net": 0.0, "major": 0, "latest": ""})
                a["net"] += delta
                a["major"] += int(major)
                if not a["latest"]:
                    a["latest"] = str(r.get("headline") or "")[:180]
        return _emit_group(
            agg, "uw_news", 18,
            strength_fn=lambda a: abs(a["net"]) / 5.0 + (0.2 if a["major"] else 0.0),
            meta_fn=lambda a: {"net_sentiment": int(a["net"]), "major": a["major"],
                               "latest": a["latest"]},
        )

    return _safe(run, "uw_news")


# The market-wide feeds run once per cycle; each returns Signals across many tickers.
FEEDS = [feed_flow, feed_darkpool, feed_insider, feed_congress, feed_news]


def collect_all(uw: UWClient) -> list[Signal]:
    """Run every market-wide feed once; return all fanned-out Signals."""
    signals: list[Signal] = []
    for fn in FEEDS:
        signals.extend(fn(uw))
    return signals
