"""Pure-function bundle computers shared between the agent runner (which
builds the canonical EvidenceBundle once per run) and the analyst nodes
(which fall back to computing a PriceContext from state["prices"] when no
bundle is attached — useful for tests and direct callers)."""

from __future__ import annotations

import numpy as np
import pandas as pd
from cfp_shared import FundamentalsCtx, PriceContext


def rsi_14(close: pd.Series) -> float | None:
    if len(close) < 15:
        return None
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.rolling(14, min_periods=14).mean()
    avg_loss = loss.rolling(14, min_periods=14).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    rsi = rsi.replace([np.inf, -np.inf], np.nan)
    last = rsi.iloc[-1]
    return float(last) if pd.notna(last) else None


def compute_price_context(prices: pd.DataFrame | None) -> PriceContext:
    """Summarize OHLCV into a PriceContext. Pure function; safe on empty input."""
    if prices is None or prices.empty or "close" not in prices.columns:
        return PriceContext()

    df = prices.sort_values("ts").reset_index(drop=True)
    close = df["close"].astype(float)
    n = len(close)
    last = float(close.iloc[-1])
    ts_last = df["ts"].iloc[-1]
    last_date_val = ts_last.date() if hasattr(ts_last, "date") else None

    def _ret(k: int) -> float | None:
        if n <= k:
            return None
        try:
            return float(close.iloc[-1] / close.iloc[-1 - k] - 1.0)
        except (ZeroDivisionError, ValueError):
            return None

    ma50 = float(close.rolling(50, min_periods=50).mean().iloc[-1]) if n >= 50 else None
    ma200 = float(close.rolling(200, min_periods=200).mean().iloc[-1]) if n >= 200 else None
    ma50_dist = (last / ma50 - 1.0) if (ma50 and ma50 > 0) else None
    ma200_dist = (last / ma200 - 1.0) if (ma200 and ma200 > 0) else None

    rv20 = None
    if n >= 21:
        rets = close.pct_change()
        sd = float(rets.rolling(20, min_periods=20).std().iloc[-1] or 0.0)
        rv20 = sd * (252 ** 0.5) if sd else None

    vol_z = None
    if "volume" in df.columns and n >= 20:
        v = df["volume"].astype(float)
        v_mean = float(v.rolling(20, min_periods=20).mean().iloc[-1] or 0.0)
        v_std = float(v.rolling(20, min_periods=20).std().iloc[-1] or 0.0)
        if v_std > 0 and v_mean > 0:
            vol_z = float((v.iloc[-1] - v_mean) / v_std)

    return PriceContext(
        last_close=last,
        last_date=last_date_val,
        bars_count=n,
        ma50_dist=ma50_dist,
        ma200_dist=ma200_dist,
        rsi_14=rsi_14(close),
        return_5d=_ret(5),
        return_20d=_ret(20),
        return_60d=_ret(60),
        realized_vol_20d=rv20,
        volume_z_20d=vol_z,
    )


def _latest_metric(fundamentals: pd.DataFrame, metric: str) -> float | None:
    if fundamentals is None or fundamentals.empty:
        return None
    sel = fundamentals[
        (fundamentals["metric"] == metric) & (fundamentals["period_type"] == "A")
    ]
    if sel.empty:
        return None
    sel = sel.sort_values("fiscal_period")
    val = sel.iloc[-1]["value"]
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def compute_fundamentals_ctx(fundamentals: pd.DataFrame | None) -> FundamentalsCtx:
    if fundamentals is None or fundamentals.empty:
        return FundamentalsCtx(has_data=False)
    return FundamentalsCtx(
        has_data=True,
        revenue=_latest_metric(fundamentals, "revenue"),
        market_cap=_latest_metric(fundamentals, "market_cap"),
        roe=_latest_metric(fundamentals, "roe"),
        roic=_latest_metric(fundamentals, "roic"),
        free_cash_flow=_latest_metric(fundamentals, "free_cash_flow"),
        debt_to_equity=_latest_metric(fundamentals, "debt_to_equity"),
        pe_ratio=_latest_metric(fundamentals, "pe_ratio"),
        price_to_book=_latest_metric(fundamentals, "price_to_book"),
        gross_margin=_latest_metric(fundamentals, "gross_margin"),
        net_margin=_latest_metric(fundamentals, "net_margin"),
    )
