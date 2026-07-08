/**
 * Multi-timeframe surface regime — BULL / BEAR / CHOP per lookback window,
 * computed from the FULL strike map's evolution (user directive 2026-07-08:
 * every GEX/VEX read = all strikes growing/shrinking, and track 1/5/10/15/30
 * minute frames to know if we're bullish, bearish, or chopping).
 *
 * Signals per window (all Skylit-native, no external feeds):
 *   1. spot drift        — where price actually went over the window
 *   2. barney-fuel skew  — |gamma| growth of negative-gamma nodes above spot
 *                          (dealers forced to chase UP) vs below spot
 *                          (forced to chase DOWN)
 *   3. wall shift        — floor (strongest pika below spot) hardening is
 *                          bullish; ceiling (strongest pika above) hardening
 *                          is bearish
 *   4. pin override      — a dominant pika sitting on spot forces CHOP no
 *                          matter what the drift says (0DTE pin = theta
 *                          death both directions; see feedback 2026-07-08)
 *
 * Consumers:
 *   - fire-loop: prints the regime strip + stamps regimes on each fire's
 *     supporting_state so live fires carry their context
 *   - replay-fires: records regimes per play so the multi-day validation
 *     can answer "do fires aligned with 15m/30m regime outperform?"
 */

const DEFAULT_WINDOWS_MIN = [1, 5, 10, 15, 30];

// Classification thresholds. Deliberately coarse — regime is context, not a
// signal. Scores are a weighted sum of three components each in [-1, +1].
const SCORE_BULL = +0.35;
const SCORE_BEAR = -0.35;
const PIN_RELSIG = 0.18;        // pika ≥18% of surface...
const PIN_DISTANCE_PCT = 0.005; // ...within 0.5% of spot → CHOP override
const W_DRIFT = 0.40;
const W_FUEL = 0.35;
const W_WALL = 0.25;
// Spot drift saturates the [-1,+1] component at this many bps per window-min:
// e.g. 30bps over 5 min or 90bps over 30 min both read "strongly directional".
const DRIFT_SATURATION_BPS_PER_MIN = 6;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function fuelAround(nodes, spot, side, widthPct = 0.02) {
  // side +1 → barneys above spot; -1 → below
  const lo = side > 0 ? spot : spot * (1 - widthPct);
  const hi = side > 0 ? spot * (1 + widthPct) : spot;
  let sum = 0;
  for (const n of nodes) {
    if (n.sign === 'barney' && n.strike >= lo && n.strike <= hi) sum += Math.abs(n.gamma);
  }
  return sum;
}

function strongestPika(nodes, spot, side) {
  // side +1 → at/above spot (ceiling); -1 → at/below (floor)
  let best = null;
  for (const n of nodes) {
    if (n.sign !== 'pika') continue;
    if (side > 0 ? n.strike < spot : n.strike > spot) continue;
    if (!best || n.relativeSignificance > best.relativeSignificance) best = n;
  }
  return best;
}

function growthComponent(now, then) {
  // Ratio → [-1, +1]: 2× growth ≈ +0.5, halving ≈ -0.5. Zero baselines are neutral.
  if (!(then > 0)) return now > 0 ? 0.5 : 0;
  return clamp(Math.log2(now / then) / 2, -1, 1);
}

/**
 * Classify one window given the surface now and the surface ~window ago.
 * Surfaces: { spot, nodes } with nodes carrying sign/gamma/relativeSignificance.
 */
export function classifyWindow(nowSurface, thenSurface, windowMin) {
  const { spot, nodes } = nowSurface;

  // Pin override — dominant pika on top of spot = chop regardless of drift.
  const pinZone = spot * PIN_DISTANCE_PCT;
  for (const n of nodes) {
    if (n.sign === 'pika' && Math.abs(n.strike - spot) <= pinZone &&
        n.relativeSignificance >= PIN_RELSIG) {
      return { label: 'CHOP', score: 0, reason: `pin_$${n.strike}_${(n.relativeSignificance * 100).toFixed(0)}%` };
    }
  }

  if (!thenSurface) return { label: 'CHOP', score: 0, reason: 'no_history' };

  // 1. spot drift
  const driftBps = (spot - thenSurface.spot) / thenSurface.spot * 10000;
  const drift = clamp(driftBps / (DRIFT_SATURATION_BPS_PER_MIN * windowMin), -1, 1);

  // 2. barney-fuel skew: growth above (bullish chase) minus growth below (bearish chase)
  const fuelAboveNow = fuelAround(nodes, spot, +1);
  const fuelBelowNow = fuelAround(nodes, spot, -1);
  const fuelAboveThen = fuelAround(thenSurface.nodes, thenSurface.spot, +1);
  const fuelBelowThen = fuelAround(thenSurface.nodes, thenSurface.spot, -1);
  const fuel = clamp(growthComponent(fuelAboveNow, fuelAboveThen) -
                     growthComponent(fuelBelowNow, fuelBelowThen), -1, 1);

  // 3. wall shift: floor hardening bullish, ceiling hardening bearish
  const floorNow = strongestPika(nodes, spot, -1);
  const ceilNow = strongestPika(nodes, spot, +1);
  const thenByStrike = new Map(thenSurface.nodes.map(n => [n.strike, n]));
  const floorD = floorNow ? (floorNow.relativeSignificance - (thenByStrike.get(floorNow.strike)?.relativeSignificance ?? floorNow.relativeSignificance)) : 0;
  const ceilD = ceilNow ? (ceilNow.relativeSignificance - (thenByStrike.get(ceilNow.strike)?.relativeSignificance ?? ceilNow.relativeSignificance)) : 0;
  const wall = clamp((floorD - ceilD) / 0.10, -1, 1); // ±10pp shift saturates

  const score = W_DRIFT * drift + W_FUEL * fuel + W_WALL * wall;
  const label = score >= SCORE_BULL ? 'BULL' : score <= SCORE_BEAR ? 'BEAR' : 'CHOP';
  return {
    label, score: Number(score.toFixed(3)),
    reason: `drift=${driftBps.toFixed(0)}bps fuel=${fuel.toFixed(2)} wall=${wall.toFixed(2)}`,
  };
}

/**
 * Classify all windows from a surface history (ascending tsMs).
 * history: [{ tsMs, spot, nodes }, ...] — the newest entry is "now".
 * Returns { '1m': {label, score, reason}, '5m': ..., ... } using the nearest
 * history entry at-or-before each window boundary. Windows with no history
 * deep enough come back CHOP/no_history.
 */
export function classifyRegimes(history, { windowsMin = DEFAULT_WINDOWS_MIN } = {}) {
  const out = {};
  if (!history?.length) return out;
  const nowSurface = history[history.length - 1];
  for (const w of windowsMin) {
    const target = nowSurface.tsMs - w * 60_000;
    let then = null;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].tsMs <= target) { then = history[i]; break; }
    }
    out[`${w}m`] = classifyWindow(nowSurface, then, w);
  }
  return out;
}

/** Compact one-line strip for terminal display: `1m:🐂 5m:· 15m:🐻 30m:🐻` */
export function regimeStrip(regimes) {
  const icon = { BULL: '🐂', BEAR: '🐻', CHOP: '·' };
  return Object.entries(regimes)
    .map(([w, r]) => `${w}:${icon[r.label] ?? '?'}`)
    .join(' ');
}
