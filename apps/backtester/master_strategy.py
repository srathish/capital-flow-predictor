"""
MASTER v3.1 Strategy — Python port of the Pine Script for systematic backtesting.

Mirrors the Pine logic bar-by-bar:
  - Setup state machine (BCS / HFS arming, trigger freeze, invalidation)
  - Grade gate, flow gate, danger filter
  - Entry on aSignal (close > frozen trigger + grade + flow)
  - Exit module (initial stop, ratcheting trail, R1/R2 targets, BE-after-T1,
    danger exit, time stop)
  - Single-position, no pyramiding

Used by backtest.py to run on historical OHLCV data.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd


# ============================================================
# Indicator helpers (pandas-native so we control the math)
# ============================================================
def ema(s: pd.Series, length: int) -> pd.Series:
    return s.ewm(span=length, adjust=False).mean()


def sma(s: pd.Series, length: int) -> pd.Series:
    return s.rolling(length).mean()


def stdev(s: pd.Series, length: int) -> pd.Series:
    return s.rolling(length).std(ddof=0)


def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    return tr


def atr(df: pd.DataFrame, length: int) -> pd.Series:
    # Pine ta.atr uses RMA (Wilder's smoothing). Match it exactly.
    tr = true_range(df)
    return tr.ewm(alpha=1 / length, adjust=False).mean()


def rolling_highest(s: pd.Series, length: int) -> pd.Series:
    return s.rolling(length).max()


def rolling_lowest(s: pd.Series, length: int) -> pd.Series:
    return s.rolling(length).min()


def mfi(df: pd.DataFrame, length: int) -> pd.Series:
    """Money Flow Index — matches Pine's ta.mfi(hlc3, length)."""
    tp = (df["high"] + df["low"] + df["close"]) / 3
    raw_money = tp * df["volume"]
    tp_diff = tp.diff()
    pos_flow = raw_money.where(tp_diff > 0, 0.0)
    neg_flow = raw_money.where(tp_diff < 0, 0.0)
    pos_sum = pos_flow.rolling(length).sum()
    neg_sum = neg_flow.rolling(length).sum()
    mfr = pos_sum / neg_sum.replace(0, np.nan)
    return 100 - (100 / (1 + mfr))


def cmf(df: pd.DataFrame, length: int) -> pd.Series:
    """Chaikin Money Flow — matches Pine's CMF computation."""
    hl = df["high"] - df["low"]
    mf_mult = np.where(hl == 0, 0.0, ((df["close"] - df["low"]) - (df["high"] - df["close"])) / hl.replace(0, np.nan))
    mf_vol = pd.Series(mf_mult, index=df.index) * df["volume"]
    return mf_vol.rolling(length).sum() / df["volume"].rolling(length).sum()


# ============================================================
# Strategy parameters — defaults match the Pine inputs
# ============================================================
@dataclass
class Params:
    # MAs
    ema_short: int = 8
    ema_mid: int = 21
    ema_long: int = 50
    ema_trend: int = 200

    # BCS (Base Compression)
    vol_len: int = 20
    vol_len_long: int = 50
    atr_len: int = 14
    atr_lookback: int = 60
    dry_up_ratio: float = 0.80
    ema_tight_pct: float = 2.0

    # HFS (Handle / Flag)
    swing_look: int = 30
    handle_max: int = 15
    pull_min: float = 3.0
    pull_max: float = 22.0
    vol_dry_handle: float = 0.90
    range_comp_pct: float = 0.70

    # Grade
    bb_len: int = 20
    bb_mult: float = 2.0
    breakout_vol: float = 1.5
    strong_close: float = 0.65
    range_exp_mult: float = 1.2
    min_grade: int = 3

    # Flow
    flow_len: int = 20
    mfi_bull: float = 50.0
    require_flow: bool = True

    # Invalidation
    invalid_pct_low: float = 3.0
    invalid_pct_ema: float = 3.0
    invalid_max_bars: int = 30

    # Exits
    stop_method: str = "Max of ATR and 50EMA"  # ATR / Setup Low / 50EMA / Max of ATR and 50EMA
    atr_stop_mult: float = 2.0
    trail_method: str = "Chandelier OR 21EMA"  # Chandelier / 21EMA / 10EMA / Chandelier OR 21EMA
    atr_trail_mult: float = 3.0
    t1_rmult: float = 2.0
    t2_rmult: float = 3.0
    move_be_after_t1: bool = True
    exit_on_danger: bool = True
    max_trade_bars: int = 60

    # Sizing / costs
    initial_capital: float = 100_000.0
    risk_pct_equity: float = 1.0
    commission_pct: float = 0.0005  # 0.05% per side
    slippage_bps: float = 2.0  # basis points (0.02%) — approximates 2 ticks on liquid stocks


