#!/usr/bin/env python3
"""
Sniper framework validation against 12 months of daily GEX + price data.

Tests the framework's load-bearing claims against actual historical SPY/QQQ
behavior. Outputs a markdown report with pass/fail per claim and headline
statistics.

Run:  uv run python sniper/validation/validate.py
"""
from __future__ import annotations
import os, sys, json, math, statistics
from collections import defaultdict
import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set", file=sys.stderr); sys.exit(1)

TICKERS = ["SPY", "QQQ"]

def load_data(ticker):
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute("""
        SELECT g.date::date AS d,
               g.call_gamma, g.put_gamma,
               g.call_delta, g.put_delta,
               g.call_vanna, g.put_vanna,
               g.call_charm, g.put_charm,
               p.open, p.high, p.low, p.close, p.volume
        FROM uw_greek_exposure g
        JOIN prices_daily p ON p.symbol = g.ticker AND p.ts::date = g.date
        WHERE g.ticker = %s
        ORDER BY g.date
    """, (ticker,))
    rows = [dict(r) for r in cur.fetchall()]
    cur.close(); conn.close()
    return rows

def enrich(rows):
    """Compute derived per-day features + next-day features."""
    out = []
    for i, r in enumerate(rows):
        net_gex = (r["call_gamma"] or 0) + (r["put_gamma"] or 0)
        abs_gex = abs(r["call_gamma"] or 0) + abs(r["put_gamma"] or 0)
        regime = "POS" if net_gex > 0 else "NEG"
        # The framework's claim: positive net GEX → pinning, negative → trending
        # Day's behavior:
        day_range_pct = (r["high"] - r["low"]) / r["close"] * 100 if r["close"] else 0
        day_ret_pct = (r["close"] - r["open"]) / r["open"] * 100 if r["open"] else 0
        # Gap from prior close to today's open
        gap_pct = (r["open"] - rows[i-1]["close"]) / rows[i-1]["close"] * 100 if i > 0 and rows[i-1]["close"] else 0
        # Day shape: open near low (uptrend) / near high (downtrend)
        if r["high"] != r["low"]:
            close_position = (r["close"] - r["low"]) / (r["high"] - r["low"])  # 0=at low, 1=at high
            open_position = (r["open"] - r["low"]) / (r["high"] - r["low"])
        else:
            close_position = open_position = 0.5
        # Trend Day heuristic: |close - open| / range > 0.7  AND range > median
        # We'll mark Trend Days as days where close is in extreme 20% of range AND range > median
        # Compute next-day move
        next_ret_pct = None
        next_range_pct = None
        next_gap_pct = None
        if i + 1 < len(rows):
            nx = rows[i+1]
            if r["close"]:
                next_ret_pct = (nx["close"] - r["close"]) / r["close"] * 100
                next_gap_pct = (nx["open"] - r["close"]) / r["close"] * 100
            if nx["close"]:
                next_range_pct = (nx["high"] - nx["low"]) / nx["close"] * 100
        out.append({
            **r,
            "net_gex": net_gex,
            "abs_gex": abs_gex,
            "regime": regime,
            "day_range_pct": day_range_pct,
            "day_ret_pct": day_ret_pct,
            "gap_pct": gap_pct,
            "close_position": close_position,
            "open_position": open_position,
            "next_ret_pct": next_ret_pct,
            "next_range_pct": next_range_pct,
            "next_gap_pct": next_gap_pct,
        })
    return out

def safe_mean(xs): return statistics.mean(xs) if xs else float("nan")
def safe_med(xs): return statistics.median(xs) if xs else float("nan")

def claim_regime_predicts_range(data):
    """C1: Positive net GEX → next day range is SMALLER than negative net GEX days."""
    pos = [d["next_range_pct"] for d in data if d["regime"]=="POS" and d["next_range_pct"] is not None]
    neg = [d["next_range_pct"] for d in data if d["regime"]=="NEG" and d["next_range_pct"] is not None]
    return {
        "pos_n": len(pos), "neg_n": len(neg),
        "pos_mean_next_range": safe_mean(pos),
        "neg_mean_next_range": safe_mean(neg),
        "pos_median": safe_med(pos), "neg_median": safe_med(neg),
        "delta_means": safe_mean(neg) - safe_mean(pos),  # positive means neg-regime ranges are wider (framework correct)
        "pass": safe_mean(neg) > safe_mean(pos),
    }

