"""Phase 3 — Universe Regression.

Validates the five flow gates from Phase 2 across all 48 Talon tickers.

Adapted to actual data layout:
- One JSON per ticker at cache/uw_gex/{TICKER}.json
- Contains list of daily rows with call_gamma, put_gamma, call_delta, put_delta,
  call_charm, put_charm, call_vanna, put_vanna
- We derive call_dominance_pct, net_gamma, net_vanna, net_delta in metrics.load_gex().

Gates:
  G1 — delta_buildup_pct: % change in dealer net delta (Apr 30 mean → post-May 18 mean)
  G2 — gamma_sign on scan day must match thesis direction
  G3 — vanna_stability: net_vanna at t+3d / net_vanna at scan day, require ≥0.85
  G4 — call_dom_trend_5d: 5-day change in call_dominance leading into scan day
  G5 — call_dom_5d_high (hedge-specific): call_dom on scan day is at 5d high in
       thesis direction (call dom rising for bull hedges, falling for bear hedges)
"""
from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import StandardScaler

from talon_analysis.phase2_flow.metrics import load_gex

ROOT = Path(__file__).resolve().parents[1]
PHASE1_CSV = ROOT / "output" / "phase1_all_tickers.csv"
OUT = ROOT / "output"
OUT.mkdir(exist_ok=True)

SCAN_DATE = pd.Timestamp("2026-05-18")
WINDOW_START = pd.Timestamp("2026-04-30")
WINDOW_END = pd.Timestamp("2026-05-28")

HEDGES = {"VIX", "^VIX", "SQQQ", "QQQ", "SMH", "IGV", "XLP", "CVS", "HPE", "LLY"}

THEMES = {
    "FSLR": "clean_energy", "ENPH": "clean_energy",
    "RIVN": "ev_autos", "F": "ev_autos", "TSLA": "ev_autos",
    "CLSK": "crypto_miners", "MARA": "crypto_miners",
    "MSTR": "crypto_tokens", "IBIT": "crypto_tokens", "ETHA": "crypto_tokens",
    "SHOP": "ai_cloud", "MSFT": "ai_cloud", "META": "ai_cloud",
    "AMZN": "ai_cloud", "GOOGL": "ai_cloud", "CRM": "ai_cloud",
    "PLTR": "ai_cloud", "ORCL": "ai_cloud",
    "SMCI": "semis", "MU": "semis", "TXN": "semis", "NVDA": "semis",
    "HOOD": "fintech", "PYPL": "fintech", "SOFI": "fintech", "COIN": "fintech",
    "BKNG": "consumer_travel", "DIS": "consumer_travel", "HD": "consumer_travel",
    "RCL": "consumer_travel", "CCL": "consumer_travel", "DASH": "consumer_travel",
    "LYFT": "consumer_travel", "PINS": "consumer_travel", "WBD": "consumer_travel",
    "TTD": "ad_tech", "KWEB": "china_internet", "SLV": "metals",
    "XLF": "financials",
    "VIX": "vol_hedge", "^VIX": "vol_hedge",
    "SQQQ": "nasdaq_hedge", "QQQ": "nasdaq_hedge",
    "SMH": "semis_hedge", "IGV": "software_hedge",
    "XLP": "staples_hedge", "CVS": "healthcare_hedge",
    "HPE": "tech_hedge", "LLY": "healthcare_hedge",
}


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def _val_on_or_near(df: pd.DataFrame, target: pd.Timestamp, col: str,
                    look_back: int = 2) -> float:
    """Get the value of `col` on `target`, or the closest prior trading day within look_back days."""
    if df.empty:
        return float("nan")
    eligible = df[(df["date"] <= target) & (df["date"] >= target - timedelta(days=look_back))]
    if eligible.empty:
        return float("nan")
    return float(eligible.iloc[-1][col])


