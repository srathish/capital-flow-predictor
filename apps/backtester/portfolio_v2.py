"""Portfolio backtester v2 - adds research-driven hypotheses:

H1: 55-day Donchian breakout entry path (Turtle System 2)
H2: 500-day vs 200-day trend filter (research: 500d sleeve = stable compounding)
H3: Skip-month momentum (avoid recency bias - if last bar's signal, wait N bars)
H4: Relative-strength rotation - rank universe by N-period RS, only enter top N
H5: Multi-timeframe - require weekly trend up + daily breakout
H6: Profit-target scale-out

All toggleable for clean ablation. Built on top of portfolio.py architecture.
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
class PortfolioV2Params:
    initial_capital: float = 100_000.0
    risk_pct_equity: float = 1.0
    max_concurrent: int = 5
    commission_pct: float = 0.0005
    slippage_bps: float = 2.0

    # Entry params
    atr_len: int = 14
    atr_stop_mult: float = 2.0
    atr_trail_mult: float = 10.0
    max_trade_bars: int = 250

    # Pyramiding
    pyramid_max: int = 3
    pyramid_spacing_atr: float = 2.0
    pyramid_size_pct: float = 0.5

    # Trend filter — 200 or 500 day MA
    trend_ma_len: int = 200

    # Entry signal — pick one or combine
    use_ema_breakout: bool = True       # EMA stacked + close > prior bar high
    use_donchian_55: bool = False        # close > 55-day high
    use_donchian_20: bool = False        # close > 20-day high (faster)

    # RS rotation overlay
    use_rs_filter: bool = False
    rs_lookback: int = 126                # 6 months
    rs_skip_recent: int = 21              # skip last month (avoid recency bias)
    rs_top_pct: float = 0.30              # only enter if in top 30% of universe by RS

    # Profit-target scale-out
    use_partial_scale: bool = False
    scale1_r: float = 2.0                 # exit 1/3 at +2R
    scale2_r: float = 5.0                 # exit 1/3 at +5R


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
    scale1_done: bool = False
    scale2_done: bool = False


def precompute(df: pd.DataFrame, p: PortfolioV2Params) -> pd.DataFrame:
    o = df.copy()
    o["ema8"] = ema(o["close"], 8)
    o["ema21"] = ema(o["close"], 21)
    o["ema50"] = ema(o["close"], 50)
    o["ema_trend"] = ema(o["close"], p.trend_ma_len)
    o["atr"] = atr(o, p.atr_len)
    o["stacked"] = (o["ema8"] > o["ema21"]) & (o["ema21"] > o["ema50"]) & (o["ema50"] > o["ema_trend"])
    o["ema50_rising"] = o["ema50"] > o["ema50"].shift(10)
    o["close_gt_prev_high"] = o["close"] > o["high"].shift(1)
    o["ema_breakout"] = o["stacked"] & o["ema50_rising"] & o["close_gt_prev_high"]

    # Donchian breakouts (require close > prior N-day high, excluding today)
    o["donchian_55_high"] = o["high"].shift(1).rolling(55).max()
    o["donchian_20_high"] = o["high"].shift(1).rolling(20).max()
    o["donchian_55"] = o["close"] > o["donchian_55_high"]
    o["donchian_20"] = o["close"] > o["donchian_20_high"]

    # Danger
    o["stage4"] = (o["close"] < o["ema_trend"]) & (o["ema_trend"] < o["ema_trend"].shift(20))
    o["bear_stack"] = (o["ema8"] < o["ema21"]) & (o["ema21"] < o["ema50"]) & (o["ema50"] < o["ema_trend"])
    o["danger"] = o["stage4"] | o["bear_stack"]

    # RS metric — skip-month momentum
    if p.use_rs_filter:
        # ROC from (lookback) bars ago to (skip_recent) bars ago
        o["rs_score"] = (o["close"].shift(p.rs_skip_recent) / o["close"].shift(p.rs_lookback)) - 1
    else:
        o["rs_score"] = 0.0

    # Composite entry signal
    entry_components = []
    if p.use_ema_breakout: entry_components.append(o["ema_breakout"])
    if p.use_donchian_55: entry_components.append(o["donchian_55"])
    if p.use_donchian_20: entry_components.append(o["donchian_20"])
    o["entry_signal"] = pd.concat(entry_components, axis=1).any(axis=1) if entry_components else pd.Series(False, index=o.index)

    # Must also be in uptrend (above trend MA)
    o["entry_signal"] = o["entry_signal"] & (o["close"] > o["ema_trend"])

    return o.dropna()


def run_portfolio_v2(tickers: list[str], p: PortfolioV2Params,
                     start_date: str | None = None, end_date: str | None = None,
                     period: str = "max") -> dict:
    """Portfolio backtest with optional date window."""
    all_data = {}
    for tk in tickers:
        try:
            df = load_ohlcv(tk, period=period)
            if start_date: df = df[df.index >= start_date]
            if end_date: df = df[df.index < end_date]
            if len(df) >= 300:
                all_data[tk] = precompute(df, p)
        except Exception as e:
            print(f"  ! {tk}: {e}")

    if not all_data:
        return {}

    master_dates = sorted(set().union(*[set(df.index) for df in all_data.values()]))

    positions: dict[str, Position] = {}
    cash = p.initial_capital
    eq_hist = []
    trades = []

    for date in master_dates:
        # --- Exits ---
        for tk in list(positions.keys()):
            pos = positions[tk]
            df = all_data[tk]
            if date not in df.index:
                continue
            bar = df.loc[date]
            close, high, low = bar["close"], bar["high"], bar["low"]
            pos.bars_in_trade += 1
            pos.high_since_entry = max(pos.high_since_entry, high)
            chandelier = pos.high_since_entry - bar["atr"] * p.atr_trail_mult
            pos.trail_stop = max(pos.trail_stop, chandelier)

            # Partial scale-outs
            if p.use_partial_scale:
                r_unit = pos.entry_price - pos.initial_stop
                if not pos.scale1_done and high >= pos.entry_price + r_unit * p.scale1_r:
                    scale_qty = pos.qty // 3
                    if scale_qty >= 1:
                        sell_price = (pos.entry_price + r_unit * p.scale1_r) * (1 - p.slippage_bps / 10000)
                        proceeds = sell_price * scale_qty * (1 - p.commission_pct)
                        pnl = proceeds - pos.entry_price * scale_qty
                        cash += proceeds
                        pos.qty -= scale_qty
                        pos.scale1_done = True
                        trades.append({"ticker": tk, "pnl": pnl, "reason": "Scale1", "bars": pos.bars_in_trade})
                if not pos.scale2_done and high >= pos.entry_price + r_unit * p.scale2_r:
                    scale_qty = pos.qty // 2  # half of remaining
                    if scale_qty >= 1:
                        sell_price = (pos.entry_price + r_unit * p.scale2_r) * (1 - p.slippage_bps / 10000)
                        proceeds = sell_price * scale_qty * (1 - p.commission_pct)
                        pnl = proceeds - pos.entry_price * scale_qty
                        cash += proceeds
                        pos.qty -= scale_qty
                        pos.scale2_done = True
                        trades.append({"ticker": tk, "pnl": pnl, "reason": "Scale2", "bars": pos.bars_in_trade})

            # Exit checks
            exit_reason, exit_price = None, float("nan")
            if pos.qty <= 0:
                del positions[tk]
                continue
            if low <= pos.trail_stop:
                exit_reason = "TrailExit"; exit_price = pos.trail_stop * (1 - p.slippage_bps / 10000)
            elif bool(bar["danger"]):
                exit_reason = "DangerExit"; exit_price = close * (1 - p.slippage_bps / 10000)
            elif pos.bars_in_trade >= p.max_trade_bars:
                exit_reason = "TimeExit"; exit_price = close * (1 - p.slippage_bps / 10000)

            if exit_reason:
                proceeds = exit_price * pos.qty * (1 - p.commission_pct)
                pnl = proceeds - pos.entry_price * pos.qty
                cash += proceeds
                trades.append({"ticker": tk, "pnl": pnl, "reason": exit_reason, "bars": pos.bars_in_trade})
                del positions[tk]

        marked = sum(all_data[tk].loc[date]["close"] * pos.qty
                     for tk, pos in positions.items() if date in all_data[tk].index) if positions else 0.0
        equity = cash + marked

        # --- New entry candidates ---
        candidates = []
        for tk, df in all_data.items():
            if tk in positions or date not in df.index:
                continue
            bar = df.loc[date]
            if not (bool(bar["entry_signal"]) and not bool(bar["danger"])):
                continue
            candidates.append((tk, bar))

        # RS rotation overlay: rank candidates by RS, only keep top X%
        if p.use_rs_filter and candidates:
            # Score every ticker with current bar
            all_rs = []
            for tk, df in all_data.items():
                if date in df.index:
                    rs = df.loc[date].get("rs_score", 0)
                    if not pd.isna(rs):
                        all_rs.append((tk, rs))
            if all_rs:
                threshold_idx = max(1, int(len(all_rs) * p.rs_top_pct))
                top_tickers = set(tk for tk, _ in sorted(all_rs, key=lambda x: -x[1])[:threshold_idx])
                candidates = [(tk, bar) for tk, bar in candidates if tk in top_tickers]

        # Rank candidates by "tightest" entry (close - EMA50) / ATR — smaller = better
        candidates.sort(key=lambda x: (x[1]["close"] - x[1]["ema50"]) / x[1]["atr"] if x[1]["atr"] > 0 else 999)

        for tk, bar in candidates:
            if len(positions) >= p.max_concurrent:
                break
            close = bar["close"]
            init_stop = max(close - bar["atr"] * p.atr_stop_mult, bar["ema50"])
            if init_stop >= close:
                continue
            risk_cash = equity * p.risk_pct_equity / 100
            qty = int(math.floor(risk_cash / (close - init_stop)))
            if qty < 1:
                continue
            fill = close * (1 + p.slippage_bps / 10000)
            cost = fill * qty * (1 + p.commission_pct)
            if cost > cash:
                qty = int(math.floor(cash * 0.95 / (fill * (1 + p.commission_pct))))
                if qty < 1: continue
                cost = fill * qty * (1 + p.commission_pct)
                if cost > cash: continue
            cash -= cost
            positions[tk] = Position(
                ticker=tk, entry_date=date, entry_price=fill, qty=qty,
                initial_stop=init_stop, trail_stop=init_stop, high_since_entry=bar["high"],
            )

        marked = sum(all_data[tk].loc[date]["close"] * pos.qty
                     for tk, pos in positions.items() if date in all_data[tk].index) if positions else 0.0
        eq_hist.append({"date": date, "equity": cash + marked})

    eq_df = pd.DataFrame(eq_hist).set_index("date")
    if eq_df.empty:
        return {}
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
        "total_trades": len(trades),
        "wins": len(wins),
        "win_rate": len(wins) / len(trades) * 100 if trades else 0,
        "net_pct": net_pct, "cagr": cagr, "max_dd_pct": abs(dd_pct), "sharpe": sharpe,
        "final_equity": final, "equity_curve": eq_df,
    }


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


def main():
    print(f"Portfolio v2 ablation on {len(UNIVERSE)} tickers, 10y\n")

    variants = {
        "P1: baseline EMA-only":                   PortfolioV2Params(),
        "P2: + 500-day trend filter":              PortfolioV2Params(trend_ma_len=500),
        "P3: + Donchian 55 entry":                 PortfolioV2Params(use_donchian_55=True),
        "P4: Donchian 55 ONLY (no EMA)":           PortfolioV2Params(use_ema_breakout=False, use_donchian_55=True),
        "P5: Donchian 20 ONLY":                    PortfolioV2Params(use_ema_breakout=False, use_donchian_20=True),
        "P6: EMA + Donchian 55 combined":          PortfolioV2Params(use_donchian_55=True),
        "P7: + RS filter (top 30%)":               PortfolioV2Params(use_rs_filter=True, rs_top_pct=0.30),
        "P8: + RS filter (top 50%)":               PortfolioV2Params(use_rs_filter=True, rs_top_pct=0.50),
        "P9: + partial scale-out (1/3 @2R + @5R)": PortfolioV2Params(use_partial_scale=True),
        "P10: 500-day MA + Donchian 55":           PortfolioV2Params(trend_ma_len=500, use_donchian_55=True),
        "P11: max_concurrent=10":                  PortfolioV2Params(max_concurrent=10, risk_pct_equity=0.7),
        "P12: 500-day + RS top 30%":               PortfolioV2Params(trend_ma_len=500, use_rs_filter=True),
        "P13: ALL combined":                       PortfolioV2Params(trend_ma_len=500, use_donchian_55=True, use_rs_filter=True, use_partial_scale=True),
    }

    rows = []
    for label, p in variants.items():
        r = run_portfolio_v2(UNIVERSE, p, period="10y")
        if not r:
            continue
        rows.append({
            "variant": label,
            "trades": r["total_trades"],
            "win%": round(r["win_rate"], 1),
            "net%": round(r["net_pct"], 0),
            "cagr%": round(r["cagr"], 1),
            "dd%": round(r["max_dd_pct"], 1),
            "sharpe": round(r["sharpe"], 2),
        })
        print(f"  {label:42s} | net%={rows[-1]['net%']:6.0f} | CAGR={rows[-1]['cagr%']:5.1f} | DD={rows[-1]['dd%']:5.1f} | Sharpe={rows[-1]['sharpe']:.2f}")

    df = pd.DataFrame(rows).sort_values("sharpe", ascending=False)
    print("\n========= RANKED BY SHARPE =========")
    print(df.to_string(index=False))

    out_path = Path(__file__).parent / "results_portfolio_v2.csv"
    df.to_csv(out_path, index=False)


if __name__ == "__main__":
    main()
