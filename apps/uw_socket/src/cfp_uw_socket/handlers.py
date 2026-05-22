"""Per-channel message handlers. Each handler:

  * Parses a raw UW WebSocket message (JSON dict).
  * Maps fields into a DB row.
  * Returns either the SQL + params dict, or None to skip the message.

Persistence is done by main.py — handlers stay pure for testing.

Field shapes follow UW's documented channel formats. Where the API may
return alternate keys, we accept either. Anything we can't parse goes
to ``payload`` as a JSON blob so we can backfill later.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, date as Date
from typing import Any

log = logging.getLogger(__name__)


# ---------- coercion helpers ----------


def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        if f != f:  # NaN
            return None
        return f
    except (TypeError, ValueError):
        return None


def _i(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _ts(v: Any) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=UTC)
    if isinstance(v, (int, float)):
        try:
            # Heuristic: > 1e12 means ms, otherwise seconds since epoch.
            return datetime.fromtimestamp(v / 1000 if v > 1e12 else v, tz=UTC)
        except (OverflowError, ValueError, OSError):
            return None
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _date(v: Any) -> Date | None:
    if v is None:
        return None
    if isinstance(v, Date):
        return v
    if isinstance(v, str):
        try:
            return Date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


# ---------- payload extractor ----------


def _envelope(raw: Any) -> dict[str, Any] | None:
    """UW envelopes are inconsistent across channels. Some are bare dicts,
    some are `{"data": {...}}`, some are `{"channel": "...", "payload": {...}}`.
    Normalise to "the actual event dict" or None if we can't tell."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return None
    if not isinstance(raw, dict):
        return None
    if "data" in raw and isinstance(raw["data"], dict):
        return raw["data"]
    if "payload" in raw and isinstance(raw["payload"], dict):
        return raw["payload"]
    return raw


# ---------- per-channel handlers ----------


FLOW_ALERTS_SQL = """
    INSERT INTO uw_flow_alerts (
        ts, ticker, option_symbol, option_type, strike, expiry,
        premium, total_volume, total_premium, alert_rule, payload
    ) VALUES (
        %(ts)s, %(ticker)s, %(option_symbol)s, %(option_type)s, %(strike)s, %(expiry)s,
        %(premium)s, %(total_volume)s, %(total_premium)s, %(alert_rule)s, %(payload)s
    ) ON CONFLICT DO NOTHING
"""


def handle_flow_alert(raw: Any) -> tuple[str, dict[str, Any]] | None:
    e = _envelope(raw)
    if not e:
        return None
    ticker = (e.get("ticker") or e.get("symbol") or "").upper()
    if not ticker:
        return None
    params = {
        "ts": _ts(e.get("created_at") or e.get("executed_at") or e.get("ts")),
        "ticker": ticker,
        "option_symbol": e.get("option_chain") or e.get("option_symbol"),
        "option_type": (e.get("type") or e.get("option_type") or "").lower() or None,
        "strike": _f(e.get("strike")),
        "expiry": _date(e.get("expiry") or e.get("expires_at")),
        "premium": _f(e.get("premium") or e.get("total_premium")),
        "total_volume": _i(e.get("total_volume") or e.get("volume")),
        "total_premium": _f(e.get("total_premium")),
        "alert_rule": e.get("alert_rule") or e.get("rule"),
        "payload": json.dumps(e),
    }
    if params["ts"] is None:
        return None
    return FLOW_ALERTS_SQL, params


OPTION_TRADES_SQL = """
    INSERT INTO uw_option_trades_stream (
        ts, ticker, option_symbol, option_type, strike, expiry,
        price, size, premium, bid_at_trade, ask_at_trade, side,
        sweep, cross_market, trade_id, payload
    ) VALUES (
        %(ts)s, %(ticker)s, %(option_symbol)s, %(option_type)s, %(strike)s, %(expiry)s,
        %(price)s, %(size)s, %(premium)s, %(bid_at_trade)s, %(ask_at_trade)s, %(side)s,
        %(sweep)s, %(cross_market)s, %(trade_id)s, %(payload)s
    ) ON CONFLICT DO NOTHING
"""


def handle_option_trade(raw: Any) -> tuple[str, dict[str, Any]] | None:
    e = _envelope(raw)
    if not e:
        return None
    ticker = (e.get("ticker") or e.get("underlying_symbol") or e.get("symbol") or "").upper()
    if not ticker:
        return None
    ts = _ts(e.get("executed_at") or e.get("ts") or e.get("timestamp"))
    if ts is None:
        return None
    trade_id = str(
        e.get("trade_id")
        or e.get("id")
        or f"{ts.isoformat()}|{ticker}|{e.get('option_symbol') or ''}|{e.get('size') or ''}"
    )
    price = _f(e.get("price"))
    size = _i(e.get("size") or e.get("volume"))
    premium = _f(e.get("premium"))
    if premium is None and price is not None and size is not None:
        premium = price * size * 100
    params = {
        "ts": ts,
        "ticker": ticker,
        "option_symbol": e.get("option_chain") or e.get("option_symbol"),
        "option_type": (e.get("type") or e.get("option_type") or "").lower() or None,
        "strike": _f(e.get("strike")),
        "expiry": _date(e.get("expiry") or e.get("expires_at")),
        "price": price,
        "size": size,
        "premium": premium,
        "bid_at_trade": _f(e.get("bid")),
        "ask_at_trade": _f(e.get("ask")),
        "side": e.get("side") or e.get("aggressor"),
        "sweep": bool(e.get("sweep") or e.get("is_sweep") or False),
        "cross_market": bool(e.get("cross_market") or e.get("is_cross") or False),
        "trade_id": trade_id,
        "payload": json.dumps(e),
    }
    return OPTION_TRADES_SQL, params