def claim_regime_predicts_direction(data):
    """C4: Predict next-day direction. The framework's regime call alone vs random."""
    # Framework rule (interpreted): in positive GEX regime, expect mean reversion (fade big moves);
    # in negative GEX regime, expect continuation. We test continuation rate by regime.
    pos_continuations = 0; pos_total = 0
    neg_continuations = 0; neg_total = 0
    for d in data:
        if d["next_ret_pct"] is None: continue
        same_dir = (d["day_ret_pct"] > 0 and d["next_ret_pct"] > 0) or (d["day_ret_pct"] < 0 and d["next_ret_pct"] < 0)
        if d["regime"]=="POS":
            pos_total += 1
            if same_dir: pos_continuations += 1
        else:
            neg_total += 1
            if same_dir: neg_continuations += 1
    return {
        "pos_total": pos_total, "pos_continuations": pos_continuations,
        "pos_continuation_rate": pos_continuations/pos_total*100 if pos_total else float("nan"),
        "neg_total": neg_total, "neg_continuations": neg_continuations,
        "neg_continuation_rate": neg_continuations/neg_total*100 if neg_total else float("nan"),
        "framework_says": "NEG should have HIGHER continuation rate than POS (trending regime)",
        "pass": (neg_continuations/neg_total if neg_total else 0) > (pos_continuations/pos_total if pos_total else 0),
    }

def claim_gap_fill_bias(data):
    """C2: 80% of small gaps fill same day (claim from 12-day-archetypes.md). 
    We test: % of days that gap up (>0.15%) where close is BELOW the open (gap-fill direction)."""
    small_up = [d for d in data if 0.15 <= d["gap_pct"] < 0.5]
    medium_up = [d for d in data if 0.5 <= d["gap_pct"] < 1.0]
    big_up = [d for d in data if d["gap_pct"] >= 1.0]
    small_down = [d for d in data if -0.5 < d["gap_pct"] <= -0.15]
    big_down = [d for d in data if d["gap_pct"] <= -1.0]
    def fill_rate(rs, direction):  # direction=-1 for gap-up (need close<open), +1 for gap-down
        if not rs: return None
        return sum(1 for r in rs if (direction == -1 and r["close"] < r["open"]) or (direction == 1 and r["close"] > r["open"])) / len(rs) * 100
    return {
        "small_up_n": len(small_up), "small_up_fill_rate": fill_rate(small_up, -1),
        "medium_up_n": len(medium_up), "medium_up_fill_rate": fill_rate(medium_up, -1),
        "big_up_n": len(big_up), "big_up_fill_rate": fill_rate(big_up, -1),
        "small_down_n": len(small_down), "small_down_fill_rate": fill_rate(small_down, +1),
        "big_down_n": len(big_down), "big_down_fill_rate": fill_rate(big_down, +1),
        "framework_says": "Small gaps fill ~80%, big gaps fill ~30-45%",
    }

def claim_trend_day_in_neg_regime(data):
    """C5: Trend Days (open near one extreme, close near other extreme) more common in negative GEX regime."""
    # Define Trend Day: close_position > 0.8 OR < 0.2 AND open_position opposite extreme AND day_range_pct > median
    median_range = safe_med([d["day_range_pct"] for d in data if d["day_range_pct"]])
    pos_trends = 0; pos_total = 0
    neg_trends = 0; neg_total = 0
    for d in data:
        is_big = d["day_range_pct"] > median_range
        is_trend = is_big and ((d["close_position"] > 0.8 and d["open_position"] < 0.3) or 
                               (d["close_position"] < 0.2 and d["open_position"] > 0.7))
        if d["regime"]=="POS":
            pos_total += 1
            if is_trend: pos_trends += 1
        else:
            neg_total += 1
            if is_trend: neg_trends += 1
    return {
        "median_range_pct": median_range,
        "pos_total": pos_total, "pos_trend_days": pos_trends, "pos_trend_rate": pos_trends/pos_total*100 if pos_total else 0,
        "neg_total": neg_total, "neg_trend_days": neg_trends, "neg_trend_rate": neg_trends/neg_total*100 if neg_total else 0,
        "framework_says": "Trend Day rate should be HIGHER in NEG regime than POS",
        "pass": (neg_trends/neg_total if neg_total else 0) > (pos_trends/pos_total if pos_total else 0),
    }

