/**
 * Beach Ball (overshoot setup) — spec §3.4
 *
 *   price was outside deflection_zone of node (overshoot)
 *   AND price now stalling (5m velocity near zero)
 *   AND node has relative_significance > 5%
 *   AND the overshoot direction conflicts with node's expected behavior
 *
 * Bias contribution: ±60 depending on overshoot direction (transient).
 *
 * Implementation note: requires recent spot history. Caller must provide `spotHistory`,
 * an array of { tsMs, spot } from the past ~5 minutes for this ticker. If insufficient
 * history, detector returns `detected: false` with a `needs_history` reject reason.
 */

import { thresholds, deflectionZone } from '../../utils/config.js';

export const PATTERN = 'beach_ball';

const MIN_NODE_SIG = thresholds.node_significance.min_significance_for_floor_ceiling; // 5%
const STALL_VELOCITY_PER_MIN = 0.0005; // |Δspot/min|/spot < 0.05% counts as stalled
const HISTORY_WINDOW_MS = 5 * 60 * 1000;
const OVERSHOOT_MULTIPLIER = 1.5; // price was ≥ 1.5× zone past the node

export function detect({ nodes, spot, ticker, spotHistory }) {
  if (!Array.isArray(spotHistory) || spotHistory.length < 3) {
    return reject('insufficient_spot_history');
  }

  const now = spotHistory[spotHistory.length - 1].tsMs;
  const recentWindow = spotHistory.filter(s => now - s.tsMs <= HISTORY_WINDOW_MS);
  if (recentWindow.length < 3) return reject('insufficient_recent_history');

  // Stall check: recent 5m spot range divided by elapsed minutes < threshold
  const elapsedMin = (recentWindow[recentWindow.length - 1].tsMs - recentWindow[0].tsMs) / 60_000;
  if (elapsedMin <= 0) return reject('zero_elapsed_window');

  const minSpot = Math.min(...recentWindow.map(s => s.spot));
  const maxSpot = Math.max(...recentWindow.map(s => s.spot));
  const recentVelocityPerMin = (maxSpot - minSpot) / elapsedMin / spot;
  const stalled = recentVelocityPerMin < STALL_VELOCITY_PER_MIN;
  if (!stalled) return reject('not_stalling');

  const zone = deflectionZone(ticker);
  const overshootThreshold = zone * OVERSHOOT_MULTIPLIER;

  // Look at significant pika nodes that price recently overshot.
  // Overshot above (price went above the pika): if maxSpot >= node.strike + overshootThreshold AND now spot is near node
  // Overshot below (price went below the pika): if minSpot <= node.strike - overshootThreshold AND now spot is near node
  let best = null;
  for (const n of nodes) {
    if (n.sign !== 'pika' || n.relativeSignificance < MIN_NODE_SIG) continue;

    const distNow = Math.abs(spot - n.strike);
    if (distNow > 2 * zone) continue; // must be back near the node now

    const overshotAbove = maxSpot >= n.strike + overshootThreshold;
    const overshotBelow = minSpot <= n.strike - overshootThreshold;
    if (!overshotAbove && !overshotBelow) continue;

    // Direction: revertingDown after overshooting up = bearish; revertingUp after overshooting down = bullish
    const direction = overshotAbove ? 'reverting_down' : 'reverting_up';
    const score = direction === 'reverting_up' ? +60 : -60;

    const candidate = {
      detected: true,
      confidence: Math.min(1, n.relativeSignificance / 0.10),
      supportingStrikes: [n.strike],
      conditionsMet: ['overshoot_observed', 'price_stalling', 'node_significance_>5%'],
      pattern: PATTERN,
      score,
      direction,
      overshoot: { node: n.strike, maxSpot, minSpot, distNow, threshold: overshootThreshold },
    };
    if (!best || n.relativeSignificance > best.confidence * 0.10) best = candidate;
  }

  return best || reject('no_overshoot_against_significant_node');
}

function reject(reason, ctx = {}) {
  return {
    detected: false,
    confidence: 0,
    supportingStrikes: [],
    conditionsMet: [],
    rejectReason: reason,
    rejectContext: ctx,
    pattern: PATTERN,
    score: 0,
  };
}