GEX_INTRADAY_SQL = """
    INSERT INTO uw_greek_exposure_intraday (
        ts, ticker, net_gamma, net_delta, net_vega, net_theta,
        call_gamma, put_gamma, payload
    ) VALUES (
        %(ts)s, %(ticker)s, %(net_gamma)s, %(net_delta)s, %(net_vega)s, %(net_theta)s,
        %(call_gamma)s, %(put_gamma)s, %(payload)s
    ) ON CONFLICT (ts, ticker) DO UPDATE SET
        net_gamma  = EXCLUDED.net_gamma,
        net_delta  = EXCLUDED.net_delta,
        net_vega   = EXCLUDED.net_vega,
        net_theta  = EXCLUDED.net_theta,
        call_gamma = EXCLUDED.call_gamma,
        put_gamma  = EXCLUDED.put_gamma,
        payload    = EXCLUDED.payload
"""


def handle_gex(raw: Any) -> tuple[str, dict[str, Any]] | None:
    e = _envelope(raw)
    if not e:
        return None
    ticker = (e.get("ticker") or e.get("symbol") or "").upper()
    if not ticker:
        return None
    ts = _ts(e.get("ts") or e.get("timestamp") or datetime.now(UTC))
    if ts is None:
        return None
    params = {
        "ts": ts,
        "ticker": ticker,
        "net_gamma": _f(e.get("net_gamma") or e.get("gamma")),
        "net_delta": _f(e.get("net_delta") or e.get("delta")),
        "net_vega": _f(e.get("net_vega") or e.get("vega")),
        "net_theta": _f(e.get("net_theta") or e.get("theta")),
        "call_gamma": _f(e.get("call_gamma")),
        "put_gamma": _f(e.get("put_gamma")),
        "payload": json.dumps(e),
    }
    return GEX_INTRADAY_SQL, params


MARKET_TIDE_SQL = """
    INSERT INTO uw_market_tide (
        ts, net_call_premium, net_put_premium, net_volume
    ) VALUES (
        %(ts)s, %(net_call_premium)s, %(net_put_premium)s, %(net_volume)s
    ) ON CONFLICT (ts) DO UPDATE SET
        net_call_premium = EXCLUDED.net_call_premium,
        net_put_premium  = EXCLUDED.net_put_premium,
        net_volume       = EXCLUDED.net_volume
"""


def handle_market_tide(raw: Any) -> tuple[str, dict[str, Any]] | None:
    e = _envelope(raw)
    if not e:
        return None
    ts = _ts(e.get("ts") or e.get("timestamp") or e.get("date"))
    if ts is None:
        return None
    params = {
        "ts": ts,
        "net_call_premium": _f(e.get("net_call_premium")),
        "net_put_premium": _f(e.get("net_put_premium")),
        "net_volume": _f(e.get("net_volume")),
    }
    return MARKET_TIDE_SQL, params


TRADING_HALTS_SQL = """
    INSERT INTO uw_trading_halts (
        ts, ticker, halt_code, halt_reason, market,
        resumption_ts, resumption_quote_ts, resumption_trade_ts, payload
    ) VALUES (
        %(ts)s, %(ticker)s, %(halt_code)s, %(halt_reason)s, %(market)s,
        %(resumption_ts)s, %(resumption_quote_ts)s, %(resumption_trade_ts)s, %(payload)s
    ) ON CONFLICT (ts, ticker, halt_code) DO UPDATE SET
        resumption_ts       = EXCLUDED.resumption_ts,
        resumption_quote_ts = EXCLUDED.resumption_quote_ts,
        resumption_trade_ts = EXCLUDED.resumption_trade_ts,
        payload             = EXCLUDED.payload
"""


def handle_trading_halt(raw: Any) -> tuple[str, dict[str, Any]] | None:
    """UW socket trading_halts payload (per docs):

        {"ticker": "GME", "state": "halted"|"resumed"|"paused",
         "reason": "LUDP"|"T1"|"", "time": "2026-04-27T14:31:02Z"}

    We map both `halted` and `resumed` into the same row keyed by (ts,
    ticker, reason). For a `resumed` event we set resumption_ts so the
    Halts strip can show the halt as inactive.
    """
    e = _envelope(raw)
    if not e:
        return None
    ticker = (e.get("ticker") or e.get("symbol") or "").upper()
    if not ticker:
        return None
    ts = _ts(e.get("time") or e.get("ts") or e.get("halt_time"))
    if ts is None:
        return None
    state = (e.get("state") or "").lower()
    is_resume = state in ("resumed", "resume")
    # Pre-existing aliases preserved so older payloads still parse.
    reason_code = e.get("reason") or e.get("halt_code") or e.get("code") or ""
    params = {
        "ts": ts,
        "ticker": ticker,
        # halt_code is in the PK and NOT NULL — '' is the sentinel for
        # "no reason code provided".
        "halt_code": reason_code,
        "halt_reason": state or e.get("halt_reason"),
        "market": e.get("market") or e.get("exchange"),
        "resumption_ts": ts if is_resume else _ts(e.get("resumption_ts") or e.get("resume_time")),
        "resumption_quote_ts": _ts(e.get("resumption_quote_ts")),
        "resumption_trade_ts": _ts(e.get("resumption_trade_ts")),
        "payload": json.dumps(e),
    }
    return TRADING_HALTS_SQL, params


# ---------- channel registry ----------


HANDLERS = {
    "flow_alerts": handle_flow_alert,
    "option_trades": handle_option_trade,
    "gex": handle_gex,
    "market_tide": handle_market_tide,
    "trading_halts": handle_trading_halt,
}
