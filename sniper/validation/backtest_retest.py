#!/usr/bin/env python3
"""
SPY-focused breakout WITH RETEST FILTER backtest.

Strategy:
  1. At 09:35 ET, identify floor + ceiling from Skylit Trinity
  2. Wait for SPY to BREAK above ceiling (or below floor) — body close past
     the level on a 1-min bar
  3. Wait for RETEST — price comes back to within 0.20 pts of the level
  4. Wait for HOLD — next 1m bar(s) close back AWAY from the level (doesn't
     break back through)
  5. ENTER on the hold. Target: nearest liquidity vacuum.
  6. STOP: 1m body close back through the level.

Compares: naive breakout (entry on first close past level) vs retest entry
(wait for pullback + hold).
"""
from __future__ import annotations
import json, statistics
from datetime import datetime, timezone
from pathlib import Path
from collections import defaultdict

REPLAY_DIR = Path("/Users/saiyeeshrathish/gex-data-replay-reader/data")
THRESHOLD = 0.5      # SPY proximity to King for PIN
RETEST_BAND = 0.20   # SPY pts — how close price must come back to broken level
HOLD_BARS = 3        # # of 1m bars to confirm hold after retest (was 2 → 3)
STOP_BUFFER = 0.50   # SPY pts BEYOND level required to stop out (was 0.0 → 0.50)
TAKE_PROFIT_PTS = 1.0   # take profit at +1.0 pts (was None → 1.0)

def list_files():
    return sorted(p for p in REPLAY_DIR.glob("gex-replay-*.json") if p.name.count(".") == 1)

def derive_structure(spot, strikes, gammaCol):
    if not strikes or not gammaCol: return None
    idx = max(range(len(gammaCol)), key=lambda i: abs(gammaCol[i] or 0))
    king_strike = strikes[idx]
    below_pos = [(s, g) for s, g in zip(strikes, gammaCol) if s < spot and g and g > 0]
    above = [(s, g) for s, g in zip(strikes, gammaCol) if s > spot and g]
    floor = max(below_pos, key=lambda x: x[1])[0] if below_pos else None
    ceiling = max(above, key=lambda x: abs(x[1]))[0] if above else None
    # Vacuum above: find biggest gap in positive-gamma strikes above spot
    max_abs = max(abs(g or 0) for g in gammaCol) or 1
    threshold_g = 0.05 * max_abs
    vacuums = []
    in_vac = False; vac_start = None
    for s, g in zip(strikes, gammaCol):
        if abs(g or 0) < threshold_g:
            if not in_vac:
                vac_start = s; in_vac = True
        else:
            if in_vac:
                vacuums.append((vac_start, s))
                in_vac = False
    above_vacs = sorted([v for v in vacuums if v[0] > spot])
    below_vacs = sorted([v for v in vacuums if v[1] < spot], reverse=True)
    up_target = above_vacs[0][1] if above_vacs else None  # high of nearest vacuum above
    down_target = below_vacs[0][0] if below_vacs else None
    return {
        "king": king_strike, "floor": floor, "ceiling": ceiling,
        "up_vacuum_target": up_target,
        "down_vacuum_target": down_target,
    }

