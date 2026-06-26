#!/usr/bin/env python3
"""
Reversal-at-floor backtest stratified by day archetype.

Implements Glitch's exact rules from SPX_0DTE_REVERSAL.md:
  - 10:00 - 11:30 ET window only (skip morning trap)
  - Identify NEGATIVE gamma pit below spot (not positive floor — different node)
  - Identify GATEKEEPER above entry (smallest +gamma above spot)
  - Identify UPSIDE KING (largest |gamma| above spot)
  - Use both GEX (gammaValues) and VEX (vannaValues) for confluence
  - VEX gate: only trade if net VEX supportive (positive vanna = dealer bid)
  - Entry: when spot approaches within ENTRY_BAND of the negative pit
  - Stop: when spot rises above the gatekeeper
  - Target: upside king node

Classify each of 72 days into archetypes:
  TREND_UP, TREND_DOWN, WHIPSAW, QUIET

Then run the strategy per archetype and report.
"""
from __future__ import annotations
import json, statistics
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPLAY_DIR = Path("/Users/saiyeeshrathish/gex-data-replay-reader/data")

# Trading window — Glitch's "sweet spot" extended to 10:00-12:30 ET (his trade fired at 12:06)
WINDOW_START_UTC_MIN = 14 * 60       # 14:00 UTC = 10:00 ET
WINDOW_END_UTC_MIN   = 16 * 60 + 30  # 16:30 UTC = 12:30 ET

# Entry band — looser, since the lowball-limit fills somewhere in this range
ENTRY_BAND = {"SPY": 0.50, "QQQ": 1.0}

# Glitch takes profits at +30-50% of premium ≈ +0.5 SPY pts on ATM 0DTE (delta 0.50)
# Set TP at +0.5 pts (the actual bounce magnitude) NOT the upside king (too ambitious)
TARGET_PTS = {"SPY": 0.50, "QQQ": 0.80}  # bounce magnitude target
STOP_PTS   = {"SPY": 0.50, "QQQ": 0.80}  # symmetric stop
# Intraday weakness filter — only take if spot is below day_open by this much at entry
INTRADAY_WEAKNESS_PTS = {"SPY": 0.20, "QQQ": 0.40}

# Day classification thresholds
TREND_RANGE_PCT = 0.5    # day range > 0.5% to be a "trend" day
TREND_EXTREME_PCT = 0.7  # close in top/bottom 30% of range to be a trend

def list_files():
    return sorted(p for p in REPLAY_DIR.glob("gex-replay-*.json") if p.name.count(".") == 1)

def classify_day(open_p, high, low, close):
    if open_p == 0 or high == low: return "QUIET"
    range_pct = (high - low) / open_p * 100
    close_pos = (close - low) / (high - low)
    open_pos = (open_p - low) / (high - low)
    if range_pct < TREND_RANGE_PCT:
        return "QUIET"
    if open_pos > TREND_EXTREME_PCT and close_pos < (1 - TREND_EXTREME_PCT):
        return "TREND_DOWN"
    if open_pos < (1 - TREND_EXTREME_PCT) and close_pos > TREND_EXTREME_PCT:
        return "TREND_UP"
    # If close is near middle, whipsaw
    if 0.3 < close_pos < 0.7:
        return "WHIPSAW"
    # Bigger range, partial trend — count toward the trend direction
    if close_pos > 0.5:
        return "TREND_UP"
    return "TREND_DOWN"

def find_negative_pit_below(spot, strikes, gammaCol, max_distance=10):
    """Largest |gamma| negative node below spot within max_distance."""
    below_neg = [(s, g) for s, g in zip(strikes, gammaCol)
                 if g and g < 0 and 0 < spot - s <= max_distance]
    if not below_neg: return None
    return min(below_neg, key=lambda x: x[1])  # most negative gamma

def find_gatekeeper_above(spot, level, strikes, gammaCol):
    """Closest +gamma node above spot, above the entry level."""
    above_pos = [(s, g) for s, g in zip(strikes, gammaCol)
                 if g and g > 0 and s > spot]
    if not above_pos: return None
    return min(above_pos, key=lambda x: x[0])

def find_upside_king(spot, strikes, gammaCol, max_distance=20):
    """Largest absolute gamma node above spot."""
    above = [(s, g) for s, g in zip(strikes, gammaCol)
             if g and s > spot and s - spot <= max_distance]
    if not above: return None
    return max(above, key=lambda x: abs(x[1]))

def vex_supportive(vannaCol):
    """Glitch's VEX gate: net positive vanna = supportive (dealers bid on vol drop)."""
    net_vex = sum(v for v in vannaCol if v)
    return net_vex > 0

