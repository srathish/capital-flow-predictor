#!/usr/bin/env python3
"""
Trinity confluence backtest with 0-100 bullishness score.

Glitch's rule: "you have to look at SPX, you have to look at SPY, you have to look at QQQ,
and you have to look at the net GEX. And then you sometimes even have to look at the net VEX."

Per-ticker bullishness score (0-100):
  0   = spot at the floor (negative gamma pit) → max bearish
  50  = spot at the King → balanced / pin
  100 = spot at the ceiling (positive +gamma resistance) → max bullish
  +5  if net VEX positive (supportive dealer bid)
  -5  if net VEX negative (vol-controlled, fade risk)

Trinity score = average of SPY + QQQ + SPXW sub-scores
Divergence    = max(sub-score) - min(sub-score)  (>30 = significant disagreement)

Strategy per Trinity score band:
  0 - 20   MAX_BEARISH   → V-BOUNCE CALLS at SPY floor (Glitch's main trade)
  20 - 40  BEARISH       → fade rally into resistance (puts)
  40 - 60  BALANCED      → mean-revert within pin band
  60 - 80  BULLISH       → momentum continuation (calls)
  80 - 100 MAX_BULLISH   → CEILING REJECTION PUTS at SPY ceiling

Skip if divergence > 30 (Glitch's "trinity disagreement = wait").
"""
from __future__ import annotations
import json, statistics
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPLAY_DIR = Path("/Users/saiyeeshrathish/gex-data-replay-reader/data")
TICKERS = ["SPY", "QQQ", "SPXW"]
WINDOW_START_UTC_MIN = 14 * 60       # 10:00 ET
WINDOW_END_UTC_MIN = 16 * 60 + 30    # 12:30 ET

NEAR_LEVEL_BAND = {"SPY": 0.50, "QQQ": 1.0, "SPXW": 5.0}
# Asymmetric: take profits early (Glitch's +30-50%), wider stop
TARGET_PTS    = {"SPY": 0.35, "QQQ": 0.60, "SPXW": 3.5}
STOP_PTS      = {"SPY": 0.60, "QQQ": 1.0, "SPXW": 6.0}

# Divergence threshold — skip trade if any two tickers differ by more than this
DIVERGENCE_LIMIT = 30

# Extreme score bands — only trade A+ extremes
EXTREME_BEARISH = 20   # score < this = V-bounce calls
EXTREME_BULLISH = 80   # score > this = ceiling rejection puts

TREND_RANGE_PCT = 0.5
TREND_EXTREME_PCT = 0.7

def list_files():
    return sorted(p for p in REPLAY_DIR.glob("gex-replay-*.json") if p.name.count(".") == 1)

def classify_archetype(open_p, high, low, close):
    if open_p == 0 or high == low: return "QUIET"
    range_pct = (high - low) / open_p * 100
    if range_pct < TREND_RANGE_PCT: return "QUIET"
    close_pos = (close - low) / (high - low)
    open_pos = (open_p - low) / (high - low)
    if open_pos > TREND_EXTREME_PCT and close_pos < (1 - TREND_EXTREME_PCT):
        return "TREND_DOWN"
    if open_pos < (1 - TREND_EXTREME_PCT) and close_pos > TREND_EXTREME_PCT:
        return "TREND_UP"
    if 0.3 < close_pos < 0.7:
        return "WHIPSAW"
    return "TREND_UP" if close_pos > 0.5 else "TREND_DOWN"

def derive_structure(spot, strikes, gammaCol, vannaCol):
    if not strikes: return None
    idx = max(range(len(gammaCol)), key=lambda i: abs(gammaCol[i] or 0))
    king_strike = strikes[idx]
    below_pos = [(s, g) for s, g in zip(strikes, gammaCol) if s < spot and g and g > 0]
    floor = max(below_pos, key=lambda x: x[1])[0] if below_pos else None
    above = [(s, g) for s, g in zip(strikes, gammaCol) if s > spot and g]
    ceiling = max(above, key=lambda x: abs(x[1]))[0] if above else None
    net_vex = sum(v for v in vannaCol if v) if vannaCol else 0
    return {"spot": spot, "king": king_strike, "floor": floor, "ceiling": ceiling, "net_vex": net_vex}