def find_break_retest(prices, level, direction):
    """Walk price series. Find first body close past level (BREAK), then first
    return to within RETEST_BAND (RETEST), then check if next HOLD_BARS close
    in trade direction (HOLD).

    direction='up' for ceiling break (calls); 'down' for floor break (puts).

    Returns dict with entry_idx, entry_price, max_favorable, exit_reason, exit_price.
    """
    n = len(prices)
    state = "wait_break"
    broke_at = -1
    retest_at = -1
    entry_idx = -1
    entry_price = None
    hold_count = 0

    for i in range(1, n):
        p_prev = prices[i-1]
        p_now = prices[i]
        if state == "wait_break":
            if direction == "up" and p_now > level and p_prev <= level:
                broke_at = i
                state = "wait_retest"
            elif direction == "down" and p_now < level and p_prev >= level:
                broke_at = i
                state = "wait_retest"
        elif state == "wait_retest":
            within_band = abs(p_now - level) <= RETEST_BAND
            if within_band:
                retest_at = i
                state = "wait_hold"
                hold_count = 0
        elif state == "wait_hold":
            # Need HOLD_BARS consecutive bars where price stays in trade direction
            on_correct_side = (direction == "up" and p_now > level) or (direction == "down" and p_now < level)
            if on_correct_side:
                hold_count += 1
                if hold_count >= HOLD_BARS:
                    entry_idx = i
                    entry_price = p_now
                    break
            else:
                # Failed retest — back to looking for a new break
                state = "wait_break"
                broke_at = -1; retest_at = -1; hold_count = 0

    if entry_idx < 0:
        return None

    # Manage the trade from entry forward
    # Looser stop: STOP_BUFFER pts BEYOND the level (gives the trade room to wobble)
    stop_price = level - STOP_BUFFER if direction == "up" else level + STOP_BUFFER
    max_fav = entry_price
    exit_reason = "EOD"
    exit_price = prices[-1]
    for i in range(entry_idx + 1, n):
        p = prices[i]
        if direction == "up":
            max_fav = max(max_fav, p)
            if TAKE_PROFIT_PTS is not None and (p - entry_price) >= TAKE_PROFIT_PTS:
                exit_reason = "TP"; exit_price = p; break
            if p < stop_price:
                exit_reason = "STOP"; exit_price = p; break
        else:
            max_fav = min(max_fav, p)
            if TAKE_PROFIT_PTS is not None and (entry_price - p) >= TAKE_PROFIT_PTS:
                exit_reason = "TP"; exit_price = p; break
            if p > stop_price:
                exit_reason = "STOP"; exit_price = p; break
    return {
        "broke_at": broke_at, "retest_at": retest_at, "entry_idx": entry_idx,
        "entry_price": entry_price, "max_fav": max_fav,
        "exit_price": exit_price, "exit_reason": exit_reason,
    }

def process_file(path):
    with open(path) as f:
        d = json.load(f)
    frames = d.get("frames") or []
    if not frames: return None

    # Build SPY timeline (every frame, not subsampled — we need 1m granularity for the retest)
    timeline = []
    first_0935 = None
    for frame in frames:
        ts_str = frame["timestamp"]
        ts_ms = int(datetime.fromisoformat(ts_str.replace("Z","+00:00")).timestamp() * 1000)
        dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
        mod = dt.hour * 60 + dt.minute
        t = frame.get("tickers", {}).get("SPY")
        if not t: continue
        spot = t.get("spotPrice")
        if spot is None: continue
        timeline.append({"ts_ms": ts_ms, "spot": spot, "mod": mod, "raw": t})
        if first_0935 is None and mod >= 13*60 + 35:
            first_0935 = timeline[-1]
    if first_0935 is None: return None

    # Derive structure from 09:35 frame
    strikes = first_0935["raw"].get("strikes") or []
    gammaValues = first_0935["raw"].get("gammaValues") or []
    if not strikes or not gammaValues: return None
    gammaCol = [row[0] if row else 0 for row in gammaValues]
    struct = derive_structure(first_0935["spot"], strikes, gammaCol)
    if struct is None: return None

    # Price series after 09:35
    future = [p["spot"] for p in timeline if p["ts_ms"] > first_0935["ts_ms"]]
    if not future: return None

    # Test breakout above ceiling (calls)
    up_result = None
    if struct["ceiling"] is not None:
        up_result = find_break_retest(future, struct["ceiling"], "up")
    # Test breakdown below floor (puts)
    dn_result = None
    if struct["floor"] is not None:
        dn_result = find_break_retest(future, struct["floor"], "down")

    return {
        "date": d.get("metadata", {}).get("date"),
        "spot_0935": first_0935["spot"],
        "structure": struct,
        "up_trade": up_result,
        "down_trade": dn_result,
    }

