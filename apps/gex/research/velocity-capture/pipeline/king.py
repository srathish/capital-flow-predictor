import os as _os
#!/usr/bin/env python3
"""King-track + flip + velocity analysis for 1-min GEX/VEX surfaces. Research only."""
import gzip, json, os, sys
from datetime import datetime, timedelta, timezone

BASE = "/Users/saiyeeshrathish/the final plan/apps/gex"
ONEMIN = os.path.join(BASE, "research/velocity-capture/backfill/2026-07-14")
FIVEMIN = os.path.join(BASE, "data/skylit-archive/intraday/2026-07-14")
TICKERS = ["SPXW", "SPY", "QQQ"]

def et(ts_iso):
    """UTC ISO -> ET label HH:MM (EDT = UTC-4)."""
    s = ts_iso.replace("Z", "+00:00")
    dt = datetime.fromisoformat(s).astimezone(timezone.utc) - timedelta(hours=4)
    return dt.strftime("%H:%M")

def load(path):
    frames = []
    with gzip.open(path, "rt") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            frames.append(d)
    frames.sort(key=lambda d: d["requestedTs"])
    return frames

def king_of(frame):
    """Return dict describing the King (max |gamma| strike) of one frame."""
    spot = frame["spot"]
    strikes = frame["strikes"]
    total_abs = sum(abs(s["gamma"]) for s in strikes)
    if total_abs == 0:
        return None
    # King = max |gamma|
    kg = max(strikes, key=lambda s: abs(s["gamma"]))
    gk = kg["gamma"]
    if gk == 0:
        return None
    strike = kg["strike"]
    sign = "pika" if gk > 0 else "barney"        # pika=+gamma, barney=-gamma
    side = "above" if strike > spot else ("below" if strike < spot else "at")
    share = abs(gk) / total_abs
    # vanna at king strike
    vk = kg["vanna"]
    return {
        "strike": strike, "gamma": gk, "abs_gamma": abs(gk), "sign": sign,
        "side": side, "share": share, "vanna": vk, "spot": spot,
        "total_abs": total_abs, "dist": strike - spot,
    }

def build_ledger(frames):
    led = []
    for fr in frames:
        k = king_of(fr)
        row = {"ts": fr["requestedTs"], "et": et(fr["requestedTs"]), "spot": fr["spot"]}
        if k:
            row.update({
                "king": k["strike"], "sign": k["sign"], "side": k["side"],
                "share": round(k["share"], 4), "cat": f"{k['sign']}-{k['side']}",
                "abs_gamma": k["abs_gamma"], "gamma": k["gamma"], "vanna": k["vanna"],
                "dist": round(k["dist"], 2),
            })
        else:
            row.update({"king": None, "sign": None, "side": None, "share": None,
                        "cat": None, "abs_gamma": 0, "gamma": 0, "vanna": 0, "dist": None})
        led.append(row)
    return led

def count_transitions(led):
    migrations = []  # strike change
    sign_flips = []
    side_flips = []
    cat_changes = []
    for i in range(1, len(led)):
        a, b = led[i-1], led[i]
        if a["king"] is None or b["king"] is None:
            continue
        if b["king"] != a["king"]:
            migrations.append((i, a, b))
        if b["sign"] != a["sign"]:
            sign_flips.append((i, a, b))
        if b["side"] != a["side"]:
            side_flips.append((i, a, b))
        if b["cat"] != a["cat"]:
            cat_changes.append((i, a, b))
    return migrations, sign_flips, side_flips, cat_changes

def classify_flip(a, b):
    """Classify a category change a->b."""
    fa, fb = a["cat"], b["cat"]
    if fa == "barney-above" and fb == "pika-below":
        return "BULLISH_COMPOSITE"
    if fa == "pika-below" and fb == "barney-above":
        return "BEARISH_COMPOSITE"
    sign_ch = a["sign"] != b["sign"]
    side_ch = a["side"] != b["side"]
    if sign_ch and side_ch:
        return "BOTH_OTHER"
    if sign_ch:
        return "SIGN_ONLY"
    if side_ch:
        return "SIDE_ONLY"
    return "NONE"

if __name__ == "__main__":
    out = {}
    for t in TICKERS:
        frames = load(os.path.join(ONEMIN, f"{t}.jsonl.gz"))
        led = build_ledger(frames)
        migrations, sign_flips, side_flips, cat_changes = count_transitions(led)
        out[t] = {"n_frames": len(frames), "led": led,
                  "n_migrations": len(migrations), "n_sign_flips": len(sign_flips),
                  "n_side_flips": len(side_flips), "n_cat_changes": len(cat_changes)}
        print(f"\n===== {t} =====")
        print(f"frames={len(frames)}  migrations={len(migrations)}  "
              f"sign_flips={len(sign_flips)}  side_flips={len(side_flips)}  cat_changes={len(cat_changes)}")
        # category-change table with classification
        print("  CATEGORY CHANGES:")
        for (i, a, b) in cat_changes:
            cls = classify_flip(a, b)
            print(f"    {b['et']}  {a['cat']:>14s} @{a['king']} -> {b['cat']:<14s} @{b['king']}  "
                  f"spot={b['spot']:.2f}  share {a['share']}->{b['share']}  [{cls}]")
    # dump
    sp = _os.path.dirname(_os.path.abspath(__file__))
    with open(os.path.join(sp, "ledgers.json"), "w") as f:
        json.dump(out, f)
    print("\n[saved ledgers.json]")