# ============================================================
# Backtest result records
# ============================================================
@dataclass
class Trade:
    ticker: str
    entry_date: pd.Timestamp
    entry_price: float
    exit_date: pd.Timestamp
    exit_price: float
    exit_reason: str  # TrailExit / DangerExit / TimeExit
    qty: int
    pnl: float
    pnl_pct: float
    r_multiple: float
    bars_in_trade: int
    t1_hit: bool
    t2_hit: bool


@dataclass
class BacktestResult:
    ticker: str
    params: Params
    trades: list[Trade] = field(default_factory=list)
    equity_curve: pd.Series | None = None
    final_equity: float = 0.0
    net_profit: float = 0.0
    net_profit_pct: float = 0.0
    total_trades: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    profit_factor: float = 0.0
    max_drawdown: float = 0.0
    max_drawdown_pct: float = 0.0
    sharpe: float = 0.0
    buy_hold_return_pct: float = 0.0
    cagr: float = 0.0

    def summary_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "trades": self.total_trades,
            "win_rate%": round(self.win_rate, 1),
            "net_profit$": round(self.net_profit, 0),
            "net_profit%": round(self.net_profit_pct, 1),
            "cagr%": round(self.cagr, 1),
            "buy_hold%": round(self.buy_hold_return_pct, 1),
            "max_dd%": round(self.max_drawdown_pct, 1),
            "profit_factor": round(self.profit_factor, 2),
            "sharpe": round(self.sharpe, 2),
            "avg_win$": round(self.avg_win, 0),
            "avg_loss$": round(self.avg_loss, 0),
        }


