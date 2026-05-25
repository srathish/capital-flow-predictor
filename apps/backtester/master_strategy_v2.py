"""MASTER strategy v2 — extends v1 with:
  - Trend classification (HH/HL pivot-based)
  - Macro regime filter (VIX + SPY)
  - Sector strength filter
  - Trend-continuation entries (pullback to 21EMA in confirmed trend)
  - Adaptive trail (wider in STRONG_UP, tighter in WEAK/SIDEWAYS)
  - Volume quality signals
  - Pyramiding support

Every new feature is toggleable so ablations isolate each contribution.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))

from master_strategy import (
    Trade, BacktestResult, ema, sma, stdev, atr, mfi, cmf,
    rolling_highest, rolling_lowest,
)
from trend import classify_trend
from macro import get_macro_series, align_to
from sector import get_sector_for_ticker


@dataclass
class ParamsV2:
    # === Inherited from v1 ===
    ema_short: int = 8
    ema_mid: int = 21
    ema_long: int = 50
    ema_trend: int = 200
    vol_len: int = 20
    vol_len_long: int = 50
    atr_len: int = 14
    atr_lookback: int = 60
    dry_up_ratio: float = 0.80
    ema_tight_pct: float = 2.0
    swing_look: int = 30
    handle_max: int = 15
    pull_min: float = 3.0
    pull_max: float = 22.0
    vol_dry_handle: float = 0.90
    range_comp_pct: float = 0.70
    bb_len: int = 20
    bb_mult: float = 2.0
    breakout_vol: float = 1.5
    strong_close: float = 0.65
    range_exp_mult: float = 1.2
    min_grade: int = 3
    flow_len: int = 20
    mfi_bull: float = 50.0
    require_flow: bool = True
    invalid_pct_low: float = 3.0
    invalid_pct_ema: float = 3.0
    invalid_max_bars: int = 30

    # Exits — use the v1-ablation winner as new defaults
    stop_method: str = "Max of ATR and 50EMA"
    atr_stop_mult: float = 2.0
    trail_method: str = "Chandelier"  # changed from "Chandelier OR 21EMA"
    atr_trail_mult: float = 5.0       # changed from 3.0 (the winning setting)
    t1_rmult: float = 2.0
    t2_rmult: float = 3.0
    move_be_after_t1: bool = False    # changed — proved neutral, simpler off
    exit_on_danger: bool = True
    max_trade_bars: int = 250         # loosened from 60

    initial_capital: float = 100_000.0
    risk_pct_equity: float = 1.0
    commission_pct: float = 0.0005
    slippage_bps: float = 2.0

    # === v2 NEW: Trend classifier ===
    pivot_left: int = 5
    pivot_right: int = 5
    use_trend_filter: bool = False     # require STRONG_UP/WEAK_UP for new entries
    trend_adaptive_trail: bool = False # widen trail in STRONG_UP, tighten otherwise

    # === v2 NEW: Macro filter ===
    use_macro_filter: bool = False     # require macro_risk_on (SPY>200ma AND NOT vix>25)

    # === v2 NEW: Sector filter ===
    use_sector_filter: bool = False    # require sec_hot (sector above 50ma AND outperforming SPY)

    # === v2 NEW: Trend-continuation entries ===
    use_continuation_entries: bool = False  # add pullback-to-21EMA path in confirmed trend
    continuation_min_bars_trend: int = 10   # trend must be established this long
    continuation_pullback_atr: float = 1.0  # within N ATRs of 21EMA
    continuation_trigger_lookback: int = 5  # trigger = N-bar high

    # === v2 NEW: Volume quality ===
    use_pocket_pivot: bool = False  # require pocket-pivot characteristics on entry bar

    # === v2 NEW: Pyramiding ===
    max_pyramid: int = 1  # 1 = no pyramiding; 2 = up to 1 add; 3 = up to 2 adds
    pyramid_spacing_atr: float = 2.0  # minimum ATR move from prior entry to add
    pyramid_size_pct: float = 0.5     # adds sized as fraction of original


def precompute_v2(df_in: pd.DataFrame, p: ParamsV2, ticker: str = "?") -> pd.DataFrame:
    """v1 precompute + trend + macro + sector + volume quality columns."""
    o = df_in.copy()
    # === v1 base indicators ===
    o["ema8"]   = ema(o["close"], p.ema_short)
    o["ema10"]  = ema(o["close"], 10)
    o["ema21"]  = ema(o["close"], p.ema_mid)
    o["ema50"]  = ema(o["close"], p.ema_long)
    o["ema200"] = ema(o["close"], p.ema_trend)
    o["volMA"]   = sma(o["volume"], p.vol_len)
    o["volMA50"] = sma(o["volume"], p.vol_len_long)
    o["handleVolMA"] = sma(o["volume"], 5)
    o["atr"] = atr(o, p.atr_len)
    o["atrPast"] = o["atr"].shift(p.atr_lookback)
    o["atrContracted"] = (o["atr"] < o["atrPast"] * 0.80) & o["atrPast"].notna()
    o["bbBasis"] = sma(o["close"], p.bb_len)
    o["bbDev"] = p.bb_mult * stdev(o["close"], p.bb_len)
    o["bbUpper"] = o["bbBasis"] + o["bbDev"]
    o["bbLower"] = o["bbBasis"] - o["bbDev"]
    o["bbWidth"] = np.where(o["bbBasis"] != 0, (o["bbUpper"] - o["bbLower"]) / o["bbBasis"], 0.0)
    bb_range = o["bbUpper"] - o["bbLower"]
    o["bbPctB"] = np.where(bb_range != 0, (o["close"] - o["bbLower"]) / bb_range, 0.5)
    o["bbThrust"] = o["bbPctB"] > 0.8
    o["bbExpand"] = o["bbWidth"] > o["bbWidth"].shift(1)
    o["ema200_slope50"] = np.where(
        (o["ema200"].shift(50).notna()) & (o["ema200"].shift(50) != 0),
        (o["ema200"] - o["ema200"].shift(50)) / o["ema200"].shift(50) * 100,
        0.0,
    )
    o["stage2"] = (o["close"] > o["ema200"]) & (o["ema50"] > o["ema200"]) & (o["ema200_slope50"] > 1.0)
    o["dryUp"] = o["volMA"] < o["volMA50"] * p.dry_up_ratio
    o["emaSpread1"] = (o["ema8"] - o["ema21"]).abs() / o["close"] * 100
    o["emaSpread2"] = (o["ema21"] - o["ema50"]).abs() / o["close"] * 100
    o["emaTight"] = (o["emaSpread1"] < p.ema_tight_pct) & (o["emaSpread2"] < p.ema_tight_pct * 2)
    o["high52"] = rolling_highest(o["high"], 252)
    o["pctFromHigh"] = (o["high52"] - o["close"]) / o["high52"] * 100
    o["inBaseZone"] = (o["pctFromHigh"] > 10) & (o["pctFromHigh"] < 40)
    o["bcsScore"] = (o["stage2"].astype(int) + o["dryUp"].astype(int) + o["atrContracted"].astype(int) + o["emaTight"].astype(int) + o["inBaseZone"].astype(int))
    o["bcsReady"] = o["bcsScore"] >= 4

    o["emasStacked"] = (o["ema8"] > o["ema21"]) & (o["ema21"] > o["ema50"]) & (o["ema50"] > o["ema200"])
    o["uptrend"] = o["emasStacked"] & (o["ema21"] > o["ema21"].shift(5)) & (o["ema50"] > o["ema50"].shift(10))
    o["swingHigh"] = rolling_highest(o["high"], p.swing_look)
    o["pullbackPct"] = (o["swingHigh"] - o["close"]) / o["swingHigh"] * 100
    o["inPullbackZone"] = (o["pullbackPct"] >= p.pull_min) & (o["pullbackPct"] <= p.pull_max)
    o["holdingEma"] = (o["close"] > o["ema50"]) & (o["low"] > o["ema50"] * 0.97)
    o["recentRange"] = rolling_highest(o["high"], 5) - rolling_lowest(o["low"], 5)
    o["priorRange"] = rolling_highest(o["high"].shift(5), 5) - rolling_lowest(o["low"].shift(5), 5)
    o["rangeCompressed"] = o["recentRange"] < o["priorRange"] * p.range_comp_pct
    o["volDryInHandle"] = o["handleVolMA"] < o["volMA"] * p.vol_dry_handle
    o["hfsScore"] = (o["uptrend"].astype(int) + o["inPullbackZone"].astype(int) + o["holdingEma"].astype(int) + o["rangeCompressed"].astype(int) + o["volDryInHandle"].astype(int))
    o["hfsReady"] = o["hfsScore"] >= 4

    o["stage4"] = (o["close"] < o["ema200"]) & (o["ema200"] < o["ema200"].shift(20))
    o["bearStack"] = (o["ema8"] < o["ema21"]) & (o["ema21"] < o["ema50"]) & (o["ema50"] < o["ema200"])
    o["danger"] = o["stage4"] | o["bearStack"]
    o["caution"] = (o["close"] < o["ema50"]) & (o["ema21"] < o["ema21"].shift(5)) & (~o["danger"])

    o["priorHigh20"] = rolling_highest(o["high"].shift(1), 20)
    o["handleHigh"] = rolling_highest(o["high"].shift(1), p.handle_max)
    o["setupLow10"] = rolling_lowest(o["low"].shift(1), 10)

    o["rvol"] = np.where(o["volMA"].shift(1) > 0, o["volume"] / o["volMA"].shift(1), 0.0)
    o["volSurge"] = o["rvol"] >= p.breakout_vol
    hl = o["high"] - o["low"]
    o["closePos"] = np.where(hl == 0, 0.5, (o["close"] - o["low"]) / hl.replace(0, np.nan))
    o["strongBar"] = (hl > 0) & (o["closePos"] >= p.strong_close)
    o["rangeExp"] = hl > o["atr"] * p.range_exp_mult
    o["grade"] = (o["volSurge"].astype(int) + o["strongBar"].astype(int) + o["rangeExp"].astype(int) + o["bbThrust"].astype(int) + o["bbExpand"].astype(int))
    o["mfi"] = mfi(o, p.flow_len)
    o["cmf"] = cmf(o, p.flow_len)
    o["flowOk"] = (o["mfi"] > p.mfi_bull) & (o["cmf"] > 0)

    stop_atr = o["close"] - o["atr"] * p.atr_stop_mult
    if p.stop_method == "ATR":
        o["stopInit"] = stop_atr
    elif p.stop_method == "50EMA":
        o["stopInit"] = o["ema50"]
    elif p.stop_method == "Setup Low":
        o["stopInit"] = np.nan
    else:
        o["stopInit"] = np.maximum(stop_atr, o["ema50"])

    # === v2 NEW: Trend classifier ===
    if p.use_trend_filter or p.trend_adaptive_trail or p.use_continuation_entries:
        o = classify_trend(o, pivot_left=p.pivot_left, pivot_right=p.pivot_right)
    else:
        # ensure columns exist for downstream code
        o["trend_state"] = "UNKNOWN"
        o["bars_in_trend"] = 0

    # === v2 NEW: Macro regime ===
    if p.use_macro_filter:
        try:
            macro = get_macro_series(period="max")
            macro_aligned = align_to(macro, o.index)
            o["macro_risk_on"] = macro_aligned["macro_risk_on"].fillna(False)
        except Exception:
            o["macro_risk_on"] = True  # default to risk-on if data unavailable
    else:
        o["macro_risk_on"] = True

    # === v2 NEW: Sector strength ===
    if p.use_sector_filter:
        try:
            sec = get_sector_for_ticker(ticker, period="max")
            sec_aligned = sec.reindex(o.index, method="ffill")
            o["sec_hot"] = sec_aligned["sec_hot"].fillna(False)
        except Exception:
            o["sec_hot"] = True
    else:
        o["sec_hot"] = True

    # === v2 NEW: Trend-continuation arming candidate ===
    # Confirmed STRONG_UP trend that has been in place for N bars,
    # price pulled back to within X ATRs of 21EMA, today's close is bullish.
    dist_to_21ema = (o["close"] - o["ema21"]).abs()
    near_21ema = dist_to_21ema < o["atr"] * p.continuation_pullback_atr
    bullish_close = (o["close"] > o["open"]) & (o["close"] > o["close"].shift(1))
    o["cont_ready"] = (
        (o["trend_state"] == "STRONG_UP")
        & (o["bars_in_trend"] >= p.continuation_min_bars_trend)
        & near_21ema
        & bullish_close
    )
    o["contHigh"] = rolling_highest(o["high"].shift(1), p.continuation_trigger_lookback)

    # === v2 NEW: Pocket pivot (single-day volume spike + close above prior 10d close range) ===
    if p.use_pocket_pivot:
        last10_close_high = rolling_highest(o["close"].shift(1), 10)
        down_vol_10 = (o["volume"].where(o["close"] < o["close"].shift(1), 0)).rolling(10).max()
        o["pocket_pivot"] = (
            (o["close"] > last10_close_high)
            & (o["volume"] > down_vol_10 * 1.0)
            & (o["close"] > o["ema50"])
        )
    else:
        o["pocket_pivot"] = False

    return o


@dataclass
class SetupStateV2:
    armed: bool = False
    locked_phase: str = "NEUTRAL"  # BASE / HANDLE / CONT
    trigger: float = float("nan")
    setup_low: float = float("nan")
    bars_armed: int = 0
    prev_fired: bool = False


@dataclass
class TradeStateV2:
    in_trade: bool = False
    entry_idx: int = -1
    entry_price: float = float("nan")
    qty: int = 0
    initial_stop: float = float("nan")
    trail_stop: float = float("nan")
    r1_target: float = float("nan")
    r2_target: float = float("nan")
    high_since_entry: float = float("nan")
    bars_in_trade: int = 0
    t1_hit: bool = False
    t2_hit: bool = False
    # Pyramiding
    entries: list = field(default_factory=list)  # list of (price, qty) for avg-price tracking
    last_entry_price: float = float("nan")
    num_entries: int = 0


def run_backtest_v2(df_in: pd.DataFrame, p: ParamsV2, ticker: str = "?") -> BacktestResult:
    df = precompute_v2(df_in, p, ticker=ticker)
    df = df.dropna(subset=["ema200", "atr", "volMA50"]).copy()
    if len(df) < 50:
        return BacktestResult(ticker=ticker, params=p)

    setup = SetupStateV2()
    trade = TradeStateV2()
    trades: list[Trade] = []
    equity = p.initial_capital
    equity_history: list[float] = []
    dates: list[pd.Timestamp] = []

    bars = df.reset_index().to_dict("records")
    date_col = "Date" if "Date" in bars[0] else "index"

    for i, bar in enumerate(bars):
        date = bar[date_col]
        close = bar["close"]
        high = bar["high"]
        low = bar["low"]

        # ============ SETUP STATE MACHINE ============
        # Standard base/handle arm
        base_arm = (bar["bcsReady"] or bar["hfsReady"]) and (not setup.armed) and (not bar["danger"])
        # NEW: Trend continuation arm
        cont_arm = (
            p.use_continuation_entries
            and bar.get("cont_ready", False)
            and (not setup.armed)
            and (not bar["danger"])
        )
        new_arm = base_arm or cont_arm

        # Apply macro/sector/trend filters at arm time
        if new_arm and p.use_macro_filter and not bar.get("macro_risk_on", True):
            new_arm = False
        if new_arm and p.use_sector_filter and not bar.get("sec_hot", True):
            new_arm = False
        if new_arm and p.use_trend_filter and bar.get("trend_state", "UNKNOWN") not in ("STRONG_UP", "WEAK_UP", "UNKNOWN"):
            new_arm = False

        if new_arm:
            setup.armed = True
            if cont_arm and not base_arm:
                setup.locked_phase = "CONT"
                setup.trigger = bar["contHigh"]
            elif bar["bcsScore"] >= bar["hfsScore"]:
                setup.locked_phase = "BASE"
                setup.trigger = bar["priorHigh20"]
            else:
                setup.locked_phase = "HANDLE"
                setup.trigger = bar["handleHigh"]
            setup.setup_low = bar["setupLow10"]
            setup.bars_armed = 0
        elif setup.armed:
            setup.bars_armed += 1
            invalidated = (
                low < setup.setup_low * (1 - p.invalid_pct_low / 100)
                or close < bar["ema50"] * (1 - p.invalid_pct_ema / 100)
                or setup.bars_armed > p.invalid_max_bars
                or bar["danger"]
            )
            if invalidated or setup.prev_fired:
                setup.armed = False
                setup.locked_phase = "NEUTRAL"
                setup.trigger = float("nan")
                setup.setup_low = float("nan")
                setup.bars_armed = 0

        # ============ aSIGNAL ============
        armed_for_signal = setup.armed and not new_arm
        broke_trigger = (not math.isnan(setup.trigger)) and close > setup.trigger
        grade_ok = bar["grade"] >= p.min_grade
        flow_ok = bar["flowOk"] or not p.require_flow

        a_signal = (
            (not bar["danger"]) and armed_for_signal and broke_trigger and grade_ok and flow_ok
        )
        # Pocket pivot filter (optional)
        if a_signal and p.use_pocket_pivot and not bar.get("pocket_pivot", False):
            a_signal = False

        # ============ ENTRY (initial) ============
        if a_signal and not trade.in_trade:
            init_stop = setup.setup_low if p.stop_method == "Setup Low" else bar["stopInit"]
            if not math.isnan(init_stop) and init_stop < close:
                risk_per_share = close - init_stop
                risk_cash = equity * p.risk_pct_equity / 100
                qty = int(math.floor(risk_cash / risk_per_share))
                if qty >= 1:
                    fill_price = close * (1 + p.slippage_bps / 10000)
                    cost = fill_price * qty * (1 + p.commission_pct)
                    if cost <= equity:
                        trade.in_trade = True
                        trade.entry_idx = i
                        trade.entry_price = fill_price
                        trade.qty = qty
                        trade.initial_stop = init_stop
                        trade.r1_target = fill_price + risk_per_share * p.t1_rmult
                        trade.r2_target = fill_price + risk_per_share * p.t2_rmult
                        trade.trail_stop = init_stop
                        trade.high_since_entry = high
                        trade.bars_in_trade = 0
                        trade.t1_hit = False
                        trade.t2_hit = False
                        trade.entries = [(fill_price, qty)]
                        trade.last_entry_price = fill_price
                        trade.num_entries = 1
                        equity -= fill_price * qty * p.commission_pct

        # ============ PYRAMID ENTRY (additional) ============
        # Only when already in trade, in profit, trend still strong, and enough ATR distance from last entry
        elif a_signal and trade.in_trade and trade.num_entries < p.max_pyramid:
            atr_distance = (close - trade.last_entry_price) / bar["atr"]
            in_profit = close > trade.entry_price
            trend_ok = bar.get("trend_state", "UNKNOWN") in ("STRONG_UP", "UNKNOWN")
            if atr_distance >= p.pyramid_spacing_atr and in_profit and trend_ok:
                add_risk_cash = equity * p.risk_pct_equity / 100 * p.pyramid_size_pct
                risk_per_share = close - trade.trail_stop  # risk to current trail
                if risk_per_share > 0:
                    add_qty = int(math.floor(add_risk_cash / risk_per_share))
                    if add_qty >= 1:
                        fill_price = close * (1 + p.slippage_bps / 10000)
                        cost = fill_price * add_qty * (1 + p.commission_pct)
                        if cost <= equity:
                            trade.entries.append((fill_price, add_qty))
                            trade.qty += add_qty
                            # Update average entry price
                            total_cost = sum(p_e * q_e for p_e, q_e in trade.entries)
                            trade.entry_price = total_cost / trade.qty
                            trade.last_entry_price = fill_price
                            trade.num_entries += 1
                            equity -= fill_price * add_qty * p.commission_pct

        # ============ IN-TRADE MANAGEMENT + EXIT ============
        exit_reason: str | None = None
        exit_price: float = float("nan")

        if trade.in_trade:
            trade.bars_in_trade += 1
            trade.high_since_entry = max(trade.high_since_entry, high)

            # Adaptive trail multiplier based on trend
            atr_mult = p.atr_trail_mult
            if p.trend_adaptive_trail:
                ts = bar.get("trend_state", "UNKNOWN")
                if ts == "STRONG_UP":
                    atr_mult = p.atr_trail_mult * 1.4  # 40% wider
                elif ts in ("SIDEWAYS", "WEAK_UP", "UNKNOWN"):
                    atr_mult = p.atr_trail_mult * 1.0
                else:  # WEAK_DOWN, STRONG_DOWN
                    atr_mult = p.atr_trail_mult * 0.6  # 40% tighter

            chandelier = trade.high_since_entry - bar["atr"] * atr_mult
            if p.trail_method == "Chandelier":
                trail_cand = chandelier
            elif p.trail_method == "21EMA":
                trail_cand = bar["ema21"]
            elif p.trail_method == "10EMA":
                trail_cand = bar["ema10"]
            else:
                trail_cand = max(chandelier, bar["ema21"])

            if not math.isnan(trail_cand):
                trade.trail_stop = max(trade.trail_stop, trail_cand)

            if high >= trade.r1_target and not trade.t1_hit:
                trade.t1_hit = True
                if p.move_be_after_t1:
                    trade.trail_stop = max(trade.trail_stop, trade.entry_price)
            if high >= trade.r2_target and not trade.t2_hit:
                trade.t2_hit = True

            if low <= trade.trail_stop:
                exit_reason = "TrailExit"
                exit_price = trade.trail_stop * (1 - p.slippage_bps / 10000)
            elif bar["danger"] and p.exit_on_danger:
                exit_reason = "DangerExit"
                exit_price = close * (1 - p.slippage_bps / 10000)
            elif trade.bars_in_trade >= p.max_trade_bars:
                exit_reason = "TimeExit"
                exit_price = close * (1 - p.slippage_bps / 10000)

            if exit_reason:
                exit_commission = exit_price * trade.qty * p.commission_pct
                pnl = (exit_price - trade.entry_price) * trade.qty - exit_commission
                pnl_pct = (exit_price - trade.entry_price) / trade.entry_price * 100
                r_mult = (exit_price - trade.entry_price) / (trade.entry_price - trade.initial_stop)
                equity += pnl

                trades.append(
                    Trade(
                        ticker=ticker,
                        entry_date=bars[trade.entry_idx][date_col],
                        entry_price=trade.entry_price,
                        exit_date=date,
                        exit_price=exit_price,
                        exit_reason=exit_reason,
                        qty=trade.qty,
                        pnl=pnl,
                        pnl_pct=pnl_pct,
                        r_multiple=r_mult,
                        bars_in_trade=trade.bars_in_trade,
                        t1_hit=trade.t1_hit,
                        t2_hit=trade.t2_hit,
                    )
                )
                trade = TradeStateV2()

        setup.prev_fired = a_signal

        # Mark-to-market
        mtm = equity
        if trade.in_trade:
            mtm = equity + (close - trade.entry_price) * trade.qty
        equity_history.append(mtm)
        dates.append(date)

    # Build result
    result = BacktestResult(ticker=ticker, params=p, trades=trades)
    result.equity_curve = pd.Series(equity_history, index=pd.DatetimeIndex(dates))
    result.final_equity = equity_history[-1] if equity_history else p.initial_capital
    result.net_profit = result.final_equity - p.initial_capital
    result.net_profit_pct = result.net_profit / p.initial_capital * 100
    result.total_trades = len(trades)

    if trades:
        wins = [t for t in trades if t.pnl > 0]
        losses = [t for t in trades if t.pnl <= 0]
        result.wins = len(wins)
        result.losses = len(losses)
        result.win_rate = len(wins) / len(trades) * 100
        result.avg_win = sum(t.pnl for t in wins) / len(wins) if wins else 0.0
        result.avg_loss = sum(t.pnl for t in losses) / len(losses) if losses else 0.0
        total_win = sum(t.pnl for t in wins)
        total_loss = abs(sum(t.pnl for t in losses))
        result.profit_factor = total_win / total_loss if total_loss > 0 else float("inf") if total_win > 0 else 0.0

    eq = result.equity_curve
    running_max = eq.cummax()
    drawdown_pct = (eq / running_max - 1) * 100
    result.max_drawdown_pct = abs(drawdown_pct.min())
    result.max_drawdown = abs((eq - running_max).min())

    days = (eq.index[-1] - eq.index[0]).days
    years = days / 365.25 if days > 0 else 1.0
    if result.final_equity > 0 and p.initial_capital > 0 and years > 0:
        result.cagr = ((result.final_equity / p.initial_capital) ** (1 / years) - 1) * 100

    daily_ret = eq.pct_change().dropna()
    if len(daily_ret) > 1 and daily_ret.std() > 0:
        result.sharpe = (daily_ret.mean() / daily_ret.std()) * np.sqrt(252)

    first_close = df["close"].iloc[0]
    last_close = df["close"].iloc[-1]
    result.buy_hold_return_pct = (last_close / first_close - 1) * 100

    return result