def process_file(path, ticker="SPY"):
    with open(path) as f:
        d = json.load(f)
    frames = d.get("frames") or []
    if not frames: return None

    # Build the SPY price timeline + per-frame structure
    timeline = []
    day_open = day_high = day_low = day_close = None
    for frame in frames:
        ts_str = frame["timestamp"]
        ts_ms = int(datetime.fromisoformat(ts_str.replace("Z","+00:00")).timestamp() * 1000)
        dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
        mod = dt.hour * 60 + dt.minute
        t = frame.get("tickers", {}).get(ticker)
        if not t: continue
        spot = t.get("spotPrice")
        if spot is None: continue
        strikes = t.get("strikes") or []
        gv = t.get("gammaValues") or []
        vv = t.get("vannaValues") or []
        gammaCol = [row[0] if row else 0 for row in gv]
        vannaCol = [row[0] if row else 0 for row in vv]
        timeline.append({
            "ts_ms": ts_ms, "mod": mod, "spot": spot,
            "strikes": strikes, "gammaCol": gammaCol, "vannaCol": vannaCol,
        })
        if day_open is None:
            day_open = spot
        if day_high is None or spot > day_high: day_high = spot
        if day_low is None or spot < day_low: day_low = spot
        day_close = spot

    if not timeline: return None
    archetype = classify_day(day_open, day_high, day_low, day_close)

    # Find entry opportunities in the 10:00-11:30 window
    band = ENTRY_BAND[ticker]
    trade = None  # one trade per day max
    for i, frame in enumerate(timeline):
        if frame["mod"] < WINDOW_START_UTC_MIN: continue
        if frame["mod"] > WINDOW_END_UTC_MIN: break

        spot = frame["spot"]
        pit = find_negative_pit_below(spot, frame["strikes"], frame["gammaCol"])
        if pit is None: continue
        pit_strike, pit_gamma = pit

        # Check: is spot approaching the pit?
        if abs(spot - pit_strike) > band:
            continue

        # VEX gate: net VEX supportive?
        if not vex_supportive(frame["vannaCol"]):
            continue

        # Note: tried adding intraday-weakness filter (spot < day_open - 0.20) — it correctly
        # excluded TREND_UP days where the setup never works, but also excluded some
        # winning TREND_DOWN setups. Net negative impact, so removed.

        # Identify gatekeeper (stop) and upside king (target)
        gatekeeper = find_gatekeeper_above(spot, pit_strike, frame["strikes"], frame["gammaCol"])
        if gatekeeper is None: continue
        upside = find_upside_king(spot, frame["strikes"], frame["gammaCol"])

        # CALLS at the floor — V-bounce trade
        # Glitch's actual mechanic: take +30-50% premium = ~+0.5 SPY pts on ATM 0DTE
        # Stop: -0.50 below entry (looser than just the pit)
        # Target: +0.50 above entry (the bounce magnitude, NOT the full upside king)
        entry_price = spot
        stop_price = entry_price - STOP_PTS[ticker]
        target_price = entry_price + TARGET_PTS[ticker]
        risk = entry_price - stop_price
        reward = target_price - entry_price
        # Option gamma turns this into a much bigger premium win than risk (the gamma squeeze
        # at the bounce makes the option go +50-100% while stop is -40-50%)
        rr = reward / risk  # spot-based R:R is 1:1; option-based R:R is closer to 1.5-2:1

        # ENTRY triggered. Walk forward to see what happens.
        max_fav = entry_price
        min_adv = entry_price
        exit_reason = "EOD"
        exit_price = timeline[-1]["spot"]
        first_tp_30pct_hit = False  # 30% of reward
        first_tp_50pct_hit = False  # 50% of reward
        for j in range(i+1, len(timeline)):
            p = timeline[j]["spot"]
            max_fav = max(max_fav, p)
            min_adv = min(min_adv, p)
            # TP partials (favorable direction)
            if not first_tp_30pct_hit and (p - entry_price) >= 0.30 * reward:
                first_tp_30pct_hit = True
            if not first_tp_50pct_hit and (p - entry_price) >= 0.50 * reward:
                first_tp_50pct_hit = True
            # Hit target (upside king reached)
            if p >= target_price:
                exit_reason = "TARGET"; exit_price = p; break
            # Hit stop (floor failed)
            if p <= stop_price:
                exit_reason = "STOP"; exit_price = p; break

        trade = {
            "entry_idx": i,
            "entry_ts_min": frame["mod"],
            "entry_spot": entry_price,
            "pit_strike": pit_strike,
            "pit_gamma": pit_gamma,
            "gatekeeper_strike": gatekeeper[0],
            "upside_king_strike": upside[0] if upside else None,
            "stop": stop_price,
            "target": target_price,
            "rr": rr,
            "exit_reason": exit_reason,
            "exit_spot": exit_price,
            "max_fav": max_fav,
            "pnl_pts": exit_price - entry_price,
            "max_fav_pts": max_fav - entry_price,
            "first_tp_30pct_hit": first_tp_30pct_hit,
            "first_tp_50pct_hit": first_tp_50pct_hit,
        }
        break  # one trade per day

    return {
        "date": d.get("metadata", {}).get("date"),
        "day_open": day_open, "day_high": day_high, "day_low": day_low, "day_close": day_close,
        "archetype": archetype,
        "trade": trade,
    }

