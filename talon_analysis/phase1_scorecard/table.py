"""Single combined table: all 48 tickers from the Talon May 18 scan,
scored on direction + full-window return + (where levels are published) target hit, R, inval.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from .score import score_all

ROOT = Path(__file__).resolve().parents[1]


def fmt(v, kind: str) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return "—"
    if kind == "pct":
        return f"{v*100:+.1f}%"
    if kind == "R":
        return f"{v:+.1f}"
    if kind == "tick":
        return "✓" if v else "✗"
    return str(v)


def swing_cell(s) -> str:
    n = len(s["swing_targets"]) if isinstance(s["swing_targets"], list) else 0
    if n == 0:
        return "—"
    if s["highest_swing_idx"] == -1:
        return f"0/{n}"
    return f"{s['highest_swing_idx']+1}/{n}"


def main() -> None:
    df = score_all()
    df["theme"] = df.apply(lambda r: _theme_for(r["ticker"]), axis=1)

    # Combined table — one row per ticker
    rows = []
    for _, r in df.iterrows():
        rows.append({
            "Ticker": r["ticker"],
            "Theme": r["theme"] or "—",
            "Cat": _short_cat(r["category"]),
            "Grade": int(r["grade"]) if pd.notna(r["grade"]) else "—",
            "Dir": "bull" if r["direction"] == "bullish" else "bear",
            "Trig": "Y" if r["triggered"] else "N",
            "ST Tgt": fmt(r["st_target_hit"], "tick"),
            "Swing": swing_cell(r),
            "Inval": "held" if not r["inval_breached"] else f"break {r['inval_breached_date'] or ''}",
            "5d %": fmt(r["ret_5d"], "pct"),
            "Full %": fmt(r["ret_full"], "pct"),
            "MFE": fmt(r["mfe_pct"], "pct"),
            "MAE": fmt(r["mae_pct"], "pct"),
            "R": fmt(r["realized_R"], "R"),
            "MaxR": fmt(r["max_R_if_held"], "R"),
            "Note": r["notes"][:30],
        })
    full_df = pd.DataFrame(rows)

    # Print sorted by Full % descending (most-correct-bullish-or-bearish first)
    sortable = full_df.copy()
    sortable["sort_key"] = df["ret_full"].fillna(-1e9).to_numpy()
    sortable = sortable.sort_values("sort_key", ascending=False).drop(columns="sort_key")
    print()
    print("=" * 140)
    print(" Talon May 18 Scan — All 48 Tickers, Scored Through May 28 (8 trading days)")
    print("=" * 140)
    print(" Full % is signed in trade direction: positive = bet won (stock up if bull, down if bear).")
    print()
    # Pretty print
    with pd.option_context("display.max_colwidth", 30, "display.width", 200,
                           "display.max_rows", 60):
        print(sortable.to_string(index=False))

    # Save CSV
    out = ROOT / "output" / "phase1_all_tickers.csv"
    sortable.to_csv(out, index=False)
    print(f"\nWrote {out}")

    # Theme aggregation
    print()
    print("=" * 80)
    print(" Theme aggregation (mean full-window return, % direction-correct)")
    print("=" * 80)
    df["theme_filled"] = df["theme"].fillna("(no theme tagged)")
    agg = df[df["triggered"]].groupby("theme_filled").agg(
        n=("ticker", "count"),
        mean_full_ret=("ret_full", "mean"),
        dir_correct_pct=("direction_correct_full", "mean"),
        tickers=("ticker", lambda s: ", ".join(s)),
    ).sort_values("mean_full_ret", ascending=False)
    agg["mean_full_ret"] = (agg["mean_full_ret"] * 100).round(2).astype(str) + "%"
    agg["dir_correct_pct"] = (agg["dir_correct_pct"] * 100).round(0).astype(int).astype(str) + "%"
    with pd.option_context("display.max_colwidth", 80, "display.width", 200):
        print(agg.to_string())
    agg_out = ROOT / "output" / "phase1_by_theme.csv"
    agg.to_csv(agg_out)
    print(f"\nWrote {agg_out}")


def _short_cat(c: str) -> str:
    return {
        "actionable": "ACT",
        "ote_watch": "OTE",
        "risk_watch_bullish": "RSK+",
        "bearish": "BEAR",
        "thematic_bullish": "THM",
    }.get(c, c)


# Theme map for the existing 30 (those without an explicit `theme` field in YAML)
_THEME_OVERRIDES = {
    "FSLR": "clean_energy",
    "SHOP": "ai_cloud",
    "RIVN": "ev_autos",
    "TTD": "ad_tech",
    "CLSK": "crypto",
    "MARA": "crypto",
    "DIS": "consumer_travel",
    "BKNG": "consumer_travel",
    "KWEB": "china_internet",
    "F": "ev_autos",
    "MSFT": "ai_cloud",
    "HOOD": "fintech",
    "META": "ai_cloud",
    "TSLA": "ev_autos",
    "AMZN": "ai_cloud",
    "SLV": "metals",
    "GOOGL": "ai_cloud",
    "PINS": "consumer_travel",
    "WBD": "media",
    "XLF": "financials",
    "^VIX": "vol_hedge",
    "SQQQ": "nasdaq_hedge",
    "QQQ": "nasdaq_hedge",
    "SMH": "semis",
    "IGV": "software_hedge",
    "CVS": "healthcare",
    "XLP": "staples_hedge",
    "HPE": "tech",
    "LLY": "healthcare",
    "NVDA": "ai_cloud_semis",
}


def _theme_for(ticker: str) -> str | None:
    # YAML thematic tickers have theme field already loaded — for them, score_all returns
    # a Score dataclass that doesn't carry `theme`. We re-resolve via the overrides + a
    # secondary read of the YAML.
    if ticker in _THEME_OVERRIDES:
        return _THEME_OVERRIDES[ticker]
    # Fallback: read YAML once
    import yaml
    with (ROOT / "reference" / "2026-05-18.yaml").open() as f:
        scan = yaml.safe_load(f)
    for s in scan["tickers"]:
        if s["ticker"] == ticker:
            return s.get("theme")
    return None


if __name__ == "__main__":
    main()
