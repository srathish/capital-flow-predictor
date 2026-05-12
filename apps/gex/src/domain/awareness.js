/**
 * Continuous rolling awareness tiers per Overlay #6.
 *
 * Per (ticker, strike, trading_day), maintain awareness_level in:
 *   None | Watching | Monitoring | Tracking | Confirmed
 *
 * Escalation rules:
 *   None      → Watching     when 30s OR 1m window shows growing/decaying
 *   Watching  → Monitoring   when 5m window confirms direction
 *   Monitoring → Tracking    when 15m window confirms
 *   Tracking  → Confirmed    when 30m AND session window confirm
 *
 * De-escalation: drops one tier whenever the LONGEST confirming window flips direction.
 * Full retreat to None when 10+ minutes pass without confirmation.
 *
 * Anticipatory vs Realized sub-classification (Overlay #7):
 *   - Realized            — node is on the side price has already advanced toward
 *   - Anticipatory wide   — node is past spot's current level by > 1 deflection zone
 *   - Anticipatory tight  — node is past spot within 1 deflection zone
 *
 * Score contribution per spec §4.3 Component 6 (rolling_signal):
 *   Floor accumulating (rolling-up candidate) and ceiling decaying or vice versa
 *   are the bullish/bearish polarities. We expose getRollingSignal() per ticker.
 */

import { thresholds, deflectionZone } from '../utils/config.js';

const TIERS = ['None', 'Watching', 'Monitoring', 'Tracking', 'Confirmed'];
const RETREAT_TIMEOUT_MS = 10 * 60 * 1000;

const state = new Map(); // key: `${ticker}|${strike}|${tradingDay}` → { level, startedMs, paired, variant, lastConfirmMs, lastDirection }

function key(ticker, strike, tradingDay) {
  return `${ticker}|${strike}|${tradingDay}`;
}

/**
 * Update awareness for a single node based on its multi-horizon velocity.
 * Returns: { level, variant, paired, score_contribution_sign }
 *   `sign` indicates whether this node accumulating helps bullish or bearish thesis.
 *     Floor accumulating  → +
 *     Ceiling decaying    → +  (top is melting; bullish)
 *     Floor decaying      → -
 *     Ceiling accumulating → -
 *     Otherwise → 0
 */
export function updateAwareness({ ticker, strike, tradingDay, tsMs, velocity, structure, spot }) {
  const k = key(ticker, strike, tradingDay);
  let st = state.get(k);
  if (!st) {
    st = { level: 'None', startedMs: null, paired: null, variant: null, lastConfirmMs: null, lastDirection: null };
    state.set(k, st);
  }

  // Determine the dominant direction across windows that confirms it.
  const win = velocity || {};
  const dir30s = win.window_30s?.direction || 'flat';
  const dir1m  = win.window_1m?.direction  || 'flat';
  const dir5m  = win.window_5m?.direction  || 'flat';
  const dir15m = win.window_15m?.direction || 'flat';
  const dir30m = win.window_30m?.direction || 'flat';
  const dirSession = win.window_session?.direction || 'flat';

  const matches = (...dirs) => {
    const grow = dirs.every(d => d === 'growing');
    const decay = dirs.every(d => d === 'decaying');
    return grow ? 'growing' : decay ? 'decaying' : null;
  };

  const newLevel =
    matches(dir15m, dir30m, dirSession) ? 'Confirmed' :
    matches(dir15m) ? 'Tracking' :
    matches(dir5m)  ? 'Monitoring' :
    (matches(dir30s) || matches(dir1m)) ? 'Watching' :
    'None';

  // Direction lock: track which polarity drove escalation.
  const newDirection =
    matches(dir5m) || matches(dir1m) || matches(dir30s) ||
    matches(dir15m) || matches(dir30m, dirSession) || null;

  const previousIdx = TIERS.indexOf(st.level);
  const targetIdx = TIERS.indexOf(newLevel);

  if (targetIdx > previousIdx) {
    // Escalation
    st.level = newLevel;
    st.startedMs ??= tsMs;
    st.lastConfirmMs = tsMs;
    st.lastDirection = newDirection;
  } else if (targetIdx < previousIdx) {
    // Velocity lost a window — retreat ONE tier (avoid flicker).
    if (newLevel === 'None' || tsMs - (st.lastConfirmMs ?? 0) >= RETREAT_TIMEOUT_MS) {
      st.level = 'None';
      st.startedMs = null;
      st.paired = null;
      st.variant = null;
      st.lastDirection = null;
    } else {
      const downIdx = Math.max(0, previousIdx - 1);
      st.level = TIERS[downIdx];
    }
  } else {
    // Same level — refresh confirm timer if direction is consistent.
    if (newDirection && newDirection === st.lastDirection) st.lastConfirmMs = tsMs;
  }

  // Anticipatory variant classification: where is the node relative to spot?
  st.variant = classifyVariant({ strike, spot, ticker, structure });

  // Score-contribution sign (used by bias rolling component).
  const sign = directionalSign({ strike, spot, structure, lastDirection: st.lastDirection });

  return {
    level: st.level,
    variant: st.variant,
    paired: st.paired,
    sign,
    direction: st.lastDirection,
  };
}