def _val_on_or_after(df: pd.DataFrame, target: pd.Timestamp, col: str,
                     look_fwd: int = 2) -> float:
    if df.empty:
        return float("nan")
    eligible = df[(df["date"] >= target) & (df["date"] <= target + timedelta(days=look_fwd))]
    if eligible.empty:
        return float("nan")
    return float(eligible.iloc[0][col])


# ----------------------------------------------------------------------------
# Per-ticker gate computation
# ----------------------------------------------------------------------------
def compute_gates(ticker: str) -> dict:
    """Compute all 5 gates plus auxiliary fields for one ticker."""
    df = load_gex(ticker)
    out = {"ticker": ticker, "has_gex": not df.empty}
    if df.empty:
        return out

    pre = df[df["date"] < SCAN_DATE]
    post = df[df["date"] >= SCAN_DATE]
    if pre.empty or post.empty:
        return out

    # ---- Scan-day snapshots ----
    cd_scan = _val_on_or_near(df, SCAN_DATE, "call_dominance_pct")
    gamma_scan = _val_on_or_near(df, SCAN_DATE, "net_gamma")
    vanna_scan = _val_on_or_near(df, SCAN_DATE, "net_vanna")
    delta_scan = _val_on_or_near(df, SCAN_DATE, "net_delta")

    out["call_dom_scan_day"] = cd_scan
    out["gamma_scan_day"] = gamma_scan
    out["vanna_scan_day"] = vanna_scan

    # ---- Gate 1: Delta buildup (post-scan mean vs pre-scan mean) ----
    pre_delta = pre["net_delta"].mean()
    post_delta = post["net_delta"].mean()
    if pre_delta != 0 and not pd.isna(pre_delta):
        out["delta_buildup_pct"] = (post_delta - pre_delta) / abs(pre_delta) * 100
    else:
        out["delta_buildup_pct"] = float("nan")
    out["delta_buildup_gt50"] = (
        1 if out["delta_buildup_pct"] > 50 else 0
    ) if not pd.isna(out["delta_buildup_pct"]) else 0

    # ---- Gate 2: Gamma sign on scan day ----
    out["gamma_sign"] = 1 if gamma_scan > 0 else -1 if gamma_scan < 0 else 0
    out["gamma_positive"] = 1 if gamma_scan > 0 else 0

    # ---- Gate 3: Vanna stability (t+3d / t=0) ----
    # Find post-scan vanna ~3 trading days later
    vanna_t3 = _val_on_or_after(df, SCAN_DATE + timedelta(days=5), "net_vanna", look_fwd=3)
    if not pd.isna(vanna_scan) and vanna_scan != 0:
        out["vanna_stability"] = vanna_t3 / vanna_scan
    else:
        out["vanna_stability"] = float("nan")
    out["vanna_stable_85"] = (
        1 if not pd.isna(out["vanna_stability"]) and out["vanna_stability"] >= 0.85 else 0
    )

    # ---- Gate 4: Call dom trend (scan day vs 5 trading days prior) ----
    # 5 trading days before May 18 ≈ May 11
    cd_5d_back = _val_on_or_near(df, SCAN_DATE - timedelta(days=7), "call_dominance_pct")
    if not pd.isna(cd_scan) and not pd.isna(cd_5d_back):
        out["call_dom_trend_5d"] = cd_scan - cd_5d_back
    else:
        out["call_dom_trend_5d"] = float("nan")
    out["call_dom_rising"] = (
        1 if not pd.isna(out["call_dom_trend_5d"]) and out["call_dom_trend_5d"] > 5 else 0
    )

    # ---- Gate 5: Call dom 5d high (hedge-specific) ----
    # Within the trailing 5 trading days, did call_dom peak ON scan day?
    trailing = df[(df["date"] >= SCAN_DATE - timedelta(days=10)) & (df["date"] <= SCAN_DATE)]
    if not trailing.empty:
        max_cd_date = trailing.loc[trailing["call_dominance_pct"].idxmax(), "date"]
        out["call_dom_5d_high"] = 1 if max_cd_date == SCAN_DATE else 0
        out["days_since_call_dom_peak"] = (SCAN_DATE - max_cd_date).days
    else:
        out["call_dom_5d_high"] = 0
        out["days_since_call_dom_peak"] = float("nan")

    # ---- Auxiliary: pre/post call dom for context ----
    out["call_dom_pre_mean"] = pre["call_dominance_pct"].mean()
    out["call_dom_post_mean"] = post["call_dominance_pct"].mean()
    out["delta_skew_post"] = post["delta_skew"].mean()

    return out