# ============================================================
# Precompute all bar-level indicators
# ============================================================
def precompute(df: pd.DataFrame, p: Params) -> pd.DataFrame:
    """Add all derived columns the strategy needs."""
    o = df.copy()
    # MAs
    o["ema8"] = ema(o["close"], p.ema_short)
    o["ema10"] = ema(o["close"], 10)
    o["ema21"] = ema(o["close"], p.ema_mid)
    o["ema50"] = ema(o["close"], p.ema_long)
    o["ema200"] = ema(o["close"], p.ema_trend)

    # Vol MAs
    o["volMA"] = sma(o["volume"], p.vol_len)
    o["volMA50"] = sma(o["volume"], p.vol_len_long)
    o["handleVolMA"] = sma(o["volume"], 5)

    # ATR
    o["atr"] = atr(o, p.atr_len)
    o["atrPast"] = o["atr"].shift(p.atr_lookback)
    o["atrContracted"] = (o["atr"] < o["atrPast"] * 0.80) & o["atrPast"].notna()

    # BB
    o["bbBasis"] = sma(o["close"], p.bb_len)
    o["bbDev"] = p.bb_mult * stdev(o["close"], p.bb_len)
    o["bbUpper"] = o["bbBasis"] + o["bbDev"]
    o["bbLower"] = o["bbBasis"] - o["bbDev"]
    o["bbWidth"] = np.where(o["bbBasis"] != 0, (o["bbUpper"] - o["bbLower"]) / o["bbBasis"], 0.0)
    bb_range = o["bbUpper"] - o["bbLower"]
    o["bbPctB"] = np.where(bb_range != 0, (o["close"] - o["bbLower"]) / bb_range, 0.5)
    o["bbThrust"] = o["bbPctB"] > 0.8
    o["bbExpand"] = o["bbWidth"] > o["bbWidth"].shift(1)

    # Stage 2 (BCS)
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
    o["bcsScore"] = (
        o["stage2"].astype(int)
        + o["dryUp"].astype(int)
        + o["atrContracted"].astype(int)
        + o["emaTight"].astype(int)
        + o["inBaseZone"].astype(int)
    )
    o["bcsReady"] = o["bcsScore"] >= 4

    # HFS
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
    o["hfsScore"] = (
        o["uptrend"].astype(int)
        + o["inPullbackZone"].astype(int)
        + o["holdingEma"].astype(int)
        + o["rangeCompressed"].astype(int)
        + o["volDryInHandle"].astype(int)
    )
    o["hfsReady"] = o["hfsScore"] >= 4

    # Danger / caution
    o["stage4"] = (o["close"] < o["ema200"]) & (o["ema200"] < o["ema200"].shift(20))
    o["bearStack"] = (o["ema8"] < o["ema21"]) & (o["ema21"] < o["ema50"]) & (o["ema50"] < o["ema200"])
    o["danger"] = o["stage4"] | o["bearStack"]
    o["caution"] = (o["close"] < o["ema50"]) & (o["ema21"] < o["ema21"].shift(5)) & (~o["danger"])

    # Trigger candidates
    o["priorHigh20"] = rolling_highest(o["high"].shift(1), 20)
    o["handleHigh"] = rolling_highest(o["high"].shift(1), p.handle_max)
    o["setupLow10"] = rolling_lowest(o["low"].shift(1), 10)

    # Grade
    o["rvol"] = np.where(o["volMA"].shift(1) > 0, o["volume"] / o["volMA"].shift(1), 0.0)
    o["volSurge"] = o["rvol"] >= p.breakout_vol
    hl = o["high"] - o["low"]
    o["closePos"] = np.where(hl == 0, 0.5, (o["close"] - o["low"]) / hl.replace(0, np.nan))
    o["strongBar"] = (hl > 0) & (o["closePos"] >= p.strong_close)
    o["rangeExp"] = hl > o["atr"] * p.range_exp_mult
    o["grade"] = (
        o["volSurge"].astype(int)
        + o["strongBar"].astype(int)
        + o["rangeExp"].astype(int)
        + o["bbThrust"].astype(int)
        + o["bbExpand"].astype(int)
    )

    # Flow
    o["mfi"] = mfi(o, p.flow_len)
    o["cmf"] = cmf(o, p.flow_len)
    o["flowOk"] = (o["mfi"] > p.mfi_bull) & (o["cmf"] > 0)

    # Initial stop candidates
    stop_atr = o["close"] - o["atr"] * p.atr_stop_mult
    if p.stop_method == "ATR":
        o["stopInit"] = stop_atr
    elif p.stop_method == "50EMA":
        o["stopInit"] = o["ema50"]
    elif p.stop_method == "Setup Low":
        o["stopInit"] = np.nan  # filled per-bar from state machine setupLow
    else:  # Max of ATR and 50EMA
        o["stopInit"] = np.maximum(stop_atr, o["ema50"])

    return o


# ============================================================
# State machine for setup arming (mirrors Pine's prevFired pattern)
# ============================================================
@dataclass
class SetupState:
    armed: bool = False
    locked_phase: str = "NEUTRAL"
    trigger: float = float("nan")
    setup_low: float = float("nan")
    bars_armed: int = 0
    prev_fired: bool = False


# ============================================================
# State machine for active trade
# ============================================================
@dataclass
class TradeState:
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