function classifyVariant({ strike, spot, ticker, structure }) {
  if (!structure) return null;
  const zone = deflectionZone(ticker);
  // Realized = node is on the side price has already advanced past, i.e. behind spot's recent direction.
  // Without spot history here we can only judge anticipatory tight vs wide vs realized at the structural level.
  // Anticipatory tight: |strike - spot| <= 1 zone AND strike past current spot in direction of structure shift.
  // For now, anticipatory_tight if very near spot, anticipatory_wide if further out, realized if behind.
  const dist = Math.abs(strike - spot);
  if (dist <= zone) return 'anticipatory_tight';
  if (dist <= 2 * zone) return 'anticipatory_wide';
  return 'realized';
}

function directionalSign({ strike, spot, structure, lastDirection }) {
  if (!lastDirection || !structure) return 0;
  const isFloor = structure.floor && structure.floor.strike === strike;
  const isCeiling = structure.ceiling && structure.ceiling.strike === strike;
  const accumulating = lastDirection === 'growing';
  const decaying = lastDirection === 'decaying';

  if (isFloor && accumulating) return +1;   // floor rolling up = bullish
  if (isFloor && decaying) return -1;       // floor decaying = bearish
  if (isCeiling && decaying) return +1;     // ceiling melting = bullish
  if (isCeiling && accumulating) return -1; // ceiling rolling down = bearish
  return 0;
}

/**
 * Score contribution for the bias `rolling_signal` component (-100 to +100).
 * Sums per-ticker over the floor and ceiling node states.
 */
export function getRollingSignal({ ticker, tradingDay, structure }) {
  if (!structure) return 0;
  const contribs = thresholds.rolling_awareness_score_contribution;
  let signal = 0;

  for (const node of [structure.floor, structure.ceiling].filter(Boolean)) {
    const k = key(ticker, node.strike, tradingDay);
    const st = state.get(k);
    if (!st || st.level === 'None' || !st.lastDirection) continue;

    const tierContrib = contribs[st.level.toLowerCase()] ?? 0;
    const variantBonus =
      st.variant === 'anticipatory_tight' ? contribs.anticipatory_bonus_tight :
      st.variant === 'anticipatory_wide'  ? contribs.anticipatory_bonus_wide :
      0;

    const sign = directionalSign({
      strike: node.strike, spot: node.strike + node.distanceFromSpot,
      structure, lastDirection: st.lastDirection,
    });
    if (sign === 0) continue;

    signal += sign * (tierContrib + variantBonus);
  }
  return Math.max(-100, Math.min(100, signal));
}

export function snapshotAwarenessForPersist({ ticker, tradingDay }) {
  const out = [];
  for (const [k, v] of state.entries()) {
    const [t, strikeStr, day] = k.split('|');
    if (t !== ticker || day !== tradingDay) continue;
    out.push({ ticker, strike: Number(strikeStr), tradingDay, ...v });
  }
  return out;
}

export function clearAwarenessState() {
  state.clear();
}
