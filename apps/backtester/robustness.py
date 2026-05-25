"""Robustness test — run the winning pure-trend variant on 50+ diverse tickers.

If it only works on a cherry-picked basket it's not a real strategy.
Must hold up across sectors, market caps, and regime types.
"""

from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from data import load_ohlcv
from pure_trend import PureParams, run_pure_trend

# 50+ diversified tickers
UNIVERSE = sorted(set([
    # Mega-cap tech
    "AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSLA", "AVGO",
    "AMD", "MU", "ADBE", "ORCL", "CRM", "NFLX", "INTC", "QCOM",
    # Cyclicals
    "JPM", "GS", "BAC", "WFC", "C", "MS",
    # Energy
    "XOM", "CVX", "COP", "SLB",
    # Healthcare
    "JNJ", "UNH", "PFE", "ABBV", "LLY",
    # Industrials
    "BA", "CAT", "GE", "HON", "LMT", "RTX", "NOC",
    # Consumer
    "WMT", "KO", "PG", "MCD", "HD", "NKE", "SBUX",
    # ETFs (sector + broad)
    "SPY", "QQQ", "IWM", "XLK", "XLF", "XLE", "XLV", "XLI", "XLU",
    # Higher vol / cyclical names
    "ROKU", "SHOP", "SQ", "PLTR",
    # Speculative growth (recent)
    "COIN", "RIVN",
]))


def main():
    # The winning variant: 5xATR trail, pyramid 3, 2% risk
    # (sweet spot of profit/Sharpe per ablation + walk-forward)
    winner = PureParams(atr_trail_mult=5.0, risk_pct_equity=2.0)
    conservative = PureParams(atr_trail_mult=5.0, risk_pct_equity=1.0)
    aggressive = PureParams(atr_trail_mult=10.0, risk_pct_equity=2.0)

    for label, params in [
        ("CONSERVATIVE: 5xATR trail, 1% risk", conservative),
        ("RECOMMENDED:  5xATR trail, 2% risk", winner),
        ("AGGRESSIVE:   10xATR trail, 2% risk", aggressive),
    ]:
        print(f"\n\n========= {label} =========")
        rows = []
        for tk in UNIVERSE:
            try:
                df = load_ohlcv(tk, period="10y")
                if len(df) < 300:
                    continue
                r = run_pure_trend(df, params, ticker=tk)
                rows.append({
                    "ticker": tk,
                    "trades": r.total_trades,
                    "win%": round(r.win_rate, 1),
                    "net%": round(r.net_profit_pct, 1),
                    "cagr%": round(r.cagr, 2),
                    "dd%": round(r.max_drawdown_pct, 1),
                    "sharpe": round(r.sharpe, 2),
                    "bh%": round(r.buy_hold_return_pct, 0),
                })
            except Exception as e:
                print(f"  ! {tk}: {e}")

        df = pd.DataFrame(rows)
        if df.empty:
            continue

        # Stats
        print(df.sort_values("net%", ascending=False).to_string(index=False))

        # Summary
        winners = df[df["net%"] > 0]
        losers = df[df["net%"] <= 0]
        beat_bh = df[df["net%"] > df["bh%"]]
        positive_sharpe = df[df["sharpe"] > 0]
        sharpe_gt_05 = df[df["sharpe"] > 0.5]

        print(f"\n--- {label} SUMMARY (n={len(df)}) ---")
        print(f"  Positive net%:      {len(winners):2d} / {len(df)} = {len(winners)/len(df)*100:.0f}%")
        print(f"  Beat buy-and-hold:  {len(beat_bh):2d} / {len(df)} = {len(beat_bh)/len(df)*100:.0f}%")
        print(f"  Positive Sharpe:    {len(positive_sharpe):2d} / {len(df)} = {len(positive_sharpe)/len(df)*100:.0f}%")
        print(f"  Sharpe > 0.5:       {len(sharpe_gt_05):2d} / {len(df)} = {len(sharpe_gt_05)/len(df)*100:.0f}%")
        print(f"  Mean / median net%: {df['net%'].mean():.1f} / {df['net%'].median():.1f}")
        print(f"  Mean / median CAGR: {df['cagr%'].mean():.2f}% / {df['cagr%'].median():.2f}%")
        print(f"  Mean / median DD:   {df['dd%'].mean():.1f}% / {df['dd%'].median():.1f}%")
        print(f"  Mean / median Sharpe: {df['sharpe'].mean():.2f} / {df['sharpe'].median():.2f}")
        print(f"  Worst single ticker: {df['net%'].min():.1f}%  on {df.loc[df['net%'].idxmin(), 'ticker']}")
        print(f"  Best single ticker:  {df['net%'].max():.1f}%  on {df.loc[df['net%'].idxmax(), 'ticker']}")

        out_path = Path(__file__).parent / f"results_robustness_{label.split(':')[0].lower()}.csv"
        df.to_csv(out_path, index=False)


if __name__ == "__main__":
    main()