def claim_directional_baseline(data):
    """C4: Simple regime → direction predictor baseline.
    Framework claim is that negative GEX → next-day continuation in current direction.
    Compare with naive coin-flip and the walk-forward 48.3% number."""
    n = sum(1 for d in data if d["next_ret_pct"] is not None)
    correct = 0
    for d in data:
        if d["next_ret_pct"] is None: continue
        # Heuristic: NEG regime predict continuation, POS regime predict reversal
        predict_dir = 1 if d["day_ret_pct"] > 0 else -1
        if d["regime"]=="POS": predict_dir = -predict_dir  # POS regime: fade
        actual_dir = 1 if d["next_ret_pct"] > 0 else -1
        if predict_dir == actual_dir: correct += 1
    return {
        "n": n, "correct": correct,
        "hit_rate_pct": correct/n*100 if n else 0,
        "baseline_walkforward_hit_rate_pct": 48.3,
        "framework_says": "Combined regime+continuation rule should beat 50%",
        "pass": (correct/n if n else 0) > 0.50,
    }

def claim_volume_in_neg_regime(data):
    """C6: Negative GEX days should have higher volume (more activity)."""
    pos_vol = [d["volume"] for d in data if d["regime"]=="POS" and d["volume"]]
    neg_vol = [d["volume"] for d in data if d["regime"]=="NEG" and d["volume"]]
    return {
        "pos_mean_vol": safe_mean(pos_vol), "neg_mean_vol": safe_mean(neg_vol),
        "pos_n": len(pos_vol), "neg_n": len(neg_vol),
        "framework_says": "NEG regime should have HIGHER volume (more institutional activity)",
        "pass": safe_mean(neg_vol) > safe_mean(pos_vol),
    }

def fmt_pct(x): return f"{x:.1f}%" if x is not None and not (isinstance(x, float) and math.isnan(x)) else "n/a"
def fmt_f(x, p=2): return f"{x:.{p}f}" if x is not None and not (isinstance(x, float) and math.isnan(x)) else "n/a"

def run(ticker):
    rows = load_data(ticker)
    if not rows:
        return None
    data = enrich(rows)
    return {
        "ticker": ticker,
        "n_days": len(data),
        "date_range": (str(rows[0]["d"]), str(rows[-1]["d"])),
        "regime_split": {
            "pos": sum(1 for d in data if d["regime"]=="POS"),
            "neg": sum(1 for d in data if d["regime"]=="NEG"),
        },
        "claims": {
            "C1_regime_predicts_range": claim_regime_predicts_range(data),
            "C2_gap_fill_bias": claim_gap_fill_bias(data),
            "C3_continuation_by_regime": claim_regime_predicts_direction(data),
            "C4_directional_baseline": claim_directional_baseline(data),
            "C5_trend_day_in_neg_regime": claim_trend_day_in_neg_regime(data),
            "C6_volume_in_neg_regime": claim_volume_in_neg_regime(data),
        }
    }

if __name__ == "__main__":
    results = {}
    for t in TICKERS:
        results[t] = run(t)
    out = "sniper/validation/results.json"
    with open(out, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"Wrote {out}")
    # Pretty print headline
    for t, r in results.items():
        print(f"\n=== {t} — {r['n_days']} days ({r['date_range'][0]} → {r['date_range'][1]}) ===")
        print(f"  regime split: POS {r['regime_split']['pos']} / NEG {r['regime_split']['neg']}")
        for cname, c in r["claims"].items():
            passed = c.get("pass")
            mark = "✅" if passed is True else "❌" if passed is False else "·"
            print(f"  {mark} {cname}")
