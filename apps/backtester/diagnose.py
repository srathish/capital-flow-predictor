"""Trade-level diagnostic — find where the strategy is actually leaking.

Dumps every trade with exit reason, R-multiple, bars held, T1/T2 hit status.
Plus aggregated breakdowns so we can see WHERE the bleed comes from.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from data import load_ohlcv
from master_strategy import Params, run_backtest


def diagnose(ticker: str, period: str = "10y", params: Params | None = None):
    p = params or Params()
    df = load_ohlcv(ticker, period=period)
    result = run_backtest(df, p, ticker=ticker)

    print(f"\n========= {ticker} — {len(result.trades)} trades over {period} =========")
    print(f"Net profit:     ${result.net_profit:,.0f} ({result.net_profit_pct:+.1f}%)")
    print(f"Buy & hold:     {result.buy_hold_return_pct:+.1f}%")
    print(f"Win rate:       {result.win_rate:.1f}% ({result.wins}W / {result.losses}L)")
    print(f"Profit factor:  {result.profit_factor:.2f}")
    print(f"Avg win:        ${result.avg_win:,.0f}")
    print(f"Avg loss:       ${result.avg_loss:,.0f}")
    print(f"Max DD:         {result.max_drawdown_pct:.1f}%")
    print(f"Sharpe:         {result.sharpe:.2f}")
    print(f"CAGR:           {result.cagr:.2f}%")

    if not result.trades:
        return

    # Per-trade table
    trades_df = pd.DataFrame([{
        "entry": t.entry_date.date(),
        "exit": t.exit_date.date(),
        "bars": t.bars_in_trade,
        "entry$": round(t.entry_price, 2),
        "exit$": round(t.exit_price, 2),
        "pnl$": round(t.pnl, 0),
        "pnl%": round(t.pnl_pct, 1),
        "R": round(t.r_multiple, 2),
        "t1": "Y" if t.t1_hit else "-",
        "t2": "Y" if t.t2_hit else "-",
        "reason": t.exit_reason,
    } for t in result.trades])

    print("\n--- Trade ledger ---")
    print(trades_df.to_string(index=False))

    # === Aggregated breakdowns ===
    print("\n--- Exit reason breakdown ---")
    reason_counts = trades_df["reason"].value_counts()
    reason_pnl = trades_df.groupby("reason")["pnl$"].agg(["count", "mean", "sum"])
    print(reason_pnl)

    print("\n--- R-multiple distribution ---")
    r_buckets = pd.cut(trades_df["R"], bins=[-10, -2, -1, 0, 1, 2, 3, 5, 10, 100],
                       labels=["<-2R", "-2 to -1", "-1 to 0", "0-1R", "1-2R", "2-3R", "3-5R", "5-10R", ">10R"])
    print(r_buckets.value_counts().sort_index())

    print(f"\n--- T1/T2 hit rates ---")
    print(f"T1 (+2R) hit: {trades_df['t1'].value_counts().get('Y', 0)} / {len(trades_df)} = {trades_df['t1'].value_counts().get('Y', 0)/len(trades_df)*100:.0f}%")
    print(f"T2 (+3R) hit: {trades_df['t2'].value_counts().get('Y', 0)} / {len(trades_df)} = {trades_df['t2'].value_counts().get('Y', 0)/len(trades_df)*100:.0f}%")

    print(f"\n--- Bars in trade ---")
    print(f"Mean: {trades_df['bars'].mean():.0f}  Median: {trades_df['bars'].median():.0f}  Max: {trades_df['bars'].max()}")

    # Biggest single win vs biggest loss
    biggest_win = trades_df.loc[trades_df["pnl$"].idxmax()]
    biggest_loss = trades_df.loc[trades_df["pnl$"].idxmin()]
    print(f"\nBiggest win:  {biggest_win['entry']} → {biggest_win['exit']}  ${biggest_win['pnl$']:.0f} ({biggest_win['R']:.1f}R, {biggest_win['bars']} bars, exit={biggest_win['reason']})")
    print(f"Biggest loss: {biggest_loss['entry']} → {biggest_loss['exit']}  ${biggest_loss['pnl$']:.0f} ({biggest_loss['R']:.1f}R, {biggest_loss['bars']} bars, exit={biggest_loss['reason']})")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", default="NVDA")
    ap.add_argument("--period", default="10y")
    args = ap.parse_args()
    diagnose(args.ticker, args.period)
