/**
 * Rainbow Road (undefined chaos) — spec §3.6
 *
 *   no node has relative_significance > 10%
 *   AND king node concentration < 8%
 *   AND no clear floor or ceiling identifiable
 *   AND surface entropy is high
 *
 * Bias contribution: 0 with no_trade flag (overrides all other signals on this ticker).
 */

import { thresholds } from '../../utils/config.js';

export const PATTERN = 'rainbow_road';
export const SCORE = 0;

const MAX_TOP_SIG = 0.10;
const MAX_KING_SIG = 0.08;
const HIGH_ENTROPY_THRESHOLD = 0.85; // normalized entropy

export function detect({ nodes, structure }) {
  if (!nodes || nodes.length === 0) return reject('empty_surface');

  const topSig = Math.max(...nodes.map(n => n.relativeSignificance));
  const king = structure?.king;
  const kingSig = king ? king.relativeSignificance : topSig;

  // Normalized Shannon entropy across rel_sig distribution.
  const total = nodes.reduce((s, n) => s + n.relativeSignificance, 0);
  if (total === 0) return reject('zero_total_significance');

  let h = 0;
  for (const n of nodes) {
    if (n.relativeSignificance <= 0) continue;
    const p = n.relativeSignificance / total;
    h -= p * Math.log2(p);
  }
  const maxH = Math.log2(nodes.length);
  const entropyNorm = maxH > 0 ? h / maxH : 0;

  const noFloor = !structure?.floor;
  const noCeiling = !structure?.ceiling;
  const noClearStructure = noFloor && noCeiling;

  const conditions = [];
  if (topSig < MAX_TOP_SIG) conditions.push('no_node_>10%');
  if (kingSig < MAX_KING_SIG) conditions.push('king_<8%');
  if (noClearStructure) conditions.push('no_floor_or_ceiling');
  if (entropyNorm >= HIGH_ENTROPY_THRESHOLD) conditions.push('high_entropy');

  const detected =
    topSig < MAX_TOP_SIG &&
    kingSig < MAX_KING_SIG &&
    noClearStructure &&
    entropyNorm >= HIGH_ENTROPY_THRESHOLD;

  if (!detected) {
    return {
      detected: false, confidence: 0, supportingStrikes: [],
      conditionsMet: conditions, pattern: PATTERN, score: 0,
      flags: [],
    };
  }

  return {
    detected: true,
    confidence: Math.min(1, entropyNorm),
    supportingStrikes: [],
    conditionsMet: conditions,
    pattern: PATTERN,
    score: SCORE,
    flags: ['no_trade'],
    diagnostics: { topSig, kingSig, entropyNorm },
  };
}

function reject(reason) {
  return {
    detected: false,
    confidence: 0,
    supportingStrikes: [],
    conditionsMet: [],
    rejectReason: reason,
    pattern: PATTERN,
    score: 0,
  };
}