# ----------------------------------------------------------------------------
# Universe assembly
# ----------------------------------------------------------------------------
def build_universe() -> pd.DataFrame:
    """Merge Phase 1 scorecard with Phase 3 gate metrics for all 48 tickers."""
    phase1 = pd.read_csv(PHASE1_CSV)
    # Normalize column names
    phase1 = phase1.rename(columns={
        "Ticker": "ticker", "Grade": "grade", "Dir": "direction",
        "5d %": "ret_5d_pct", "Full %": "ret_full_pct", "ST Tgt": "st_tgt",
        "Trig": "triggered",
    })
    # ret columns are strings like "+15.5%" → strip and float
    for c in ["ret_5d_pct", "ret_full_pct"]:
        phase1[c] = (
            phase1[c].astype(str).str.replace("%", "").str.replace("+", "")
            .replace("—", "nan").astype(float) / 100
        )
    phase1["grade"] = pd.to_numeric(phase1["grade"], errors="coerce")

    # Map ticker variants
    def _normalize(t):
        return t.replace("^", "")
    phase1["ticker_lookup"] = phase1["ticker"].apply(_normalize)

    rows = []
    for _, p1 in phase1.iterrows():
        gates = compute_gates(p1["ticker_lookup"])
        # also try without normalization for ^VIX
        if not gates.get("has_gex"):
            gates = compute_gates(p1["ticker"])
        rows.append({
            "ticker": p1["ticker"],
            "grade": p1["grade"],
            "direction": p1["direction"],
            "triggered": p1["triggered"],
            "ret_5d": p1["ret_5d_pct"],
            "ret_full": p1["ret_full_pct"],
            "st_tgt_hit": (p1["st_tgt"] == "✓") if isinstance(p1["st_tgt"], str) else None,
            "theme": THEMES.get(p1["ticker"], "unthemed"),
            **{k: v for k, v in gates.items() if k != "ticker"},
        })
    return pd.DataFrame(rows)


# ----------------------------------------------------------------------------
# Theme coherence — done as a second pass after universe is built
# ----------------------------------------------------------------------------
def attach_theme_coherence(df: pd.DataFrame) -> pd.DataFrame:
    """For each ticker, compute min Spearman correlation of daily call_dom with same-theme peers."""
    # Pre-load all timeseries
    ts_cache = {}
    for t in df["ticker"].unique():
        norm = t.replace("^", "")
        gex = load_gex(norm) if not load_gex(t).shape[0] else load_gex(t)
        if gex.empty:
            gex = load_gex(norm)
        if not gex.empty:
            ts_cache[t] = gex.set_index("date")["call_dominance_pct"]

    coherences = []
    for _, r in df.iterrows():
        peers = df[(df["theme"] == r["theme"]) & (df["ticker"] != r["ticker"])]["ticker"].tolist()
        if not peers or r["ticker"] not in ts_cache:
            coherences.append(float("nan"))
            continue
        my_ts = ts_cache[r["ticker"]]
        corrs = []
        for p in peers:
            if p not in ts_cache:
                continue
            peer_ts = ts_cache[p]
            common = my_ts.index.intersection(peer_ts.index)
            if len(common) < 5:
                continue
            corr, _ = stats.spearmanr(my_ts.loc[common], peer_ts.loc[common])
            if not pd.isna(corr):
                corrs.append(corr)
        coherences.append(min(corrs) if corrs else float("nan"))
    df["theme_coherence_min"] = coherences
    df["theme_coherent"] = (df["theme_coherence_min"] >= 0.3).astype(int)
    return df


