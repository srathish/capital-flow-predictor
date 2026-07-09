"""Metrics for the policy simulator. Pure functions over a trades DataFrame
with columns: day, pnl (sized $), cap (sized $ at risk), ret_pct (per-trade %),
mfe_pct, mae_pct, t_peak_min."""
import numpy as np
import pandas as pd


def compute_policy_metrics(trades: pd.DataFrame, universe_n: int) -> dict:
    n = len(trades)
    if n == 0:
        return {"n": 0, "kept_pct": 0.0}
    pnl = trades["pnl"]
    cap = trades["cap"].sum()
    wins = pnl > 0
    gross_win = pnl[wins].sum()
    gross_loss = -pnl[~wins].sum()
    daily = trades.groupby("day")["pnl"].sum().sort_index()
    equity = daily.cumsum()
    dd = (equity - equity.cummax()).min() if len(equity) else 0.0
    top5_n = max(1, int(np.ceil(n * 0.05)))
    top5 = pnl.nlargest(top5_n).sum()
    return {
        "n": n,
        "kept_pct": round(100 * n / universe_n, 1),
        "total_pnl": round(pnl.sum()),
        "ret_on_cap_pct": round(pnl.sum() / cap * 100, 2) if cap else np.nan,
        "avg_ret_pct": round(trades["ret_pct"].mean(), 2),
        "med_ret_pct": round(trades["ret_pct"].median(), 2),
        "win_rate": round(100 * wins.mean(), 1),
        "profit_factor": round(gross_win / gross_loss, 2) if gross_loss > 0 else np.inf,
        "max_drawdown": round(dd),
        "avg_mae_pct": round(trades["mae_pct"].mean(), 1),
        "avg_mfe_pct": round(trades["mfe_pct"].mean(), 1),
        "med_t_peak_min": round(trades["t_peak_min"].median(), 0),
        "pnl_per_day": round(daily.mean()) if len(daily) else 0,
        "worst_day": round(daily.min()) if len(daily) else 0,
        "best_day": round(daily.max()) if len(daily) else 0,
        "top5pct_share": round(100 * top5 / pnl.sum(), 0) if pnl.sum() > 0 else np.nan,
    }


def holdout_metrics(trades: pd.DataFrame, universe: pd.DataFrame) -> dict:
    """Stability slices: odd/even day-of-month + first/second half of window."""
    out = {}
    days_sorted = sorted(universe["day"].unique())
    mid = days_sorted[len(days_sorted) // 2]
    slices = {
        "odd": trades[trades["day"].str[-2:].astype(int) % 2 == 1],
        "even": trades[trades["day"].str[-2:].astype(int) % 2 == 0],
        "H1": trades[trades["day"] < mid],
        "H2": trades[trades["day"] >= mid],
    }
    for k, sub in slices.items():
        cap = sub["cap"].sum()
        out[f"ret_{k}"] = round(sub["pnl"].sum() / cap * 100, 1) if cap else np.nan
    return out


def breakdown(trades: pd.DataFrame, col: str) -> pd.DataFrame:
    if col not in trades.columns or trades.empty:
        return pd.DataFrame()
    g = trades.groupby(col, observed=True).apply(
        lambda x: pd.Series({
            "n": len(x),
            "ret_%": round(x["pnl"].sum() / x["cap"].sum() * 100, 1) if x["cap"].sum() else np.nan,
            "win_%": round(100 * (x["pnl"] > 0).mean(), 0),
        }), include_groups=False)
    return g.reset_index()


def stability_assessment(trades: pd.DataFrame, universe: pd.DataFrame, m: dict, T: dict) -> dict:
    """Nine pass/fail stability criteria -> stability_score + recommendation.
    Optimizes for out-of-sample survival, not backtest return."""
    tol = -T["neutral_tol_pct"]
    if m.get("n", 0) == 0:
        return {"stability_score": 0, "outlier_dependency_score": np.nan,
                "tail_dependency_percent": np.nan, "holdout_pass_count": 0,
                "regime_pass_count": "0/0", "recommended_status": "reject"}

    def split_ret(sub):
        cap = sub["cap"].sum()
        return sub["pnl"].sum() / cap * 100 if cap else np.nan

    # holdouts (odd/even + H1/H2)
    days_sorted = sorted(universe["day"].unique())
    mid = days_sorted[len(days_sorted) // 2]
    holdouts = [
        split_ret(trades[trades["day"].str[-2:].astype(int) % 2 == 1]),
        split_ret(trades[trades["day"].str[-2:].astype(int) % 2 == 0]),
        split_ret(trades[trades["day"] < mid]),
        split_ret(trades[trades["day"] >= mid]),
    ]
    holdout_pass = sum(1 for r in holdouts if pd.notna(r) and r > 0)

    # ticker + time-bucket splits (neutral-or-better)
    tick = [split_ret(g) for _, g in trades.groupby("ticker") if len(g) >= 5]
    tick_ok = all(pd.notna(r) and r >= tol for r in tick) if tick else False
    tb = trades.assign(b=pd.cut(trades["hr"], [9.5, 10, 11, 12, 13.5, 15, 15.5]))
    tbs = [split_ret(g) for _, g in tb.groupby("b", observed=True) if len(g) >= 5]
    tb_ok = all(pd.notna(r) and r >= tol for r in tbs) if tbs else False

    # regime cells (gex_state x daytype x trend) — count neutral-or-better
    cells, cells_ok = 0, 0
    for col in ["gex_state", "daytype", "trend_day"]:
        if col not in trades.columns: continue
        for _, g in trades.groupby(col, observed=True):
            if len(g) < 5: continue
            cells += 1
            r = split_ret(g)
            if pd.notna(r) and r >= tol: cells_ok += 1

    # outlier / tail dependency
    total = trades["pnl"].sum()
    if total > 0:
        best_trade = trades["pnl"].max() / total
        best_day = trades.groupby("day")["pnl"].sum().max() / total
        outlier = round(max(best_trade, best_day), 2)
        pos = trades.loc[trades["pnl"] > 0, "pnl"]
        top5 = pos.nlargest(max(1, int(np.ceil(len(trades) * 0.05)))).sum()
        tail = round(100 * top5 / pos.sum(), 0) if pos.sum() > 0 else np.nan
    else:
        outlier, tail = 1.0, np.nan

    cap_total = trades["cap"].sum()
    dd_ok = abs(m.get("max_drawdown", 0)) <= T["dd_max_frac_of_cap"] * cap_total

    checks = [
        m.get("avg_ret_pct", -1) > 0,
        m.get("med_ret_pct", -1) > 0,
        m.get("profit_factor", 0) > 1,
        dd_ok,
        holdout_pass >= 2 and holdouts[0] > 0 and holdouts[1] > 0,   # odd AND even
        holdout_pass == 4,                                           # both halves too
        tick_ok,
        tb_ok,
        outlier < T["outlier_max_share"] and (pd.isna(tail) or tail <= T["tail_max_share_pct"]),
    ]
    score = int(sum(bool(c) for c in checks))
    if total <= 0 or score < T["status_research_min"]:
        status = "reject"
    elif score >= T["status_strong_min"]:
        status = "strong_candidate"
    elif score >= T["status_candidate_min"]:
        status = "candidate"
    else:
        status = "research_more"
    return {
        "stability_score": score,
        "outlier_dependency_score": outlier,
        "tail_dependency_percent": tail,
        "holdout_pass_count": holdout_pass,
        "regime_pass_count": f"{cells_ok}/{cells}",
        "recommended_status": status,
    }
