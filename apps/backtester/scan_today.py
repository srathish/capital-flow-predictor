"""Scan today's universe for active entry signals using the winning Pure Trend logic.

This is the immediately actionable output of the research.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from data import load_ohlcv
from master_strategy import ema, atr


# S&P 500-ish universe + user's known holdings (extend as needed)
UNIVERSE = sorted(set([
    # Mega-cap tech
    "AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSLA", "AVGO",
    "AMD", "MU", "ADBE", "ORCL", "CRM", "NFLX", "INTC", "QCOM",
    # Cyclicals & financials
    "JPM", "GS", "BAC", "WFC", "C", "MS",
    # Energy
    "XOM", "CVX", "COP", "SLB",
    # Healthcare
    "JNJ", "UNH", "PFE", "ABBV", "LLY", "TMO",
    # Industrials
    "BA", "CAT", "GE", "HON", "LMT", "RTX", "NOC", "GD",
    # Consumer
    "WMT", "KO", "PG", "MCD", "HD", "NKE", "SBUX", "COST",
    # ETFs (sector + broad)
    "SPY", "QQQ", "IWM", "DIA",
    "XLK", "XLF", "XLE", "XLV", "XLI", "XLU", "XLY", "XLP", "XLB", "XLRE", "XLC",
    # Space basket (per user memory)
    "RKLB", "ASTS", "PL", "RDW", "IRDM",
    # Active swing names
    "ROKU", "SHOP", "SQ", "PLTR", "COIN", "RIVN", "DELL",
]))


def score_ticker(ticker: str) -> dict | None:
    try:
        df = load_ohlcv(ticker, period="1y")
        if len(df) < 250:
            return None
    except Exception:
        return None

    df["ema8"]   = ema(df["close"], 8)
    df["ema21"]  = ema(df["close"], 21)
    df["ema50"]  = ema(df["close"], 50)
    df["ema200"] = ema(df["close"], 200)
    df["atr"]    = atr(df, 14)

    last = df.iloc[-1]
    prev = df.iloc[-2]

    stacked = last["ema8"] > last["ema21"] > last["ema50"] > last["ema200"]
    ema50_rising = last["ema50"] > df.iloc[-11]["ema50"]
    breakout = last["close"] > prev["high"]
    stage4 = last["close"] < last["ema200"] and last["ema200"] < df.iloc[-21]["ema200"]
    bear_stack = last["ema8"] < last["ema21"] < last["ema50"] < last["ema200"]
    danger = stage4 or bear_stack

    # Setup score: how many of the entry conditions are met right now?
    score = sum([stacked, ema50_rising, breakout, not danger])

    # Distance to setup (how far from being a fresh entry)
    dist_above_50 = (last["close"] - last["ema50"]) / last["close"] * 100
    dist_above_200 = (last["close"] - last["ema200"]) / last["close"] * 100

    return {
        "ticker": ticker,
        "close": round(last["close"], 2),
        "stacked": "Y" if stacked else "-",
        "ema50_rising": "Y" if ema50_rising else "-",
        "breakout_today": "Y" if breakout else "-",
        "danger": "Y" if danger else "-",
        "above_50ma%": round(dist_above_50, 1),
        "above_200ma%": round(dist_above_200, 1),
        "score": score,
        "signal": (stacked and ema50_rising and breakout and not danger),
    }


def main():
    rows = []
    for tk in UNIVERSE:
        r = score_ticker(tk)
        if r:
            rows.append(r)

    df = pd.DataFrame(rows)
    if df.empty:
        print("No data.")
        return

    print(f"\n========= SCAN RUN ON {len(df)} TICKERS — Pure Trend v4 Entry Logic =========\n")

    # Active signals (all 4 conditions met)
    signals = df[df["signal"]]
    print(f"🟢 ACTIVE ENTRY SIGNALS ({len(signals)}):")
    if len(signals) > 0:
        print(signals.drop(columns=["signal"]).to_string(index=False))
    else:
        print("  (none today)")

    # Near-signals (3 of 4 conditions, missing breakout)
    near = df[(df["score"] == 3) & (df["breakout_today"] == "-") & (df["danger"] == "-")]
    print(f"\n🟡 NEAR-SIGNALS (stacked + ema50 rising, awaiting breakout) ({len(near)}):")
    if len(near) > 0:
        print(near.drop(columns=["signal"]).to_string(index=False))

    # Danger phase
    dgr = df[df["danger"] == "Y"]
    print(f"\n🔴 IN DANGER ({len(dgr)}):")
    if len(dgr) > 0:
        print(dgr[["ticker", "close", "above_200ma%"]].to_string(index=False))

    # Save
    out_path = Path(__file__).parent / "scan_today.csv"
    df.to_csv(out_path, index=False)
    print(f"\nSaved -> {out_path}")


if __name__ == "__main__":
    main()