# ----------------------------------------------------------------------------
# Gate validation — statistical tests
# ----------------------------------------------------------------------------
def _bins(df: pd.DataFrame, col: str, thresholds: list, target: str = "ret_5d") -> list:
    """Return mean(target) for each bin defined by thresholds."""
    bins = [-np.inf] + thresholds + [np.inf]
    df = df.dropna(subset=[col, target])
    df["_bin"] = pd.cut(df[col], bins)
    return df.groupby("_bin")[target].mean().tolist()


def validate(df: pd.DataFrame) -> dict:
    """Run 5 gate tests + master regression. Returns dict of stats."""
    out = {}

    # Gate 1 — delta_buildup
    valid = df.dropna(subset=["delta_buildup_pct", "ret_5d"])
    if len(valid) >= 5:
        slope, intercept, r, p, se = stats.linregress(valid["delta_buildup_pct"], valid["ret_5d"])
        # Cap delta_buildup_pct at +/- 500% to avoid outliers
        capped = valid.copy()
        capped["delta_buildup_capped"] = capped["delta_buildup_pct"].clip(-500, 500)
        slope_c, _, r_c, p_c, _ = stats.linregress(capped["delta_buildup_capped"], capped["ret_5d"])
        high = valid[valid["delta_buildup_pct"] > 50]["ret_5d"].mean()
        low = valid[valid["delta_buildup_pct"] <= 50]["ret_5d"].mean()
        out["gate1_delta_buildup"] = {
            "n": len(valid), "r": r, "p": p, "slope": slope,
            "r_capped": r_c, "p_capped": p_c,
            "buildup_gt50_mean": high, "buildup_le50_mean": low,
            "spread": high - low,
            "pass": bool(p < 0.05),
        }

    # Gate 2 — gamma sign matches thesis
    df["gamma_match_thesis"] = (
        ((df["direction"] == "bull") & (df["gamma_positive"] == 1)) |
        ((df["direction"] == "bear") & (df["gamma_positive"] == 0))
    ).astype(int)
    bulls = df[df["direction"] == "bull"].dropna(subset=["gamma_positive", "ret_5d"])
    bears = df[df["direction"] == "bear"].dropna(subset=["gamma_positive", "ret_5d"])
    bull_match_rate = (bulls["gamma_positive"] == 1).mean() if len(bulls) else float("nan")
    bear_match_rate = (bears["gamma_positive"] == 0).mean() if len(bears) else float("nan")
    overall_match = df["gamma_match_thesis"].mean()
    # Returns conditioned on match
    matched = df[df["gamma_match_thesis"] == 1]["ret_5d"].dropna()
    unmatched = df[df["gamma_match_thesis"] == 0]["ret_5d"].dropna()
    if len(matched) >= 3 and len(unmatched) >= 3:
        t_stat, p_val = stats.ttest_ind(matched, unmatched, equal_var=False)
    else:
        t_stat, p_val = float("nan"), float("nan")
    out["gate2_gamma_sign"] = {
        "n": int(len(df)),
        "bull_match_rate": bull_match_rate,
        "bear_match_rate": bear_match_rate,
        "overall_match_rate": overall_match,
        "matched_mean_ret": matched.mean() if len(matched) else float("nan"),
        "unmatched_mean_ret": unmatched.mean() if len(unmatched) else float("nan"),
        "t_stat": t_stat, "p": p_val,
        "pass": bool(not pd.isna(p_val) and p_val < 0.05),
    }

    # Gate 3 — vanna stability
    valid = df.dropna(subset=["vanna_stability", "ret_5d"])
    if len(valid) >= 5:
        rho, p = stats.spearmanr(valid["vanna_stability"], valid["ret_5d"])
        stable = valid[valid["vanna_stability"] >= 0.85]["ret_5d"].mean()
        mid = valid[(valid["vanna_stability"] >= 0.70) & (valid["vanna_stability"] < 0.85)]["ret_5d"].mean()
        weak = valid[valid["vanna_stability"] < 0.70]["ret_5d"].mean()
        out["gate3_vanna_stability"] = {
            "n": int(len(valid)),
            "rho": rho, "p": p,
            "stable_mean_ret": stable, "mid_mean_ret": mid, "weak_mean_ret": weak,
            "pass": bool(p < 0.05),
        }

    # Gate 4 — call dom trend
    valid = df.dropna(subset=["call_dom_trend_5d", "ret_5d"])
    if len(valid) >= 5:
        rho, p = stats.spearmanr(valid["call_dom_trend_5d"], valid["ret_5d"])
        rising = valid[valid["call_dom_trend_5d"] > 5]["ret_5d"].mean()
        flat = valid[(valid["call_dom_trend_5d"] >= -5) & (valid["call_dom_trend_5d"] <= 5)]["ret_5d"].mean()
        falling = valid[valid["call_dom_trend_5d"] < -5]["ret_5d"].mean()
        out["gate4_call_dom_trend"] = {
            "n": int(len(valid)),
            "rho": rho, "p": p,
            "rising_mean_ret": rising, "flat_mean_ret": flat, "falling_mean_ret": falling,
            "pass": bool(p < 0.05),
        }

    # Gate 5 — call dom 5d high (hedge subset)
    hedges_df = df[df["ticker"].isin(HEDGES)].dropna(subset=["call_dom_5d_high", "ret_5d"])
    fresh = hedges_df[hedges_df["call_dom_5d_high"] == 1]["ret_5d"].mean()
    stale = hedges_df[hedges_df["call_dom_5d_high"] == 0]["ret_5d"].mean()
    out["gate5_call_dom_5d_high"] = {
        "n_hedges": int(len(hedges_df)),
        "fresh_mean_ret": fresh, "stale_mean_ret": stale,
        "freshness_effect": fresh - stale,
        "pass": "hedge-specific (no global p-test)",
    }

    # Master regression — 5 gates
    features = ["delta_buildup_pct", "gamma_positive", "vanna_stability",
                "call_dom_trend_5d", "theme_coherent"]
    sub = df.dropna(subset=features + ["ret_5d"]).copy()
    # Cap outliers in delta_buildup
    sub["delta_buildup_pct"] = sub["delta_buildup_pct"].clip(-500, 500)
    if len(sub) >= 8:
        X = StandardScaler().fit_transform(sub[features])
        y = sub["ret_5d"].values
        m = LinearRegression().fit(X, y)
        r2 = m.score(X, y)
        # n=count, k=features → adjusted R²
        n, k = len(sub), len(features)
        r2_adj = 1 - (1 - r2) * (n - 1) / (n - k - 1)

        # Grade alone for comparison
        gsub = df.dropna(subset=["grade", "ret_5d"])
        if len(gsub) >= 5:
            Xg = StandardScaler().fit_transform(gsub[["grade"]])
            yg = gsub["ret_5d"].values
            r2_grade = LinearRegression().fit(Xg, yg).score(Xg, yg)
        else:
            r2_grade = float("nan")

        out["master"] = {
            "n": int(len(sub)),
            "r2_gates_only": r2, "r2_adj": r2_adj,
            "r2_grade_alone": r2_grade,
            "improvement_pp": (r2 - r2_grade) * 100,
            "coefficients": dict(zip(features, m.coef_)),
        }

    # Bonus: Grade + gates combined
    sub2 = df.dropna(subset=features + ["grade", "ret_5d"]).copy()
    sub2["delta_buildup_pct"] = sub2["delta_buildup_pct"].clip(-500, 500)
    if len(sub2) >= 8:
        X2 = StandardScaler().fit_transform(sub2[features + ["grade"]])
        y2 = sub2["ret_5d"].values
        m2 = LinearRegression().fit(X2, y2)
        out["master"]["r2_grade_plus_gates"] = m2.score(X2, y2)

    return out


