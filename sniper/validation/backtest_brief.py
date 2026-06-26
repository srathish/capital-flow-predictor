#!/usr/bin/env python3
"""
Backtest the sniper morning brief across 72 days of Skylit Trinity replay.

For each day:
  1. Find the 09:35 ET frame
  2. Compute structure (King / floor / ceiling / liquidity vacuums)
  3. Generate the brief:
       - PRIMARY: mean reversion to King (CALLS if below, PUTS if above, PIN if at)
       - BREAKOUT: above ceiling → vacuum target (CALLS), below floor → vacuum (PUTS)
  4. Grade against the rest of the day:
       - Primary "mean reversion" hit: did spot reach within threshold of King at any
         point after 09:35 ET?
       - Breakout up: did spot close above ceiling + buffer, then continue to vacuum?
       - Breakout down: did spot close below floor − buffer, then continue to vacuum?
  5. Per-day P&L assuming naive ATM 0DTE strikes and 50-point delta proxy.

Outputs:
  sniper/validation/brief_backtest.json
  sniper/validation/BRIEF_BACKTEST.md  (per-day table + summary)
"""
from __future__ import annotations
import os, sys, json, statistics
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

REPLAY_DIR = Path("/Users/saiyeeshrathish/gex-data-replay-reader/data")
TICKERS = ["SPY", "QQQ"]
THRESHOLDS = {"SPY": 0.5, "QQQ": 1.0}

# Empirical pin rates from REPORT_SKYLIT.md — used for primary play confidence
PIN_RATES_AFTERNOON = {"SPY": 54.0, "QQQ": 66.0}

def list_files():
    return sorted(p for p in REPLAY_DIR.glob("gex-replay-*.json") if p.name.count(".") == 1)

def derive_structure(spot, strikes, gammaCol):
    """King + floor + ceiling + vacuums. Mirrors apps/gex/src/domain/structure.js."""
    if not strikes or not gammaCol: return None
    # King = max |gamma|
    idx = max(range(len(gammaCol)), key=lambda i: abs(gammaCol[i] or 0))
    king_strike = strikes[idx]
    king_gamma = gammaCol[idx]
    # Floor = largest positive below spot
    below_pos = [(s, g) for s, g in zip(strikes, gammaCol) if s < spot and g and g > 0]
    floor = max(below_pos, key=lambda x: x[1]) if below_pos else None
    # Ceiling = largest |gamma| above spot
    above = [(s, g) for s, g in zip(strikes, gammaCol) if s > spot and g]
    ceiling = max(above, key=lambda x: abs(x[1])) if above else None
    # Liquidity vacuum: any contiguous range of strikes where |gamma| < small_threshold
    # Approximate: find gaps > 1 strike where |gamma| ≤ 5% of max
    max_abs = max(abs(g or 0) for g in gammaCol) or 1
    threshold_g = 0.05 * max_abs
    vacuums = []
    in_vacuum = False
    vac_start = None
    for s, g in zip(strikes, gammaCol):
        is_vacuum = abs(g or 0) < threshold_g
        if is_vacuum and not in_vacuum:
            vac_start = s; in_vacuum = True
        elif not is_vacuum and in_vacuum:
            vacuums.append({"low": vac_start, "high": s})
            in_vacuum = False
    if in_vacuum:
        vacuums.append({"low": vac_start, "high": strikes[-1]})
    return {
        "king": king_strike, "king_gamma": king_gamma,
        "floor": floor[0] if floor else None,
        "ceiling": ceiling[0] if ceiling else None,
        "vacuums": vacuums,
    }

def nearest_vacuum_above(spot, vacuums):
    above = sorted([v for v in vacuums if v["low"] > spot], key=lambda v: v["low"])
    return above[0] if above else None

def nearest_vacuum_below(spot, vacuums):
    below = sorted([v for v in vacuums if v["high"] < spot], key=lambda v: v["high"], reverse=True)
    return below[0] if below else None

def generate_brief(ticker, spot, structure):
    threshold = THRESHOLDS[ticker]
    king = structure["king"]
    floor = structure["floor"]
    ceiling = structure["ceiling"]
    vacuums = structure["vacuums"]
    if abs(spot - king) <= threshold:
        primary = "PIN"
    elif spot < king:
        primary = "REVERT_UP"  # buy calls toward King
    else:
        primary = "REVERT_DOWN"  # buy puts toward King
    up_vac = nearest_vacuum_above(spot, vacuums)
    down_vac = nearest_vacuum_below(spot, vacuums)
    return {
        "primary": primary,
        "primary_target": king,
        "breakout_above": (ceiling + threshold) if ceiling is not None else None,
        "breakout_above_target": up_vac["high"] if up_vac else None,
        "breakout_below": (floor - threshold) if floor is not None else None,
        "breakout_below_target": down_vac["low"] if down_vac else None,
    }

