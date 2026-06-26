#!/usr/bin/env python3
"""
Sniper framework validation against Skylit Trinity replay data.

For each 1-min frame across 72 trading days (Dec 2025 → May 2026), compute:
  - King strike (largest |GEX|) and its sign
  - Regime from net 0DTE gamma
  - VEX net sign (4-Greek confluence signal)
  - Distance from spot to King

Then test framework claims forward in time (15-min and 30-min horizons):
  C-A: When spot is near King (≤ 0.5 SPY pts), does it stay near King? (pin behavior)
  C-B: When spot crosses King, which direction does it accelerate?
  C-C: Does GEX-VEX agreement improve directional hit rate?
  C-D: Intraday time-of-day effects (open / morning / lunch / afternoon / power hour)

Streaming: one file at a time, summary stats only, no full retention.

Run:  uv run --with luxon python sniper/validation/validate_skylit.py
"""
from __future__ import annotations
import os, sys, json, statistics, math
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

REPLAY_DIR = Path("/Users/saiyeeshrathish/gex-data-replay-reader/data")
TICKERS = ["SPY", "QQQ"]
HORIZONS_MIN = [15, 30, 60]
SUBSAMPLE_EVERY = 5  # minutes — subsample frames to keep compute bounded

ET = timezone(timedelta(hours=-4))  # EDT — approximate; data is mostly EDT in this window

def list_files():
    files = sorted(p for p in REPLAY_DIR.glob("gex-replay-*.json")
                   if p.name.count(".") == 1)  # skip .spxw-backup etc
    return files

def derive_structure(spot, strikes, gammaCol, vannaCol):
    """Given strike list + per-strike gamma + per-strike vanna for the nearest expiration,
    return King strike, signed total gex/vex, regime."""
    if not strikes or len(strikes) != len(gammaCol):
        return None
    # signed sums
    net_gex = sum(g for g in gammaCol if g)
    net_vex = sum(v for v in vannaCol if v) if vannaCol else 0
    # King = strike with max |gamma|
    king_idx = max(range(len(gammaCol)), key=lambda i: abs(gammaCol[i] or 0))
    king_strike = strikes[king_idx]
    king_gamma = gammaCol[king_idx]
    dist_to_king = king_strike - spot
    # Floor = largest +gamma below spot
    below = [(s, g) for s, g in zip(strikes, gammaCol) if s < spot and g and g > 0]
    floor = max(below, key=lambda x: x[1]) if below else None
    # Ceiling = largest +gamma above spot OR largest -gamma above spot
    above = [(s, g) for s, g in zip(strikes, gammaCol) if s > spot and g]
    ceiling = max(above, key=lambda x: abs(x[1])) if above else None
    return {
        "spot": spot,
        "net_gex": net_gex,
        "net_vex": net_vex,
        "regime": "POS" if net_gex > 0 else "NEG",
        "vex_regime": "POS" if net_vex > 0 else "NEG",
        "king_strike": king_strike,
        "king_gamma": king_gamma,
        "dist_to_king": dist_to_king,
        "floor": floor,
        "ceiling": ceiling,
    }

