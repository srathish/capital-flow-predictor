"""Pure trend follower — minimal strategy to benchmark base/handle complexity.

Entry: close > ema21 > ema50 > ema200 AND ema50 > ema50[10] (rising)
       AND today's close > prior bar's high (breakout from yesterday)
       AND not already in trade

Initial stop: max(close - 2*ATR, ema50)
Trail: Chandelier 5xATR (the v2 winner)
Pyramid: up to 3, spaced 2 ATR apart, 50% size
Exit: trail hit, danger (stage 4 or bear stack), or 250 bars

NO base/handle scoring. NO grade gate. NO flow gate. Just trend + breakout.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from master_strategy import Trade, BacktestResult, ema, atr, sma


@dataclass
class PureParams:
    initial_capital: float = 100_000.0
    risk_pct_equity: float = 1.0
    commission_pct: float = 0.0005
    slippage_bps: float = 2.0

    atr_len: int = 14
    atr_stop_mult: float = 2.0
    atr_trail_mult: float = 5.0
    pyramid_max: int = 3
    pyramid_spacing_atr: float = 2.0
    pyramid_size_pct: float = 0.5
    max_trade_bars: int = 250


def run_pure_trend(df_in: pd.DataFrame, p: PureParams, ticker: str = "?") -> BacktestResult:
    o = df_in.copy()
    o["ema8"] = ema(o["close"], 8)
    o["ema21"] = ema(o["close"], 21)
    o["ema50"] = ema(o["close"], 50)
    o["ema200"] = ema(o["close"], 200)
    o["atr"] = atr(o, p.atr_len)

    # Entry trigger: EMAs stacked + EMA50 rising + close > prior high
    o["stacked"] = (o["ema8"] > o["ema21"]) & (o["ema21"] > o["ema50"]) & (o["ema50"] > o["ema200"])
    o["ema50_rising"] = o["ema50"] > o["ema50"].shift(10)
    o["entry_signal"] = o["stacked"] & o["ema50_rising"] & (o["close"] > o["high"].shift(1))

    # Danger filter
    o["stage4"] = (o["close"] < o["ema200"]) & (o["ema200"] < o["ema200"].shift(20))
    o["bear_stack"] = (o["ema8"] < o["ema21"]) & (o["ema21"] < o["ema50"]) & (o["ema50"] < o["ema200"])
    o["danger"] = o["stage4"] | o["bear_stack"]

    o = o.dropna().reset_index()
    date_col = "Date" if "Date" in o.columns else "index"

    equity = p.initial_capital
    eq_hist = []
    dates = []
    trades = []

    in_trade = False
    entry_price = float("nan")
    qty = 0
    initial_stop = float("nan")
    trail_stop = float("nan")
    high_since_entry = float("nan")
    bars_in_trade = 0
    last_entry_price = float("nan")
    num_entries = 0
    entry_idx = -1
    entries_list: list[tuple[float, int]] = []

    for i, bar in enumerate(o.to_dict("records")):
        close = bar["close"]
        high = bar["high"]
        low = bar["low"]
        bar_atr = bar["atr"]

        signal = bool(bar["entry_signal"]) and not bool(bar["danger"])

        # === Entry ===
        if signal and not in_trade:
            init_stop = max(close - bar_atr * p.atr_stop_mult, bar["ema50"])
            if init_stop < close:
                risk_per_share = close - init_stop
                risk_cash = equity * p.risk_pct_equity / 100
                qty_new = int(math.floor(risk_cash / risk_per_share))
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

        # === Pyramid ===
        elif signal and in_trade and num_entries < p.pyramid_max:
            atr_dist = (close - last_entry_price) / bar_atr
            in_profit = close > entry_price
            if atr_dist >= p.pyramid_spacing_atr and in_profit:
                add_risk_cash = equity * p.risk_pct_equity / 100 * p.pyramid_size_pct
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

        # === In-trade management ===
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
                    ticker=ticker,
                    entry_date=o.iloc[entry_idx][date_col],
                    entry_price=entry_price,
                    exit_date=bar[date_col],
                    exit_price=exit_price,
                    exit_reason=exit_reason,
                    qty=qty,
                    pnl=pnl,
                    pnl_pct=pnl_pct,
                    r_multiple=r_mult,
                    bars_in_trade=bars_in_trade,
                    t1_hit=False,
                    t2_hit=False,
                ))
                in_trade = False
                entries_list = []
                num_entries = 0

        mtm = equity + ((close - entry_price) * qty if in_trade else 0)
        eq_hist.append(mtm)
        dates.append(bar[date_col])

    # === Build result ===
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
        result.avg_win = sum(t.pnl for t in wins) / len(wins) if wins else 0
        result.avg_loss = sum(t.pnl for t in losses) / len(losses) if losses else 0
        tw = sum(t.pnl for t in wins); tl = abs(sum(t.pnl for t in losses))
        result.profit_factor = tw / tl if tl > 0 else float("inf") if tw > 0 else 0

    eq = result.equity_curve
    rm = eq.cummax()
    dd_pct = (eq / rm - 1) * 100
    result.max_drawdown_pct = abs(dd_pct.min())
    days = (eq.index[-1] - eq.index[0]).days
    years = days / 365.25 if days > 0 else 1.0
    if result.final_equity > 0 and years > 0:
        result.cagr = ((result.final_equity / p.initial_capital) ** (1/years) - 1) * 100
    ret = eq.pct_change().dropna()
    if len(ret) > 1 and ret.std() > 0:
        result.sharpe = (ret.mean() / ret.std()) * np.sqrt(252)
    result.buy_hold_return_pct = (df_in["close"].iloc[-1] / df_in["close"].iloc[0] - 1) * 100
    return result


if __name__ == "__main__":
    from data import load_ohlcv
    BASKET = ["INTC", "META", "NFLX", "AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "SPY", "QQQ"]
    results = []
    for tk in BASKET:
        df = load_ohlcv(tk, period="10y")
        if len(df) >= 300:
            r = run_pure_trend(df, PureParams(), ticker=tk)
            results.append(r)
            print(f"{tk:5s}  trades={r.total_trades:3d}  win%={r.win_rate:5.1f}  net%={r.net_profit_pct:7.1f}  cagr%={r.cagr:5.2f}  dd%={r.max_drawdown_pct:5.1f}  sharpe={r.sharpe:5.2f}  bh%={r.buy_hold_return_pct:7.0f}")

    mean_net = sum(r.net_profit_pct for r in results) / len(results)
    mean_cagr = sum(r.cagr for r in results) / len(results)
    mean_sharpe = sum(r.sharpe for r in results) / len(results)
    mean_dd = sum(r.max_drawdown_pct for r in results) / len(results)
    print(f"\nMEAN: net%={mean_net:.1f}  cagr%={mean_cagr:.2f}  sharpe={mean_sharpe:.2f}  dd%={mean_dd:.1f}")
