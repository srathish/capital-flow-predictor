/**
 * Hedge vs Real node classification per Overlay #8.
 *
 *   Real        — growing across 5m AND 15m windows, regardless of distance, OR
 *                 within structural range AND tested with deflection.
 *   Hedge       — stable/decaying across 5m+ AND 15m+ AND not tested today AND
 *                 distance from spot is significant.
 *   Ambiguous   — anything else.
 *
 * Class modifier (multiplied into floor_ceiling_proximity component of bias):
 *   Real: 1.0, Ambiguous: 0.6, Hedge: 0.3.
 *
 * Inputs:
 *   - node       : enriched node from significance.js
 *   - velocity   : output of velocity.computeVelocity for this strike
 *   - lifecycle  : row from node_lifecycle (or null if untracked)
 *   - spot       : current spot for distance check
 */

import { thresholds } from '../utils/config.js';

const HEDGE_DISTANCE_PCT = 0.03; // > 3% from spot is "significant" distance per spec

export function classifyNode({ node, velocity, lifecycle, spot }) {
  const distancePct = Math.abs(node.strike - spot) / spot;

  const grow5m = velocity?.window_5m?.direction === 'growing';
  const grow15m = velocity?.window_15m?.direction === 'growing';
  const stable5m = velocity?.window_5m?.direction === 'stable' || velocity?.window_5m?.direction === 'decaying';
  const stable15m = velocity?.window_15m?.direction === 'stable' || velocity?.window_15m?.direction === 'decaying';
  const decaying5m = velocity?.window_5m?.direction === 'decaying';
  const decaying15m = velocity?.window_15m?.direction === 'decaying';

  const tested = (lifecycle?.tap_count || 0) > 0;
  const hadDeflection = lifecycle?.lifecycle_state === 'Tested' || lifecycle?.lifecycle_state === 'Delivered';

  // Real: trajectory-primary
  if (grow5m && grow15m) {
    return classified('Real', 'growing_5m_and_15m', distancePct);
  }
  if (hadDeflection && distancePct <= 2 * thresholds.deflection_zones.SPY / spot) {
    // "within structural range AND tested with deflection" — operationalized as: tested with deflection AND within 2 zones
    return classified('Real', 'tested_with_deflection', distancePct);
  }

  // Hedge: stable/decaying long-window AND not tested AND far
  if (stable5m && stable15m && !tested && distancePct > HEDGE_DISTANCE_PCT) {
    if (decaying5m || decaying15m) {
      return classified('Hedge', 'decaying_far_untested', distancePct);
    }
    return classified('Hedge', 'stable_far_untested', distancePct);
  }

  // Otherwise: Ambiguous
  return classified('Ambiguous', 'mixed_signals', distancePct);
}

function classified(label, reason, distancePct) {
  const modifier = thresholds.class_modifiers[label.toLowerCase()] ?? 1.0;
  return { class: label, reason, distancePct, classModifier: modifier };
}