def bullishness_score(struct):
    """Return 0-100 score. 0 = at floor (max bearish), 50 = at King, 100 = at ceiling."""
    if struct is None: return None
    spot = struct["spot"]
    king = struct["king"]
    floor = struct["floor"]
    ceiling = struct["ceiling"]
    # Position interpolation
    if floor is None or ceiling is None or floor == ceiling:
        pos = 50.0
    elif spot <= floor:
        pos = 0.0
    elif spot >= ceiling:
        pos = 100.0
    elif king is None or king == floor or king == ceiling:
        # Linear interpolation floor → ceiling
        pos = 100 * (spot - floor) / (ceiling - floor)
    else:
        # Two-segment interpolation: floor → king (0-50), king → ceiling (50-100)
        if spot <= king:
            denom = king - floor
            pos = 50 * (spot - floor) / denom if denom > 0 else 50
        else:
            denom = ceiling - king
            pos = 50 + 50 * (spot - king) / denom if denom > 0 else 50
    # VEX adjustment
    pos += 5 if struct["net_vex"] > 0 else -5
    return max(0.0, min(100.0, pos))

def trinity_score(structs):
    subs = {t: bullishness_score(s) for t, s in structs.items()}
    valid = [v for v in subs.values() if v is not None]
    if len(valid) < 3: return None, subs, None
    avg = statistics.mean(valid)
    divergence = max(valid) - min(valid)
    return avg, subs, divergence

def regime_from_score(score):
    if score < 20: return "MAX_BEARISH"
    if score < 40: return "BEARISH"
    if score < 60: return "BALANCED"
    if score < 80: return "BULLISH"
    return "MAX_BULLISH"

def pick_trade(score, spy_struct, spy_spot):
    """Return (direction, entry, target, stop) or None.
    Only take A+ extremes (score < 20 OR > 80). Skip everything in middle."""
    floor = spy_struct["floor"]; ceiling = spy_struct["ceiling"]
    band = NEAR_LEVEL_BAND["SPY"]
    tp = TARGET_PTS["SPY"]; sp = STOP_PTS["SPY"]
    if score < EXTREME_BEARISH and floor and abs(spy_spot - floor) <= band:
        # V-bounce calls at floor — Glitch's main trade
        return ("CALLS_VBOUNCE", spy_spot, spy_spot + tp, spy_spot - sp)
    if score > EXTREME_BULLISH and ceiling and abs(spy_spot - ceiling) <= band:
        # Ceiling rejection puts
        return ("PUTS_REJECT", spy_spot, spy_spot - tp, spy_spot + sp)
    return None

def process_file(path):
    with open(path) as f:
        d = json.load(f)
    frames = d.get("frames") or []
    if not frames: return None
    timelines = {t: [] for t in TICKERS}
    day_open = day_high = day_low = day_close = None
    for frame in frames:
        ts_str = frame["timestamp"]
        ts_ms = int(datetime.fromisoformat(ts_str.replace("Z","+00:00")).timestamp() * 1000)
        dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
        mod = dt.hour * 60 + dt.minute
        for ticker in TICKERS:
            t = frame.get("tickers", {}).get(ticker)
            if not t: continue
            spot = t.get("spotPrice")
            if spot is None: continue
            strikes = t.get("strikes") or []
            gv = t.get("gammaValues") or []
            vv = t.get("vannaValues") or []
            gammaCol = [row[0] if row else 0 for row in gv]
            vannaCol = [row[0] if row else 0 for row in vv]
            timelines[ticker].append({
                "ts_ms": ts_ms, "mod": mod, "spot": spot,
                "strikes": strikes, "gammaCol": gammaCol, "vannaCol": vannaCol,
            })
            if ticker == "SPY":
                if day_open is None: day_open = spot
                if day_high is None or spot > day_high: day_high = spot
                if day_low is None or spot < day_low: day_low = spot
                day_close = spot
    if not all(timelines[t] for t in TICKERS): return None
    archetype = classify_archetype(day_open, day_high, day_low, day_close)

    qqq_idx = spxw_idx = 0
    trade = None
    for i, spy in enumerate(timelines["SPY"]):
        if spy["mod"] < WINDOW_START_UTC_MIN: continue
        if spy["mod"] > WINDOW_END_UTC_MIN: break
        while qqq_idx < len(timelines["QQQ"]) - 1 and timelines["QQQ"][qqq_idx]["ts_ms"] < spy["ts_ms"]: qqq_idx += 1
        while spxw_idx < len(timelines["SPXW"]) - 1 and timelines["SPXW"][spxw_idx]["ts_ms"] < spy["ts_ms"]: spxw_idx += 1
        qqq = timelines["QQQ"][qqq_idx]
        spxw = timelines["SPXW"][spxw_idx]
        structs = {
            "SPY": derive_structure(spy["spot"], spy["strikes"], spy["gammaCol"], spy["vannaCol"]),
            "QQQ": derive_structure(qqq["spot"], qqq["strikes"], qqq["gammaCol"], qqq["vannaCol"]),
            "SPXW": derive_structure(spxw["spot"], spxw["strikes"], spxw["gammaCol"], spxw["vannaCol"]),
        }
        if any(s is None for s in structs.values()): continue
        score, sub_scores, divergence = trinity_score(structs)
        if score is None: continue
        if divergence > DIVERGENCE_LIMIT: continue  # skip — trinity disagrees
        regime = regime_from_score(score)
        action = pick_trade(score, structs["SPY"], spy["spot"])
        if not action: continue
        direction, entry, target, stop = action
        # Walk forward
        exit_reason = "EOD"; exit_price = timelines["SPY"][-1]["spot"]
        for j in range(i+1, len(timelines["SPY"])):
            p = timelines["SPY"][j]["spot"]
            if direction.startswith("CALLS"):
                if p >= target: exit_reason = "TARGET"; exit_price = p; break
                if p <= stop: exit_reason = "STOP"; exit_price = p; break
            else:
                if p <= target: exit_reason = "TARGET"; exit_price = p; break
                if p >= stop: exit_reason = "STOP"; exit_price = p; break
        pnl_pts = (exit_price - entry) if direction.startswith("CALLS") else (entry - exit_price)
        trade = {
            "direction": direction, "regime": regime, "trinity_score": score,
            "sub_scores": sub_scores, "divergence": divergence,
            "entry_ts_min": spy["mod"], "entry_spot": entry,
            "target": target, "stop": stop,
            "exit_reason": exit_reason, "exit_spot": exit_price, "pnl_pts": pnl_pts,
        }
        break

    return {
        "date": d.get("metadata", {}).get("date"),
        "archetype": archetype,
        "trade": trade,
    }

