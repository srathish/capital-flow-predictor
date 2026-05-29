"""Full 504-ticker 30-day positioning + coil audit.

For each ticker, computes:
  - call_delta trajectory (peak, current, % of peak, 5d slope)
  - call_gamma trajectory (peak, current, % of peak, 5d slope)
  - call_vanna trajectory
  - Combined with coil metrics (BB compression, range pos, off-highs)

Output: pre_squeeze_ranked.csv — every ticker with full audit columns,
ranked by squeeze-readiness composite score.

The composite favors:
  (1) Tight chart compression (BB pct < 0.25)
  (2) Depressed range position (< 0.55)
  (3) Off-high (< -15%)
  (4) Call delta currently rising (5d slope > 0)
  (5) Call delta near or above 20d peak (> 0.90 of peak)
  (6) Call gamma rising (5d slope > 0)
  (7) Hasn't fired yet today (intraday < 4%)
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import warnings
warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parents[1]
GEX_CACHE = ROOT / "cache" / "uw_gex"
OUT = ROOT / "output"


def parse_gex(gex_json: dict) -> dict | None:
    """Pull 20-day series and compute trajectory features."""
    rows = gex_json.get("result", [])
    if not rows or len(rows) < 10:
        return None

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)

    for col in ["call_gamma", "put_gamma", "call_delta", "put_delta",
                "call_vanna", "put_vanna", "call_charm", "put_charm"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    if df["call_delta"].isna().all():
        return None

    cd = df["call_delta"].dropna()
    cg = df["call_gamma"].dropna()
    cv = df["call_vanna"].dropna()

    cd_now = float(cd.iloc[-1])
    cd_peak = float(cd.max())
    cd_avg = float(cd.mean())
    cd_slope_5d = float((cd.iloc[-1] / cd.iloc[-6] - 1) * 100) if len(cd) >= 6 else 0.0
    cd_slope_10d = float((cd.iloc[-1] / cd.iloc[-11] - 1) * 100) if len(cd) >= 11 else 0.0
    cd_pct_of_peak = cd_now / cd_peak if cd_peak > 0 else 0.0

    cg_now = float(cg.iloc[-1])
    cg_peak = float(cg.max())
    cg_slope_5d = float((cg.iloc[-1] / cg.iloc[-6] - 1) * 100) if len(cg) >= 6 else 0.0
    cg_pct_of_peak = cg_now / cg_peak if cg_peak > 0 else 0.0

    cv_now = float(cv.iloc[-1])
    cv_slope_5d = float((cv.iloc[-1] / cv.iloc[-6] - 1) * 100) if len(cv) >= 6 else 0.0

    # Trend classification
    if cd_pct_of_peak > 0.95 and cd_slope_5d > 2:
        trend = "BUILDING_PEAK"
    elif cd_pct_of_peak > 0.85 and cd_slope_5d > 0:
        trend = "REACCUMULATING"
    elif cd_pct_of_peak > 0.85:
        trend = "HIGH_FLAT"
    elif cd_slope_5d > 5:
        trend = "BOTTOM_REVERSAL"
    elif cd_slope_5d > 0:
        trend = "RECOVERING"
    elif cd_pct_of_peak < 0.7:
        trend = "DEEP_UNWIND"
    else:
        trend = "DRIFTING"

    return {
        "cd_now": cd_now,
        "cd_peak": cd_peak,
        "cd_pct_of_peak": round(cd_pct_of_peak, 3),
        "cd_slope_5d": round(cd_slope_5d, 1),
        "cd_slope_10d": round(cd_slope_10d, 1),
        "cg_pct_of_peak": round(cg_pct_of_peak, 3),
        "cg_slope_5d": round(cg_slope_5d, 1),
        "cv_slope_5d": round(cv_slope_5d, 1),
        "trend": trend,
    }


def main():
    # Load coil features + intraday
    watch = pd.read_csv(OUT / "coiled_watchlist.csv")
    sprung = pd.read_csv(OUT / "coiled_already_sprung.csv")
    coil = pd.concat([
        watch.assign(yesterday_status="coiled"),
        sprung.assign(yesterday_status="sprung")
    ], ignore_index=True)

    # Use the pre_squeeze.csv which already has live_price + today_intraday_pct
    try:
        live = pd.read_csv(OUT / "pre_squeeze.csv")
        live = live[["ticker", "live_price", "today_intraday_pct"]]
    except Exception:
        live = None

    print(f"Auditing {len(coil)} tickers...")

    rows = []
    misses = 0
    for _, r in coil.iterrows():
        t = r["ticker"]
        path = GEX_CACHE / f"{t}.json"
        if not path.exists():
            misses += 1
            continue
        try:
            gex_data = json.loads(path.read_text())
        except Exception:
            misses += 1
            continue
        feats = parse_gex(gex_data)
        if not feats:
            misses += 1
            continue
        out_row = {
            "ticker": t,
            "theme": r.get("theme", "unthemed"),
            "yesterday_status": r["yesterday_status"],
            "close": r["close"],
            "bb_pct": r["bb_pct"],
            "atr_pct": r["atr_pct"],
            "vol_dryup": r["vol_dryup"],
            "range_pos": r["range_pos"],
            "pct_from_high": r["pct_from_high"],
            "ret_5d": r["ret_5d"],
            "trigger_20d": r["trigger_20d"],
            "trigger_60d": r["trigger_60d"],
            "trigger_126d": r["trigger_126d"],
            "stop_20d": r["stop_20d"],
            "ema21_slope": r["ema21_slope_pct_10d"],
            **feats,
        }
        rows.append(out_row)

    print(f"  → {len(rows)} scored, {misses} missing GEX data")
    df = pd.DataFrame(rows)

    # Join intraday if available
    if live is not None:
        df = df.merge(live, on="ticker", how="left")
    else:
        df["live_price"] = df["close"]
        df["today_intraday_pct"] = 0.0

    df["upside_to_126d_pct"] = -df["pct_from_high"]

    # COMPOSITE SQUEEZE-READY SCORE
    # Heavy weight on (a) compression and (b) positioning building toward peak
    def composite(row):
        s = 0
        # Compression (chart side)
        s += (1 - row["bb_pct"]) * 20
        s += (1 - row["atr_pct"]) * 10
        s += max(0, 1 - row["range_pos"]) * 10
        s += min(max(row["upside_to_126d_pct"], 0), 70) * 0.3
        # Positioning (GEX side)
        s += row["cd_pct_of_peak"] * 25  # at peak = full credit
        s += max(0, min(row["cd_slope_5d"], 30)) * 0.8  # rising = +
        s += max(0, min(row["cg_slope_5d"], 50)) * 0.3
        # Penalize already extended today
        if row.get("today_intraday_pct", 0) > 5:
            s -= 15
        if row.get("today_intraday_pct", 0) > 10:
            s -= 25
        # Penalize collapsing 21 EMA
        if row["ema21_slope"] < -3:
            s -= 10
        return round(s, 1)

    df["composite"] = df.apply(composite, axis=1)
    df = df.sort_values("composite", ascending=False).reset_index(drop=True)

    # PRE-SQUEEZE SUBSET: still coiled, not yet fired, building positioning
    pre = df[
        (df["bb_pct"] < 0.30)
        & (df["range_pos"] < 0.65)
        & (df.get("today_intraday_pct", 0).fillna(0) < 5)
        & (df["ret_5d"] < 10)
        & (df["pct_from_high"] < -15)
        & (df["cd_slope_5d"] > 0)  # call delta rising
        & (df["cd_pct_of_peak"] > 0.80)  # near peak
    ].copy()

    pre = pre.sort_values("composite", ascending=False).head(40)

    # Save full + pre-squeeze
    df.to_csv(OUT / "full_universe_audit.csv", index=False)
    pre.to_csv(OUT / "pre_squeeze_validated.csv", index=False)

    print(f"\n{'='*120}")
    print(f"PRE-SQUEEZE VALIDATED — coiled + delta building + not yet fired (top 30)")
    print(f"{'='*120}")
    cols = ["ticker", "theme", "yesterday_status", "close", "today_intraday_pct",
            "bb_pct", "range_pos", "pct_from_high", "ret_5d",
            "cd_pct_of_peak", "cd_slope_5d", "cg_slope_5d", "trend",
            "trigger_20d", "trigger_126d", "composite"]
    print(pre[cols].head(30).to_string(index=False))

    # Also surface the loudest signals by trend bucket
    print(f"\n{'='*100}")
    print("TREND DISTRIBUTION across full universe")
    print(f"{'='*100}")
    trend_counts = df["trend"].value_counts()
    print(trend_counts.to_string())

    print(f"\n{'='*100}")
    print("BUILDING_PEAK names (call delta near peak AND rising)")
    print(f"{'='*100}")
    building = df[df["trend"] == "BUILDING_PEAK"].sort_values("composite", ascending=False).head(20)
    print(building[["ticker","theme","close","bb_pct","range_pos","pct_from_high",
                   "cd_pct_of_peak","cd_slope_5d","cg_slope_5d","composite"]].to_string(index=False))

    print(f"\n{'='*100}")
    print("REACCUMULATING names (above 85% of peak, slope positive)")
    print(f"{'='*100}")
    reacc = df[df["trend"] == "REACCUMULATING"].sort_values("composite", ascending=False).head(20)
    print(reacc[["ticker","theme","close","bb_pct","range_pos","pct_from_high",
                "cd_pct_of_peak","cd_slope_5d","cg_slope_5d","composite"]].to_string(index=False))

    print(f"\n→ wrote full_universe_audit.csv ({len(df)} rows)")
    print(f"→ wrote pre_squeeze_validated.csv ({len(pre)} rows)")


if __name__ == "__main__":
    main()