def main():
    files = list_files()
    print(f"Files: {len(files)}")
    days = []
    for i, f in enumerate(files):
        if i % 15 == 0: print(f"  [{i+1}/{len(files)}]", flush=True)
        try:
            r = process_file(f)
            if r: days.append(r)
        except Exception as e:
            print(f"  skipped {f.name}: {e}")
    # Summarize
    up_trades = [d["up_trade"] for d in days if d["up_trade"]]
    dn_trades = [d["down_trade"] for d in days if d["down_trade"]]

    def stat(trades, direction, days_with_struct):
        n_setups = sum(1 for d in days_with_struct if (d["up_trade" if direction=="up" else "down_trade"] is not None))
        if not trades:
            return {"n_trades": 0}
        pnls_pts = []
        max_fav_pts = []
        wins = 0
        stops = 0
        for t in trades:
            if direction == "up":
                pnl = t["exit_price"] - t["entry_price"]
                mf = t["max_fav"] - t["entry_price"]
            else:
                pnl = t["entry_price"] - t["exit_price"]
                mf = t["entry_price"] - t["max_fav"]
            pnls_pts.append(pnl)
            max_fav_pts.append(mf)
            if pnl > 0: wins += 1
            if t["exit_reason"] == "STOP": stops += 1
        return {
            "n_days_with_setup": n_setups,
            "n_entries_triggered": len(trades),
            "win_rate_pct": wins / len(trades) * 100,
            "stop_rate_pct": stops / len(trades) * 100,
            "avg_pnl_pts": statistics.mean(pnls_pts),
            "median_pnl_pts": statistics.median(pnls_pts),
            "avg_max_favorable_pts": statistics.mean(max_fav_pts),
            "total_pnl_pts": sum(pnls_pts),
            "best_trade_pts": max(pnls_pts),
            "worst_trade_pts": min(pnls_pts),
        }

    summary = {
        "up_calls_after_retest_hold": stat(up_trades, "up", days),
        "down_puts_after_retest_hold": stat(dn_trades, "down", days),
    }
    out = Path("sniper/validation/retest_backtest.json")
    out.write_text(json.dumps({"summary": summary, "days": days}, indent=2, default=str))
    print(f"\nWrote {out}")
    print(f"\n=== SPY breakout with retest+hold filter ({len(days)} days) ===\n")
    print(f"--- CALLS (above ceiling break + retest hold) ---")
    s = summary["up_calls_after_retest_hold"]
    if s.get("n_entries_triggered"):
        print(f"  Setups (days with break):  {s['n_days_with_setup']}")
        print(f"  Entries triggered (after retest hold): {s['n_entries_triggered']}")
        print(f"  Win rate:                  {s['win_rate_pct']:.1f}%")
        print(f"  Stop rate:                 {s['stop_rate_pct']:.1f}%")
        print(f"  Avg P&L per trade:         {s['avg_pnl_pts']:+.2f} pts")
        print(f"  Median P&L:                {s['median_pnl_pts']:+.2f} pts")
        print(f"  Avg max favorable:         {s['avg_max_favorable_pts']:+.2f} pts")
        print(f"  Total P&L:                 {s['total_pnl_pts']:+.1f} pts")
        print(f"  Best trade:                {s['best_trade_pts']:+.2f} pts")
        print(f"  Worst trade:               {s['worst_trade_pts']:+.2f} pts")
    print(f"\n--- PUTS (below floor break + retest hold) ---")
    s = summary["down_puts_after_retest_hold"]
    if s.get("n_entries_triggered"):
        print(f"  Setups (days with break):  {s['n_days_with_setup']}")
        print(f"  Entries triggered (after retest hold): {s['n_entries_triggered']}")
        print(f"  Win rate:                  {s['win_rate_pct']:.1f}%")
        print(f"  Stop rate:                 {s['stop_rate_pct']:.1f}%")
        print(f"  Avg P&L per trade:         {s['avg_pnl_pts']:+.2f} pts")
        print(f"  Median P&L:                {s['median_pnl_pts']:+.2f} pts")
        print(f"  Avg max favorable:         {s['avg_max_favorable_pts']:+.2f} pts")
        print(f"  Total P&L:                 {s['total_pnl_pts']:+.1f} pts")
        print(f"  Best trade:                {s['best_trade_pts']:+.2f} pts")
        print(f"  Worst trade:               {s['worst_trade_pts']:+.2f} pts")

if __name__ == "__main__":
    main()
