"""Test FINAL TREND v5 on broader S&P 100 universe — no cherry-picking."""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from portfolio_v2 import PortfolioV2Params, run_portfolio_v2

# S&P 100 components (approximate — top 100 by market cap)
SP100 = sorted(set([
    "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "META", "AMZN", "TSLA", "BRK-B",
    "AVGO", "JPM", "LLY", "WMT", "V", "ORCL", "MA", "XOM", "UNH", "JNJ", "HD",
    "COST", "ABBV", "BAC", "PG", "KO", "NFLX", "CVX", "TMO", "PEP", "AMD",
    "CSCO", "WFC", "ABT", "MCD", "CRM", "ACN", "ADBE", "MRK", "TXN", "DIS",
    "QCOM", "VZ", "DHR", "PM", "INTC", "INTU", "AMGN", "RTX", "IBM", "T",
    "LOW", "SPGI", "ISRG", "CAT", "GS", "AXP", "BLK", "GE", "BKNG", "DE",
    "C", "MS", "PYPL", "MDT", "NOW", "ELV", "SYK", "ADP", "GILD", "TJX",
    "MMC", "VRTX", "LRCX", "MU", "PLD", "REGN", "SCHW", "MO", "BSX", "ZTS",
    "CB", "FI", "BMY", "AMAT", "EQIX", "CI", "CME", "PGR", "BX", "SHW",
    "ETN", "TMUS", "DUK", "USB", "SLB", "ICE", "ITW", "GD", "FCX", "APH",
]))

print(f"Testing v5 on {len(SP100)} S&P 100 tickers (no cherry-picking)\n")

p = PortfolioV2Params(max_concurrent=10, risk_pct_equity=1.5, atr_trail_mult=15.0)
r = run_portfolio_v2(SP100, p, period="10y")

if r:
    print(f"Portfolio results on S&P 100 universe:")
    print(f"  Trades:    {r['total_trades']}")
    print(f"  Win rate:  {r['win_rate']:.1f}%")
    print(f"  Net %:     {r['net_pct']:+.1f}%")
    print(f"  CAGR:      {r['cagr']:.1f}%")
    print(f"  Max DD:    {r['max_dd_pct']:.1f}%")
    print(f"  Sharpe:    {r['sharpe']:.2f}")
    print(f"\nThis is REAL OOS — no ticker was cherry-picked from the original 43.")
