"""Cross-reference: Coiled watchlist × Talon Phase 4 dealer delta/flow.

Joins coiled candidates with Phase 4 flow data (delta_buildup_pct, vanna_ratio,
call_dom, gamma sign, theme_coherence, DP_skew, DP_share). Output: ranked list
of names that are coiled AND have dealers loading — highest-probability setups.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output"

# Load coiled watchlist
coil = pd.read_csv(OUT / "coiled_watchlist.csv")

# Load Phase 4 flow scan
scan = json.load(open(OUT / "scan_2026-05-29.json"))
flow_rows = scan["actionable"] + scan["watchlist"]
flow = pd.DataFrame(flow_rows)
flow = flow[
    [
        "ticker",
        "grade",
        "direction",
        "delta_buildup_pct",
        "vanna_ratio_5d_back",
        "call_dom_now",
        "gamma_positive",
        "theme_coherence",
        "dp_skew_pct",
        "dp_share_pct",
        "g_delta_score",
        "g_vanna_score",
    ]
].rename(
    columns={
        "grade": "flow_grade",
        "direction": "flow_direction",
        "delta_buildup_pct": "delta_buildup",
        "vanna_ratio_5d_back": "vanna_ratio",
        "call_dom_now": "call_dom",
        "theme_coherence": "theme_coh",
        "dp_skew_pct": "dp_skew",
        "dp_share_pct": "dp_share",
    }
)

# Inner join: only names with both coil + flow signal
merged = coil.merge(flow, on="ticker", how="inner")
print(f"Coiled names with Phase 4 flow coverage: {len(merged)}/{len(coil)}")

# Sub-scores for confluence:
#   coil_grade (0-100) — already in `grade` column
#   flow_grade (0-100) — Phase 4 Talon grade
#   delta_signal — true if dealers loading (delta_buildup > 30% AND gamma_positive)
#   vanna_signal — true if vanna_ratio in sweet spot 0.65-1.05
#   dp_confirm — true if DP_skew >= 0.10 (institutions paying up)
#   dp_conflict — true if DP_skew <= -0.20 (institutions distributing)

merged = merged.rename(columns={"grade": "coil_grade"})
merged["delta_signal"] = (merged["delta_buildup"] > 30) & (merged["gamma_positive"] == 1)
merged["vanna_signal"] = merged["vanna_ratio"].between(0.65, 1.05)
merged["dp_confirm"] = merged["dp_skew"] >= 0.10
merged["dp_conflict"] = merged["dp_skew"] <= -0.20

# Confluence score: average of coil + flow grade, boosted by delta + vanna + DP confirm
def confluence(r):
    base = (r["coil_grade"] + r["flow_grade"]) / 2
    if r["delta_signal"]:
        base += 5
    if r["vanna_signal"]:
        base += 3
    if r["dp_confirm"]:
        base += 4
    if r["dp_conflict"]:
        base -= 6
    if r["flow_direction"] == "bear":
        base -= 10  # coil + bear flow = reject
    return round(base, 1)


merged["confluence"] = merged.apply(confluence, axis=1)
merged = merged.sort_values("confluence", ascending=False).reset_index(drop=True)

cols_show = [
    "ticker",
    "theme",
    "close",
    "coil_grade",
    "flow_grade",
    "flow_direction",
    "delta_buildup",
    "vanna_ratio",
    "call_dom",
    "dp_skew",
    "dp_share",
    "trigger_20d",
    "stop_20d",
    "confluence",
]

print("\n" + "=" * 110)
print("COIL × DEALER-DELTA CONFLUENCE — top 30")
print("=" * 110)
print(merged[cols_show].head(30).to_string(index=False))

merged.to_csv(OUT / "coil_x_flow.csv", index=False)
print(f"\n→ wrote {OUT / 'coil_x_flow.csv'} ({len(merged)} rows)")

# Categorize
tier_a = merged[
    (merged["coil_grade"] >= 60)
    & (merged["delta_signal"])
    & (merged["dp_confirm"])
    & (merged["flow_direction"] == "bull")
]
tier_b = merged[
    (merged["coil_grade"] >= 60)
    & (merged["delta_signal"])
    & (~merged["dp_conflict"])
    & (merged["flow_direction"] == "bull")
    & (~merged["ticker"].isin(tier_a["ticker"]))
]
tier_c = merged[
    (merged["coil_grade"] >= 60)
    & (merged["dp_conflict"])
    & (merged["flow_direction"] == "bull")
]

print(f"\nTier A — Coiled + dealers loading + DP confirm (highest conviction): {len(tier_a)}")
if len(tier_a):
    print(tier_a[["ticker", "coil_grade", "flow_grade", "delta_buildup", "dp_skew",
                  "trigger_20d", "stop_20d"]].to_string(index=False))

print(f"\nTier B — Coiled + dealers loading + DP neutral (standard size): {len(tier_b)}")
if len(tier_b):
    print(tier_b[["ticker", "coil_grade", "flow_grade", "delta_buildup", "dp_skew",
                  "trigger_20d", "stop_20d"]].to_string(index=False))

print(f"\nTier C — Coiled but DP fading (caution / smaller size): {len(tier_c)}")
if len(tier_c):
    print(tier_c[["ticker", "coil_grade", "flow_grade", "delta_buildup", "dp_skew",
                  "trigger_20d", "stop_20d"]].to_string(index=False))
