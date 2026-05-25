"""Volatility-scaled position sizing — Moskowitz/Ooi/Pedersen 2012 finding.

The research showed time series momentum returns are LARGELY DRIVEN by volatility
scaling, not the momentum itself. Implementation:

  target_portfolio_vol = 15% annualized (typical for CTA funds)
  position_size = (target_vol / asset_vol) * base_allocation

  asset_vol = 20-day stdev of daily returns, annualized via sqrt(252)

When asset vol is high (TSLA in turmoil), we trade SMALLER.
When asset vol is low (KO during stable run), we trade BIGGER.

Critically: vol-scaling adjusts at the TIME of entry AND continuously through the trade.
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
class VSParams:
    initial_capital: float = 100_000.0
    target_portfolio_vol: float = 0.15  # 15% annualized
    max_concurrent: int = 10
    max_position_pct: float = 0.40       # cap any single position at 40% of equity
    commission_pct: float = 0.0005
    slippage_bps: float = 2.0
    atr_len: int = 14
    atr_trail_mult: float = 10.0
    atr_stop_mult: float = 2.0
    vol_lookback: int = 20
    max_trade_bars: int = 250


@dataclass
class Position:
    ticker: str
    entry_date: pd.Timestamp
    entry_price: float
    qty: int
    initial_stop: float
    trail_stop: float
    high_since_entry: float
    bars_in_trade: int = 0


def precompute(df: pd.DataFrame, p: VSParams) -> pd.DataFrame:
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
    # Annualized 20-day volatility of log returns
    log_ret = np.log(o["close"] / o["close"].shift(1))
    o["vol_20d_ann"] = log_ret.rolling(p.vol_lookback).std() * np.sqrt(252)
    return o.dropna()


def run_vs_portfolio(tickers: list[str], p: VSParams, period: str = "10y") -> dict:
    all_data = {}
    for tk in tickers:
        try:
            df = load_ohlcv(tk, period=period)
            if len(df) >= 300:
                all_data[tk] = precompute(df, p)
        except Exception:
            pass

    if not all_data:
        return {}

    master_dates = sorted(set().union(*[set(df.index) for df in all_data.values()]))
    positions: dict[str, Position] = {}
    cash = p.initial_capital
    eq_hist = []
    trades = []

    for date in master_dates:
        # Exits
        for tk in list(positions.keys()):
            pos = positions[tk]
            df = all_data[tk]
            if date not in df.index: continue
            bar = df.loc[date]
            pos.bars_in_trade += 1
            pos.high_since_entry = max(pos.high_since_entry, bar["high"])
            chandelier = pos.high_since_entry - bar["atr"] * p.atr_trail_mult
            pos.trail_stop = max(pos.trail_stop, chandelier)
            exit_reason, exit_price = None, float("nan")
            if bar["low"] <= pos.trail_stop:
                exit_reason = "TrailExit"; exit_price = pos.trail_stop * (1 - p.slippage_bps / 10000)
            elif bool(bar["danger"]):
                exit_reason = "DangerExit"; exit_price = bar["close"] * (1 - p.slippage_bps / 10000)
            elif pos.bars_in_trade >= p.max_trade_bars:
                exit_reason = "TimeExit"; exit_price = bar["close"] * (1 - p.slippage_bps / 10000)
            if exit_reason:
                proceeds = exit_price * pos.qty * (1 - p.commission_pct)
                pnl = proceeds - pos.entry_price * pos.qty
                cash += proceeds
                trades.append({"ticker": tk, "pnl": pnl, "reason": exit_reason})
                del positions[tk]

        marked = sum(all_data[tk].loc[date]["close"] * pos.qty
                     for tk, pos in positions.items() if date in all_data[tk].index) if positions else 0.0
        equity = cash + marked

        # New entries — vol-scaled sizing
        candidates = []
        for tk, df in all_data.items():
            if tk in positions or date not in df.index: continue
            bar = df.loc[date]
            if bool(bar["entry_signal"]) and not bool(bar["danger"]):
                candidates.append((tk, bar))
        candidates.sort(key=lambda x: (x[1]["close"] - x[1]["ema50"]) / x[1]["atr"] if x[1]["atr"] > 0 else 999)

        # Allocate based on inverse vol — each position contributes target_vol/N to portfolio
        # Effective per-position vol target = target_portfolio_vol / sqrt(N positions)
        # For simplicity: target_position_vol_dollar = target_portfolio_vol * equity / max_concurrent
        # Then qty = target_dollar_vol / (asset_vol * price)

        per_pos_vol_dollar = p.target_portfolio_vol * equity / p.max_concurrent

        for tk, bar in candidates:
            if len(positions) >= p.max_concurrent: break
            close = bar["close"]
            asset_vol = bar.get("vol_20d_ann", 0.20)
            if asset_vol < 0.05 or asset_vol > 2.0 or np.isnan(asset_vol):
                continue  # skip extreme vols
            # Position size targets per_pos_vol_dollar of dollar volatility
            dollar_vol_per_share = asset_vol * close
            target_qty = per_pos_vol_dollar / dollar_vol_per_share
            qty = int(math.floor(target_qty))

            # Cap by max position size
            max_qty_by_cap = int(math.floor(equity * p.max_position_pct / close))
            qty = min(qty, max_qty_by_cap)

            init_stop = max(close - bar["atr"] * p.atr_stop_mult, bar["ema50"])
            if init_stop >= close or qty < 1:
                continue
            fill = close * (1 + p.slippage_bps / 10000)
            cost = fill * qty * (1 + p.commission_pct)
            if cost > cash:
                qty = int(math.floor(cash * 0.95 / (fill * (1 + p.commission_pct))))
                if qty < 1: continue
                cost = fill * qty * (1 + p.commission_pct)
                if cost > cash: continue
            cash -= cost
            positions[tk] = Position(ticker=tk, entry_date=date, entry_price=fill, qty=qty,
                                     initial_stop=init_stop, trail_stop=init_stop, high_since_entry=bar["high"])

        marked = sum(all_data[tk].loc[date]["close"] * pos.qty
                     for tk, pos in positions.items() if date in all_data[tk].index) if positions else 0.0
        eq_hist.append({"date": date, "equity": cash + marked})

    eq_df = pd.DataFrame(eq_hist).set_index("date")
    if eq_df.empty: return {}
    final = eq_df["equity"].iloc[-1]
    net_pct = (final - p.initial_capital) / p.initial_capital * 100
    rm = eq_df["equity"].cummax()
    dd_pct = ((eq_df["equity"] / rm - 1) * 100).min()
    days = (eq_df.index[-1] - eq_df.index[0]).days
    years = days / 365.25 if days > 0 else 1
    cagr = ((final / p.initial_capital) ** (1/years) - 1) * 100 if final > 0 else 0
    ret = eq_df["equity"].pct_change().dropna()
    sharpe = (ret.mean() / ret.std() * np.sqrt(252)) if len(ret) > 1 and ret.std() > 0 else 0
    wins = [t for t in trades if t["pnl"] > 0]
    return {
        "total_trades": len(trades), "wins": len(wins),
        "win_rate": len(wins) / len(trades) * 100 if trades else 0,
        "net_pct": net_pct, "cagr": cagr, "max_dd_pct": abs(dd_pct), "sharpe": sharpe,
        "final": final,
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
    print("Volatility-scaled portfolio backtest\n")
    for label, p in [
        ("target_vol=10% (conservative)",  VSParams(target_portfolio_vol=0.10)),
        ("target_vol=15% (CTA standard)",  VSParams(target_portfolio_vol=0.15)),
        ("target_vol=20% (aggressive)",    VSParams(target_portfolio_vol=0.20)),
        ("target_vol=30% (very aggressive)",VSParams(target_portfolio_vol=0.30)),
        ("vol=15% + max_conc=5",           VSParams(target_portfolio_vol=0.15, max_concurrent=5)),
        ("vol=15% + max_conc=15",          VSParams(target_portfolio_vol=0.15, max_concurrent=15)),
        ("vol=15% + max_position=20%",     VSParams(target_portfolio_vol=0.15, max_position_pct=0.20)),
    ]:
        r = run_vs_portfolio(UNIVERSE, p, period="10y")
        if r:
            print(f"  {label:42s} | trades={r['total_trades']:3d}  win%={r['win_rate']:.1f}  net%={r['net_pct']:6.0f}  CAGR={r['cagr']:5.1f}  DD={r['max_dd_pct']:5.1f}  Sharpe={r['sharpe']:.2f}")