# ============================================================
# Core backtest loop
# ============================================================
def run_backtest(df_in: pd.DataFrame, p: Params, ticker: str = "?") -> BacktestResult:
    """Run the MASTER strategy on a single OHLCV DataFrame."""
    df = precompute(df_in, p)
    df = df.dropna(subset=["ema200", "atr", "volMA50"]).copy()
    if len(df) < 50:
        return BacktestResult(ticker=ticker, params=p)

    setup = SetupState()
    trade = TradeState()
    trades: list[Trade] = []

    equity = p.initial_capital
    equity_history: list[float] = []
    dates: list[pd.Timestamp] = []

    bars = df.reset_index().to_dict("records")  # list of dicts for fast iteration
    date_col = "Date" if "Date" in bars[0] else "index"

    for i, bar in enumerate(bars):
        date = bar[date_col]
        close = bar["close"]
        high = bar["high"]
        low = bar["low"]

        # ============ SETUP STATE MACHINE ============
        new_arm = (bar["bcsReady"] or bar["hfsReady"]) and (not setup.armed) and (not bar["danger"])
        if new_arm:
            setup.armed = True
            setup.locked_phase = "BASE" if bar["bcsScore"] >= bar["hfsScore"] else "HANDLE"
            setup.trigger = bar["priorHigh20"] if setup.locked_phase == "BASE" else bar["handleHigh"]
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

        # armed[1] = setup was armed at start of bar (before this bar's update? Pine convention)
        # We use the value we had AFTER updates this bar, simulating armed[1] for next bar.
        # For aSignal we need "armed prior to this bar" — we approximate with prev_armed snapshot.

        # ============ aSIGNAL ============
        # Pine: aSignal requires armed[1] (armed as of prior bar). We track it.
        # Trick: we snapshot armed BEFORE this bar's mutation. We'll use a small look-back trick:
        # Compute "armed_at_bar_start" as the setup.armed value before this bar's arm/disarm logic.
        # Easier: aSignal fires only if we WERE armed at bar start (i.e., this bar didn't just arm).
        # That means: setup.armed is True AND not new_arm.
        armed_for_signal = setup.armed and not new_arm

        broke_trigger = (not math.isnan(setup.trigger)) and close > setup.trigger
        grade_ok = bar["grade"] >= p.min_grade
        flow_ok = bar["flowOk"] or not p.require_flow

        a_signal = (
            (not bar["danger"]) and armed_for_signal and broke_trigger and grade_ok and flow_ok
        )

        # ============ ENTRY ============
        if a_signal and not trade.in_trade:
            # Initial stop value (Setup Low requires the live setupLow value)
            if p.stop_method == "Setup Low":
                init_stop = setup.setup_low
            else:
                init_stop = bar["stopInit"]

            if not math.isnan(init_stop) and init_stop < close:
                risk_per_share = close - init_stop
                risk_cash = equity * p.risk_pct_equity / 100
                qty = int(math.floor(risk_cash / risk_per_share))
                if qty >= 1:
                    # Apply slippage on entry (buy at slightly higher price)
                    fill_price = close * (1 + p.slippage_bps / 10000)
                    cost = fill_price * qty * (1 + p.commission_pct)
                    if cost <= equity:
                        trade.in_trade = True
                        trade.entry_idx = i
                        trade.entry_price = fill_price
                        trade.qty = qty
                        trade.initial_stop = init_stop
                        trade.r1_target = fill_price + (fill_price - init_stop) * p.t1_rmult
                        trade.r2_target = fill_price + (fill_price - init_stop) * p.t2_rmult
                        trade.trail_stop = init_stop
                        trade.high_since_entry = high
                        trade.bars_in_trade = 0
                        trade.t1_hit = False
                        trade.t2_hit = False
                        equity -= fill_price * qty * p.commission_pct  # pay commission

        # ============ IN-TRADE MANAGEMENT + EXIT ============
        exit_reason: str | None = None
        exit_price: float = float("nan")

        if trade.in_trade:
            trade.bars_in_trade += 1
            trade.high_since_entry = max(trade.high_since_entry, high)

            # Update trail
            chandelier = trade.high_since_entry - bar["atr"] * p.atr_trail_mult
            if p.trail_method == "Chandelier":
                trail_cand = chandelier
            elif p.trail_method == "21EMA":
                trail_cand = bar["ema21"]
            elif p.trail_method == "10EMA":
                trail_cand = bar["ema10"]
            else:  # Chandelier OR 21EMA (wider)
                trail_cand = max(chandelier, bar["ema21"])

            if not math.isnan(trail_cand):
                trade.trail_stop = max(trade.trail_stop, trail_cand)

            # T1 / T2 hit detection (uses bar high)
            if high >= trade.r1_target and not trade.t1_hit:
                trade.t1_hit = True
                if p.move_be_after_t1:
                    trade.trail_stop = max(trade.trail_stop, trade.entry_price)
            if high >= trade.r2_target and not trade.t2_hit:
                trade.t2_hit = True

            # Exit checks (priority order: stop hit intrabar > danger > time)
            # Stop hit: if low <= trail_stop, exit at trail_stop (assume stop order filled)
            if low <= trade.trail_stop:
                exit_reason = "TrailExit"
                # Fill at trail_stop minus slippage
                exit_price = trade.trail_stop * (1 - p.slippage_bps / 10000)
            elif bar["danger"] and p.exit_on_danger:
                exit_reason = "DangerExit"
                exit_price = close * (1 - p.slippage_bps / 10000)
            elif trade.bars_in_trade >= p.max_trade_bars:
                exit_reason = "TimeExit"
                exit_price = close * (1 - p.slippage_bps / 10000)

            if exit_reason:
                proceeds = exit_price * trade.qty * (1 - p.commission_pct)
                cost_basis = trade.entry_price * trade.qty
                pnl = proceeds - cost_basis
                pnl_pct = pnl / cost_basis * 100
                r_mult = (exit_price - trade.entry_price) / (trade.entry_price - trade.initial_stop)
                equity += pnl  # commission was paid on entry; we apply on exit too
                # Actually equity needs the gross proceeds back, not net of cost basis.
                # Let me recompute cleanly:
                # On entry: equity -= fill_price * qty * commission (commission paid)
                #           position cost = fill_price * qty (held in stock)
                # On exit:  equity += exit_price * qty - exit_price * qty * commission
                #           - (fill_price * qty)  [the original cost basis comes back as PnL]
                # Net delta to equity from open to close = (exit - entry)*qty - both_commissions
                # But I already subtracted entry commission above. Now I need:
                #   equity_change = (exit_price - fill_price) * qty - exit_price * qty * commission
                # Let me rewrite:
                # ... redo this cleanly below.

                # CLEAN re-calc:
                # entry commission was already taken from equity above
                # now apply exit: equity += pnl - exit_commission
                exit_commission = exit_price * trade.qty * p.commission_pct
                # Undo wrong += pnl line above and apply correct:
                equity -= pnl  # undo
                equity += (exit_price - trade.entry_price) * trade.qty - exit_commission

                trades.append(
                    Trade(
                        ticker=ticker,
                        entry_date=bars[trade.entry_idx][date_col],
                        entry_price=trade.entry_price,
                        exit_date=date,
                        exit_price=exit_price,
                        exit_reason=exit_reason,
                        qty=trade.qty,
                        pnl=(exit_price - trade.entry_price) * trade.qty - exit_commission,
                        pnl_pct=pnl_pct,
                        r_multiple=r_mult,
                        bars_in_trade=trade.bars_in_trade,
                        t1_hit=trade.t1_hit,
                        t2_hit=trade.t2_hit,
                    )
                )
                trade = TradeState()  # reset

        # Update prev_fired for next bar's setup state machine
        setup.prev_fired = a_signal

        # Mark-to-market equity
        mtm = equity
        if trade.in_trade:
            mtm = equity + (close - trade.entry_price) * trade.qty
        equity_history.append(mtm)
        dates.append(date)

    # ============ BUILD RESULT ============
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

    # Max drawdown
    eq = result.equity_curve
    running_max = eq.cummax()
    drawdown = eq - running_max
    drawdown_pct = (eq / running_max - 1) * 100
    result.max_drawdown = abs(drawdown.min())
    result.max_drawdown_pct = abs(drawdown_pct.min())

    # CAGR
    days = (eq.index[-1] - eq.index[0]).days
    years = days / 365.25 if days > 0 else 1.0
    if result.final_equity > 0 and p.initial_capital > 0 and years > 0:
        result.cagr = ((result.final_equity / p.initial_capital) ** (1 / years) - 1) * 100

    # Sharpe (daily returns based)
    daily_ret = eq.pct_change().dropna()
    if len(daily_ret) > 1 and daily_ret.std() > 0:
        result.sharpe = (daily_ret.mean() / daily_ret.std()) * np.sqrt(252)

    # Buy & hold benchmark
    first_close = df["close"].iloc[0]
    last_close = df["close"].iloc[-1]
    result.buy_hold_return_pct = (last_close / first_close - 1) * 100

    return result
