/**
 * Trapdoor (bearish continuation) — Falcon-style.
 *
 *   Price approaching a positive-gamma FLOOR from above, about to break.
 *   When it breaks, dealers who were long gamma at the floor sell to hedge,
 *   accelerating downside — the "trapdoor" opens.
 *
 * Distinct from beach-ball (which requires overshoot + revert). Trapdoor
 * fires BEFORE the break — the leading edge of a cascade.
 *
 * Trigger conditions (all required):
 *   - Significant pika node at or just below spot (within 1.5 * deflection_zone)
 *   - Spot velocity is DECREASING toward that node (downward momentum, 5m window)
 *   - Vanna field in the near-strike region is negative (adds downside pull)
 *   - No opposing pika cluster below the trapdoor node (nothing to save it)
 *
 * Bias contribution: -70 (strong bearish leading indicator).
 */

import { thresholds, deflectionZone } from '../../utils/config.js';

export const PATTERN = 'trapdoor';
export const SCORE = -70;

const MIN_NODE_SIG = thresholds.node_significance.min_significance_for_floor_ceiling; // 5%
const APPROACH_VELOCITY = -0.001; // -0.1% per 5m window = falling into node
const ZONE_MULT_APPROACH = 1.5;   // spot within 1.5× deflection zone above node

export function detect({ ticker, nodes, spot, spotHistory, structure }) {
  if (!Array.isArray(nodes) || nodes.length === 0) return reject('no_nodes');
  if (!spot) return reject('no_spot');

  const zone = deflectionZone(ticker);
  const approachThreshold = zone * ZONE_MULT_APPROACH;

  // 1. Find a significant pika node AT or JUST BELOW spot.
  //    We're looking for a floor about to be tested from above.
  const candidateNodes = nodes.filter(n =>
    n.sign === 'pika' &&
    n.relativeSignificance >= MIN_NODE_SIG &&
    n.strike <= spot &&
    (spot - n.strike) <= approachThreshold
  ).sort((a, b) => b.relativeSignificance - a.relativeSignificance);

  const trapdoorNode = candidateNodes[0];
  if (!trapdoorNode) return reject('no_pika_floor_near_spot');

  // 2. Spot velocity must be DECREASING (falling toward the node).
  //    Compute 5-min slope from spotHistory.
  if (!Array.isArray(spotHistory) || spotHistory.length < 3) {
    return reject('insufficient_spot_history');
  }
  const now = spotHistory[spotHistory.length - 1].tsMs;
  const window = spotHistory.filter(s => now - s.tsMs <= 5 * 60 * 1000);
  if (window.length < 3) return reject('insufficient_recent_history');

  const first = window[0];
  const last = window[window.length - 1];
  const elapsedMin = (last.tsMs - first.tsMs) / 60_000;
  if (elapsedMin <= 0) return reject('zero_elapsed_window');
  const velocityPct = (last.spot - first.spot) / first.spot;

  if (velocityPct > APPROACH_VELOCITY) {
    return reject('not_falling_fast_enough', { velocityPct, threshold: APPROACH_VELOCITY });
  }

  // 3. Vanna field near the trapdoor node must be negative (adds downside pressure).
  //    Look at the ±3-strike neighborhood of the node.
  const neighborhood = nodes.filter(n => Math.abs(n.strike - trapdoorNode.strike) <= approachThreshold * 2);
  const totalNearVanna = neighborhood.reduce((sum, n) => sum + (n.vanna || 0), 0);
  if (totalNearVanna >= 0) {
    return reject('vanna_field_not_negative', { totalNearVanna });
  }

  // 4. No opposing pika cluster BELOW the trapdoor node — nothing to catch it if it breaks.
  const minGk = thresholds.node_significance.min_significance_for_gatekeeper;
  const belowCluster = nodes.filter(n =>
    n.sign === 'pika' &&
    n.strike < trapdoorNode.strike &&
    n.strike >= trapdoorNode.strike * 0.98 &&
    n.relativeSignificance >= minGk
  );
  if (belowCluster.length >= 2) {
    return reject('safety_cluster_below_trapdoor', { count: belowCluster.length });
  }

  // Confidence scales with node significance × downward velocity magnitude.
  const velocityMagnitude = Math.min(Math.abs(velocityPct) / 0.005, 1); // 0.5%/5m = full mag
  const confidence = Math.min(1, trapdoorNode.relativeSignificance / 0.10 * velocityMagnitude);

  return {
    detected: true,
    confidence,
    supportingStrikes: [trapdoorNode.strike],
    conditionsMet: ['pika_floor_near_spot', 'downward_velocity', 'negative_vanna_field', 'no_safety_cluster_below'],
    pattern: PATTERN,
    score: SCORE,
    trapdoor: {
      nodeStrike: trapdoorNode.strike,
      distFromSpot: spot - trapdoorNode.strike,
      velocityPct5m: velocityPct,
      vannaField: totalNearVanna,
    },
  };
}

function reject(reason, ctx = {}) {
  return {
    detected: false,
    confidence: 0,
    pattern: PATTERN,
    score: 0,
    rejectReason: reason,
    rejectContext: ctx,
  };
}
