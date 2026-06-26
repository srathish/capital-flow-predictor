#!/usr/bin/env python3
"""
Test the morning-brief claim: "King = bull/bear axis."

For each Skylit Trinity frame, classify spot's position relative to King at time T:
  - above_King: spot > King
  - below_King: spot < King
  - at_King:    |spot - King| ≤ threshold

Then at T+30 min, check:
  - Did spot *continue* in the same direction it started?
  - Did spot cross back through the King?

This tests whether the trade rule "above King = buy calls, below King = buy puts"
has empirical edge.
"""
from __future__ import annotations
import os, sys, json, statistics
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

REPLAY_DIR = Path("/Users/saiyeeshrathish/gex-data-replay-reader/data")
TICKERS = ["SPY", "QQQ"]
SUBSAMPLE_EVERY = 5  # minutes
HORIZON_MIN = 30

def list_files():
    return sorted(p for p in REPLAY_DIR.glob("gex-replay-*.json")
                  if p.name.count(".") == 1)

def king_of(strikes, gammaCol):
    if not strikes or not gammaCol: return None
    idx = max(range(len(gammaCol)), key=lambda i: abs(gammaCol[i] or 0))
    return strikes[idx], gammaCol[idx]

def process_file(path, threshold_map):
    with open(path) as f:
        d = json.load(f)
    frames = d.get("frames") or []
    timelines = {t: [] for t in TICKERS}
    for frame in frames:
        ts_str = frame["timestamp"]
        ts_ms = int(datetime.fromisoformat(ts_str.replace("Z","+00:00")).timestamp() * 1000)
        if (ts_ms // 60000) % SUBSAMPLE_EVERY != 0: continue
        for ticker in TICKERS:
            t = frame.get("tickers", {}).get(ticker)
            if not t: continue
            strikes = t.get("strikes") or []
            gammaValues = t.get("gammaValues") or []
            if not strikes or not gammaValues: continue
            gammaCol = [row[0] if row else 0 for row in gammaValues]
            vannaValues = t.get("vannaValues") or []
            vannaCol = [row[0] if row else 0 for row in vannaValues]
            spot = t.get("spotPrice")
            if spot is None: continue
            k = king_of(strikes, gammaCol)
            if k is None: continue
            king_strike, king_gamma = k
            net_gex = sum(g for g in gammaCol if g)
            net_vex = sum(v for v in vannaCol if v) if vannaCol else 0
            timelines[ticker].append({
                "ts_ms": ts_ms,
                "spot": spot,
                "king": king_strike,
                "king_gamma": king_gamma,
                "regime": "POS" if net_gex > 0 else "NEG",
                "vex_regime": "POS" if net_vex > 0 else "NEG",
                "dist_to_king": spot - king_strike,
            })
    # Sort
    for t in TICKERS:
        timelines[t].sort(key=lambda x: x["ts_ms"])
    # Compute look-forward stats
    samples = []
    for ticker, tl in timelines.items():
        threshold = threshold_map[ticker]
        for i, here in enumerate(tl):
            target_ms = here["ts_ms"] + HORIZON_MIN * 60_000
            future = None
            for j in range(i+1, len(tl)):
                if tl[j]["ts_ms"] >= target_ms:
                    future = tl[j]; break
            if not future: continue
            position = "ABOVE" if here["spot"] > here["king"] + threshold else \
                       "BELOW" if here["spot"] < here["king"] - threshold else "AT"
            future_position = "ABOVE" if future["spot"] > here["king"] + threshold else \
                              "BELOW" if future["spot"] < here["king"] - threshold else "AT"
            # Did the move continue in the starting direction?
            spot_chg = future["spot"] - here["spot"]
            continued = False
            if position == "ABOVE" and spot_chg > 0: continued = True
            elif position == "BELOW" and spot_chg < 0: continued = True
            # Did it cross back through the King?
            crossed_back = (position == "ABOVE" and future["spot"] < here["king"]) or \
                           (position == "BELOW" and future["spot"] > here["king"])
            samples.append({
                "ticker": ticker,
                "ts_ms": here["ts_ms"],
                "position": position,
                "future_position": future_position,
                "continued": continued,
                "crossed_back": crossed_back,
                "regime": here["regime"],
                "vex_regime": here["vex_regime"],
                "spot_chg_pct": spot_chg / here["spot"] * 100,
                "abs_chg_pct": abs(spot_chg) / here["spot"] * 100,
            })
    return samples

def aggregate(samples):
    by_ticker = defaultdict(list)
    for s in samples:
        by_ticker[s["ticker"]].append(s)
    results = {}
    for ticker, ss in by_ticker.items():
        # Position breakdown
        above = [s for s in ss if s["position"] == "ABOVE"]
        below = [s for s in ss if s["position"] == "BELOW"]
        at    = [s for s in ss if s["position"] == "AT"]
        def stats(sub, want_cont, label):
            if not sub: return {"n": 0}
            cont = sum(1 for s in sub if s["continued"] == want_cont)
            cross = sum(1 for s in sub if s["crossed_back"])
            avg_move = statistics.mean(s["spot_chg_pct"] for s in sub)
            return {
                "label": label,
                "n": len(sub),
                "continuation_rate_pct": cont / len(sub) * 100,
                "crossback_rate_pct": cross / len(sub) * 100,
                "avg_signed_move_pct": avg_move,
            }
        # Continuation in NEG regime (where framework expects trend)
        above_neg = [s for s in above if s["regime"] == "NEG"]
        below_neg = [s for s in below if s["regime"] == "NEG"]
        above_pos = [s for s in above if s["regime"] == "POS"]
        below_pos = [s for s in below if s["regime"] == "POS"]
        # GEX×VEX agreement
        above_agreed = [s for s in above if s["regime"] == s["vex_regime"]]
        below_agreed = [s for s in below if s["regime"] == s["vex_regime"]]

        results[ticker] = {
            "all_above": stats(above, True, "ABOVE → up?"),
            "all_below": stats(below, True, "BELOW → down?"),
            "above_NEG_regime": stats(above_neg, True, "ABOVE × NEG GEX → up?"),
            "below_NEG_regime": stats(below_neg, True, "BELOW × NEG GEX → down?"),
            "above_POS_regime": stats(above_pos, True, "ABOVE × POS GEX → up?"),
            "below_POS_regime": stats(below_pos, True, "BELOW × POS GEX → down?"),
            "above_GEX_VEX_agree": stats(above_agreed, True, "ABOVE × GEX=VEX → up?"),
            "below_GEX_VEX_agree": stats(below_agreed, True, "BELOW × GEX=VEX → down?"),
        }
    return results

def main():
    threshold_map = {"SPY": 0.5, "QQQ": 1.0}
    files = list_files()
    print(f"Found {len(files)} files. Testing axis claim with {HORIZON_MIN}-min horizon.")
    all_samples = []
    for i, f in enumerate(files):
        if i % 15 == 0: print(f"  [{i+1}/{len(files)}]", flush=True)
        try:
            all_samples.extend(process_file(f, threshold_map))
        except Exception as e:
            print(f"  skipped {f.name}: {e}", file=sys.stderr)
    print(f"Total samples: {len(all_samples):,}")
    results = aggregate(all_samples)
    out = Path("sniper/validation/results_axis.json")
    out.write_text(json.dumps(results, indent=2))
    print(f"\nWrote {out}\n")
    for ticker, r in results.items():
        print(f"=== {ticker} ===")
        for k, v in r.items():
            if v["n"] == 0: continue
            print(f"  {v['label']:<35}  n={v['n']:>5}  cont={v['continuation_rate_pct']:>5.1f}%  cross_back={v['crossback_rate_pct']:>5.1f}%  avg_move={v['avg_signed_move_pct']:+.3f}%")
        print()

if __name__ == "__main__":
    main()
