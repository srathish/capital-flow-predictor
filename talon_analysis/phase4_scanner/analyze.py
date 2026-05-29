"""Phase 4 analysis — produce theme + DP + grade rollups from the saved scan."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SCAN = ROOT / "output" / "scan_2026-05-29.json"
OUT = ROOT / "output"


def main():
    data = json.loads(SCAN.read_text())
    rows = data["actionable"] + data["watchlist"]
    df = pd.DataFrame(rows)
    print(f"=== Talon Phase 4 — Universe Scan {data['scan_date']} ===")
    print(f"Universe: {data['universe_total']}, with GEX data: {data['with_gex_data']}, "
          f"actionable: {data['actionable_count']}, watchlist: {data['watchlist_count']}")
    print()

    # ---- Top 25 actionable ----
    print("=== TOP 25 ACTIONABLE SETUPS ===")
    cols = ["ticker", "grade", "direction", "theme", "call_dom_now",
            "delta_buildup_pct", "vanna_ratio_5d_back", "theme_coherence",
            "dp_skew_pct", "dp_share_pct"]
    top = df[df["grade"] >= 70].nlargest(25, "grade")[cols].copy()
    for c in ["call_dom_now", "delta_buildup_pct", "vanna_ratio_5d_back",
              "theme_coherence", "dp_skew_pct", "dp_share_pct"]:
        top[c] = top[c].astype(float).round(2)
    print(top.to_string(index=False))
    print()

    # ---- Theme rollup ----
    print("=== THEME ROLLUP — actionable + watchlist counts + mean grade ===")
    rollup = (df.groupby("theme").agg(
        n=("ticker", "count"),
        n_actionable=("grade", lambda s: int((s >= 70).sum())),
        mean_grade=("grade", "mean"),
        mean_call_dom=("call_dom_now", "mean"),
        mean_delta_buildup=("delta_buildup_pct", "mean"),
        mean_dp_skew=("dp_skew_pct", lambda s: s.dropna().mean() if s.notna().any() else None),
        bull_share=("direction", lambda s: float((s == "bull").mean()))
    ).round(2).sort_values("mean_grade", ascending=False))
    print(rollup.to_string())
    print()

    # ---- DP conflict signals ----
    print("=== HIGHEST CONFLICT SIGNALS — bullish thesis but bearish DP skew ===")
    bulls_with_dp = df[(df["direction"] == "bull") & (df["dp_skew_pct"].notna())].copy()
    bulls_with_dp["conflict"] = bulls_with_dp["grade"] - bulls_with_dp["dp_skew_pct"] * 50
    conflicts = bulls_with_dp.nlargest(15, "conflict")[
        ["ticker", "grade", "direction", "theme", "call_dom_now",
         "dp_skew_pct", "dp_share_pct"]].copy()
    print("Bullish setups with the most negative DP skew (institutions selling into rally):")
    print(conflicts.sort_values("dp_skew_pct").head(15).to_string(index=False))
    print()

    # ---- DP confirmation signals ----
    print("=== DP CONFIRMATION — bullish setups + positive DP skew ≥ +0.1% ===")
    confirms = df[(df["direction"] == "bull") & (df["dp_skew_pct"] >= 0.10) &
                  (df["grade"] >= 60)].copy()
    confirms = confirms.nlargest(15, "grade")[
        ["ticker", "grade", "theme", "call_dom_now", "dp_skew_pct", "dp_share_pct"]]
    print(confirms.to_string(index=False))
    print()

    # ---- High stealth (DP share > 70%) ----
    print("=== STEALTH ACCUMULATION CANDIDATES — DP share > 70% (institutions trading off-exchange) ===")
    stealth = df[(df["dp_share_pct"] > 70) & (df["grade"] >= 60)].copy()
    stealth = stealth.nlargest(15, "grade")[
        ["ticker", "grade", "direction", "theme", "dp_share_pct", "dp_skew_pct", "call_dom_now"]]
    print(stealth.to_string(index=False))
    print()

    # ---- Save outputs ----
    top.to_csv(OUT / "phase4_top25.csv", index=False)
    rollup.to_csv(OUT / "phase4_theme_rollup.csv")
    conflicts.to_csv(OUT / "phase4_dp_conflicts.csv", index=False)
    confirms.to_csv(OUT / "phase4_dp_confirms.csv", index=False)
    stealth.to_csv(OUT / "phase4_stealth.csv", index=False)
    print(f"Saved CSVs to {OUT}")


if __name__ == "__main__":
    main()
