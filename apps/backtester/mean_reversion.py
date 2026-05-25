"""Mean-reversion variant for SIDEWAYS / volatile regimes.

Hypothesis: when trend follower fails (sideways markets), mean reversion can
add value. Buy oversold bounces from key MAs in confirmed Stage 2 stocks.

Entry: close > EMA200 (still in uptrend long-term)
       AND RSI < 30 (oversold)
       AND close > prior bar's close (today's bar is recovering)
       AND close > 0.95 * EMA50 (didn't break too far below mid trend)

Exit: close > EMA21 (mean reverted) OR stop loss at 2*ATR below entry.
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


def rsi(s: pd.Series, length: int = 14) -> pd.Series:
    delta = s.diff()
    gain = delta.where(delta > 0, 0).ewm(alpha=1/length, adjust=False).mean()
    loss = (-delta.where(delta < 0, 0)).ewm(alpha=1/length, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


@dataclass
class MRParams:
    initial_capital: float = 100_000.0
    risk_pct_equity: float = 1.0
    max_concurrent: int = 5
    commission_pct: float = 0.0005
    slippage_bps: float = 2.0
    atr_len: int = 14
    rsi_len: int = 14
    rsi_oversold: float = 30.0
    stop_mult_atr: float = 2.0
    target_method: str = "ema21"  # ema21 or rsi_50


@dataclass
class MRPosition:
    ticker: str
    entry_date: pd.Timestamp
    entry_price: float
    qty: int
    stop: float


def precompute_mr(df: pd.DataFrame, p: MRParams) -> pd.DataFrame:
    o = df.copy()
    o["ema8"] = ema(o["close"], 8)
    o["ema21"] = ema(o["close"], 21)
    o["ema50"] = ema(o["close"], 50)
    o["ema200"] = ema(o["close"], 200)
    o["atr"] = atr(o, p.atr_len)
    o["rsi"] = rsi(o["close"], p.rsi_len)
    # Entry: in Stage 2 (above 200, EMA50 above EMA200) AND oversold AND recovering
    o["stage2"] = (o["close"] > o["ema200"]) & (o["ema50"] > o["ema200"])
    o["oversold"] = o["rsi"] < p.rsi_oversold
    o["recovering"] = o["close"] > o["close"].shift(1)
    o["not_too_broken"] = o["close"] > o["ema50"] * 0.93
    o["entry"] = o["stage2"] & o["oversold"] & o["recovering"] & o["not_too_broken"]
    return o.dropna()


def run_mr_portfolio(tickers: list[str], p: MRParams, period: str = "10y") -> dict:
    all_data = {}
    for tk in tickers:
        try:
            df = load_ohlcv(tk, period=period)
            if len(df) >= 300:
                all_data[tk] = precompute_mr(df, p)
        except Exception:
            pass

    if not all_data:
        return {}

    master_dates = sorted(set().union(*[set(df.index) for df in all_data.values()]))
    positions: dict[str, MRPosition] = {}
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
            exit_reason, exit_price = None, float("nan")
            # Target: close > ema21
            if p.target_method == "ema21" and bar["close"] > bar["ema21"]:
                exit_reason = "Target"; exit_price = bar["close"] * (1 - p.slippage_bps / 10000)
            elif p.target_method == "rsi_50" and bar["rsi"] > 50:
                exit_reason = "Target"; exit_price = bar["close"] * (1 - p.slippage_bps / 10000)
            elif bar["low"] <= pos.stop:
                exit_reason = "Stop"; exit_price = pos.stop * (1 - p.slippage_bps / 10000)
            elif bar["close"] < bar["ema200"]:
                exit_reason = "TrendBreak"; exit_price = bar["close"] * (1 - p.slippage_bps / 10000)
            if exit_reason:
                proceeds = exit_price * pos.qty * (1 - p.commission_pct)
                pnl = proceeds - pos.entry_price * pos.qty
                cash += proceeds
                trades.append({"ticker": tk, "pnl": pnl, "reason": exit_reason})
                del positions[tk]

        marked = sum(all_data[tk].loc[date]["close"] * pos.qty
                     for tk, pos in positions.items() if date in all_data[tk].index) if positions else 0.0
        equity = cash + marked

        # New entries
        candidates = []
        for tk, df in all_data.items():
            if tk in positions or date not in df.index: continue
            bar = df.loc[date]
            if bool(bar["entry"]):
                candidates.append((tk, bar))
        # Rank by lowest RSI (most oversold first)
        candidates.sort(key=lambda x: x[1]["rsi"])

        for tk, bar in candidates:
            if len(positions) >= p.max_concurrent: break
            close = bar["close"]
            stop = close - bar["atr"] * p.stop_mult_atr
            if stop >= close: continue
            risk_cash = equity * p.risk_pct_equity / 100
            qty = int(math.floor(risk_cash / (close - stop)))
            if qty < 1: continue
            fill = close * (1 + p.slippage_bps / 10000)
            cost = fill * qty * (1 + p.commission_pct)
            if cost > cash:
                qty = int(math.floor(cash * 0.95 / (fill * (1 + p.commission_pct))))
                if qty < 1: continue
                cost = fill * qty * (1 + p.commission_pct)
                if cost > cash: continue
            cash -= cost
            positions[tk] = MRPosition(ticker=tk, entry_date=date, entry_price=fill, qty=qty, stop=stop)

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
    print("Mean-reversion portfolio backtest\n")
    for label, p in [
        ("baseline RSI<30, EMA21 target", MRParams()),
        ("RSI<25 (more oversold)",        MRParams(rsi_oversold=25)),
        ("RSI<35 (less strict)",          MRParams(rsi_oversold=35)),
        ("RSI<30 + RSI50 target",         MRParams(target_method="rsi_50")),
        ("max_concurrent=10",             MRParams(max_concurrent=10, risk_pct_equity=0.7)),
        ("max_concurrent=15",             MRParams(max_concurrent=15, risk_pct_equity=0.5)),
    ]:
        r = run_mr_portfolio(UNIVERSE, p, period="10y")
        if r:
            print(f"  {label:35s} | trades={r['total_trades']:3d}  win%={r['win_rate']:.1f}  net%={r['net_pct']:6.0f}  CAGR={r['cagr']:5.1f}  DD={r['max_dd_pct']:5.1f}  Sharpe={r['sharpe']:.2f}")
