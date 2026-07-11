"""Endpoint whitelist — generated from the LIVE OpenAPI spec (fetched 2026-07-11,
192 paths). Anything not listed here cannot be called; this is the anti-hallucination
gate. Known trap (confirmed against the spec): the flow endpoint is
/api/option-trades/flow-alerts — /api/options/flow does NOT exist.
"""

from __future__ import annotations

WHITELIST: dict[str, str] = {
    "spot_exposures_strike": "/api/stock/{ticker}/spot-exposures/strike",
    "spot_exposures_expiry_strike": "/api/stock/{ticker}/spot-exposures/{expiry}/strike",
    "greek_exposure": "/api/stock/{ticker}/greek-exposure",
    "greek_exposure_strike": "/api/stock/{ticker}/greek-exposure/strike",
    "greek_exposure_expiry": "/api/stock/{ticker}/greek-exposure/expiry",
    "flow_alerts": "/api/stock/{ticker}/flow-alerts",
    "flow_recent": "/api/stock/{ticker}/flow-recent",
    "net_prem_ticks": "/api/stock/{ticker}/net-prem-ticks",
    "max_pain": "/api/stock/{ticker}/max-pain",
    "oi_per_strike": "/api/stock/{ticker}/oi-per-strike",
    "ohlc": "/api/stock/{ticker}/ohlc/{candle_size}",
    "stock_state": "/api/stock/{ticker}/stock-state",
    "volatility_term_structure": "/api/stock/{ticker}/volatility/term-structure",
    "market_tide": "/api/market/market-tide",
}


def path(name: str, **kwargs: str) -> str:
    """Resolve a whitelisted endpoint. Raises on anything off-spec."""
    if name not in WHITELIST:
        raise KeyError(f"endpoint {name!r} is not in the spec-verified whitelist")
    return WHITELIST[name].format(**kwargs)