def aggregate_by_archetype(days):
    by = defaultdict(list)
    for d in days:
        by[d["archetype"]].append(d)
    out = {}
    for arch, ds in by.items():
        trades = [d["trade"] for d in ds if d["trade"]]
        pnls = [t["pnl_pts"] for t in trades]
        n_setup = len(trades)
        wins = sum(1 for p in pnls if p > 0)
        out[arch] = {
            "n_days": len(ds), "n_setup": n_setup,
            "setup_pct": n_setup / len(ds) * 100 if ds else 0,
            "win_rate": wins / n_setup * 100 if n_setup else 0,
            "avg_pnl": statistics.mean(pnls) if pnls else 0,
            "total_pnl": sum(pnls),
        }
    return out

def aggregate_by_direction(days):
    by = defaultdict(list)
    for d in days:
        if d["trade"]: by[d["trade"]["direction"]].append(d["trade"]["pnl_pts"])
    out = {}
    for dir, pnls in by.items():
        wins = sum(1 for p in pnls if p > 0)
        out[dir] = {"n": len(pnls), "win_rate": wins / len(pnls) * 100, "avg_pnl": statistics.mean(pnls), "total_pnl": sum(pnls)}
    return out

def main():
    files = list_files()
    print(f"Processing {len(files)} files with Trinity 0-100 scoring...")
    days = []
    for i, f in enumerate(files):
        if i % 15 == 0: print(f"  [{i+1}/{len(files)}]", flush=True)
        try:
            r = process_file(f)
            if r: days.append(r)
        except Exception as e:
            print(f"  skip {f.name}: {e}")
    arch_summary = aggregate_by_archetype(days)
    dir_summary = aggregate_by_direction(days)
    out = Path("sniper/validation/trinity_score_backtest.json")
    out.write_text(json.dumps({"by_archetype": arch_summary, "by_direction": dir_summary, "days": days}, indent=2, default=str))
    print(f"\nWrote {out}\n")
    print("=== By day archetype ===")
    print(f"{'Archetype':<12} {'Days':>5} {'Setup':>6} {'Setup%':>7} {'Win%':>6} {'Avg pnl':>9} {'Total':>8}")
    print("-" * 70)
    for arch in ["TREND_UP", "TREND_DOWN", "WHIPSAW", "QUIET"]:
        if arch not in arch_summary: continue
        s = arch_summary[arch]
        print(f"{arch:<12} {s['n_days']:>5} {s['n_setup']:>6} {s['setup_pct']:>6.1f}% {s['win_rate']:>5.1f}% {s['avg_pnl']:+8.3f} {s['total_pnl']:+7.1f}")

    print(f"\n=== By trade direction ===")
    print(f"{'Direction':<16} {'N':>4} {'Win%':>6} {'Avg pnl':>9} {'Total':>8}")
    print("-" * 50)
    for d, s in sorted(dir_summary.items(), key=lambda x: -x[1]["total_pnl"]):
        print(f"{d:<16} {s['n']:>4} {s['win_rate']:>5.1f}% {s['avg_pnl']:+8.3f} {s['total_pnl']:+7.1f}")

if __name__ == "__main__":
    main()
