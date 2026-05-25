"""Add SHORT-side trading to v5 — mirror logic for downtrends.

Hypothesis: in bear markets, strategy sits in cash. Adding shorts on
Stage 4 / bear stack setups could capture downside moves.

SHORT entry: EMA 8 < 21 < 50 < 200 (inverted stack) AND EMA50 falling
             AND close < prior bar's low (downside breakout)
             AND NOT in 'reverse danger' (stage 2 / bull stack)

SHORT stop: min(close + 2*ATR, EMA50)
SHORT trail: lowSinceEntry + 15*ATR (ratchets down)
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
class LSParams:
    initial_capital: float = 100_000.0
    risk_pct_equity: float = 1.5
    max_concurrent: int = 10
    commission_pct: float = 0.0005
    slippage_bps: float = 2.0
    atr_len: int = 14
    atr_trail_mult: float = 15.0
    atr_stop_mult: float = 2.0
    max_trade_bars: int = 250
    enable_shorts: bool = True
    max_position_pct: float = 0.30  # cap any one position at 30% equity (realism)


@dataclass
class Position:
    ticker: str
    side: str  # "long" or "short"
    entry_date: pd.Timestamp
    entry_price: float
    qty: int
    initial_stop: float
    trail_stop: float
    extreme_since_entry: float  # high for longs, low for shorts
    bars_in_trade: int = 0


def precompute(df, p: LSParams):
    o = df.copy()
    o["ema8"] = ema(o["close"], 8)
    o["ema21"] = ema(o["close"], 21)
    o["ema50"] = ema(o["close"], 50)
    o["ema200"] = ema(o["close"], 200)
    o["atr"] = atr(o, p.atr_len)
    # Long signal
    o["bull_stack"] = (o["ema8"] > o["ema21"]) & (o["ema21"] > o["ema50"]) & (o["ema50"] > o["ema200"])
    o["ema50_rising"] = o["ema50"] > o["ema50"].shift(10)
    o["long_breakout"] = o["close"] > o["high"].shift(1)
    o["long_entry"] = o["bull_stack"] & o["ema50_rising"] & o["long_breakout"]
    # Short signal (mirror)
    o["bear_stack"] = (o["ema8"] < o["ema21"]) & (o["ema21"] < o["ema50"]) & (o["ema50"] < o["ema200"])
    o["ema50_falling"] = o["ema50"] < o["ema50"].shift(10)
    o["short_breakout"] = o["close"] < o["low"].shift(1)
    o["short_entry"] = o["bear_stack"] & o["ema50_falling"] & o["short_breakout"]
    # Danger states (would invalidate the trade)
    o["stage4"] = (o["close"] < o["ema200"]) & (o["ema200"] < o["ema200"].shift(20))
    o["stage2"] = (o["close"] > o["ema200"]) & (o["ema200"] > o["ema200"].shift(20))
    return o.dropna()


def run_long_short(tickers, p, period="10y"):
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
        # Exits
        for tk in list(positions.keys()):
            pos = positions[tk]; df = all_data[tk]
            if date not in df.index: continue
            bar = df.loc[date]
            pos.bars_in_trade += 1

            er, ep = None, float("nan")
            if pos.side == "long":
                pos.extreme_since_entry = max(pos.extreme_since_entry, bar["high"])
                chand = pos.extreme_since_entry - bar["atr"] * p.atr_trail_mult
                pos.trail_stop = max(pos.trail_stop, chand)
                bear = (bar["ema8"] < bar["ema21"]) & (bar["ema21"] < bar["ema50"]) & (bar["ema50"] < bar["ema200"]) | bar["stage4"]
                if bar["low"] <= pos.trail_stop:
                    er = "TrailExit"; ep = pos.trail_stop * (1 - p.slippage_bps / 10000)
                elif bool(bear):
                    er = "DangerExit"; ep = bar["close"] * (1 - p.slippage_bps / 10000)
                elif pos.bars_in_trade >= p.max_trade_bars:
                    er = "TimeExit"; ep = bar["close"] * (1 - p.slippage_bps / 10000)
                if er:
                    proceeds = ep * pos.qty * (1 - p.commission_pct)
                    pnl = proceeds - pos.entry_price * pos.qty
                    cash += proceeds
                    trades.append({"ticker": tk, "side": "long", "pnl": pnl})
                    del positions[tk]
            else:  # short
                pos.extreme_since_entry = min(pos.extreme_since_entry, bar["low"])
                chand = pos.extreme_since_entry + bar["atr"] * p.atr_trail_mult
                pos.trail_stop = min(pos.trail_stop, chand)
                bull = (bar["ema8"] > bar["ema21"]) & (bar["ema21"] > bar["ema50"]) & (bar["ema50"] > bar["ema200"]) | bar["stage2"]
                if bar["high"] >= pos.trail_stop:
                    er = "TrailExit"; ep = pos.trail_stop * (1 + p.slippage_bps / 10000)
                elif bool(bull):
                    er = "RallyExit"; ep = bar["close"] * (1 + p.slippage_bps / 10000)
                elif pos.bars_in_trade >= p.max_trade_bars:
                    er = "TimeExit"; ep = bar["close"] * (1 + p.slippage_bps / 10000)
                if er:
                    # Short PnL: (entry - exit) * qty - commissions
                    proceeds = ep * pos.qty * (1 + p.commission_pct)  # buy to cover
                    pnl = (pos.entry_price - ep) * pos.qty - ep * pos.qty * p.commission_pct
                    cash += pos.entry_price * pos.qty + pnl  # release margin + pnl
                    trades.append({"ticker": tk, "side": "short", "pnl": pnl})
                    del positions[tk]

        marked = 0.0
        for tk, pos in positions.items():
            if date not in all_data[tk].index: continue
            close = all_data[tk].loc[date]["close"]
            if pos.side == "long":
                marked += close * pos.qty
            else:
                marked += (pos.entry_price - close) * pos.qty + pos.entry_price * pos.qty
        equity = cash + marked

        # New entries
        cands = []
        for tk, df in all_data.items():
            if tk in positions or date not in df.index: continue
            bar = df.loc[date]
            if bool(bar["long_entry"]) and not bool(bar["bear_stack"]):
                cands.append((tk, bar, "long"))
            elif p.enable_shorts and bool(bar["short_entry"]) and not bool(bar["bull_stack"]):
                cands.append((tk, bar, "short"))
        # Sort by closest to EMA50 (tightest setup)
        cands.sort(key=lambda x: abs(x[1]["close"] - x[1]["ema50"]) / x[1]["atr"] if x[1]["atr"] > 0 else 999)

        for tk, bar, side in cands:
            if len(positions) >= p.max_concurrent: break
            close = bar["close"]
            if side == "long":
                init_stop = max(close - bar["atr"] * p.atr_stop_mult, bar["ema50"])
                if init_stop >= close: continue
                risk_per_share = close - init_stop
            else:
                init_stop = min(close + bar["atr"] * p.atr_stop_mult, bar["ema50"])
                if init_stop <= close: continue
                risk_per_share = init_stop - close
            risk_cash = equity * p.risk_pct_equity / 100
            qty = int(math.floor(risk_cash / risk_per_share))
            if qty < 1: continue
            # Position size cap
            max_qty_cap = int(math.floor(equity * p.max_position_pct / close))
            qty = min(qty, max_qty_cap)
            if qty < 1: continue
            fill = close * (1 + p.slippage_bps / 10000) if side == "long" else close * (1 - p.slippage_bps / 10000)
            cost = fill * qty * (1 + p.commission_pct)
            if cost > cash:
                qty = int(math.floor(cash * 0.95 / (fill * (1 + p.commission_pct))))
                if qty < 1: continue
                cost = fill * qty * (1 + p.commission_pct)
                if cost > cash: continue
            cash -= cost
            extreme = bar["high"] if side == "long" else bar["low"]
            positions[tk] = Position(ticker=tk, side=side, entry_date=date, entry_price=fill,
                                     qty=qty, initial_stop=init_stop, trail_stop=init_stop,
                                     extreme_since_entry=extreme)

        marked = 0.0
        for tk, pos in positions.items():
            if date not in all_data[tk].index: continue
            close = all_data[tk].loc[date]["close"]
            if pos.side == "long":
                marked += close * pos.qty
            else:
                marked += (pos.entry_price - close) * pos.qty + pos.entry_price * pos.qty
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
    longs = [t for t in trades if t["side"] == "long"]
    shorts = [t for t in trades if t["side"] == "short"]
    return {"trades": len(trades), "longs": len(longs), "shorts": len(shorts),
            "long_pnl": sum(t["pnl"] for t in longs),
            "short_pnl": sum(t["pnl"] for t in shorts),
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
    print("Long vs Long+Short comparison\n")
    for label, p in [
        ("LONG ONLY (v5)",     LSParams(enable_shorts=False)),
        ("LONG + SHORT",       LSParams(enable_shorts=True)),
    ]:
        r = run_long_short(UNIVERSE, p, period="10y")
        if r:
            print(f"  {label:25s} | trades={r['trades']:3d} (L={r['longs']}, S={r['shorts']})  net%={r['net_pct']:7.1f}  CAGR={r['cagr']:5.1f}  DD={r['max_dd_pct']:5.1f}  Sharpe={r['sharpe']:.2f}")
            if r['shorts'] > 0:
                print(f"    Long PnL: ${r['long_pnl']:,.0f}   Short PnL: ${r['short_pnl']:,.0f}")
