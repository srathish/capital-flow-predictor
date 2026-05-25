"""Portfolio-mode backtester.

Instead of $100k per ticker (parallel single-ticker accounts), run ONE $100k
account across the entire universe. Max N concurrent positions. New signals
compete for capital.

This unlocks cross-ticker compounding - when NVDA is in a multi-year run AND
AAPL signals fresh, we can be in both, sharing the equity base.

This is the biggest single architectural change we can test.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from data import load_ohlcv
from master_strategy import ema, atr


@dataclass
class PortfolioParams:
    initial_capital: float = 100_000.0
    risk_pct_equity: float = 1.0          # smaller per-trade risk because we run multiple positions
    max_concurrent: int = 5                # max positions open at once
    commission_pct: float = 0.0005
    slippage_bps: float = 2.0
    atr_len: int = 14
    atr_stop_mult: float = 2.0
    atr_trail_mult: float = 10.0
    pyramid_max: int = 3
    pyramid_spacing_atr: float = 2.0
    pyramid_size_pct: float = 0.5
    max_trade_bars: int = 250
    rank_by: str = "atr_distance"  # how to choose when multiple signals compete: atr_distance / first


@dataclass
class Position:
    ticker: str
    entry_idx: int
    entry_date: pd.Timestamp
    entry_price: float
    qty: int
    initial_stop: float
    trail_stop: float
    high_since_entry: float
    bars_in_trade: int = 0
    num_entries: int = 1
    last_entry_price: float = float("nan")
    entries: list = field(default_factory=list)


def precompute(df: pd.DataFrame, p: PortfolioParams) -> pd.DataFrame:
    o = df.copy()
    o["ema8"] = ema(o["close"], 8)
    o["ema21"] = ema(o["close"], 21)
    o["ema50"] = ema(o["close"], 50)
    o["ema200"] = ema(o["close"], 200)
    o["atr"] = atr(o, p.atr_len)
    o["stacked"] = (o["ema8"] > o["ema21"]) & (o["ema21"] > o["ema50"]) & (o["ema50"] > o["ema200"])
    o["ema50_rising"] = o["ema50"] > o["ema50"].shift(10)
    o["entry_signal"] = o["stacked"] & o["ema50_rising"] & (o["close"] > o["high"].shift(1))
    o["stage4"] = (o["close"] < o["ema200"]) & (o["ema200"] < o["ema200"].shift(20))
    o["bear_stack"] = (o["ema8"] < o["ema21"]) & (o["ema21"] < o["ema50"]) & (o["ema50"] < o["ema200"])
    o["danger"] = o["stage4"] | o["bear_stack"]
    return o.dropna()


def run_portfolio(tickers: list[str], p: PortfolioParams, period: str = "10y") -> dict:
    """Backtest the strategy as a single portfolio with shared capital."""
    # Load all data
    all_data = {}
    for tk in tickers:
        try:
            df = load_ohlcv(tk, period=period)
            if len(df) >= 300:
                all_data[tk] = precompute(df, p)
        except Exception as e:
            print(f"  ! {tk}: {e}")

    if not all_data:
        return {}

    # Build master date index (union of all)
    master_dates = sorted(set().union(*[set(df.index) for df in all_data.values()]))

    positions: dict[str, Position] = {}
    cash = p.initial_capital
    eq_hist = []
    trades = []
    realized_pnl = 0.0

    for date in master_dates:
        # === Check exits on all open positions first ===
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
            chandelier = pos.high_since_entry - bar_atr * p.atr_trail_mult
            pos.trail_stop = max(pos.trail_stop, chandelier)

            exit_reason, exit_price = None, float("nan")
            if low <= pos.trail_stop:
                exit_reason = "TrailExit"; exit_price = pos.trail_stop * (1 - p.slippage_bps / 10000)
            elif bool(bar["danger"]):
                exit_reason = "DangerExit"; exit_price = close * (1 - p.slippage_bps / 10000)
            elif pos.bars_in_trade >= p.max_trade_bars:
                exit_reason = "TimeExit"; exit_price = close * (1 - p.slippage_bps / 10000)

            if exit_reason:
                proceeds = exit_price * pos.qty * (1 - p.commission_pct)
                cost_basis = pos.entry_price * pos.qty
                pnl = proceeds - cost_basis
                pnl_pct = (exit_price - pos.entry_price) / pos.entry_price * 100
                cash += proceeds  # add proceeds back to cash
                realized_pnl += pnl
                trades.append({
                    "ticker": pos.ticker,
                    "entry_date": pos.entry_date,
                    "exit_date": date,
                    "entry_price": pos.entry_price,
                    "exit_price": exit_price,
                    "qty": pos.qty,
                    "pnl": pnl,
                    "pnl_pct": pnl_pct,
                    "reason": exit_reason,
                    "bars": pos.bars_in_trade,
                })
                del positions[tk]

        # === Compute current equity for sizing decisions ===
        marked = sum(
            all_data[tk].loc[date]["close"] * pos.qty
            for tk, pos in positions.items()
            if date in all_data[tk].index
        ) if positions else 0.0
        equity = cash + marked

        # === Look for new entries ===
        candidates = []
        for tk, df in all_data.items():
            if tk in positions or date not in df.index:
                continue
            bar = df.loc[date]
            if not (bool(bar["entry_signal"]) and not bool(bar["danger"])):
                continue
            # Compute distance from EMA50 as ranking score (closer = better quality)
            close = bar["close"]
            atr_dist = (close - bar["ema50"]) / bar["atr"] if bar["atr"] > 0 else 0
            candidates.append((tk, bar, atr_dist))

        # Sort candidates (lowest atr_distance = tightest base = highest quality)
        if p.rank_by == "atr_distance":
            candidates.sort(key=lambda x: x[2])
        # else first-come-first-served (data order)

        # Try to open new positions (up to max_concurrent total)
        for tk, bar, _ in candidates:
            if len(positions) >= p.max_concurrent:
                break
            close = bar["close"]
            init_stop = max(close - bar["atr"] * p.atr_stop_mult, bar["ema50"])
            if init_stop >= close:
                continue
            risk_cash = equity * p.risk_pct_equity / 100
            qty = int(math.floor(risk_cash / (close - init_stop)))
            if qty < 1:
                continue
            fill = close * (1 + p.slippage_bps / 10000)
            cost = fill * qty * (1 + p.commission_pct)
            if cost > cash:
                # Can't afford this signal — try smaller qty
                qty = int(math.floor(cash * 0.95 / (fill * (1 + p.commission_pct))))
                if qty < 1:
                    continue
                cost = fill * qty * (1 + p.commission_pct)
                if cost > cash:
                    continue
            cash -= cost
            positions[tk] = Position(
                ticker=tk,
                entry_idx=0,
                entry_date=date,
                entry_price=fill,
                qty=qty,
                initial_stop=init_stop,
                trail_stop=init_stop,
                high_since_entry=bar["high"],
                bars_in_trade=0,
                num_entries=1,
                last_entry_price=fill,
                entries=[(fill, qty)],
            )

        # === Mark-to-market equity ===
        marked = sum(
            all_data[tk].loc[date]["close"] * pos.qty
            for tk, pos in positions.items()
            if date in all_data[tk].index
        ) if positions else 0.0
        eq_hist.append({"date": date, "equity": cash + marked, "cash": cash, "positions": len(positions)})

    # === Build result ===
    eq_df = pd.DataFrame(eq_hist).set_index("date")
    final_equity = eq_df["equity"].iloc[-1] if not eq_df.empty else p.initial_capital
    net = final_equity - p.initial_capital
    net_pct = net / p.initial_capital * 100
    running_max = eq_df["equity"].cummax()
    dd_pct = ((eq_df["equity"] / running_max - 1) * 100).min()
    days = (eq_df.index[-1] - eq_df.index[0]).days
    years = days / 365.25 if days > 0 else 1
    cagr = ((final_equity / p.initial_capital) ** (1/years) - 1) * 100 if final_equity > 0 else 0
    daily_ret = eq_df["equity"].pct_change().dropna()
    sharpe = (daily_ret.mean() / daily_ret.std() * np.sqrt(252)) if len(daily_ret) > 1 and daily_ret.std() > 0 else 0

    trades_df = pd.DataFrame(trades)
    wins = trades_df[trades_df["pnl"] > 0] if not trades_df.empty else pd.DataFrame()
    losses = trades_df[trades_df["pnl"] <= 0] if not trades_df.empty else pd.DataFrame()

    return {
        "total_trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": len(wins) / len(trades) * 100 if trades else 0,
        "net_profit": net,
        "net_profit_pct": net_pct,
        "cagr": cagr,
        "max_drawdown_pct": abs(dd_pct),
        "sharpe": sharpe,
        "final_equity": final_equity,
        "equity_curve": eq_df,
        "trades_df": trades_df,
        "max_concurrent_seen": eq_df["positions"].max(),
        "avg_concurrent": eq_df["positions"].mean(),
    }


if __name__ == "__main__":
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

    print(f"Portfolio backtest on {len(UNIVERSE)} tickers, 10y\n")

    for label, p in [
        ("baseline (1% risk, max 5 concurrent)", PortfolioParams(risk_pct_equity=1.0, max_concurrent=5)),
        ("aggressive (2% risk, max 5)",          PortfolioParams(risk_pct_equity=2.0, max_concurrent=5)),
        ("more positions (1% risk, max 10)",     PortfolioParams(risk_pct_equity=1.0, max_concurrent=10)),
        ("fewer positions (2% risk, max 3)",     PortfolioParams(risk_pct_equity=2.0, max_concurrent=3)),
        ("very wide (1% risk, max 20)",          PortfolioParams(risk_pct_equity=1.0, max_concurrent=20)),
        ("conservative (0.5%, max 10)",          PortfolioParams(risk_pct_equity=0.5, max_concurrent=10)),
    ]:
        r = run_portfolio(UNIVERSE, p, period="10y")
        if not r:
            continue
        years = (r["equity_curve"].index[-1] - r["equity_curve"].index[0]).days / 365.25
        print(f"--- {label} ---")
        print(f"  Trades: {r['total_trades']}   WinRate: {r['win_rate']:.1f}%")
        print(f"  Net: ${r['net_profit']:,.0f} ({r['net_profit_pct']:+.1f}%)   CAGR: {r['cagr']:.1f}%")
        print(f"  Max DD: {r['max_drawdown_pct']:.1f}%   Sharpe: {r['sharpe']:.2f}")
        print(f"  Avg concurrent: {r['avg_concurrent']:.1f}   Max seen: {r['max_concurrent_seen']}")
        print()
