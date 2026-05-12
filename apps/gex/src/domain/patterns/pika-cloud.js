/**
 * Pika Cloud (compression / gravity well) — spec §3.3
 *
 *   count(adjacent pika nodes with relative_significance > 2%) >= 3
 *   AND sum(relative_significance of cluster) > 15%
 *   AND cluster spans <= 5% price range
 *
 * Bias contribution: 0 (neutral, sets chop flag).
 */

import { thresholds } from '../../utils/config.js';

export const PATTERN = 'pika_cloud';
export const SCORE = 0;

const MIN_MEMBER_SIG = 0.02;     // §3.3: > 2%
const MIN_CLUSTER_TOTAL = 0.15;  // §3.3: > 15%
const MAX_CLUSTER_SPAN_PCT = 0.05; // §3.3: ≤ 5%
const MIN_CLUSTER_SIZE = 3;      // §3.3: 3+ adjacent

export function detect({ nodes, spot }) {
  const sorted = [...nodes].sort((a, b) => a.strike - b.strike);

  // Walk the sorted strikes, building runs of adjacent pika nodes ≥2% sig.
  // "Adjacent" is interpreted as consecutive in the strike array (no zero-rel-sig gaps).
  let bestCluster = null;

  let run = [];
  for (const n of sorted) {
    if (n.sign === 'pika' && n.relativeSignificance >= MIN_MEMBER_SIG) {
      run.push(n);
    } else {
      bestCluster = pickBetterCluster(bestCluster, evalRun(run, spot));
      run = [];
    }
  }
  bestCluster = pickBetterCluster(bestCluster, evalRun(run, spot));

  if (!bestCluster || !bestCluster.qualifies) {
    return {
      detected: false, confidence: 0, supportingStrikes: [],
      conditionsMet: [], pattern: PATTERN, score: 0,
      flags: [],
    };
  }

  const conditionsMet = ['cluster_size_>=3', 'total_significance_>=15%', 'span_<=5%'];
  return {
    detected: true,
    confidence: Math.min(1, bestCluster.totalSig / 0.30), // 30% sig = full confidence
    supportingStrikes: bestCluster.strikes,
    conditionsMet,
    pattern: PATTERN,
    score: SCORE,
    flags: ['chop'],
    cluster: bestCluster,
  };
}

function evalRun(run, spot) {
  if (run.length < MIN_CLUSTER_SIZE) return null;
  const totalSig = run.reduce((s, n) => s + n.relativeSignificance, 0);
  const span = run[run.length - 1].strike - run[0].strike;
  const spanPct = span / spot;
  return {
    qualifies: totalSig >= MIN_CLUSTER_TOTAL && spanPct <= MAX_CLUSTER_SPAN_PCT,
    totalSig,
    spanPct,
    strikes: run.map(n => n.strike),
    low: run[0].strike,
    high: run[run.length - 1].strike,
  };
}

function pickBetterCluster(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (b.totalSig > a.totalSig) ? b : a;
}
