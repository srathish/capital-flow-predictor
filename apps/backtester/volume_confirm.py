"""Volume-confirmation entry filter test.

Research: institutional breakouts often coincide with above-average volume.
Test if requiring entry-day volume > X * 20d avg adds edge.

Hypothesis: filters volume <= avg trades (likely false breakouts).
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
from master_strategy import ema, atr, sma


@dataclass
class VolParams:
    initial_capital: float = 100_000.0
    risk_pct_equity: float = 1.5
    max_concurrent: int = 10
    commission_pct: float = 0.0005
    slippage_bps: float = 2.0
    atr_len: int = 14
    atr_trail_mult: float = 15.0
    atr_stop_mult: float = 2.0
    max_trade_bars: int = 250
    # Volume confirmation
    use_vol_confirm: bool = True
    vol_threshold: float = 1.2  # volume must be >= this * 20d avg


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


def precompute(df, p: VolParams):
    o = df.copy()
    o["ema8"] = ema(o["close"], 8)
    o["ema21"] = ema(o["close"], 21)
    o["ema50"] = ema(o["close"], 50)
    o["ema200"] = ema(o["close"], 200)
    o["atr"] = atr(o, p.atr_len)
    o["vol_ma20"] = sma(o["volume"], 20)
    o["rvol"] = o["volume"] / o["vol_ma20"]
    o["stacked"] = (o["ema8"] > o["ema21"]) & (o["ema21"] > o["ema50"]) & (o["ema50"] > o["ema200"])
    o["ema50_rising"] = o["ema50"] > o["ema50"].shift(10)
    o["breakout"] = o["close"] > o["high"].shift(1)
    base_signal = o["stacked"] & o["ema50_rising"] & o["breakout"]
    if p.use_vol_confirm:
        o["entry_signal"] = base_signal & (o["rvol"] >= p.vol_threshold)
    else:
        o["entry_signal"] = base_signal
    o["stage4"] = (o["close"] < o["ema200"]) & (o["ema200"] < o["ema200"].shift(20))
    o["bear_stack"] = (o["ema8"] < o["ema21"]) & (o["ema21"] < o["ema50"]) & (o["ema50"] < o["ema200"])
    o["danger"] = o["stage4"] | o["bear_stack"]
    return o.dropna()


def run_vol(tickers, p, period="10y"):
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
            pos = positions[tk]; df = all_data[tk]
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
                trades.append({"pnl": pnl})
                del positions[tk]
        marked = sum(all_data[tk].loc[date]["close"] * pos.qty
                     for tk, pos in positions.items() if date in all_data[tk].index) if positions else 0.0
        equity = cash + marked
        cands = []
        for tk, df in all_data.items():
            if tk in positions or date not in df.index: continue
            bar = df.loc[date]
            if bool(bar["entry_signal"]) and not bool(bar["danger"]):
                cands.append((tk, bar))
        cands.sort(key=lambda x: (x[1]["close"] - x[1]["ema50"]) / x[1]["atr"] if x[1]["atr"] > 0 else 999)
        for tk, bar in cands:
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
    return {"trades": len(trades), "net_pct": net_pct, "cagr": cagr,
            "max_dd_pct": abs(dd_pct), "sharpe": sharpe}


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
    print("Volume confirmation test\n")
    for label, p in [
        ("v5 baseline (no vol filter)",   VolParams(use_vol_confirm=False)),
        ("+ vol >= 1.0x avg (any)",       VolParams(use_vol_confirm=True, vol_threshold=1.0)),
        ("+ vol >= 1.2x avg (modest)",    VolParams(use_vol_confirm=True, vol_threshold=1.2)),
        ("+ vol >= 1.5x avg (strong)",    VolParams(use_vol_confirm=True, vol_threshold=1.5)),
        ("+ vol >= 2.0x avg (surge)",     VolParams(use_vol_confirm=True, vol_threshold=2.0)),
    ]:
        r = run_vol(UNIVERSE, p, period="10y")
        if r:
            print(f"  {label:38s} | trades={r['trades']:3d}  net%={r['net_pct']:7.1f}  CAGR={r['cagr']:5.1f}  DD={r['max_dd_pct']:5.1f}  Sharpe={r['sharpe']:.2f}")
