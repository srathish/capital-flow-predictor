"""Find HOOD-style 'depressed coil release' candidates.

HOOD's fingerprint pre-squeeze (yesterday close $84.84):
  - BB pct 0.127 (top decile compression)
  - ATR pct 0.246 (low realized vol)
  - Vol dry-up 0.81
  - Range pos 0.28 (LOW in 6mo range — recovery setup, NOT a highflyer at trigger)
  - pct_from_high -39.3 (way off all-time/6mo high)
  - EMA slope -1.15% (flat — NOT uptrending, just stabilizing)
  - ret_5d +12% (already firing the 20d trigger)
  - breakout_today = True
  - trigger_20d already broken (-3.4%)

This is different from the AVGO/ORCL pattern (highflyer at top of range, tight coil).
HOOD = beaten-down stock that compressed, just starting to fire.

Filter criteria:
  - BB pct < 0.30 (compressed)
  - ATR pct < 0.40 (low realized vol)
  - range_pos < 0.55 (in lower half of 6mo range — depressed)
  - pct_from_high < -20 (significantly off highs)
  - ret_5d > 4 OR breakout_today=True (firing or just fired)
  - close > 0 and stop_20d > 0 (valid data)

Outputs ranked by "squeeze potential" = upside to 126d high.
"""
from __future__ import annotations

from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output"

# Load both watchlist (still coiled) and sprung
watch = pd.read_csv(OUT / "coiled_watchlist.csv")
sprung = pd.read_csv(OUT / "coiled_already_sprung.csv")

both = pd.concat([watch.assign(status="coiled"), sprung.assign(status="sprung")], ignore_index=True)

# Filters
mask = (
    (both["bb_pct"] < 0.30)
    & (both["atr_pct"] < 0.40)
    & (both["range_pos"] < 0.55)
    & (both["pct_from_high"] < -20)
    & ((both["ret_5d"] > 4) | (both["breakout_today"] == True))  # noqa: E712
)

hood_like = both[mask].copy()

# Squeeze potential: upside to 126d high (in %)
hood_like["upside_to_126d_pct"] = -hood_like["pct_from_high"]

# Sort by combo: high upside + compressed (penalize already-extended)
hood_like["hood_score"] = (
    (1 - hood_like["bb_pct"]) * 30
    + (1 - hood_like["atr_pct"]) * 20
    + (hood_like["upside_to_126d_pct"]).clip(upper=100) * 0.3
    + hood_like["ret_5d"].clip(lower=0, upper=15) * 1.5
    + (1 - hood_like["range_pos"]) * 20
)
hood_like = hood_like.sort_values("hood_score", ascending=False).reset_index(drop=True)

cols = [
    "ticker", "theme", "status", "close", "grade",
    "bb_pct", "atr_pct", "vol_dryup", "range_pos", "pct_from_high",
    "ret_5d", "ema21_slope_pct_10d", "breakout_today",
    "trigger_20d", "trigger_60d", "trigger_126d", "stop_20d",
    "upside_to_126d_pct", "hood_score",
]
print(f"Found {len(hood_like)} HOOD-like candidates")
print(hood_like[cols].head(30).to_string(index=False))

hood_like.to_csv(OUT / "hood_pattern.csv", index=False)
print(f"\n→ wrote {OUT / 'hood_pattern.csv'}")
