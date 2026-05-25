"""Daily scanner using FINAL TREND v5 logic.

Outputs:
  - Active entry signals (long now)
  - Active danger names (stay out)
  - Near-signal names (stacked but waiting for breakout)

Designed for daily operational use — run morning before market open.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from data import load_ohlcv
from master_strategy import ema, atr

UNIVERSE = sorted(set([
    # Mega-cap tech (always watch)
    "AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSLA", "AVGO",
    "AMD", "MU", "ADBE", "ORCL", "CRM", "NFLX", "INTC", "QCOM",
    # Financials
    "JPM", "GS", "BAC", "WFC", "C", "MS",
    # Energy
    "XOM", "CVX", "COP", "SLB",
    # Healthcare
    "JNJ", "UNH", "PFE", "ABBV", "LLY", "TMO",
    # Industrials (incl space basket)
    "BA", "CAT", "GE", "HON", "LMT", "RTX", "NOC", "GD",
    "RKLB", "ASTS", "PL", "RDW", "IRDM",
    # Consumer
    "WMT", "KO", "PG", "MCD", "HD", "NKE", "SBUX", "COST",
    # ETFs
    "SPY", "QQQ", "IWM", "DIA",
    "XLK", "XLF", "XLE", "XLV", "XLI", "XLU", "XLY", "XLP", "XLB", "XLRE", "XLC",
    # Speculative
    "ROKU", "SHOP", "PLTR", "COIN", "RIVN", "DELL",
]))


def score(ticker: str) -> dict | None:
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
    ema50_10ago = df.iloc[-11]["ema50"]
    ema200_20ago = df.iloc[-21]["ema200"]

    stacked = last["ema8"] > last["ema21"] > last["ema50"] > last["ema200"]
    ema50_rising = last["ema50"] > ema50_10ago
    breakout = last["close"] > prev["high"]
    stage4 = last["close"] < last["ema200"] and last["ema200"] < ema200_20ago
    bear_stack = last["ema8"] < last["ema21"] < last["ema50"] < last["ema200"]
    danger = stage4 or bear_stack

    init_stop = max(last["close"] - last["atr"] * 2.0, last["ema50"])
    risk_pct = (last["close"] - init_stop) / last["close"] * 100

    return {
        "ticker": ticker,
        "close": round(last["close"], 2),
        "stacked": stacked,
        "ema50_rising": ema50_rising,
        "breakout": breakout,
        "danger": danger,
        "atr": round(last["atr"], 2),
        "stop": round(init_stop, 2),
        "risk_pct_per_share": round(risk_pct, 1),
        "above_200ma_pct": round((last["close"] - last["ema200"]) / last["close"] * 100, 1),
        "above_50ma_pct": round((last["close"] - last["ema50"]) / last["close"] * 100, 1),
        "signal_strength": int(stacked) + int(ema50_rising) + int(breakout) - int(danger) * 4,
    }


def main():
    rows = []
    for tk in UNIVERSE:
        r = score(tk)
        if r:
            rows.append(r)
    df = pd.DataFrame(rows)
    if df.empty:
        print("No data")
        return

    # Active entry signals (all 3 conditions + not danger)
    entries = df[df["stacked"] & df["ema50_rising"] & df["breakout"] & (~df["danger"])]
    print(f"\n=== ENTRY SIGNALS — TAKE LONG NOW ({len(entries)}) ===")
    if len(entries) > 0:
        cols = ["ticker", "close", "stop", "risk_pct_per_share", "above_50ma_pct", "above_200ma_pct"]
        print(entries[cols].to_string(index=False))
    else:
        print("(none today — wait for next bar)")

    # Near-signals (stacked + ema50_rising, waiting for breakout)
    near = df[df["stacked"] & df["ema50_rising"] & (~df["breakout"]) & (~df["danger"])]
    print(f"\n=== NEAR-SIGNALS — IN UPTREND, AWAIT BREAKOUT ({len(near)}) ===")
    if len(near) > 0:
        cols = ["ticker", "close", "above_50ma_pct", "above_200ma_pct"]
        print(near[cols].to_string(index=False))

    # Danger names (stay out)
    danger = df[df["danger"]]
    print(f"\n=== DANGER — STAY OUT ({len(danger)}) ===")
    if len(danger) > 0:
        cols = ["ticker", "close", "above_200ma_pct"]
        print(danger[cols].to_string(index=False))

    # Healthy uptrend but missing 1 cond
    healthy_not_setup = df[df["stacked"] & (~df["danger"]) & (~df["ema50_rising"])]
    print(f"\n=== STACKED BUT EMA50 NOT RISING (consolidation) ({len(healthy_not_setup)}) ===")
    if len(healthy_not_setup) > 0:
        cols = ["ticker", "close", "above_50ma_pct"]
        print(healthy_not_setup[cols].to_string(index=False))

    out_path = Path(__file__).parent / "scan_v5_today.csv"
    df.to_csv(out_path, index=False)
    print(f"\nSaved -> {out_path}")
    print(f"\nUniverse: {len(df)} tickers, Entries: {len(entries)}, Near: {len(near)}, Danger: {len(danger)}")


if __name__ == "__main__":
    main()
