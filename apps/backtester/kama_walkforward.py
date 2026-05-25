"""Walk-forward validation on KAMA strategy."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from data import load_ohlcv
from kama_test import KAMAParams, run_kama, precompute


# Need to modify to support date windows
def run_kama_window(tickers, p, start, end, period="max"):
    """Run KAMA backtest on a date window."""
    import math
    import numpy as np
    import pandas as pd
    from kama_test import Position

    all_data = {}
    for tk in tickers:
        try:
            df = load_ohlcv(tk, period=period)
            df = df[(df.index >= start) & (df.index < end)]
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
                trades.append({"ticker": tk, "pnl": pnl, "reason": er})
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
    import pandas as pd
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

    p_ema = KAMAParams(use_kama=False)
    p_kama = KAMAParams(use_kama=True)

    print("Walk-forward: EMA vs KAMA\n")
    splits = [
        ("EARLY 2012-2018", "2012-01-01", "2018-01-01"),
        ("LATE  2018-2026", "2018-01-01", "2026-06-01"),
        ("TRAIN 2014-2020", "2014-01-01", "2020-01-01"),
        ("TEST  2020-2026", "2020-01-01", "2026-06-01"),
    ]
    rows = []
    for label, start, end in splits:
        for name, p in [("EMA", p_ema), ("KAMA", p_kama)]:
            r = run_kama_window(UNIVERSE, p, start, end)
            if r:
                rows.append({"window": label, "ma_type": name, **{k: round(v, 2) if isinstance(v, float) else v for k, v in r.items()}})
                print(f"  {label:22s} {name:5s} | trades={r['trades']:3d}  net%={r['net_pct']:7.1f}  CAGR={r['cagr']:5.1f}  DD={r['max_dd_pct']:5.1f}  Sharpe={r['sharpe']:.2f}")

    df = pd.DataFrame(rows)
    print("\n========= EMA vs KAMA WALK-FORWARD =========")
    print(df.to_string(index=False))
    df.to_csv(Path(__file__).parent / "results_kama_walkforward.csv", index=False)
