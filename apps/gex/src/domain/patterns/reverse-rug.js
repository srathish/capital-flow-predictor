/**
 * Reverse Rug (bullish) — spec §3.2 (mirror of Rug Setup).
 *
 *   exists(pika_node below spot with relative_significance > 5%)
 *   AND exists(barney_node above the pika with relative_significance > 3%)
 *   AND barney is between pika and spot OR within 1% of spot
 *   AND no opposing pika cluster between spot and barney
 *
 * Bias contribution: +80 to pattern_signal (strong bullish).
 */

import { thresholds } from '../../utils/config.js';

export const PATTERN = 'reverse_rug';
export const SCORE = +80;

export function detect({ nodes, spot }) {
  const minPika = thresholds.node_significance.min_significance_for_floor_ceiling; // 5%
  const minBarney = thresholds.node_significance.min_significance_for_gatekeeper;  // 3%

  const pika = nodes
    .filter(n => n.sign === 'pika' && n.strike < spot && n.relativeSignificance >= minPika)
    .sort((a, b) => b.relativeSignificance - a.relativeSignificance)[0];
  if (!pika) return reject('no_qualifying_pika_below_spot');

  const upperBound = spot * 1.01;
  const barney = nodes
    .filter(n =>
      n.sign === 'barney' &&
      n.strike > pika.strike &&
      n.strike <= upperBound &&
      n.relativeSignificance >= minBarney
    )
    .sort((a, b) => b.relativeSignificance - a.relativeSignificance)[0];
  if (!barney) return reject('no_qualifying_barney_above_pika', { pikaStrike: pika.strike });

  const between = nodes.filter(n =>
    n.sign === 'pika' &&
    n.strike >= Math.min(spot, barney.strike) &&
    n.strike <= Math.max(spot, barney.strike) &&
    n.relativeSignificance >= minBarney
  );
  if (between.length >= 2) {
    return reject('opposing_pika_cluster_between_spot_and_barney', {
      pikaStrike: pika.strike, barneyStrike: barney.strike, clusterCount: between.length
    });
  }

  const confidence = Math.min(1, (pika.relativeSignificance + barney.relativeSignificance) / 0.20);

  return {
    detected: true,
    confidence,
    supportingStrikes: [pika.strike, barney.strike],
    conditionsMet: ['pika_below_spot', 'barney_above_pika', 'no_opposing_cluster'],
    pattern: PATTERN,
    score: SCORE,
  };
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