def write_report(df: pd.DataFrame, val: dict) -> str:
    lines = ["# Phase 3 — Universe Regression (All 48 Talon Tickers)", ""]
    lines.append(f"**Window:** {WINDOW_START.date()} → {WINDOW_END.date()}.  "
                 f"**Universe:** {len(df)} tickers from Phase 1 scorecard.")
    lines.append(f"**Tickers with GEX data:** {df['has_gex'].sum()} / {len(df)}")
    lines.append("")

    # Headline
    g1 = val.get("gate1_delta_buildup", {})
    g2 = val.get("gate2_gamma_sign", {})
    g3 = val.get("gate3_vanna_stability", {})
    g4 = val.get("gate4_call_dom_trend", {})
    g5 = val.get("gate5_call_dom_5d_high", {})
    m = val.get("master", {})

    lines.append("## Gate-by-Gate Validation")
    lines.append("")
    lines.append("| Gate | n | r / ρ | p | Pass? |")
    lines.append("|---|---|---|---|---|")
    lines.append(f"| G1 delta_buildup | {g1.get('n','-')} | {g1.get('r',float('nan')):.3f} | "
                 f"{g1.get('p',float('nan')):.4f} | {'✓' if g1.get('pass') else '✗'} |")
    lines.append(f"| G2 gamma_sign×thesis | {g2.get('n','-')} | t={g2.get('t_stat',float('nan')):.2f} | "
                 f"{g2.get('p',float('nan')):.4f} | {'✓' if g2.get('pass') else '✗'} |")
    lines.append(f"| G3 vanna_stability | {g3.get('n','-')} | {g3.get('rho',float('nan')):.3f} | "
                 f"{g3.get('p',float('nan')):.4f} | {'✓' if g3.get('pass') else '✗'} |")
    lines.append(f"| G4 call_dom_trend | {g4.get('n','-')} | {g4.get('rho',float('nan')):.3f} | "
                 f"{g4.get('p',float('nan')):.4f} | {'✓' if g4.get('pass') else '✗'} |")
    lines.append(f"| G5 hedge freshness | {g5.get('n_hedges','-')} hedges | "
                 f"effect={g5.get('freshness_effect',float('nan'))*100:+.2f}% | n/a | hedge-only |")
    lines.append("")

    # Per-gate detail
    lines.append("## Gate 1 — Delta Buildup (>50% threshold)")
    if g1:
        lines.append(f"- Linear regression: slope = {g1['slope']:.6f}/% → +100% buildup → +{g1['slope']*100:.2f}% return")
        lines.append(f"- Buildup >50%: mean 5d return = {g1['buildup_gt50_mean']*100:+.2f}%")
        lines.append(f"- Buildup ≤50%: mean 5d return = {g1['buildup_le50_mean']*100:+.2f}%")
        lines.append(f"- **Spread: {g1['spread']*100:+.2f}%**  (with outlier cap: r={g1['r_capped']:.3f}, p={g1['p_capped']:.4f})")
    lines.append("")

    lines.append("## Gate 2 — Gamma Sign × Thesis Direction")
    if g2:
        lines.append(f"- Bullish tickers with +gamma: **{g2['bull_match_rate']*100:.1f}%**")
        lines.append(f"- Bearish tickers with -gamma: **{g2['bear_match_rate']*100:.1f}%**")
        lines.append(f"- Overall match rate: {g2['overall_match_rate']*100:.1f}%")
        lines.append(f"- Matched mean ret: {g2['matched_mean_ret']*100:+.2f}%; "
                     f"Unmatched: {g2['unmatched_mean_ret']*100:+.2f}%")
    lines.append("")

    lines.append("## Gate 3 — Vanna Stability (≥0.85 at t+3d)")
    if g3:
        lines.append(f"- ≥0.85: {g3['stable_mean_ret']*100:+.2f}%")
        lines.append(f"- 0.70–0.85: {g3['mid_mean_ret']*100:+.2f}%")
        lines.append(f"- <0.70: {g3['weak_mean_ret']*100:+.2f}%")
    lines.append("")

    lines.append("## Gate 4 — Call Dom Trend (5d change)")
    if g4:
        lines.append(f"- Rising (>+5): {g4['rising_mean_ret']*100:+.2f}%")
        lines.append(f"- Flat (±5): {g4['flat_mean_ret']*100:+.2f}%")
        lines.append(f"- Falling (<−5): {g4['falling_mean_ret']*100:+.2f}%")
    lines.append("")

    lines.append("## Gate 5 — Hedge Freshness")
    if g5:
        lines.append(f"- Hedges with call_dom at 5d high on scan day: {g5['fresh_mean_ret']*100:+.2f}%")
        lines.append(f"- Hedges with stale call_dom: {g5['stale_mean_ret']*100:+.2f}%")
        lines.append(f"- **Freshness effect: {g5['freshness_effect']*100:+.2f}%**")
    lines.append("")

    # Master regression
    lines.append("## Master Regression")
    if m:
        lines.append(f"- Sample: {m['n']} tickers")
        lines.append(f"- **R² gates-only**: {m['r2_gates_only']:.3f} (adj: {m['r2_adj']:.3f})")
        lines.append(f"- R² Grade-alone (Phase 1 reproduce): {m['r2_grade_alone']:.3f}")
        lines.append(f"- **Improvement from gates over Grade alone: {m['improvement_pp']:+.1f} pp**")
        if "r2_grade_plus_gates" in m:
            lines.append(f"- R² Grade + Gates combined: {m['r2_grade_plus_gates']:.3f}")
        lines.append("")
        lines.append("**Standardized coefficients (which gate matters most):**")
        for k, v in m["coefficients"].items():
            lines.append(f"- {k}: {v:+.4f}")
    lines.append("")

    # Verdict
    passes = sum(1 for g in [g1, g2, g3, g4] if g and g.get("pass"))
    lines.append("## Verdict")
    if passes >= 3:
        lines.append(f"**{passes}/4 gates validated** at p<0.05 across the 48-ticker universe. "
                     "Gates are universal, not local to Phase 2 sample. Build Talon 2.0 scanner.")
    elif passes >= 2:
        lines.append(f"**{passes}/4 gates validated.** Build scanner with passing gates only.")
    else:
        lines.append(f"**Only {passes}/4 gates validated.** Some Phase 2 findings may be sample-specific. "
                     "Need larger universe or fresh out-of-sample data.")
    lines.append("")

    return "\n".join(lines)


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def main():
    print("=== Phase 3 — Universe Regression ===")
    df = build_universe()
    df = attach_theme_coherence(df)
    print(f"Built universe: {len(df)} rows, {df['has_gex'].sum()} with GEX data")

    val = validate(df)

    # Save artifacts
    df.to_csv(OUT / "phase3_all_48_metrics.csv", index=False)
    with (OUT / "phase3_gate_validation.json").open("w") as f:
        json.dump(val, f, indent=2, default=str)
    report = write_report(df, val)
    (OUT / "phase3_universe_regression_report.md").write_text(report)

    print()
    print(report)
    print()
    print(f"Wrote:")
    print(f"  {OUT}/phase3_all_48_metrics.csv")
    print(f"  {OUT}/phase3_gate_validation.json")
    print(f"  {OUT}/phase3_universe_regression_report.md")


if __name__ == "__main__":
    main()