def grade_brief(brief, spot_0935, day_path):
    """Look at the rest of the day's price action and grade the brief."""
    # day_path is the list of {ts_ms, spot} after 09:35 ET
    if not day_path:
        return {"primary_hit": None, "breakout_above_triggered": False, "breakout_below_triggered": False}
    spots = [p["spot"] for p in day_path]
    day_high = max(spots)
    day_low = min(spots)
    threshold = 0.5  # we'll use generic; brief carries the ticker-specific in caller

    # Primary play grade
    primary_hit = False
    primary_pnl_pts = 0
    target = brief["primary_target"]
    if brief["primary"] == "PIN":
        # Pin: profit if spot stays within +/- 1 pt of target by close
        close = spots[-1]
        primary_hit = abs(close - target) <= 1.0
        primary_pnl_pts = -abs(close - target)  # negative deviation
    elif brief["primary"] == "REVERT_UP":
        # We bought calls toward King target. Hit if spot reaches target.
        primary_hit = day_high >= target
        if primary_hit:
            primary_pnl_pts = target - spot_0935
        else:
            primary_pnl_pts = spots[-1] - spot_0935  # rough P&L
    elif brief["primary"] == "REVERT_DOWN":
        primary_hit = day_low <= target
        if primary_hit:
            primary_pnl_pts = spot_0935 - target
        else:
            primary_pnl_pts = spot_0935 - spots[-1]

    # Breakout above
    breakout_above_triggered = False
    breakout_above_hit = False
    breakout_above_pnl_pts = 0
    if brief["breakout_above"] is not None:
        # Trigger if spot crosses breakout level
        if day_high >= brief["breakout_above"]:
            breakout_above_triggered = True
            # Did it reach the vacuum target?
            if brief["breakout_above_target"] is not None and day_high >= brief["breakout_above_target"]:
                breakout_above_hit = True
                breakout_above_pnl_pts = brief["breakout_above_target"] - brief["breakout_above"]
            else:
                # Did NOT reach target — partial
                breakout_above_pnl_pts = day_high - brief["breakout_above"] - 0.5  # arbitrary slippage
    # Breakout below
    breakout_below_triggered = False
    breakout_below_hit = False
    breakout_below_pnl_pts = 0
    if brief["breakout_below"] is not None:
        if day_low <= brief["breakout_below"]:
            breakout_below_triggered = True
            if brief["breakout_below_target"] is not None and day_low <= brief["breakout_below_target"]:
                breakout_below_hit = True
                breakout_below_pnl_pts = brief["breakout_below"] - brief["breakout_below_target"]
            else:
                breakout_below_pnl_pts = brief["breakout_below"] - day_low - 0.5
    return {
        "primary_hit": primary_hit,
        "primary_pnl_pts": primary_pnl_pts,
        "breakout_above_triggered": breakout_above_triggered,
        "breakout_above_hit": breakout_above_hit,
        "breakout_above_pnl_pts": breakout_above_pnl_pts,
        "breakout_below_triggered": breakout_below_triggered,
        "breakout_below_hit": breakout_below_hit,
        "breakout_below_pnl_pts": breakout_below_pnl_pts,
        "day_high": day_high, "day_low": day_low, "day_close": spots[-1],
    }

def process_file(path):
    with open(path) as f:
        d = json.load(f)
    frames = d.get("frames") or []
    if not frames:
        return None
    # Find 09:35 ET = 13:35 UTC frame and build per-ticker timelines
    timelines = {t: [] for t in TICKERS}
    first_frames = {t: None for t in TICKERS}
    for frame in frames:
        ts_str = frame["timestamp"]
        ts_ms = int(datetime.fromisoformat(ts_str.replace("Z","+00:00")).timestamp() * 1000)
        dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
        mod = dt.hour * 60 + dt.minute
        # 09:30 ET = 13:30 UTC during EDT (most of this dataset). Take first frame ≥ 13:35.
        for ticker in TICKERS:
            t = frame.get("tickers", {}).get(ticker)
            if not t: continue
            spot = t.get("spotPrice")
            if spot is None: continue
            timelines[ticker].append({"ts_ms": ts_ms, "spot": spot, "raw": t})
            if first_frames[ticker] is None and mod >= 13*60 + 35:
                first_frames[ticker] = {"ts_ms": ts_ms, "spot": spot, "raw": t}
    # If no 09:35 frame, skip
    out = {"date": d.get("metadata", {}).get("date")}
    per_ticker = {}
    for ticker in TICKERS:
        ff = first_frames[ticker]
        if ff is None: continue
        strikes = ff["raw"].get("strikes") or []
        gammaValues = ff["raw"].get("gammaValues") or []
        if not strikes or not gammaValues: continue
        gammaCol = [row[0] if row else 0 for row in gammaValues]
        struct = derive_structure(ff["spot"], strikes, gammaCol)
        if struct is None: continue
        brief = generate_brief(ticker, ff["spot"], struct)
        # Future path: frames after 09:35
        future = [p for p in timelines[ticker] if p["ts_ms"] > ff["ts_ms"]]
        grade = grade_brief(brief, ff["spot"], future)
        per_ticker[ticker] = {
            "spot_0935": ff["spot"],
            "structure": struct,
            "brief": brief,
            "grade": grade,
        }
    out["per_ticker"] = per_ticker
    return out

