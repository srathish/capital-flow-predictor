# STAGE_DRIFT.md — Python port divergences from the TV Pine indicator

The Python scanner in `stage_logic.py` ports the `Stage + Confluence Master`
TradingView indicator. Most conditions match cell-for-cell; this document
tracks the deliberate divergences.

The original rule is "TV wins, fix the port." That rule still applies to
**every** condition NOT listed here. Conditions listed here are stronger by
design, not cell-faithful — the Python version is the source of truth for
these and the TV indicator should be patched to match when convenient.

Last reviewed: 2026-05-21.

---

## Fix #1 — G3b Flow gate

**TV indicator (weaker):**
```pine
mfi = ta.mfi(hlc3, 20)
cmf = (sum of mf-mult * volume over 20 bars) / (sum of volume over 20 bars)
flowOk = mfi > 50 and cmf > 0
```

Both metrics are computed on the breakout bar itself and weight by
volume × price. On a confirmed breakout bar (high closePos, price up),
`mfi > 50` and `cmf > 0` are nearly mechanically true — so G3b passes in
lockstep with G3a roughly 90% of the time. It's not independent of the
breakout; it's a restatement of it.

**Python version (stronger):**
```python
window = bars [i - flow_len, i)           # exclusive of the breakout bar
obv_slope_positive = linreg_slope(OBV[window]) > 0
up_vol_ratio = sum(vol on up-days) / sum(vol on down-days)  # over window
flow_ok = obv_slope_positive AND up_vol_ratio >= 1.2
```

Both components look *backward* from the breakout bar at the 20 bars of
base/handle building. They answer "was money flowing in during the
consolidation?" rather than "did the breakout bar look bullish?" That's a
genuinely different — and useful — signal.

**Why this is correct:** measures *pre-breakout accumulation*, decorrelated
from the breakout bar. The truly independent leg is still options flow / OI
in OpenClaw; this is the strongest Pine-equivalent within OHLCV.

---

## Fix #2 — G3a Grade component swap (`strongBar` → `pre_break_tightness`)

**TV indicator (weaker):**
```pine
closePos = (close - low) / (high - low)
strongBar = closePos >= 0.65
```

A bar that breaks out (close > priorHigh20) almost always closes in the
upper half of its range — so `strongBar` is nearly guaranteed when G2's
trigger fires. Same-bar tautology with the breakout itself.

**Python version (stronger):**
```python
atr_short = mean( (high - low) over [i-5, i-1] )   # excludes the breakout bar
atr_long  = mean( (high - low) over [i-25, i-6] )
pre_break_tightness = atr_short < atr_long * 0.70
```

Measures whether the 5 bars *before* the breakout were squeezed relative to
the prior 20 bars — i.e., a genuine consolidation that's about to resolve.
Decoupled from the breakout bar itself.

The other four Grade components are unchanged: `volume_surge` (RVOL with
the repaint fix), `range_expansion`, `bb_thrust`, `bb_expanding`.

---

## Fix #3 — HFS handle duration (new 6th condition)

**TV indicator (weaker):**
The handle is only checked for a 5-bar range compression and 15-bar
trigger window. There is no check on how many bars the handle has actually
lasted. A 2-bar pullback that happens to tighten can score 5/5 even though
it's not a real handle.

**Python version (stronger):**
```python
handle_duration = bars since the most recent swing-high touch
handle_duration_ok = 5 <= handle_duration <= 15
```

Added as the 6th HFS condition. The HFS armed threshold remains `score ≥ 4`,
so this makes HFS strictly stricter than the TV version — the new condition
cannot lower the score, only raise it.

**Why this is correct:** a textbook handle/flag is defined by both shape
AND duration. The TV indicator drops the duration; we add it back.

---

## Fix #4 — Phase tie-break ladder (no hysteresis)

**TV indicator (path-dependent):**
```pine
phase := ...
       : bcsScore > hfsScore ? "BASE"
       : hfsScore > bcsScore ? "HANDLE"
       : (phase == "BASE" or phase == "HANDLE") ? phase   // hysteresis
       : bcsScore >= 3 ? "BASE"
       : hfsScore >= 3 ? "HANDLE"
       : "NEUTRAL"
```

The hysteresis line ("keep prior phase on a tie") makes the label for a
given bar depend on where the scan window started — the same bar can label
BASE in one backtest and HANDLE in another.

**Python version (deterministic):**
```python
if bcs > hfs:                      phase = "BASE"
elif hfs > bcs:                    phase = "HANDLE"
elif tied and max_score >= 4:      phase = "BASE"     # bigger thesis wins on strong setups
elif tied and max_score == 3:      phase = "HANDLE"   # continuation default on weak setups
else:                              phase = "NEUTRAL"
```

No path dependence. The tie-break logic encodes the mental model: BASE is
rare and rewards big; on a strong tie that's the bigger thesis to call.
HANDLE is common and faster; on a marginal tie that's the higher-probability
label.

**Why this is correct:** removes the "same bar labels differently depending
on where you started" footgun. Deterministic = testable.

---

## Other notes (not divergences, but worth knowing)

- **`vol_ma[i-1]` repaint fix** (RVOL, Master breakout volume test, breakdown
  WARN volume test): the TV indicator also adopted this fix — both sides
  use the prior-bar volume MA so the breakout bar doesn't inflate its own
  benchmark. Not a divergence; just calling it out so it doesn't get
  "fixed" back to current-bar.
- **`armed[1]`**: same in both. Setup must have existed BEFORE the breakout
  bar — the trigger and the score cannot both flip on the same candle.
- **`confirmOnClose`**: TV has this knob; the Python scanner always runs on
  closed daily bars (yfinance EOD), so the equivalent is implicit.
