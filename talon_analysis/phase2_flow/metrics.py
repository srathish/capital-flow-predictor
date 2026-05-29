"""Derive per-ticker daily flow + GEX metrics from cached UW responses.

Each GEX timeseries row has: call_gamma, put_gamma, call_delta, put_delta,
call_charm, put_charm, call_vanna, put_vanna.

Sign convention from UW:
  - call_gamma > 0, put_gamma < 0  → dealer net long gamma if (call + put) > 0
  - call_delta > 0 (dealer short calls = short delta); put_delta < 0 (dealer short puts = long delta)
    Net DEALER delta exposure = call_delta + put_delta (positive = dealer long net delta)
  - vanna: call_vanna > 0 indicates upside-vol-exposed; put_vanna depends on side
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
GEX_DIR = ROOT / "cache" / "uw_gex"
STRIKE_DIR = ROOT / "cache" / "uw_strike"
MAX_PAIN_DIR = ROOT / "cache" / "uw_max_pain"
SCREENER_DIR = ROOT / "cache" / "uw_screener"
TIDE_DIR = ROOT / "cache" / "uw_tide"


def load_gex(ticker: str) -> pd.DataFrame:
    """Load GEX timeseries for a ticker into a DataFrame with derived columns."""
    path = GEX_DIR / f"{ticker.replace('^','_')}.json"
    if not path.exists():
        return pd.DataFrame()
    data = json.loads(path.read_text())
    rows = data.get("result") or data.get("data") or []
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    num_cols = ["call_gamma", "put_gamma", "call_delta", "put_delta",
                "call_charm", "put_charm", "call_vanna", "put_vanna"]
    for c in num_cols:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)

    # Derived metrics
    df["net_gamma"] = df["call_gamma"] + df["put_gamma"]                # signed
    df["net_delta"] = df["call_delta"] + df["put_delta"]                # dealer net delta
    df["net_charm"] = df["call_charm"] + df["put_charm"]
    df["net_vanna"] = df["call_vanna"] + df["put_vanna"]
    df["gamma_total"] = df["call_gamma"] - df["put_gamma"]              # absolute gamma magnitude
    df["delta_skew"] = df["call_delta"] / df["put_delta"].abs().replace(0, pd.NA)
    df["gamma_skew"] = df["call_gamma"] / df["put_gamma"].abs().replace(0, pd.NA)
    df["call_dominance_pct"] = df["call_delta"] / (df["call_delta"] + df["put_delta"].abs()) * 100
    return df


def gex_summary(ticker: str, start: str = "2026-05-01", end: str = "2026-05-28") -> dict:
    df = load_gex(ticker)
    if df.empty:
        return {"ticker": ticker, "_status": "no_data"}
    mask = (df["date"] >= start) & (df["date"] <= end)
    win = df.loc[mask]
    pre18 = df.loc[df["date"] < "2026-05-18"]
    post18 = df.loc[df["date"] >= "2026-05-18"]
    return {
        "ticker": ticker,
        "n_days": len(win),
        "mean_call_dominance_pct_pre18": pre18["call_dominance_pct"].mean(),
        "mean_call_dominance_pct_post18": post18["call_dominance_pct"].mean(),
        "mean_delta_skew_pre18": pre18["delta_skew"].mean(),
        "mean_delta_skew_post18": post18["delta_skew"].mean(),
        "mean_gamma_skew_pre18": pre18["gamma_skew"].mean(),
        "mean_gamma_skew_post18": post18["gamma_skew"].mean(),
        "delta_buildup_pre18_to_post18_pct": (
            (post18["net_delta"].mean() - pre18["net_delta"].mean())
            / pre18["net_delta"].mean().__abs__() * 100
            if pre18["net_delta"].mean() != 0 else float("nan")
        ),
        "net_vanna_pre18_mean": pre18["net_vanna"].mean(),
        "net_vanna_post18_mean": post18["net_vanna"].mean(),
        "vanna_flip": bool((pre18["net_vanna"].iloc[-1] > 0) != (post18["net_vanna"].iloc[0] > 0))
            if not pre18.empty and not post18.empty else False,
    }


def gex_to_long_df(tickers: list[str]) -> pd.DataFrame:
    """All tickers in one long-format DataFrame for easy filtering / comparison."""
    frames = []
    for t in tickers:
        df = load_gex(t)
        if df.empty:
            continue
        df["ticker"] = t
        frames.append(df)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def load_strike(ticker: str, date: str) -> pd.DataFrame:
    path = STRIKE_DIR / f"{ticker.replace('^','_')}_{date}.json"
    if not path.exists():
        return pd.DataFrame()
    data = json.loads(path.read_text())
    rows = data.get("result") or data.get("data") or []
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    for c in ["strike", "call_gamma", "put_gamma", "call_delta", "put_delta",
              "call_charm", "put_charm", "call_vanna", "put_vanna"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    df["net_gamma"] = df.get("call_gamma", 0) + df.get("put_gamma", 0)
    df["net_vanna"] = df.get("call_vanna", 0) + df.get("put_vanna", 0)
    return df.sort_values("strike").reset_index(drop=True)


def load_screener(date: str) -> pd.DataFrame:
    path = SCREENER_DIR / f"snapshot_{date}.json"
    if not path.exists():
        return pd.DataFrame()
    data = json.loads(path.read_text())
    rows = data.get("data") or data.get("result") or []
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["_snapshot_date"] = date
    return df


def load_max_pain(ticker: str, date: str) -> dict:
    path = MAX_PAIN_DIR / f"{ticker.replace('^','_')}_{date}.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text())
