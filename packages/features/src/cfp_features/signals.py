"""Three feature builders that PROJECT_STATUS flagged as missing.

These are pure pandas transforms with no DB I/O — wire them into
``cfp_jobs.bundle_compute`` (or the training pipeline) to actually persist the
columns.

* insider_net_buy_30d:  sum( buy_dollars - sell_dollars ) over last 30d / sector market cap proxy
* dark_pool_volume_ratio: dark-pool prints / total volume (rolling 5d mean)
* reddit_mention_velocity: 7d slope of daily mention counts (positive = rising)
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def insider_net_buy_30d(insider_txns: pd.DataFrame, sector_marketcap: pd.Series | None = None) -> pd.DataFrame:
    """Net insider $ flow over the trailing 30 calendar days, per (ticker, date).

    Args:
        insider_txns: must have columns transaction_date, ticker,
            transaction_code in {'P','S'}, amount (shares), price ($).
        sector_marketcap: optional series indexed by ticker mapping to a market
            cap proxy used to normalize the dollar flow. If None, output is
            raw dollars.

    Returns wide DataFrame indexed by date, columns by ticker. NaN where the
    ticker has no insider transactions in the window.
    """
    if insider_txns.empty:
        return pd.DataFrame()
    df = insider_txns.copy()
    df["transaction_date"] = pd.to_datetime(df["transaction_date"])
    sign = df["transaction_code"].map({"P": 1.0, "S": -1.0}).fillna(0.0)
    df["signed_usd"] = sign * df["amount"].astype(float) * df["price"].astype(float)
    daily = (
        df.groupby([pd.Grouper(key="transaction_date", freq="D"), "ticker"])["signed_usd"]
        .sum()
        .unstack(fill_value=0.0)
    )
    rolled = daily.rolling(window=30, min_periods=1).sum()
    if sector_marketcap is not None:
        mc = sector_marketcap.reindex(rolled.columns).replace(0, np.nan)
        rolled = rolled.divide(mc, axis=1)
    return rolled.rename(columns=lambda c: c).add_prefix("")  # keep ticker columns


def dark_pool_volume_ratio(prints: pd.DataFrame, total_volume: pd.DataFrame) -> pd.DataFrame:
    """Rolling 5-day mean of dark_pool_prints_$ / total_volume_$.

    Args:
        prints: long format with columns ts, ticker, dark_pool_dollars.
        total_volume: wide format indexed by ts, columns by ticker, in dollar volume.

    Returns wide DataFrame indexed by ts, columns by ticker, values in [0,1].
    """
    if prints.empty or total_volume.empty:
        return pd.DataFrame()
    p = prints.copy()
    p["ts"] = pd.to_datetime(p["ts"]).dt.normalize()
    wide = p.pivot_table(index="ts", columns="ticker", values="dark_pool_dollars", aggfunc="sum")
    tv = total_volume.reindex(wide.index).reindex(columns=wide.columns)
    ratio = wide.divide(tv.replace(0, np.nan))
    return ratio.rolling(window=5, min_periods=2).mean().clip(0.0, 1.0)


def reddit_mention_velocity(mentions: pd.DataFrame, window: int = 7) -> pd.DataFrame:
    """7-day slope of daily mention counts per ticker.

    Args:
        mentions: long format with columns ts (datetime), ticker, count (int).

    Returns wide DataFrame indexed by date, columns by ticker. The value is the
    least-squares slope of ``count`` vs day-index over the trailing window —
    positive means rising mentions, negative means falling.
    """
    if mentions.empty:
        return pd.DataFrame()
    m = mentions.copy()
    m["ts"] = pd.to_datetime(m["ts"]).dt.normalize()
    daily = m.groupby(["ts", "ticker"])["count"].sum().unstack(fill_value=0)

    x = np.arange(window, dtype=float)
    x_centered = x - x.mean()
    denom = (x_centered ** 2).sum()

    def _slope(vals: np.ndarray) -> float:
        # vals has shape (window,) — least-squares slope around centered x.
        return float(((vals - vals.mean()) * x_centered).sum() / denom)

    # rolling.apply preserves the column structure; slow but daily granularity is fine.
    out = daily.rolling(window=window, min_periods=window).apply(_slope, raw=True)
    return out
