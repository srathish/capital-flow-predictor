"""Minimal Unusual Whales REST client. Caches every response on disk.

We bypass the MCP tools to keep response bodies out of the assistant's context.
Each (endpoint, ticker, date) combo gets one JSON file under cache/uw_*/.
"""
from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE_ROOT = ROOT / "cache"

BASE = "https://api.unusualwhales.com"


def _token() -> str:
    # Read .env once
    if not hasattr(_token, "_v"):
        env_path = ROOT.parent / ".env"
        token = os.environ.get("UNUSUAL_WHALES_API_KEY") or os.environ.get("UNUSUAL_WHALES_API_TOKEN")
        if not token and env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("UNUSUAL_WHALES_API_KEY="):
                    token = line.split("=", 1)[1].strip().strip("'\"")
                    break
                if line.startswith("UNUSUAL_WHALES_API_TOKEN="):
                    token = line.split("=", 1)[1].strip().strip("'\"")
                    break
        if not token:
            raise RuntimeError("UNUSUAL_WHALES_API_KEY not found")
        _token._v = token
    return _token._v


def _get(path: str, params: dict | None = None, retries: int = 3) -> dict:
    qs = ("?" + urllib.parse.urlencode(params)) if params else ""
    url = f"{BASE}{path}{qs}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {_token()}",
        "Accept": "application/json",
    })
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except Exception as e:
            if attempt == retries - 1:
                return {"_error": str(e)}
            time.sleep(1.5 * (attempt + 1))
    return {"_error": "exhausted"}


def gex_by_ticker(ticker: str, timeframe: str = "1M", date: str = "2026-05-28") -> dict:
    cache = CACHE_ROOT / "uw_gex" / f"{ticker.replace('^','_')}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    out = _get(f"/api/stock/{urllib.parse.quote(ticker)}/greek-exposure",
               {"timeframe": timeframe, "date": date})
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(out))
    return out


def gex_by_strike(ticker: str, date: str) -> dict:
    cache = CACHE_ROOT / "uw_strike" / f"{ticker.replace('^','_')}_{date}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    out = _get(f"/api/stock/{urllib.parse.quote(ticker)}/greek-exposure/strike", {"date": date})
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(out))
    return out


def max_pain(ticker: str, date: str) -> dict:
    cache = CACHE_ROOT / "uw_max_pain" / f"{ticker.replace('^','_')}_{date}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    out = _get(f"/api/stock/{urllib.parse.quote(ticker)}/max-pain", {"date": date})
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(out))
    return out


def net_prem_ticks(ticker: str, date: str) -> dict:
    cache = CACHE_ROOT / "uw_net_prem" / f"{ticker.replace('^','_')}_{date}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    out = _get(f"/api/stock/{urllib.parse.quote(ticker)}/net-prem-ticks", {"date": date})
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(out))
    return out


def stock_screener(date: str, tickers: list[str], **kwargs) -> dict:
    """Multi-ticker daily snapshot.  Returns ticker rows with net_call_premium, IV rank, etc."""
    key = f"{date}_{'_'.join(tickers[:6])}_{len(tickers)}"
    cache = CACHE_ROOT / "uw_screener" / f"{key}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    params = {"date": date, "ticker": ",".join(tickers), "limit": 100, **kwargs}
    out = _get("/api/screener/stocks", params)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(out))
    return out


def market_tide(date: str, otm_only: bool = False) -> dict:
    cache = CACHE_ROOT / "uw_tide" / f"{date}{'_otm' if otm_only else ''}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    out = _get("/api/market/market-tide", {"date": date, "otm_only": str(otm_only).lower()})
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(out))
    return out


def flow_alerts_for_ticker(ticker: str, limit: int = 500, **filters) -> dict:
    cache = CACHE_ROOT / "uw_flow_alerts" / f"{ticker.replace('^','_')}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    params = {"ticker_symbol": ticker, "limit": limit, **filters}
    out = _get("/api/option-trades/flow-alerts", params)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(out))
    return out


if __name__ == "__main__":
    # Smoke test
    r = gex_by_ticker("AAPL")
    print("AAPL GEX rows:", len(r.get("result", [])))
    print("token loaded:", _token()[:8] + "…")
