"""Phase 2 analyses — one function per task. Each reads from cache, prints a table
and a short narrative, and returns a dict of the key numbers."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from .metrics import gex_to_long_df, load_gex, load_max_pain, load_strike

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output"
OUT.mkdir(exist_ok=True)

SCAN_DATE = pd.Timestamp("2026-05-18")


# ============================================================================
# Task 1 — Clean Energy: ENPH (+40%) vs MSFT (+0.8%)
# ============================================================================
def task1_clean_energy() -> dict:
    enph = load_gex("ENPH")
    msft = load_gex("MSFT")
    if enph.empty or msft.empty:
        return {"_status": "missing data — ENPH:" + str(len(enph)) + " MSFT:" + str(len(msft))}

    rows = []
    for tkr, df in [("ENPH", enph), ("MSFT", msft)]:
        pre = df[df["date"] < SCAN_DATE]
        post = df[df["date"] >= SCAN_DATE]
        rows.append({
            "ticker": tkr,
            "call_dom_pre_May18_pct": round(pre["call_dominance_pct"].mean(), 1),
            "call_dom_post_May18_pct": round(post["call_dominance_pct"].mean(), 1),
            "delta_skew_pre": round(pre["delta_skew"].mean(), 2),
            "delta_skew_post": round(post["delta_skew"].mean(), 2),
            "net_delta_pre_mean": f"{pre['net_delta'].mean():,.0f}",
            "net_delta_post_mean": f"{post['net_delta'].mean():,.0f}",
            "net_delta_buildup_pct": round(
                (post["net_delta"].mean() - pre["net_delta"].mean())
                / abs(pre["net_delta"].mean()) * 100, 1
            ),
            "gamma_skew_post": round(post["gamma_skew"].mean(), 2),
            "vanna_pre_mean": f"{pre['net_vanna'].mean():,.0f}",
            "vanna_post_mean": f"{post['net_vanna'].mean():,.0f}",
        })
    summary = pd.DataFrame(rows)
    print("\n=== Task 1 — Clean Energy: ENPH vs MSFT ===")
    print(summary.to_string(index=False))

    # Daily timeseries comparison (call dominance %)
    combo = pd.concat([
        enph.assign(ticker="ENPH"),
        msft.assign(ticker="MSFT"),
    ])
    pivot = combo.pivot_table(index="date", columns="ticker",
                              values="call_dominance_pct", aggfunc="mean")
    pivot.columns = [f"{c}_call_dom_pct" for c in pivot.columns]
    pivot = pivot.round(1)
    print("\n--- Daily call-dominance % (call_delta / (call_delta + |put_delta|)) ---")
    print(pivot.to_string())

    pivot.to_csv(OUT / "task1_daily_call_dom.csv")
    summary.to_csv(OUT / "task1_summary.csv", index=False)
    return {"summary": rows, "daily_pivot": pivot}


# ============================================================================
# Task 2 — VIX A+ 97 failure
# ============================================================================
def task2_vix() -> dict:
    vix = load_gex("VIX")
    if vix.empty:
        return {"_status": "no VIX data"}

    # Pre-scan trajectory (May 1-15) and post (May 18+)
    print("\n=== Task 2 — VIX A+ 97 failure ===")
    print("\n--- Daily VIX dealer GEX (May 1-28) ---")
    show = vix[["date", "call_dominance_pct", "delta_skew", "gamma_skew",
                "net_delta", "net_gamma", "net_charm"]].copy()
    show["date"] = show["date"].dt.strftime("%m-%d")
    show["net_delta"] = show["net_delta"].apply(lambda x: f"{x:>12,.0f}")
    show["net_gamma"] = show["net_gamma"].apply(lambda x: f"{x:>10,.0f}")
    show["net_charm"] = show["net_charm"].apply(lambda x: f"{x:>14,.0f}")
    show["call_dominance_pct"] = show["call_dominance_pct"].round(1)
    show["delta_skew"] = show["delta_skew"].round(2)
    show["gamma_skew"] = show["gamma_skew"].round(2)
    print(show.to_string(index=False))

    # Key inflection: when did call_dominance and delta_skew start collapsing?
    pre = vix[vix["date"] < SCAN_DATE]
    post = vix[vix["date"] >= SCAN_DATE]
    summary = {
        "May1-15 mean call dom %": round(pre["call_dominance_pct"].mean(), 1),
        "May18-28 mean call dom %": round(post["call_dominance_pct"].mean(), 1),
        "May1-15 mean delta skew": round(pre["delta_skew"].mean(), 2),
        "May18-28 mean delta skew": round(post["delta_skew"].mean(), 2),
        "Net charm May15 (last pre-scan)":
            f"{pre.iloc[-1]['net_charm']:,.0f}" if not pre.empty else "n/a",
        "Net charm May18 (scan day)":
            f"{post.iloc[0]['net_charm']:,.0f}" if not post.empty else "n/a",
    }
    print("\nSummary:")
    for k, v in summary.items():
        print(f"  {k:40s} {v}")
    vix.to_csv(OUT / "task2_vix.csv", index=False)
    return {"summary": summary, "daily": vix}


# ============================================================================
# Task 3 — Crypto internals: CLSK MARA vs MSTR IBIT ETHA
# ============================================================================
def task3_crypto() -> dict:
    tickers = ["CLSK", "MARA", "MSTR", "IBIT", "ETHA"]
    combo = gex_to_long_df(tickers)
    if combo.empty:
        return {"_status": "no crypto data"}

    # Per-ticker pre/post summary
    rows = []
    for t in tickers:
        sub = combo[combo["ticker"] == t]
        if sub.empty:
            rows.append({"ticker": t, "_status": "missing"})
            continue
        pre = sub[sub["date"] < SCAN_DATE]
        post = sub[sub["date"] >= SCAN_DATE]
        rows.append({
            "ticker": t,
            "call_dom_pre_pct": round(pre["call_dominance_pct"].mean(), 1),
            "call_dom_post_pct": round(post["call_dominance_pct"].mean(), 1),
            "delta_skew_post": round(post["delta_skew"].mean(), 2),
            "net_delta_buildup_pct": round(
                (post["net_delta"].mean() - pre["net_delta"].mean())
                / abs(pre["net_delta"].mean()) * 100, 1
            ) if pre["net_delta"].mean() != 0 else float("nan"),
            "gamma_skew_post": round(post["gamma_skew"].mean(), 2),
        })
    df = pd.DataFrame(rows)
    print("\n=== Task 3 — Crypto internals ===")
    print(df.to_string(index=False))

    # Correlation of daily net_delta across the 5 tickers
    pivot = combo.pivot_table(index="date", columns="ticker",
                              values="call_dominance_pct", aggfunc="mean")
    pivot = pivot[[t for t in tickers if t in pivot.columns]]
    corr = pivot.corr().round(2)
    print("\n--- Correlation matrix: daily call-dominance % across crypto basket ---")
    print(corr.to_string())

    # Miners (CLSK MARA) vs Tokens/Treasury (MSTR IBIT ETHA) divergence
    miners = pivot[[c for c in ["CLSK", "MARA"] if c in pivot.columns]].mean(axis=1)
    tokens = pivot[[c for c in ["MSTR", "IBIT", "ETHA"] if c in pivot.columns]].mean(axis=1)
    spread = (miners - tokens).round(1)
    spread_df = pd.DataFrame({
        "miners_call_dom_pct": miners.round(1),
        "tokens_call_dom_pct": tokens.round(1),
        "miners_minus_tokens": spread,
    })
    print("\n--- Miners vs tokens daily spread ---")
    print(spread_df.to_string())

    df.to_csv(OUT / "task3_summary.csv", index=False)
    corr.to_csv(OUT / "task3_corr.csv")
    spread_df.to_csv(OUT / "task3_spread.csv")
    return {"summary": rows, "corr": corr, "spread": spread_df}


# ============================================================================
# Task 4 — Target misses: GOOGL/AMZN/SHOP — did vanna flip / walls shift?
# ============================================================================
def task4_target_misses() -> dict:
    print("\n=== Task 4 — Target misses (GOOGL/AMZN/SHOP) wall structure shifts ===")
    out = {}
    for ticker, st_target in [("GOOGL", 407.50), ("AMZN", 270.0), ("SHOP", 110.0)]:
        for date in ["2026-05-18", "2026-05-22"]:
            df = load_strike(ticker, date)
            if df.empty:
                print(f"  {ticker} {date}: no strike data")
                continue
            # Find the strike nearest the published st_target
            df["dist_to_target"] = (df["strike"] - st_target).abs()
            near = df.nsmallest(3, "dist_to_target")[["strike", "net_gamma", "net_vanna",
                                                       "call_gamma", "put_gamma"]]
            print(f"\n--- {ticker} {date} — gamma structure near published target {st_target} ---")
            print(near.to_string(index=False))
            out[f"{ticker}_{date}"] = near.to_dict("records")

    # Also load timeseries GEX for these three to look at total vanna shift
    for t in ["GOOGL", "AMZN", "SHOP"]:
        g = load_gex(t)
        if g.empty:
            continue
        w = g[(g["date"] >= "2026-05-15") & (g["date"] <= "2026-05-28")]
        print(f"\n--- {t} timeseries: net_vanna + net_gamma May 15-28 ---")
        sub = w[["date", "net_gamma", "net_vanna", "call_dominance_pct"]].copy()
        sub["date"] = sub["date"].dt.strftime("%m-%d")
        sub["net_gamma"] = sub["net_gamma"].apply(lambda x: f"{x:>10,.0f}")
        sub["net_vanna"] = sub["net_vanna"].apply(lambda x: f"{x:>10,.0f}")
        sub["call_dominance_pct"] = sub["call_dominance_pct"].round(1)
        print(sub.to_string(index=False))

    return out


# ============================================================================
# Task 5 — Ungraded mystery: ENPH/MU/SMCI vs FSLR/SHOP/CLSK
# ============================================================================
def task5_ungraded() -> dict:
    ungraded = ["ENPH", "MU", "SMCI"]
    graded = ["FSLR", "SHOP", "CLSK"]

    rows = []
    for kind, group in [("ungraded", ungraded), ("graded A+ 100", graded)]:
        for t in group:
            df = load_gex(t)
            if df.empty:
                rows.append({"group": kind, "ticker": t, "_status": "missing"})
                continue
            pre = df[df["date"] < SCAN_DATE]
            post = df[df["date"] >= SCAN_DATE]
            rows.append({
                "group": kind,
                "ticker": t,
                "call_dom_pre_pct": round(pre["call_dominance_pct"].mean(), 1),
                "call_dom_post_pct": round(post["call_dominance_pct"].mean(), 1),
                "delta_skew_post": round(post["delta_skew"].mean(), 2),
                "net_delta_buildup_pct": round(
                    (post["net_delta"].mean() - pre["net_delta"].mean())
                    / abs(pre["net_delta"].mean()) * 100, 1
                ) if pre["net_delta"].mean() != 0 else float("nan"),
                "net_delta_post_mean": f"{post['net_delta'].mean():,.0f}",
                "vanna_post_mean": f"{post['net_vanna'].mean():,.0f}",
            })
    df = pd.DataFrame(rows)
    print("\n=== Task 5 — Ungraded vs A+ 100 graded ===")
    print(df.to_string(index=False))
    df.to_csv(OUT / "task5_summary.csv", index=False)
    return {"summary": rows}


# ============================================================================
# Task 6 — Hedge complex failure: VIX SQQQ QQQ SMH IGV
# ============================================================================
def task6_hedge_complex() -> dict:
    tickers = ["VIX", "SQQQ", "QQQ", "SMH", "IGV"]
    combo = gex_to_long_df(tickers)
    if combo.empty:
        return {"_status": "no hedge data"}

    rows = []
    for t in tickers:
        sub = combo[combo["ticker"] == t]
        if sub.empty:
            continue
        # When did call dominance peak / when did it flip?
        pre = sub[sub["date"] < SCAN_DATE]
        post = sub[sub["date"] >= SCAN_DATE]
        max_call_dom = sub.loc[sub["call_dominance_pct"].idxmax()]
        rows.append({
            "ticker": t,
            "call_dom_pre_pct": round(pre["call_dominance_pct"].mean(), 1),
            "call_dom_post_pct": round(post["call_dominance_pct"].mean(), 1),
            "delta_skew_pre": round(pre["delta_skew"].mean(), 2),
            "delta_skew_post": round(post["delta_skew"].mean(), 2),
            "max_call_dom_date": max_call_dom["date"].strftime("%Y-%m-%d"),
            "max_call_dom_pct": round(max_call_dom["call_dominance_pct"], 1),
        })
    df = pd.DataFrame(rows)
    print("\n=== Task 6 — Hedge complex (VIX SQQQ QQQ SMH IGV) ===")
    print(df.to_string(index=False))

    # Cross-correlation of daily call dominance across hedges
    pivot = combo.pivot_table(index="date", columns="ticker",
                              values="call_dominance_pct", aggfunc="mean")
    pivot = pivot[[t for t in tickers if t in pivot.columns]]
    corr = pivot.corr().round(2)
    print("\n--- Correlation matrix: daily call-dominance % across hedge complex ---")
    print(corr.to_string())

    # Daily series printed
    print("\n--- Daily call-dominance % across hedges ---")
    print(pivot.round(1).to_string())

    df.to_csv(OUT / "task6_summary.csv", index=False)
    corr.to_csv(OUT / "task6_corr.csv")
    pivot.to_csv(OUT / "task6_daily.csv")
    return {"summary": rows, "corr": corr, "daily": pivot}


# ============================================================================
# Run all
# ============================================================================
def run_all() -> None:
    task1_clean_energy()
    task2_vix()
    task3_crypto()
    task4_target_misses()
    task5_ungraded()
    task6_hedge_complex()


if __name__ == "__main__":
    run_all()
