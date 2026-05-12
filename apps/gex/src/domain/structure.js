/**
 * Structural level derivation per spec §1.5–1.10.
 *
 * Given an enriched node array (output of computeSurface), find:
 *   - floor   = argmax(relative_significance) where strike < spot AND sign == 'pika'
 *   - ceiling = argmax(relative_significance) where strike > spot AND sign == 'pika'
 *   - king    = the node already flagged isKing by computeSurface (carried through)
 *   - gatekeepers = nodes between two larger structural nodes with significance > min threshold
 *   - airPockets  = continuous strike ranges where total significance density is below threshold
 *   - liquidityVacuums = extended air pockets (length-thresholded)
 *
 * Recomputed every snapshot. Output is consumed by patterns.* and bias.js.
 */

import { thresholds } from '../utils/config.js';

export function deriveStructure({ nodes, spot }) {
  let floor = null;
  let ceiling = null;
  let king = null;

  for (const n of nodes) {
    if (n.isKing) king = n;
    if (n.sign === 'pika') {
      if (n.strike < spot) {
        if (!floor || n.relativeSignificance > floor.relativeSignificance) floor = n;
      } else if (n.strike > spot) {
        if (!ceiling || n.relativeSignificance > ceiling.relativeSignificance) ceiling = n;
      }
    }
  }

  // Apply minimum-significance gates from config.
  const minFloorCeil = thresholds.node_significance.min_significance_for_floor_ceiling;
  if (floor && floor.relativeSignificance < minFloorCeil) floor = null;
  if (ceiling && ceiling.relativeSignificance < minFloorCeil) ceiling = null;

  const gatekeepers = findGatekeepers(nodes, { king, floor, ceiling });
  const { airPockets, liquidityVacuums } = findAirPockets(nodes, spot);

  return { floor, ceiling, king, gatekeepers, airPockets, liquidityVacuums };
}

function findGatekeepers(nodes, { king, floor, ceiling }) {
  const minGk = thresholds.node_significance.min_significance_for_gatekeeper;
  const anchors = [floor, king, ceiling].filter(Boolean).map(n => n.strike).sort((a, b) => a - b);
  if (anchors.length < 2) return [];

  const gk = [];
  for (const n of nodes) {
    if (n.relativeSignificance < minGk) continue;
    if (anchors.includes(n.strike)) continue; // skip the anchor nodes themselves
    // Sits between two anchors?
    const inBetween = n.strike > anchors[0] && n.strike < anchors[anchors.length - 1];
    if (!inBetween) continue;
    gk.push(n);
  }
  return gk;
}

/**
 * Air pockets = consecutive strike ranges where ALL strikes have rel_sig < gatekeeper threshold.
 * Liquidity vacuums = air pockets longer than ~3% of spot price (operational heuristic, no spec value).
 */
function findAirPockets(nodes, spot) {
  const minGk = thresholds.node_significance.min_significance_for_gatekeeper;
  const sorted = [...nodes].sort((a, b) => a.strike - b.strike);

  const pockets = [];
  let runStart = null;
  let runEnd = null;

  for (const n of sorted) {
    const isWeak = n.relativeSignificance < minGk;
    if (isWeak) {
      if (runStart == null) runStart = n.strike;
      runEnd = n.strike;
    } else {
      if (runStart != null && runEnd != null && runEnd > runStart) {
        pockets.push({ low: runStart, high: runEnd, span: runEnd - runStart });
      }
      runStart = null;
      runEnd = null;
    }
  }
  if (runStart != null && runEnd != null && runEnd > runStart) {
    pockets.push({ low: runStart, high: runEnd, span: runEnd - runStart });
  }

  const vacuumThreshold = spot * 0.03;
  const liquidityVacuums = pockets.filter(p => p.span >= vacuumThreshold);
  return { airPockets: pockets, liquidityVacuums };
}

/**
 * Used by bias.js — distance categorization for spot vs. king node, scaled by ticker's deflection zone.
 */
export function spotPositionVsNode(spot, node, deflectionZone) {
  if (!node) return 'absent';
  const d = spot - node.strike;
  const z = deflectionZone;
  if (d > 2 * z) return 'well_above';
  if (d > z)     return 'just_above';
  if (d >= -z)   return 'at';
  if (d >= -2 * z) return 'just_below';
  return 'well_below';
}
