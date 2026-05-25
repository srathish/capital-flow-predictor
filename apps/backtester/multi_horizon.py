"""Multi-horizon trend composite — research-backed CTA approach.

Quantpedia + AQR research: compute trend strength across multiple lookback
horizons (3/6/12 month), then combine into composite signal.

t-stat-style: count how many horizons agree on trend direction.
- 3/6/12 mo: 3 ROC measurements
- If all 3 positive => strong uptrend (score=3)
- If 2/3 positive => moderate uptrend (score=2)
- etc

Use composite score to:
1. Gate entries: require score >= threshold
2. Scale size: bigger positions when more horizons agree
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
class MHParams:
    initial_capital: float = 100_000.0
    risk_pct_equity: float = 1.0
    max_concurrent: int = 10
    commission_pct: float = 0.0005
    slippage_bps: float = 2.0
    atr_len: int = 14
    atr_trail_mult: float = 10.0
    atr_stop_mult: float = 2.0
    max_trade_bars: int = 250

    # Multi-horizon
    horizons: tuple = (63, 126, 252)  # 3mo, 6mo, 12mo (trading days)
    min_horizons_agree: int = 2        # need at least 2/3 horizons positive
    use_horizon_sizing: bool = False   # scale qty by horizon count


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


def precompute(df: pd.DataFrame, p: MHParams) -> pd.DataFrame:
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

    # Multi-horizon ROC and composite
    for h in p.horizons:
        o[f"roc_{h}"] = o["close"].pct_change(h)
    o["horizons_pos"] = sum((o[f"roc_{h}"] > 0).astype(int) for h in p.horizons)
    o["mh_signal_ok"] = o["horizons_pos"] >= p.min_horizons_agree

    return o.dropna()


def run_mh(tickers: list[str], p: MHParams, period: str = "10y") -> dict:
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

        # New entries — gated by multi-horizon
        candidates = []
        for tk, df in all_data.items():
            if tk in positions or date not in df.index: continue
            bar = df.loc[date]
            if bool(bar["entry_signal"]) and not bool(bar["danger"]) and bool(bar["mh_signal_ok"]):
                candidates.append((tk, bar))
        candidates.sort(key=lambda x: (x[1]["close"] - x[1]["ema50"]) / x[1]["atr"] if x[1]["atr"] > 0 else 999)

        for tk, bar in candidates:
            if len(positions) >= p.max_concurrent: break
            close = bar["close"]
            init_stop = max(close - bar["atr"] * p.atr_stop_mult, bar["ema50"])
            if init_stop >= close: continue
            risk_pct = p.risk_pct_equity
            # Horizon-scaled sizing
            if p.use_horizon_sizing:
                risk_pct *= bar["horizons_pos"] / len(p.horizons)  # scale 1/3, 2/3, 3/3
            risk_cash = equity * risk_pct / 100
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
    return {
        "trades": len(trades), "wins": len(wins),
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
    print("Multi-horizon trend composite backtest\n")
    for label, p in [
        ("baseline (min 2/3 horizons up)",         MHParams()),
        ("min 1/3 horizons (loose)",               MHParams(min_horizons_agree=1)),
        ("min 3/3 horizons (strict)",              MHParams(min_horizons_agree=3)),
        ("horizons 1/3/6/12mo",                    MHParams(horizons=(21, 63, 126, 252), min_horizons_agree=3)),
        ("horizons 6/12mo only",                   MHParams(horizons=(126, 252), min_horizons_agree=2)),
        ("horizon-scaled sizing on/off",           MHParams(use_horizon_sizing=True)),
        ("bimodal 20d + 500d (CTA research)",      MHParams(horizons=(20, 500), min_horizons_agree=2)),
    ]:
        r = run_mh(UNIVERSE, p, period="10y")
        if r:
            print(f"  {label:42s} | trades={r['trades']:3d}  win%={r['win_rate']:.1f}  net%={r['net_pct']:6.0f}  CAGR={r['cagr']:5.1f}  DD={r['max_dd_pct']:5.1f}  Sharpe={r['sharpe']:.2f}")