def aggregate(days):
    """Compute hit rate + P&L by ticker by play type."""
    summary = {}
    for ticker in TICKERS:
        primaries = defaultdict(list)
        bo_above_trig = 0; bo_above_hit = 0; bo_above_pnls = []
        bo_below_trig = 0; bo_below_hit = 0; bo_below_pnls = []
        for d in days:
            tt = d.get("per_ticker", {}).get(ticker)
            if not tt: continue
            g = tt["grade"]; b = tt["brief"]
            primaries[b["primary"]].append({
                "hit": g["primary_hit"],
                "pnl": g["primary_pnl_pts"],
            })
            if g["breakout_above_triggered"]:
                bo_above_trig += 1
                if g["breakout_above_hit"]: bo_above_hit += 1
                bo_above_pnls.append(g["breakout_above_pnl_pts"])
            if g["breakout_below_triggered"]:
                bo_below_trig += 1
                if g["breakout_below_hit"]: bo_below_hit += 1
                bo_below_pnls.append(g["breakout_below_pnl_pts"])
        summary[ticker] = {
            "primary_by_type": {},
            "breakout_above": {
                "triggered": bo_above_trig,
                "hit_full_target": bo_above_hit,
                "hit_rate_pct": bo_above_hit / bo_above_trig * 100 if bo_above_trig else 0,
                "avg_pnl_pts": statistics.mean(bo_above_pnls) if bo_above_pnls else 0,
                "total_pnl_pts": sum(bo_above_pnls),
            },
            "breakout_below": {
                "triggered": bo_below_trig,
                "hit_full_target": bo_below_hit,
                "hit_rate_pct": bo_below_hit / bo_below_trig * 100 if bo_below_trig else 0,
                "avg_pnl_pts": statistics.mean(bo_below_pnls) if bo_below_pnls else 0,
                "total_pnl_pts": sum(bo_below_pnls),
            },
        }
        for ptype, ph in primaries.items():
            hits = [x for x in ph if x["hit"]]
            summary[ticker]["primary_by_type"][ptype] = {
                "n": len(ph),
                "hit_rate_pct": len(hits) / len(ph) * 100 if ph else 0,
                "avg_pnl_pts": statistics.mean([x["pnl"] for x in ph]) if ph else 0,
                "total_pnl_pts": sum(x["pnl"] for x in ph),
            }
    return summary

def main():
    files = list_files()
    print(f"Backtesting brief on {len(files)} days...")
    days = []
    for i, f in enumerate(files):
        if i % 15 == 0: print(f"  [{i+1}/{len(files)}]", flush=True)
        try:
            r = process_file(f)
            if r and r.get("per_ticker"):
                days.append(r)
        except Exception as e:
            print(f"  skipped {f.name}: {e}", file=sys.stderr)
    print(f"Days processed: {len(days)}")
    summary = aggregate(days)
    out = Path("sniper/validation/brief_backtest.json")
    out.write_text(json.dumps({"summary": summary, "days": days}, indent=2, default=str))
    print(f"Wrote {out}")
    # Print summary
    for ticker, s in summary.items():
        print(f"\n=== {ticker} ===")
        print(f"PRIMARY plays:")
        for ptype, p in s["primary_by_type"].items():
            print(f"  {ptype:<12} n={p['n']:>3}  hit={p['hit_rate_pct']:>5.1f}%  avg P&L={p['avg_pnl_pts']:+.2f} pts  total={p['total_pnl_pts']:+.1f} pts")
        ba = s["breakout_above"]; bb = s["breakout_below"]
        print(f"BREAKOUT above:  triggered {ba['triggered']:>3}  full-target hit {ba['hit_full_target']:>3} ({ba['hit_rate_pct']:.1f}%)  avg={ba['avg_pnl_pts']:+.2f} pts  total={ba['total_pnl_pts']:+.1f}")
        print(f"BREAKOUT below:  triggered {bb['triggered']:>3}  full-target hit {bb['hit_full_target']:>3} ({bb['hit_rate_pct']:.1f}%)  avg={bb['avg_pnl_pts']:+.2f} pts  total={bb['total_pnl_pts']:+.1f}")

if __name__ == "__main__":
    main()
