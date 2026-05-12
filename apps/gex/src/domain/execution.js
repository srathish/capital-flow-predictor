/**
 * Execution doctrine — spec §6.
 *
 * Builds a candidate trade plan from a structural setup:
 *   - Entry: direct tap of fresh, qualified node
 *   - Stop:  one node beyond invalidation, ≥3% relative_significance
 *           (subject to break-and-hold confirmation — handled by mid-trade monitor, not entry)
 *   - Targets: structure-defined nodes in trade direction
 *   - R:R gating: ≥3:1 full size, 2:1-3:1 reduced size, <2:1 reject
 *   - Position size: max_risk_per_trade / stop_distance × confluence_multiplier × regime_multiplier
 *
 * V1 closes full size at first target (§6.7). Multi-target scaling (50/25/25) is v1.5.
 * Position sizing produces fractional units; max_risk_per_trade defaults to 1% of account.
 */

import { thresholds, deflectionZone } from '../utils/config.js';

const MAX_RISK_PCT = 0.01; // §6.9 default — 1% of account per trade

/**
 * Build an entry plan or reject with a reason.
 *
 * @param direction       'calls' | 'puts'
 * @param ticker
 * @param spot
 * @param structure       output of deriveStructure
 * @param nodes           enriched node list
 * @param entryNode       the floor (calls) or ceiling (puts) at which we'd enter
 * @param confluence      'high_confidence_directional' | 'moderate_confidence_directional' | 'partial_alignment'
 * @param regimeScore     -1..+1 from significance.js
 * @param accountSize     dollars, optional — if absent, returns size in "risk units"
 */
export function planTrade({
  direction, ticker, spot, structure, nodes, entryNode,
  confluence, regimeScore, accountSize,
}) {
  if (!entryNode) return rejected('no_entry_node');

  const isCalls = direction === 'calls';
  const isPuts = direction === 'puts';
  if (!isCalls && !isPuts) return rejected('invalid_direction');

  // Stop strike per §6.6.1: next significant node beyond entry in the wrong direction.
  const minStopSig = thresholds.node_significance.min_significance_for_stop_node;
  const stopNode = isCalls
    ? findFirstNodeBelow(nodes, entryNode.strike, minStopSig)
    : findFirstNodeAbove(nodes, entryNode.strike, minStopSig);
  if (!stopNode) return rejected('no_stop_node_within_significance_threshold');

  const stopPrice = stopNode.strike;
  const entryPrice = spot; // direct tap — we enter at the deflection zone, modeled as current spot.
  const stopDistance = Math.abs(entryPrice - stopPrice);
  if (stopDistance <= 0) return rejected('zero_stop_distance');

  // Targets — fixed-bps mode (default after iter2) or structural mode (spec §6.7).
  // Structural targets at the next ≥5% rel_sig node averaged 54 bps; MFE study showed
  // median trade reached only 28 bps favorable. Structural targets were unreachable
  // most of the time. Fixed-bps TP captures the actual move shape.
  const tpConfig = thresholds.take_profit || { mode: 'structural', fixed_bps: 25 };
  let targets;
  if (tpConfig.mode === 'fixed_bps') {
    const tpDistance = entryPrice * (tpConfig.fixed_bps / 10000);
    const tpStrike = isCalls ? entryPrice + tpDistance : entryPrice - tpDistance;
    targets = [{ strike: tpStrike, distance: tpDistance, source: 'fixed_bps' }];
  } else {
    targets = findTargets({ nodes, entryStrike: entryNode.strike, isCalls });
    if (targets.length === 0) return rejected('no_target_nodes');
  }

  // R:R using first target.
  const firstTarget = targets[0];
  const targetDistance = Math.abs(firstTarget.strike - entryPrice);
  const rr = targetDistance / stopDistance;

  const rrGating = thresholds.rr_gating;
  if (rr < rrGating.reject_below) {
    return rejected('insufficient_rr', { rr, stopDistance, targetDistance });
  }

  const sizeMultiplier = computeSizeMultiplier({ rr, rrGating, confluence, regimeScore });

  // Position sizing per §6.9
  let baseSize = 1.0; // unitless
  if (accountSize && accountSize > 0) {
    const maxRisk = accountSize * MAX_RISK_PCT;
    baseSize = maxRisk / stopDistance;
  }
  const adjustedSize = baseSize * sizeMultiplier;

  return {
    accepted: true,
    direction,
    ticker,
    entryNode: { strike: entryNode.strike, sign: entryNode.sign, relativeSignificance: entryNode.relativeSignificance },
    entryPrice,
    stopStrike: stopPrice,
    stopDistance,
    targets: targets.slice(0, 3).map(t => ({ strike: t.strike, distance: Math.abs(t.strike - entryPrice) })),
    rr,
    sizeMultiplier,
    adjustedSize,
    deflectionZoneZone: deflectionZone(ticker),
    notes: [
      `entry=${entryPrice} stop=${stopPrice} (Δ${stopDistance.toFixed(2)})`,
      `T1=${firstTarget.strike} (Δ${targetDistance.toFixed(2)}) rr=${rr.toFixed(2)}`,
    ],
  };
}

function rejected(reason, ctx = {}) {
  return { accepted: false, rejectReason: reason, ...ctx };
}

function findFirstNodeBelow(nodes, fromStrike, minSig) {
  return [...nodes]
    .filter(n => n.strike < fromStrike && n.relativeSignificance >= minSig)
    .sort((a, b) => b.strike - a.strike)[0] || null;
}

function findFirstNodeAbove(nodes, fromStrike, minSig) {
  return [...nodes]
    .filter(n => n.strike > fromStrike && n.relativeSignificance >= minSig)
    .sort((a, b) => a.strike - b.strike)[0] || null;
}

function findTargets({ nodes, entryStrike, isCalls }) {
  const minTargetSig = 0.05; // §6.7: relative_significance > 5%
  const targets = nodes
    .filter(n => n.relativeSignificance >= minTargetSig &&
      (isCalls ? n.strike > entryStrike : n.strike < entryStrike))
    .sort((a, b) => isCalls ? a.strike - b.strike : b.strike - a.strike);
  return targets;
}

function computeSizeMultiplier({ rr, rrGating, confluence, regimeScore }) {
  // R:R component
  const rrSize = rr >= rrGating.full_size ? 1.0 : 0.5;

  // Confluence component (§6.9)
  const confluenceMul =
    confluence === 'high_confidence_directional'    ? 1.0 :
    confluence === 'moderate_confidence_directional' ? 0.7 :
    confluence === 'partial_alignment'              ? 0.5 : 0.3;

  // Regime component
  const regimeMul =
    regimeScore == null ? 1.0 :
    regimeScore >= thresholds.regime_thresholds.positive_clear ? 1.0 :
    regimeScore <= thresholds.regime_thresholds.negative_clear ? 0.7 : // negative gamma — wider stops, smaller size
    1.0;

  return rrSize * confluenceMul * regimeMul;
}
