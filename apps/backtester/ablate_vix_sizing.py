"""Test VIX-aware position sizing on the winning Pure Trend variant.

Instead of fixed 2% risk, scale by VIX:
  VIX < 15:  risk 3% (calm = aggressive)
  VIX 15-25: risk 2% (normal)
  VIX > 25:  risk 1% (volatile = conservative)

If this works it captures MORE upside in calm bull markets while protecting
capital in volatile drawdowns - without filtering trades.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from data import load_ohlcv
from master_strategy import Trade, BacktestResult, ema, atr
from macro import get_macro_series, align_to


@dataclass
class VixParams:
    initial_capital: float = 100_000.0
    commission_pct: float = 0.0005
    slippage_bps: float = 2.0
    atr_len: int = 14
    atr_stop_mult: float = 2.0
    atr_trail_mult: float = 10.0
    pyramid_max: int = 3
    pyramid_spacing_atr: float = 2.0
    pyramid_size_pct: float = 0.5
    max_trade_bars: int = 250
    # VIX sizing curve
    use_vix_sizing: bool = True
    risk_calm: float = 3.0   # VIX < 15
    risk_normal: float = 2.0  # VIX 15-25
    risk_volatile: float = 1.0  # VIX > 25
    fixed_risk: float = 2.0   # used when use_vix_sizing=False


def risk_pct_from_vix(vix: float, p: VixParams) -> float:
    if not p.use_vix_sizing or np.isnan(vix):
        return p.fixed_risk
    if vix < 15:
        return p.risk_calm
    if vix < 25:
        return p.risk_normal
    return p.risk_volatile


def run_vix_sizing(df_in: pd.DataFrame, p: VixParams, ticker: str = "?") -> BacktestResult:
    o = df_in.copy()
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

    # Add VIX
    macro = get_macro_series(period="max")
    macro_aligned = align_to(macro, o.index)
    o["vix"] = macro_aligned["vix"].fillna(20)  # default 20 if missing

    o = o.dropna().reset_index()
    date_col = "Date" if "Date" in o.columns else "index"

    equity = p.initial_capital
    eq_hist, dates, trades = [], [], []
    in_trade = False
    entry_price, qty, initial_stop, trail_stop = float("nan"), 0, float("nan"), float("nan")
    high_since_entry, bars_in_trade, last_entry_price = float("nan"), 0, float("nan")
    num_entries, entry_idx = 0, -1
    entries_list = []

    for i, bar in enumerate(o.to_dict("records")):
        close = bar["close"]
        high = bar["high"]
        low = bar["low"]
        bar_atr = bar["atr"]
        vix = bar["vix"]

        risk_pct = risk_pct_from_vix(vix, p)
        signal = bool(bar["entry_signal"]) and not bool(bar["danger"])

        if signal and not in_trade:
            init_stop = max(close - bar_atr * p.atr_stop_mult, bar["ema50"])
            if init_stop < close:
                risk_cash = equity * risk_pct / 100
                qty_new = int(math.floor(risk_cash / (close - init_stop)))
                if qty_new >= 1:
                    fill = close * (1 + p.slippage_bps / 10000)
                    if fill * qty_new * (1 + p.commission_pct) <= equity:
                        in_trade = True
                        entry_idx = i
                        entry_price = fill
                        qty = qty_new
                        initial_stop = init_stop
                        trail_stop = init_stop
                        high_since_entry = high
                        bars_in_trade = 0
                        last_entry_price = fill
                        num_entries = 1
                        entries_list = [(fill, qty_new)]
                        equity -= fill * qty_new * p.commission_pct
        elif signal and in_trade and num_entries < p.pyramid_max:
            atr_dist = (close - last_entry_price) / bar_atr
            in_profit = close > entry_price
            if atr_dist >= p.pyramid_spacing_atr and in_profit:
                add_risk_cash = equity * risk_pct / 100 * p.pyramid_size_pct
                risk_ps = close - trail_stop
                if risk_ps > 0:
                    add_qty = int(math.floor(add_risk_cash / risk_ps))
                    if add_qty >= 1:
                        fill = close * (1 + p.slippage_bps / 10000)
                        if fill * add_qty * (1 + p.commission_pct) <= equity:
                            entries_list.append((fill, add_qty))
                            qty += add_qty
                            total_cost = sum(pp * qq for pp, qq in entries_list)
                            entry_price = total_cost / qty
                            last_entry_price = fill
                            num_entries += 1
                            equity -= fill * add_qty * p.commission_pct

        exit_reason = None
        exit_price = float("nan")
        if in_trade:
            bars_in_trade += 1
            high_since_entry = max(high_since_entry, high)
            chandelier = high_since_entry - bar_atr * p.atr_trail_mult
            trail_stop = max(trail_stop, chandelier)

            if low <= trail_stop:
                exit_reason = "TrailExit"
                exit_price = trail_stop * (1 - p.slippage_bps / 10000)
            elif bool(bar["danger"]):
                exit_reason = "DangerExit"
                exit_price = close * (1 - p.slippage_bps / 10000)
            elif bars_in_trade >= p.max_trade_bars:
                exit_reason = "TimeExit"
                exit_price = close * (1 - p.slippage_bps / 10000)

            if exit_reason:
                ec = exit_price * qty * p.commission_pct
                pnl = (exit_price - entry_price) * qty - ec
                pnl_pct = (exit_price - entry_price) / entry_price * 100
                r_mult = (exit_price - entry_price) / (entry_price - initial_stop) if entry_price != initial_stop else 0
                equity += pnl
                trades.append(Trade(
                    ticker=ticker, entry_date=o.iloc[entry_idx][date_col],
                    entry_price=entry_price, exit_date=bar[date_col],
                    exit_price=exit_price, exit_reason=exit_reason,
                    qty=qty, pnl=pnl, pnl_pct=pnl_pct, r_multiple=r_mult,
                    bars_in_trade=bars_in_trade, t1_hit=False, t2_hit=False,
                ))
                in_trade = False; entries_list = []; num_entries = 0

        mtm = equity + ((close - entry_price) * qty if in_trade else 0)
        eq_hist.append(mtm); dates.append(bar[date_col])

    result = BacktestResult(ticker=ticker, params=p, trades=trades)
    result.equity_curve = pd.Series(eq_hist, index=pd.DatetimeIndex(dates))
    result.final_equity = eq_hist[-1] if eq_hist else p.initial_capital
    result.net_profit = result.final_equity - p.initial_capital
    result.net_profit_pct = result.net_profit / p.initial_capital * 100
    result.total_trades = len(trades)
    if trades:
        wins = [t for t in trades if t.pnl > 0]
        losses = [t for t in trades if t.pnl <= 0]
        result.wins = len(wins); result.losses = len(losses)
        result.win_rate = len(wins) / len(trades) * 100
    eq = result.equity_curve
    rm = eq.cummax()
    dd_pct = (eq / rm - 1) * 100
    result.max_drawdown_pct = abs(dd_pct.min())
    days = (eq.index[-1] - eq.index[0]).days
    years = days / 365.25 if days > 0 else 1
    if result.final_equity > 0 and years > 0:
        result.cagr = ((result.final_equity / p.initial_capital) ** (1/years) - 1) * 100
    ret = eq.pct_change().dropna()
    if len(ret) > 1 and ret.std() > 0:
        result.sharpe = (ret.mean() / ret.std()) * np.sqrt(252)
    return result


def main():
    BASKET = ["INTC", "META", "NFLX", "AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "SPY", "QQQ"]

    configs = {
        "FIXED 2% risk":                  VixParams(use_vix_sizing=False, fixed_risk=2.0),
        "VIX-SIZED (3% calm / 2% / 1%)":  VixParams(use_vix_sizing=True, risk_calm=3.0, risk_normal=2.0, risk_volatile=1.0),
        "VIX-SIZED (4% / 2% / 0.5%)":     VixParams(use_vix_sizing=True, risk_calm=4.0, risk_normal=2.0, risk_volatile=0.5),
        "VIX-SIZED (5% calm only)":       VixParams(use_vix_sizing=True, risk_calm=5.0, risk_normal=2.0, risk_volatile=2.0),
        "VIX-SIZED INVERTED (1/2/3)":     VixParams(use_vix_sizing=True, risk_calm=1.0, risk_normal=2.0, risk_volatile=3.0),
    }

    rows = []
    for label, p in configs.items():
        results = []
        for tk in BASKET:
            df = load_ohlcv(tk, period="10y")
            if len(df) >= 300:
                results.append(run_vix_sizing(df, p, ticker=tk))
        if not results:
            continue
        rows.append({
            "config": label,
            "trades": round(sum(r.total_trades for r in results) / len(results), 0),
            "win%": round(sum(r.win_rate for r in results) / len(results), 1),
            "net%": round(sum(r.net_profit_pct for r in results) / len(results), 1),
            "cagr%": round(sum(r.cagr for r in results) / len(results), 2),
            "dd%": round(sum(r.max_drawdown_pct for r in results) / len(results), 1),
            "sharpe": round(sum(r.sharpe for r in results) / len(results), 2),
        })
        print(f"  {label:42s} | net%={rows[-1]['net%']:6.1f} | dd%={rows[-1]['dd%']:5.1f} | sharpe={rows[-1]['sharpe']:.2f}")

    df = pd.DataFrame(rows)
    print("\n========= VIX-SIZING ABLATION =========")
    print(df.to_string(index=False))

    out_path = Path(__file__).parent / "results_vix_sizing.csv"
    df.to_csv(out_path, index=False)


if __name__ == "__main__":
    main()
