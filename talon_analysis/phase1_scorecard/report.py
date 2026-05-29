"""Phase 1 scorecard report — grade-band aggregates + Grade-vs-R regression."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

from .score import score_all

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output"
OUT.mkdir(exist_ok=True)


def _band(grade: float | None) -> str:
    if grade is None or pd.isna(grade):
        return "ungraded"
    g = float(grade)
    if g >= 90:
        return "A+ (90-100)"
    if g >= 85:
        return "A (85-89)"
    if g >= 70:
        return "B+ (70-84)"
    if g >= 55:
        return "B  (55-69)"
    if g >= 40:
        return "B- (40-54)"
    return "C  (0-39)"


def headline(df: pd.DataFrame) -> dict:
    triggered = df[df["triggered"]]
    has_swing = triggered[triggered["swing_targets"].apply(len) > 0]
    swing_idx = has_swing["highest_swing_idx"]
    return {
        "total": len(df),
        "triggered": int(df["triggered"].sum()),
        "not_triggered": int((~df["triggered"]).sum()),
        "direction_correct_1d_pct": 100 * triggered["direction_correct_1d"].mean(),
        "direction_correct_5d_pct": 100 * triggered["direction_correct_5d"].mean(),
        "direction_correct_full_pct": 100 * triggered["direction_correct_full"].mean(),
        "st_target_hit_pct": 100 * triggered["st_target_hit"].fillna(False).mean(),
        "st_target_hit_full_pct": 100 * triggered["st_target_hit_full"].fillna(False).mean(),
        "swing0_hit_pct": 100 * (swing_idx >= 0).mean() if len(has_swing) else float("nan"),
        "swing1_hit_pct": 100 * (swing_idx >= 1).mean() if len(has_swing) else float("nan"),
        "inval_held_pct": 100 * (~triggered["inval_breached"]).mean(),
        "failure_first_pct": 100 * triggered["failure_first"].fillna(False).mean(),
        "mean_realized_R": triggered["realized_R"].mean(),
        "mean_max_R_if_held": triggered["max_R_if_held"].mean(),
        "mean_ret_full_pct": 100 * triggered["ret_full"].mean(),
        "mean_ret_5d_pct": 100 * triggered["ret_5d"].mean(),
        "n_days_full": int(triggered["n_days_full"].mode().iloc[0]) if len(triggered) else 0,
    }


def by_band(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["band"] = df["grade"].apply(_band)
    rows = []
    band_order = ["A+ (90-100)", "A (85-89)", "B+ (70-84)", "B  (55-69)",
                  "B- (40-54)", "C  (0-39)", "ungraded"]
    for band in band_order:
        sub = df[df["band"] == band]
        if sub.empty:
            continue
        trig = sub[sub["triggered"]]
        has_swing = trig[trig["swing_targets"].apply(len) > 0]
        swing_idx = has_swing["highest_swing_idx"] if len(has_swing) else pd.Series([], dtype=float)
        rows.append({
            "band": band,
            "n": len(sub),
            "n_triggered": len(trig),
            "tickers": ", ".join(sub["ticker"].tolist()),
            "st_target_hit_pct": round(100 * trig["st_target_hit"].fillna(False).mean(), 1),
            "st_target_hit_full_pct": round(100 * trig["st_target_hit_full"].fillna(False).mean(), 1),
            "swing0_hit_pct": round(100 * (swing_idx >= 0).mean(), 1) if len(has_swing) else 0.0,
            "swing1_hit_pct": round(100 * (swing_idx >= 1).mean(), 1) if len(has_swing) else 0.0,
            "inval_held_pct": round(100 * (~trig["inval_breached"]).mean(), 1),
            "dir_correct_5d_pct": round(100 * trig["direction_correct_5d"].mean(), 1),
            "dir_correct_full_pct": round(100 * trig["direction_correct_full"].mean(), 1),
            "mean_realized_R": round(trig["realized_R"].mean(), 2),
            "mean_max_R_if_held": round(trig["max_R_if_held"].mean(), 2),
            "mean_5d_return_pct": round(100 * trig["ret_5d"].mean(), 2),
            "mean_full_return_pct": round(100 * trig["ret_full"].mean(), 2),
        })
    return pd.DataFrame(rows)


def grade_vs_R_regression(df: pd.DataFrame) -> dict:
    """Linear regression: grade (X) -> realized_R (Y). All triggered, grade-known setups."""
    sub = df[df["triggered"] & df["grade"].notna() & df["realized_R"].notna()].copy()
    if len(sub) < 5:
        return {"error": "not enough data"}
    x = sub["grade"].to_numpy(dtype=float)
    y = sub["realized_R"].to_numpy(dtype=float)
    slope, intercept, r, p, stderr = stats.linregress(x, y)
    spearman_r, spearman_p = stats.spearmanr(x, y)
    return {
        "n": len(sub),
        "slope_per_point": slope,
        "slope_per_10pts": slope * 10,
        "intercept": intercept,
        "r": r,
        "r_squared": r ** 2,
        "p_value": p,
        "stderr": stderr,
        "spearman_r": spearman_r,
        "spearman_p": spearman_p,
    }


def grade_vs_metric(df: pd.DataFrame, metric: str) -> dict:
    sub = df[df["triggered"] & df["grade"].notna() & df[metric].notna()].copy()
    if len(sub) < 5:
        return {"error": "not enough data"}
    x = sub["grade"].to_numpy(dtype=float)
    y = sub[metric].to_numpy(dtype=float)
    slope, intercept, r, p, _ = stats.linregress(x, y)
    return {"n": len(sub), "slope": slope, "r": r, "r_squared": r**2, "p_value": p}


def format_markdown(df: pd.DataFrame) -> str:
    h = headline(df)
    band_df = by_band(df)
    reg_R = grade_vs_R_regression(df)
    reg_ret = grade_vs_metric(df, "ret_5d")
    reg_full = grade_vs_metric(df, "ret_full")
    reg_max = grade_vs_metric(df, "max_R_if_held")
    reg_swing = grade_vs_metric(df, "highest_swing_idx")

    lines: list[str] = []
    lines.append("# Talon May 18, 2026 Scan — Phase 1 Scorecard")
    lines.append("")
    lines.append(f"**Windows:**")
    lines.append(f"- Short-term GEX target: May 18–22 (5 trading days, the scan's 0-5d horizon)")
    lines.append(f"- **Full window** through May 28 = {h['n_days_full']} trading days "
                 f"(~1.5 of the 2-week swing horizon — the scan promised 2-4 wks for VEX, into Jun 1–12)")
    lines.append(f"**Sample:** {h['total']} tickers with explicit grades + levels "
                 f"({h['triggered']} triggered, {h['not_triggered']} OTE never tagged).")
    lines.append("")

    # Headline
    lines.append("## Headline")
    lines.append("")
    lines.append("### Short-term (May 18–22, the 0-5d ST window)")
    lines.append(f"- Direction correct (1D close-to-close): **{h['direction_correct_1d_pct']:.0f}%**")
    lines.append(f"- Direction correct (5D close-to-close): **{h['direction_correct_5d_pct']:.0f}%**")
    lines.append(f"- Short-term GEX target hit (May 18-22 wick OK): **{h['st_target_hit_pct']:.0f}%**")
    lines.append("")
    lines.append(f"### Full ~2-week window (May 18 → May 28, {h['n_days_full']}d)")
    lines.append(f"- Direction correct (full-window close-to-close): "
                 f"**{h['direction_correct_full_pct']:.0f}%**")
    lines.append(f"- ST GEX target hit by May 28: **{h['st_target_hit_full_pct']:.0f}%**")
    lines.append(f"- **First swing/VEX rung hit: {h['swing0_hit_pct']:.0f}%**")
    lines.append(f"- **Second swing/VEX rung hit: {h['swing1_hit_pct']:.0f}%**")
    lines.append(f"- Mean full-window return: **{h['mean_ret_full_pct']:+.2f}%**")
    lines.append("")
    lines.append("### Risk management (full window)")
    lines.append(f"- Soft-invalidation held: **{h['inval_held_pct']:.0f}%**")
    lines.append(f"- Failure-first (close past inval BEFORE target wick): "
                 f"**{h['failure_first_pct']:.0f}%**")
    lines.append(f"- Mean realized R (Talon rules, exit at inval close): "
                 f"**{h['mean_realized_R']:+.2f}R**")
    lines.append(f"- Mean max R if held (ignore inval): **{h['mean_max_R_if_held']:+.2f}R**")
    lines.append("")

    # Band table
    lines.append("## Grade Band Performance — Two Horizons")
    lines.append("")
    lines.append("Band sizes are uneven — A+ 14 vs middle bands ≤ 5. Read mid-band rows with caution.")
    lines.append("")
    lines.append("| Band | n | Trig | ST Tgt (5d) | ST Tgt (full) | Swing-0 | Swing-1 | Inval Held | Dir 5d | Dir full | R | Max R | 5d% | Full% |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for _, r in band_df.iterrows():
        lines.append(
            f"| {r['band']} | {r['n']} | {r['n_triggered']} | "
            f"{r['st_target_hit_pct']}% | {r['st_target_hit_full_pct']}% | "
            f"{r['swing0_hit_pct']}% | {r['swing1_hit_pct']}% | "
            f"{r['inval_held_pct']}% | {r['dir_correct_5d_pct']}% | {r['dir_correct_full_pct']}% | "
            f"{r['mean_realized_R']:+.2f} | {r['mean_max_R_if_held']:+.2f} | "
            f"{r['mean_5d_return_pct']:+.2f}% | {r['mean_full_return_pct']:+.2f}% |"
        )
    lines.append("")

    # Regression
    lines.append("## Grade → Realized R (Linear Regression)")
    lines.append("")
    if "error" in reg_R:
        lines.append(f"_{reg_R['error']}_")
    else:
        sig = "**significant**" if reg_R["p_value"] < 0.05 else "_not significant_"
        lines.append(f"- N = {reg_R['n']}")
        lines.append(f"- Slope: **{reg_R['slope_per_10pts']:+.3f} R per 10 grade points** "
                     f"(p = {reg_R['p_value']:.3f}, {sig})")
        lines.append(f"- Pearson r = {reg_R['r']:+.3f},  R² = {reg_R['r_squared']:.3f}")
        lines.append(f"- Spearman ρ = {reg_R['spearman_r']:+.3f} (p = {reg_R['spearman_p']:.3f})")
    lines.append("")
    lines.append("## Grade → 5D Return (short-term sanity check)")
    lines.append("")
    if "error" not in reg_ret:
        sig = "significant" if reg_ret["p_value"] < 0.05 else "not sig"
        lines.append(f"- Slope: {reg_ret['slope']*10:+.4f} per 10 pts (p = {reg_ret['p_value']:.3f}, {sig})")
        lines.append(f"- Pearson r = {reg_ret['r']:+.3f}, R² = {reg_ret['r_squared']:.3f}")
    lines.append("")
    lines.append("## Grade → Full-Window Return (~2 weeks, the swing horizon)")
    lines.append("")
    if "error" not in reg_full:
        sig = "significant" if reg_full["p_value"] < 0.05 else "not sig"
        lines.append(f"- Slope: {reg_full['slope']*10:+.4f} per 10 pts (p = {reg_full['p_value']:.3f}, {sig})")
        lines.append(f"- Pearson r = {reg_full['r']:+.3f}, R² = {reg_full['r_squared']:.3f}")
    lines.append("")
    lines.append("## Grade → Highest Swing Rung Hit")
    lines.append("")
    if "error" not in reg_swing:
        sig = "significant" if reg_swing["p_value"] < 0.05 else "not sig"
        lines.append(f"- Slope: {reg_swing['slope']*10:+.3f} rungs per 10 pts (p = {reg_swing['p_value']:.3f}, {sig})")
        lines.append(f"- Pearson r = {reg_swing['r']:+.3f}, R² = {reg_swing['r_squared']:.3f}")
    lines.append("")
    lines.append("## Grade → Max R if Held (ignore invalidation)")
    lines.append("")
    if "error" not in reg_max:
        sig = "significant" if reg_max["p_value"] < 0.05 else "not sig"
        lines.append(f"- Slope: {reg_max['slope']*10:+.3f} R per 10 pts (p = {reg_max['p_value']:.3f}, {sig})")
        lines.append(f"- Pearson r = {reg_max['r']:+.3f}, R² = {reg_max['r_squared']:.3f}")
    lines.append("")

    # Per-ticker
    lines.append("## Per-Ticker Detail (sorted by Grade)")
    lines.append("")
    lines.append("Legend: ST Tgt = short-term GEX target hit (May 18-22).  "
                 "Swing = highest rung tagged through May 28 (-= none, 0 = first rung, …).  "
                 "Full% = May 18 → May 28 close-to-close, signed in trade direction (positive = bet won).")
    lines.append("")
    lines.append("| Ticker | Grade | Dir | Trig | ST Tgt | Swing | Inval | 5D% | Full% | R | Max R | Notes |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for _, r in df.sort_values("grade", ascending=False, na_position="last").iterrows():
        grade = f"{int(r['grade'])}" if pd.notna(r["grade"]) else "—"
        tgt = "—" if pd.isna(r["st_target_hit"]) else ("✓" if r["st_target_hit"] else "✗")
        swing_n = len(r["swing_targets"]) if isinstance(r["swing_targets"], list) else 0
        if swing_n == 0:
            swing_cell = "—"
        elif r["highest_swing_idx"] == -1:
            swing_cell = f"0/{swing_n}"
        else:
            swing_cell = f"{r['highest_swing_idx']+1}/{swing_n}"
        inval = "held" if not r["inval_breached"] else f"breach {r['inval_breached_date'] or ''}"
        ret5d = "—" if pd.isna(r["ret_5d"]) else f"{r['ret_5d']*100:+.1f}%"
        retf = "—" if pd.isna(r["ret_full"]) else f"{r['ret_full']*100:+.1f}%"
        R = "—" if pd.isna(r["realized_R"]) else f"{r['realized_R']:+.1f}"
        maxR = "—" if pd.isna(r["max_R_if_held"]) else f"{r['max_R_if_held']:+.1f}"
        notes = r["notes"] if r["notes"] else ""
        lines.append(
            f"| {r['ticker']} | {grade} | {r['direction'][:4]} | "
            f"{'Y' if r['triggered'] else 'N'} | {tgt} | {swing_cell} | {inval} | "
            f"{ret5d} | {retf} | {R} | {maxR} | {notes} |"
        )
    lines.append("")

    # Interpretation
    lines.append("## Interpretation")
    lines.append("")
    a_plus = band_df[band_df["band"] == "A+ (90-100)"]
    b_mid = band_df[band_df["band"] == "B  (55-69)"]
    if not a_plus.empty and not b_mid.empty:
        ap = a_plus.iloc[0]
        bm = b_mid.iloc[0]
        lines.append(f"- **A+ band** (n={ap['n_triggered']} triggered) hit st_target "
                     f"{ap['st_target_hit_pct']}% (full window {ap['st_target_hit_full_pct']}%, "
                     f"swing-0 {ap['swing0_hit_pct']}%) "
                     f"vs **B band** {bm['st_target_hit_pct']}% / {bm['st_target_hit_full_pct']}% / "
                     f"{bm['swing0_hit_pct']}%.")
        lines.append(f"- A+ mean realized R: {ap['mean_realized_R']:+.2f}, B: {bm['mean_realized_R']:+.2f}.")
    if "error" not in reg_R:
        if reg_R["p_value"] < 0.05:
            lines.append(f"- Grade is **statistically predictive** of realized R "
                         f"(p = {reg_R['p_value']:.3f}). Reverse-engineering the rubric is worthwhile.")
        else:
            lines.append(f"- Grade is **not statistically predictive** of realized R "
                         f"(p = {reg_R['p_value']:.3f}). Caveats: small sample (n={reg_R['n']}), "
                         f"single-week window, lopsided band sizes.")
    lines.append("")
    lines.append("## Caveats")
    lines.append("")
    lines.append(f"- **n = {h['triggered']}** triggered setups, 14 in A+, 4 in C, others ≤ 5. "
                 "Middle bands have huge error bars.")
    lines.append("- **Single scan / single ~2-week window.** One regime, not a distribution.")
    lines.append(f"- **Full window = {h['n_days_full']} trading days** — captures the front half of the "
                 "scan's stated 2-4 week swing horizon (which extends to ~Jun 12). "
                 "Higher swing rungs (e.g. FSLR 280/300, META 700/720, AMZN 310/325) had less time to reach.")
    lines.append("- **Realized R uses Talon's published soft_inval as a hard stop.** "
                 "Several A+ names (FSLR, RIVN, DIS, KWEB) breached inval on May 19 close then recovered. "
                 "`max R if held` is the same trade without the inval rule.")
    lines.append("- **Entry-price discipline.** OTE setups enter at the OTE (only if tagged); "
                 "bullish-trigger setups (SHOP/RIVN/F) enter at the trigger if high clears it; "
                 "everything else enters at the published `current`.")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    df = score_all()
    df.to_csv(OUT / "phase1_per_ticker.csv", index=False)
    by_band(df).to_csv(OUT / "phase1_by_band.csv", index=False)
    md = format_markdown(df)
    (OUT / "phase1_report.md").write_text(md)
    print(md)
    print(f"\nWrote: {OUT}/phase1_report.md, phase1_per_ticker.csv, phase1_by_band.csv")


if __name__ == "__main__":
    main()