def process_file(path):
    """Stream one file, extract per-frame per-ticker structure + lookforward."""
    with open(path) as f:
        d = json.load(f)
    frames = d.get("frames", [])
    if not frames:
        return None

    # Build a {ticker: [(ts_ms, spot, struct)]} timeline
    timelines = {t: [] for t in TICKERS}
    for frame in frames:
        ts_str = frame["timestamp"]
        ts_ms = int(datetime.fromisoformat(ts_str.replace("Z","+00:00")).timestamp() * 1000)
        # Only sample every SUBSAMPLE_EVERY minutes
        ts_min = (ts_ms // 60000) % SUBSAMPLE_EVERY
        if ts_min != 0:
            continue
        for ticker in TICKERS:
            t = frame.get("tickers", {}).get(ticker)
            if not t: continue
            strikes = t.get("strikes") or []
            gammaValues = t.get("gammaValues") or []
            vannaValues = t.get("vannaValues") or []
            # nearest expiration (0DTE for that day) = column 0
            gammaCol = [row[0] if row else 0 for row in gammaValues]
            vannaCol = [row[0] if row else 0 for row in vannaValues]
            spot = t.get("spotPrice")
            if spot is None or not strikes:
                continue
            struct = derive_structure(spot, strikes, gammaCol, vannaCol)
            if struct:
                struct["ts_ms"] = ts_ms
                struct["ticker"] = ticker
                timelines[ticker].append(struct)

    # Sort timelines
    for t in TICKERS:
        timelines[t].sort(key=lambda x: x["ts_ms"])

    # Compute look-forward stats
    samples = []
    for ticker, tl in timelines.items():
        for i, here in enumerate(tl):
            # Find frames at +15, +30, +60 min
            futures = {}
            for h in HORIZONS_MIN:
                target_ms = here["ts_ms"] + h * 60_000
                # Find closest in tl[i+1:]
                future = None
                for j in range(i+1, len(tl)):
                    if tl[j]["ts_ms"] >= target_ms:
                        future = tl[j]
                        break
                if future:
                    spot_chg_pct = (future["spot"] - here["spot"]) / here["spot"] * 100
                    futures[h] = {"spot": future["spot"], "spot_chg_pct": spot_chg_pct,
                                  "moved_toward_king": (abs(future["dist_to_king"]) < abs(here["dist_to_king"])) if here["dist_to_king"] != 0 else None}
            here["futures"] = futures
            samples.append(here)

    return {"date": d.get("metadata", {}).get("date"), "samples": samples}

def aggregate(all_samples):
    """Per-ticker per-claim stats."""
    by_ticker = {t: [s for s in all_samples if s["ticker"] == t] for t in TICKERS}
    results = {}
    for ticker, samples in by_ticker.items():
        if not samples:
            continue
        # Filter time of day - keep ET 09:35-15:30 only
        valid = []
        for s in samples:
            dt = datetime.fromtimestamp(s["ts_ms"] / 1000, tz=timezone.utc)
            # convert to ET
            et_hour = (dt.hour - 4) % 24
            et_min = dt.minute
            # window: 09:35 ET to 15:30 ET → 13:35 UTC to 19:30 UTC
            ut_min_of_day = dt.hour * 60 + dt.minute
            if 13*60 + 35 <= ut_min_of_day <= 19*60 + 30:
                valid.append(s)
        samples = valid

        # Claim A — Pin behavior: when spot near King (≤ 0.5 pts SPY / 1.0 pts QQQ),
        # does it stay near King 30 min later?
        threshold = 0.5 if ticker == "SPY" else 1.0
        near_king = [s for s in samples if abs(s["dist_to_king"]) <= threshold and s["futures"].get(30)]
        stayed_near = sum(1 for s in near_king if abs(s["futures"][30]["spot"] - s["king_strike"]) <= threshold)
        # Random baseline: how often is *any* sample near King 30 min later?
        all30 = [s for s in samples if s["futures"].get(30)]
        baseline_near = sum(1 for s in all30 if abs(s["futures"][30]["spot"] - s["king_strike"]) <= threshold) / len(all30) if all30 else 0

        # Claim B — Move toward King: percent of samples whose spot moved toward King 30 min later
        with_future = [s for s in samples if s["futures"].get(30) and s["futures"][30]["moved_toward_king"] is not None]
        moved_toward = sum(1 for s in with_future if s["futures"][30]["moved_toward_king"])

        # Claim C — GEX × VEX agreement signal:
        # Define "agreement" = same sign (POS×POS or NEG×NEG)
        agreed = [s for s in samples if s["regime"] == s["vex_regime"] and s["futures"].get(30)]
        disagreed = [s for s in samples if s["regime"] != s["vex_regime"] and s["futures"].get(30)]
        # When in NEG×NEG (trend regime), spot should continue away from prior spot:
        # we test: was abs(future_change) larger when GEX/VEX agreed?
        agreed_abs_moves = [abs(s["futures"][30]["spot_chg_pct"]) for s in agreed]
        disagreed_abs_moves = [abs(s["futures"][30]["spot_chg_pct"]) for s in disagreed]

        # Claim D — Time of day buckets
        tod_buckets = {"09:35-10:30": [], "10:30-12:00": [], "12:00-14:00": [], "14:00-15:30": []}
        for s in samples:
            dt = datetime.fromtimestamp(s["ts_ms"] / 1000, tz=timezone.utc)
            mod = dt.hour * 60 + dt.minute
            et = mod  # already UTC, convert mentally: 13:35-14:30 UT = 09:35-10:30 ET, 14:30-16:00 = 10:30-12:00, 16:00-18:00 = 12:00-14:00, 18:00-19:30 = 14:00-15:30
            if 13*60+35 <= mod < 14*60+30: tod_buckets["09:35-10:30"].append(s)
            elif 14*60+30 <= mod < 16*60: tod_buckets["10:30-12:00"].append(s)
            elif 16*60 <= mod < 18*60: tod_buckets["12:00-14:00"].append(s)
            elif 18*60 <= mod <= 19*60+30: tod_buckets["14:00-15:30"].append(s)

        def pin_rate(sublist):
            sub_near = [s for s in sublist if abs(s["dist_to_king"]) <= threshold and s["futures"].get(30)]
            if not sub_near: return None
            return sum(1 for s in sub_near if abs(s["futures"][30]["spot"] - s["king_strike"]) <= threshold) / len(sub_near)

        results[ticker] = {
            "n_samples_total": len(samples),
            "claim_A_pin_behavior": {
                "near_king_threshold_pts": threshold,
                "n_near_king": len(near_king),
                "pct_stayed_near_30min": stayed_near / len(near_king) * 100 if near_king else 0,
                "baseline_pct_30min": baseline_near * 100,
                "edge_vs_baseline": (stayed_near / len(near_king) * 100 - baseline_near * 100) if near_king else 0,
            },
            "claim_B_move_toward_king": {
                "n": len(with_future),
                "pct_moved_toward_king": moved_toward / len(with_future) * 100 if with_future else 0,
                "framework_says": "Spot should mean-revert toward King — expect > 50%",
            },
            "claim_C_gex_vex_agreement": {
                "agreed_n": len(agreed),
                "disagreed_n": len(disagreed),
                "agreed_abs_30min_move_pct": statistics.mean(agreed_abs_moves) if agreed_abs_moves else 0,
                "disagreed_abs_30min_move_pct": statistics.mean(disagreed_abs_moves) if disagreed_abs_moves else 0,
                "framework_says": "When GEX and VEX both POS (pin) or both NEG (trend), signal is stronger — expect bigger moves when both NEG, smaller when both POS",
            },
            "claim_D_time_of_day_pin_rates": {
                bucket: {"n_near": len([s for s in samples_list if abs(s["dist_to_king"]) <= threshold and s["futures"].get(30)]),
                         "pin_rate_pct": (pin_rate(samples_list) or 0) * 100}
                for bucket, samples_list in tod_buckets.items()
            },
        }
    return results

def main():
    files = list_files()
    print(f"Found {len(files)} replay files")
    all_samples = []
    for i, f in enumerate(files):
        if i % 10 == 0:
            print(f"  [{i+1}/{len(files)}] {f.name} ...", flush=True)
        try:
            r = process_file(f)
            if r:
                all_samples.extend(r["samples"])
        except (json.JSONDecodeError, OSError) as e:
            print(f"  skipped {f.name}: {e}", file=sys.stderr)
            continue
    print(f"\nTotal samples: {len(all_samples):,}")
    results = aggregate(all_samples)
    out = Path("sniper/validation/results_skylit.json")
    out.write_text(json.dumps(results, indent=2, default=str))
    print(f"\nWrote {out}")
    # Pretty print
    for ticker, r in results.items():
        print(f"\n=== {ticker} ({r['n_samples_total']:,} samples) ===")
        a = r["claim_A_pin_behavior"]
        print(f"  A. Pin: when spot ≤ {a['near_king_threshold_pts']} pts from King:")
        print(f"     stayed near King 30 min later: {a['pct_stayed_near_30min']:.1f}%")
        print(f"     baseline (any sample near King): {a['baseline_pct_30min']:.1f}%")
        print(f"     EDGE: {a['edge_vs_baseline']:+.1f} pp")
        b = r["claim_B_move_toward_king"]
        print(f"  B. Mean reversion to King: {b['pct_moved_toward_king']:.1f}%  (target >50%)")
        c = r["claim_C_gex_vex_agreement"]
        print(f"  C. GEX×VEX agreement (avg |spot move| 30min):")
        print(f"     agreed: {c['agreed_abs_30min_move_pct']:.3f}%  (n={c['agreed_n']})")
        print(f"     disagreed: {c['disagreed_abs_30min_move_pct']:.3f}%  (n={c['disagreed_n']})")
        d = r["claim_D_time_of_day_pin_rates"]
        print(f"  D. Pin rate by time-of-day:")
        for bucket, stats in d.items():
            print(f"     {bucket}: n={stats['n_near']:>5d}  pin={stats['pin_rate_pct']:.1f}%")

if __name__ == "__main__":
    main()
