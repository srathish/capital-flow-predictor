"""FeatureVector assembly — the deterministic snapshot the LLM reasons over.

The LLM never sees raw prices to do math on; everything numeric is computed here.
"""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from athena.perception.uw_client import UWClient
from athena.signals import flow_score, gex, indicators, regime


class FeatureVector(BaseModel):
    ticker: str
    as_of: str
    spot: float
    gex_source: str = "skylit"  # skylit (doctrine-calibrated) | uw-fallback
    expiry: str | None = None  # the 0DTE chain being read
    # GEX structure
    total_gamma: float
    flip_level: float | None
    call_wall: float | None
    put_wall: float | None
    top_gamma_strikes: list[tuple[float, float]]
    mass_below_spot: float
    total_vanna: float
    # tape
    vwap: float | None
    vwap_side: int  # +1 above, -1 below, 0 unknown
    ema9_vs_21: int  # +1 bullish stack, -1 bearish, 0 unknown
    atr: float | None
    rvol: float | None
    range_used: float | None
    or_break: int
    # flow
    flow_direction: float
    sweep_ratio: float
    opening_ratio: float
    net_ask_premium: float
    market_tide_direction: float
    # regime
    regime: str
    regime_evidence: list[str]


# Options roots whose price/tape lives on a different underlying ticker.
# SPXW has the 0DTE chain; the index itself (price, state) is SPX.
PRICE_ROOT = {"SPXW": "SPX"}


def build(client: UWClient, ticker: str) -> FeatureVector:
    price_ticker = PRICE_ROOT.get(ticker, ticker)
    # GEX/VEX surface: Skylit is primary — the T1 doctrine (and the live
    # fire-loop) are calibrated to it. UW spot-exposures is the fallback only.
    gex_source = "skylit"
    expiry = None
    try:
        from athena.perception import skylit

        surface = skylit.fetch_surface(ticker)
        spot = surface.spot
        exposures = surface.rows
        expiry = surface.expiration
    except Exception:
        gex_source = "uw-fallback"
        state = client.stock_state(price_ticker)
        spot = state.close
        # nearest-expiry 0DTE slice; aggregate when today isn't an expiry
        today = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
        try:
            exposures = client.strike_exposures(ticker, expiry=today, spot=spot)
        except Exception:
            exposures = []
        if not exposures:
            exposures = client.strike_exposures(ticker, spot=spot)
    profile = gex.build_profile(exposures, spot)
    try:
        bars = client.bars(price_ticker, "5m", limit=100)
    except Exception:
        bars = []  # index roots have no OHLC candles — indicators degrade to None
    bars = list(reversed(bars)) if _looks_reversed(bars) else bars
    closes = [b.close for b in bars]

    vw = indicators.vwap(bars)
    e9, e21 = indicators.ema(closes, 9), indicators.ema(closes, 21)
    orange = indicators.opening_range(bars)
    or_break = 0
    if orange and bars:
        last = bars[-1].close
        or_break = 1 if last > orange[0] else (-1 if last < orange[1] else 0)

    alerts = client.flow_alerts(ticker)
    flow = flow_score.summarize_flow(alerts)
    tide = flow_score.tide_direction(client.net_prem_ticks(ticker))

    nearest_wall = None
    if profile.top_gamma_strikes:
        nearest_wall = min(profile.top_gamma_strikes, key=lambda s: abs(s[0] - spot))[0]

    reg, evidence = regime.classify(
        regime.RegimeInputs(
            spot=spot,
            total_gamma=profile.total_gamma,
            flip_level=profile.flip_level,
            nearest_wall=nearest_wall,
            range_used=indicators.session_range_used(bars),
            rvol=indicators.rvol(bars),
            or_break=or_break,
            flow_direction=flow.direction,
        )
    )

    return FeatureVector(
        ticker=ticker,
        as_of=datetime.now(UTC).isoformat(timespec="seconds"),
        spot=spot,
        gex_source=gex_source,
        expiry=expiry,
        total_gamma=profile.total_gamma,
        flip_level=profile.flip_level,
        call_wall=profile.call_wall,
        put_wall=profile.put_wall,
        top_gamma_strikes=profile.top_gamma_strikes,
        mass_below_spot=profile.mass_below_spot,
        total_vanna=profile.total_vanna,
        vwap=vw,
        vwap_side=(1 if vw and spot > vw else (-1 if vw and spot < vw else 0)),
        ema9_vs_21=(1 if e9 and e21 and e9 > e21 else (-1 if e9 and e21 and e9 < e21 else 0)),
        atr=indicators.atr(bars),
        rvol=indicators.rvol(bars),
        range_used=indicators.session_range_used(bars),
        or_break=or_break,
        flow_direction=flow.direction,
        sweep_ratio=flow.sweep_ratio,
        opening_ratio=flow.opening_ratio,
        net_ask_premium=flow.net_ask_premium,
        market_tide_direction=flow_score.tide_direction(
            [t for t in client.market_tide() if t]  # market-wide tide reuses the same math
        ) if ticker in ("SPXW", "SPY", "QQQ") else tide,
        regime=reg,
        regime_evidence=evidence,
    )


def _looks_reversed(bars) -> bool:
    """UW returns newest-first for some candle endpoints; detect and normalize."""
    if len(bars) < 2 or not bars[0].start_time or not bars[-1].start_time:
        return False
    return bars[0].start_time > bars[-1].start_time
