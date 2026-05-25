"""Walk-forward validation for portfolio mode.

Critical — single-ticker walk-forward passed, but does PORTFOLIO mode also
generalize out-of-sample, or are we curve-fitting on the basket choice?
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from portfolio import PortfolioParams, run_portfolio

# Same universe used in portfolio.py main
UNIVERSE = sorted(set([
    "AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSLA", "AVGO",
    "AMD", "MU", "ADBE", "ORCL", "CRM", "NFLX", "INTC", "QCOM",
    "JPM", "GS", "BAC", "WFC", "C", "MS",
    "XOM", "CVX", "COP",
    "JNJ", "UNH", "LLY",
    "BA", "CAT", "GE", "HON", "LMT", "RTX", "NOC",
    "WMT", "KO", "PG", "MCD", "HD",
    "SPY", "QQQ", "IWM",
]))


def run_window(tickers: list[str], params: PortfolioParams, period: str, start: str, end: str) -> dict:
    """Run portfolio backtest on a date-windowed period. Filters universe data by date."""
    # We'll temporarily monkey-patch by filtering loaded data
    import master_strategy
    from data import load_ohlcv

    # We need to do this differently — modify portfolio.py to accept date range,
    # OR load data once and slice. Simplest: load each ticker, slice, then run.
    # Since portfolio.py builds its own all_data internally, we need a variant.
    # Easier: create a new function that takes pre-filtered data.

    # Hack: temporarily filter the load_ohlcv calls via slicing in our caller.
    # Better: rebuild precompute path locally.

    # For now, the simplest approach: run portfolio with period covering both,
    # then slice the resulting equity curve. But that doesn't simulate properly
    # because trades from before the window can be open.
    # Let me write a clean window-aware version below.
    raise NotImplementedError("use run_portfolio_window instead")


def run_portfolio_window(tickers: list[str], params: PortfolioParams,
                          start_date: str, end_date: str, period: str = "max") -> dict:
    """Portfolio backtest restricted to a date window.

    Uses portfolio.run_portfolio() but filters data to the window first.
    Reuses precompute by importing portfolio module's internals.
    """
    import math
    import numpy as np
    from dataclasses import dataclass, field
    from portfolio import Position, precompute
    from data import load_ohlcv

    # Load + window-filter + precompute each ticker
    all_data = {}
    for tk in tickers:
        try:
            df = load_ohlcv(tk, period=period)
            df = df[(df.index >= start_date) & (df.index < end_date)]
            if len(df) >= 300:
                all_data[tk] = precompute(df, params)
        except Exception:
            pass

    if not all_data:
        return {}

    master_dates = sorted(set().union(*[set(df.index) for df in all_data.values()]))

    positions: dict[str, Position] = {}
    cash = params.initial_capital
    eq_hist = []
    trades = []

    for date in master_dates:
        # Exits first
        for tk in list(positions.keys()):
            pos = positions[tk]
            df = all_data[tk]
            if date not in df.index:
                continue
            bar = df.loc[date]
            close, high, low = bar["close"], bar["high"], bar["low"]
            bar_atr = bar["atr"]
            pos.bars_in_trade += 1
            pos.high_since_entry = max(pos.high_since_entry, high)
            chandelier = pos.high_since_entry - bar_atr * params.atr_trail_mult
            pos.trail_stop = max(pos.trail_stop, chandelier)
            exit_reason, exit_price = None, float("nan")
            if low <= pos.trail_stop:
                exit_reason = "TrailExit"; exit_price = pos.trail_stop * (1 - params.slippage_bps / 10000)
            elif bool(bar["danger"]):
                exit_reason = "DangerExit"; exit_price = close * (1 - params.slippage_bps / 10000)
            elif pos.bars_in_trade >= params.max_trade_bars:
                exit_reason = "TimeExit"; exit_price = close * (1 - params.slippage_bps / 10000)
            if exit_reason:
                proceeds = exit_price * pos.qty * (1 - params.commission_pct)
                pnl = proceeds - pos.entry_price * pos.qty
                cash += proceeds
                trades.append({"ticker": tk, "pnl": pnl, "bars": pos.bars_in_trade, "reason": exit_reason})
                del positions[tk]

        marked = sum(all_data[tk].loc[date]["close"] * pos.qty
                     for tk, pos in positions.items() if date in all_data[tk].index) if positions else 0.0
        equity = cash + marked

        # New entries
        candidates = []
        for tk, df in all_data.items():
            if tk in positions or date not in df.index:
                continue
            bar = df.loc[date]
            if not (bool(bar["entry_signal"]) and not bool(bar["danger"])):
                continue
            close = bar["close"]
            atr_dist = (close - bar["ema50"]) / bar["atr"] if bar["atr"] > 0 else 0
            candidates.append((tk, bar, atr_dist))
        candidates.sort(key=lambda x: x[2])

        for tk, bar, _ in candidates:
            if len(positions) >= params.max_concurrent:
                break
            close = bar["close"]
            init_stop = max(close - bar["atr"] * params.atr_stop_mult, bar["ema50"])
            if init_stop >= close:
                continue
            risk_cash = equity * params.risk_pct_equity / 100
            qty = int(math.floor(risk_cash / (close - init_stop)))
            if qty < 1:
                continue
            fill = close * (1 + params.slippage_bps / 10000)
            cost = fill * qty * (1 + params.commission_pct)
            if cost > cash:
                qty = int(math.floor(cash * 0.95 / (fill * (1 + params.commission_pct))))
                if qty < 1: continue
                cost = fill * qty * (1 + params.commission_pct)
                if cost > cash: continue
            cash -= cost
            positions[tk] = Position(
                ticker=tk, entry_idx=0, entry_date=date, entry_price=fill, qty=qty,
                initial_stop=init_stop, trail_stop=init_stop, high_since_entry=bar["high"],
            )

        marked = sum(all_data[tk].loc[date]["close"] * pos.qty
                     for tk, pos in positions.items() if date in all_data[tk].index) if positions else 0.0
        eq_hist.append({"date": date, "equity": cash + marked})

    eq_df = pd.DataFrame(eq_hist).set_index("date")
    if eq_df.empty:
        return {}
    final = eq_df["equity"].iloc[-1]
    net_pct = (final - params.initial_capital) / params.initial_capital * 100
    rm = eq_df["equity"].cummax()
    dd_pct = ((eq_df["equity"] / rm - 1) * 100).min()
    days = (eq_df.index[-1] - eq_df.index[0]).days
    years = days / 365.25 if days > 0 else 1
    cagr = ((final / params.initial_capital) ** (1/years) - 1) * 100 if final > 0 else 0
    ret = eq_df["equity"].pct_change().dropna()
    sharpe = (ret.mean() / ret.std() * np.sqrt(252)) if len(ret) > 1 and ret.std() > 0 else 0
    wins = [t for t in trades if t["pnl"] > 0]
    return {
        "trades": len(trades), "wins": len(wins),
        "win_rate": len(wins) / len(trades) * 100 if trades else 0,
        "net_pct": net_pct, "cagr": cagr, "max_dd_pct": abs(dd_pct), "sharpe": sharpe,
    }


def main():
    splits = [
        ("EARLY (2016-2020)", "2016-01-01", "2020-01-01"),
        ("LATE  (2020-2026)", "2020-01-01", "2026-06-01"),
        ("TRAIN (2014-2020)", "2014-01-01", "2020-01-01"),
        ("TEST  (2020-2026)", "2020-01-01", "2026-06-01"),
    ]
    configs = {
        "baseline (1%, max 5)":      PortfolioParams(risk_pct_equity=1.0, max_concurrent=5),
        "aggressive (2%, max 5)":    PortfolioParams(risk_pct_equity=2.0, max_concurrent=5),
        "wide (1%, max 10)":         PortfolioParams(risk_pct_equity=1.0, max_concurrent=10),
        "conservative (0.5%, max 10)": PortfolioParams(risk_pct_equity=0.5, max_concurrent=10),
    }

    for cfg_name, p in configs.items():
        print(f"\n=== {cfg_name} ===")
        for win_name, start, end in splits:
            r = run_portfolio_window(UNIVERSE, p, start, end)
            if r:
                print(f"  {win_name}: trades={r['trades']:3d}  win%={r['win_rate']:.1f}  net%={r['net_pct']:7.1f}  CAGR={r['cagr']:5.1f}  DD={r['max_dd_pct']:5.1f}  Sharpe={r['sharpe']:.2f}")


if __name__ == "__main__":
    main()