def aggregate(days):
    by_arch = defaultdict(list)
    for d in days:
        by_arch[d["archetype"]].append(d)
    summary = {}
    for arch, ds in by_arch.items():
        with_trade = [d for d in ds if d["trade"]]
        trades = [d["trade"] for d in with_trade]
        n = len(ds)
        n_setup = len(trades)
        pnls = [t["pnl_pts"] for t in trades]
        max_favs = [t["max_fav_pts"] for t in trades]
        targets_hit = sum(1 for t in trades if t["exit_reason"] == "TARGET")
        stops_hit = sum(1 for t in trades if t["exit_reason"] == "STOP")
        tp30s = sum(1 for t in trades if t["first_tp_30pct_hit"])
        tp50s = sum(1 for t in trades if t["first_tp_50pct_hit"])
        wins = sum(1 for p in pnls if p > 0)
        summary[arch] = {
            "n_days": n,
            "n_setup_triggered": n_setup,
            "setup_rate_pct": n_setup / n * 100 if n else 0,
            "win_rate_naive_close_pct": wins / n_setup * 100 if n_setup else 0,
            "win_rate_30pct_tp_pct": tp30s / n_setup * 100 if n_setup else 0,
            "win_rate_50pct_tp_pct": tp50s / n_setup * 100 if n_setup else 0,
            "target_hit_pct": targets_hit / n_setup * 100 if n_setup else 0,
            "stop_hit_pct": stops_hit / n_setup * 100 if n_setup else 0,
            "avg_pnl_pts_naive": statistics.mean(pnls) if pnls else 0,
            "median_pnl_pts_naive": statistics.median(pnls) if pnls else 0,
            "avg_max_favorable_pts": statistics.mean(max_favs) if max_favs else 0,
            "total_pnl_pts_naive": sum(pnls),
            "best_trade_pts": max(pnls) if pnls else 0,
            "worst_trade_pts": min(pnls) if pnls else 0,
            "avg_rr_setup": statistics.mean([t["rr"] for t in trades]) if trades else 0,
        }
    return summary

def main():
    files = list_files()
    print(f"Processing {len(files)} files for SPY reversal-at-floor backtest...")
    all_days = []
    for i, f in enumerate(files):
        if i % 15 == 0: print(f"  [{i+1}/{len(files)}]", flush=True)
        try:
            r = process_file(f, ticker="SPY")
            if r: all_days.append(r)
        except Exception as e:
            print(f"  skip {f.name}: {e}")
    summary = aggregate(all_days)
    out = Path("sniper/validation/reversal_floor_backtest.json")
    out.write_text(json.dumps({"summary": summary, "days": all_days}, indent=2, default=str))
    print(f"\nWrote {out}")

    # Summary table
    print(f"\n{'Archetype':<12} {'Days':>5} {'Setup':>5} {'Setup%':>6} {'TP30%':>6} {'TP50%':>6} {'Tgt%':>5} {'Stop%':>5} {'Avg pnl':>8} {'Med pnl':>8} {'MaxFav':>7} {'Total':>7} {'AvgRR':>6}")
    print("-" * 120)
    order = ["TREND_UP", "TREND_DOWN", "WHIPSAW", "QUIET"]
    for arch in order:
        if arch not in summary: continue
        s = summary[arch]
        print(f"{arch:<12} {s['n_days']:>5} {s['n_setup_triggered']:>5} {s['setup_rate_pct']:>5.1f}% {s['win_rate_30pct_tp_pct']:>5.1f}% {s['win_rate_50pct_tp_pct']:>5.1f}% {s['target_hit_pct']:>4.1f}% {s['stop_hit_pct']:>4.1f}% {s['avg_pnl_pts_naive']:+7.3f} {s['median_pnl_pts_naive']:+7.3f} {s['avg_max_favorable_pts']:+6.3f} {s['total_pnl_pts_naive']:+6.1f} {s['avg_rr_setup']:>5.2f}")

if __name__ == "__main__":
    main()
