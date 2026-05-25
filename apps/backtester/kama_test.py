"""KAMA entry test - Kaufman's Adaptive Moving Average.

Research (BTC backtest): KAMA reduced whipsaws from 38% (EMA-20) to 14% (KAMA-20),
profit factor 1.21 -> 1.48.

Replace our EMA8/21 with KAMA(10, fast=2, slow=30) and see if whipsaw drop
shows up in our portfolio backtest.
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


def kama(close: pd.Series, length: int = 10, fast: int = 2, slow: int = 30) -> pd.Series:
    """Kaufman's Adaptive Moving Average."""
    change = (close - close.shift(length)).abs()
    volatility = close.diff().abs().rolling(length).sum()
    er = (change / volatility).fillna(0)  # efficiency ratio
    fast_sc = 2 / (fast + 1)
    slow_sc = 2 / (slow + 1)
    sc = (er * (fast_sc - slow_sc) + slow_sc) ** 2

    out = pd.Series(np.nan, index=close.index)
    out.iloc[length] = close.iloc[length]
    for i in range(length + 1, len(close)):
        prev = out.iloc[i-1]
        if pd.isna(prev):
            out.iloc[i] = close.iloc[i]
        else:
            out.iloc[i] = prev + sc.iloc[i] * (close.iloc[i] - prev)
    return out


@dataclass
class KAMAParams:
    initial_capital: float = 100_000.0
    risk_pct_equity: float = 1.5
    max_concurrent: int = 10
    commission_pct: float = 0.0005
    slippage_bps: float = 2.0
    atr_len: int = 14
    atr_trail_mult: float = 15.0
    atr_stop_mult: float = 2.0
    max_trade_bars: int = 250
    use_kama: bool = True  # if false, falls back to EMA


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


def precompute(df: pd.DataFrame, p: KAMAParams) -> pd.DataFrame:
    o = df.copy()
    if p.use_kama:
        o["fast"] = kama(o["close"], 10, 2, 30)
        o["mid"]  = ema(o["close"], 21)
    else:
        o["fast"] = ema(o["close"], 8)
        o["mid"]  = ema(o["close"], 21)
    o["ema50"]  = ema(o["close"], 50)
    o["ema200"] = ema(o["close"], 200)
    o["atr"]    = atr(o, p.atr_len)
    o["stacked"]      = (o["fast"] > o["mid"]) & (o["mid"] > o["ema50"]) & (o["ema50"] > o["ema200"])
    o["ema50_rising"] = o["ema50"] > o["ema50"].shift(10)
    o["entry_signal"] = o["stacked"] & o["ema50_rising"] & (o["close"] > o["high"].shift(1))
    o["stage4"]       = (o["close"] < o["ema200"]) & (o["ema200"] < o["ema200"].shift(20))
    o["bear_stack"]   = (o["fast"] < o["mid"]) & (o["mid"] < o["ema50"]) & (o["ema50"] < o["ema200"])
    o["danger"]       = o["stage4"] | o["bear_stack"]
    return o.dropna()


def run_kama(tickers, p: KAMAParams, period="10y") -> dict:
    all_data = {}
    for tk in tickers:
        try:
            df = load_ohlcv(tk, period=period)
            if len(df) >= 300:
                all_data[tk] = precompute(df, p)
        except Exception:
            pass
    if not all_data: return {}

    master_dates = sorted(set().union(*[set(df.index) for df in all_data.values()]))
    positions = {}; cash = p.initial_capital; eq_hist = []; trades = []

    for date in master_dates:
        for tk in list(positions.keys()):
            pos = positions[tk]
            df = all_data[tk]
            if date not in df.index: continue
            bar = df.loc[date]
            pos.bars_in_trade += 1
            pos.high_since_entry = max(pos.high_since_entry, bar["high"])
            chand = pos.high_since_entry - bar["atr"] * p.atr_trail_mult
            pos.trail_stop = max(pos.trail_stop, chand)
            er, ep = None, float("nan")
            if bar["low"] <= pos.trail_stop:
                er = "TrailExit"; ep = pos.trail_stop * (1 - p.slippage_bps / 10000)
            elif bool(bar["danger"]):
                er = "DangerExit"; ep = bar["close"] * (1 - p.slippage_bps / 10000)
            elif pos.bars_in_trade >= p.max_trade_bars:
                er = "TimeExit"; ep = bar["close"] * (1 - p.slippage_bps / 10000)
            if er:
                proceeds = ep * pos.qty * (1 - p.commission_pct)
                pnl = proceeds - pos.entry_price * pos.qty
                cash += proceeds
                trades.append({"ticker": tk, "pnl": pnl, "reason": er})
                del positions[tk]

        marked = sum(all_data[tk].loc[date]["close"] * pos.qty
                     for tk, pos in positions.items() if date in all_data[tk].index) if positions else 0.0
        equity = cash + marked

        candidates = []
        for tk, df in all_data.items():
            if tk in positions or date not in df.index: continue
            bar = df.loc[date]
            if bool(bar["entry_signal"]) and not bool(bar["danger"]):
                candidates.append((tk, bar))
        candidates.sort(key=lambda x: (x[1]["close"] - x[1]["ema50"]) / x[1]["atr"] if x[1]["atr"] > 0 else 999)

        for tk, bar in candidates:
            if len(positions) >= p.max_concurrent: break
            close = bar["close"]
            init_stop = max(close - bar["atr"] * p.atr_stop_mult, bar["ema50"])
            if init_stop >= close: continue
            risk_cash = equity * p.risk_pct_equity / 100
            qty = int(math.floor(risk_cash / (close - init_stop)))
            if qty < 1: continue
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
    return {"trades": len(trades), "wins": len(wins),
            "win_rate": len(wins) / len(trades) * 100 if trades else 0,
            "net_pct": net_pct, "cagr": cagr, "max_dd_pct": abs(dd_pct), "sharpe": sharpe}


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
    print("KAMA vs EMA entry test\n")
    for label, p in [
        ("EMA baseline (8/21/50/200)",   KAMAParams(use_kama=False)),
        ("KAMA(10,2,30) + EMA 21/50/200", KAMAParams(use_kama=True)),
    ]:
        r = run_kama(UNIVERSE, p, period="10y")
        if r:
            print(f"  {label:38s} | trades={r['trades']:3d}  win%={r['win_rate']:5.1f}  net%={r['net_pct']:6.0f}  CAGR={r['cagr']:5.1f}  DD={r['max_dd_pct']:5.1f}  Sharpe={r['sharpe']:.2f}")
