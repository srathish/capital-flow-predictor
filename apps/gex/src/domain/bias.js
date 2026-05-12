/**
 * Per-ticker continuous bias score (-100 to +100) per spec §4 (Operator Overlay #3).
 *
 *   bias_score(ticker) = clamp(
 *     0.30 * pattern_signal
 *   + 0.20 * king_node_position
 *   + 0.15 * floor_ceiling_proximity
 *   + 0.10 * regime_modifier
 *   + 0.15 * velocity_signal
 *   + 0.10 * rolling_signal,
 *     -100, +100
 *   )
 *
 * Weights live in config/calibrated_thresholds.json — do NOT inline.
 *
 * Components per §4.3:
 *   1. pattern_signal       — from patterns/index.js#aggregatePatternSignal
 *   2. king_node_position   — spot vs king, sign-flipped for barney king
 *   3. floor_ceiling_proximity — spot near fresh/tested/delivered/broken floor/ceiling, × class modifier
 *   4. regime_modifier      — additive contribution (the multiplicative variant from §4.3 deferred to v1.5)
 *   5. velocity_signal      — accumulation/unwind signals
 *   6. rolling_signal       — from awareness.getRollingSignal
 *
 * Note on §4.3 multiplicative regime: spec leaves this as an option ("Phase 1 calibration may
 * simplify this to pure additive if multiplicative behavior is unstable"). v1 uses pure additive.
 */

import { thresholds, deflectionZone } from '../utils/config.js';
import { spotPositionVsNode } from './structure.js';
import { aggregatePatternSignal } from './patterns/index.js';
import { getRollingSignal } from './awareness.js';

export function computeBiasScore({
  ticker, tradingDay, spot, regimeScore,
  nodes, structure, detections,
  velocityByStrike,             // Map<strike, velocityResult>
  classByStrike,                // Map<strike, classification>
  lifecycleByStrike,            // Map<strike, lifecycleRow>
}) {
  const w = thresholds.bias_score_weights;

  const patternAgg = aggregatePatternSignal(detections);
  const c1 = patternAgg.score;

  const c2 = kingNodePositionScore({ spot, structure, ticker });
  const c3 = floorCeilingProximityScore({ spot, structure, lifecycleByStrike, classByStrike });
  const c4 = regimeModifierScore({ regimeScore, spot, structure });
  const c5 = velocitySignalScore({ nodes, structure, velocityByStrike });
  const c6 = getRollingSignal({ ticker, tradingDay, structure });

  const raw =
    w.pattern_signal * c1 +
    w.king_node_position * c2 +
    w.floor_ceiling_proximity * c3 +
    w.regime_modifier * c4 +
    w.velocity_signal * c5 +
    w.rolling_signal * c6;

  const biasScore = Math.max(-100, Math.min(100, raw));

  return {
    biasScore,
    components: {
      pattern_signal: c1,
      king_node_position: c2,
      floor_ceiling_proximity: c3,
      regime_modifier: c4,
      velocity_signal: c5,
      rolling_signal: c6,
    },
    flags: patternAgg.flags,
    weightsApplied: w,
    supportingState: {
      patternsDetected: patternAgg.detectedPatterns,
      kingStrike: structure.king?.strike ?? null,
      floorStrike: structure.floor?.strike ?? null,
      ceilingStrike: structure.ceiling?.strike ?? null,
      regimeScore,
      spot,
    },
  };
}

// --- Component 2: King node position (§4.3) ---
function kingNodePositionScore({ spot, structure, ticker }) {
  const king = structure.king;
  if (!king) return 0;
  const zone = deflectionZone(ticker);
  const pos = spotPositionVsNode(spot, king, zone);

  // Pika king column: spot well above = +50 (price has cleared resistance)
  const baseTablePika = {
    well_above: +50, just_above: +25, at: 0, just_below: -25, well_below: -50, absent: 0,
  };
  // Barney king: signs invert
  const baseTableBarney = {
    well_above: -50, just_above: -25, at: 0, just_below: +25, well_below: +50, absent: 0,
  };

  let score = (king.sign === 'pika') ? baseTablePika[pos] : baseTableBarney[pos];

  // Velocity multiplier (§4.3 Component 5 hook): king accumulating boosts king position component.
  // Implemented in velocitySignalScore by *not* doubling here — pure additive in v1.
  return score;
}

// --- Component 3: Floor / ceiling proximity (§4.3) with class modifier ---
function floorCeilingProximityScore({ spot, structure, lifecycleByStrike, classByStrike }) {
  const tableFloor = { Fresh: +60, Tested: +35, Delivered: +10, Broken: 0 };
  const tableCeiling = { Fresh: -60, Tested: -35, Delivered: -10, Broken: 0 };

  let score = 0;

  for (const [node, table] of [[structure.floor, tableFloor], [structure.ceiling, tableCeiling]]) {
    if (!node) continue;
    const lifecycle = lifecycleByStrike.get(node.strike);
    const lifecycleState = lifecycle?.lifecycle_state || 'Fresh';
    let contrib = table[lifecycleState] ?? 0;

    // Apply class modifier (Real 1.0 / Ambiguous 0.6 / Hedge 0.3)
    const cls = classByStrike.get(node.strike);
    if (cls) contrib *= cls.classModifier;

    // Only count contribution if spot is near the node (within ~2 zones — otherwise it's not "at" the level)
    const dist = Math.abs(spot - node.strike);
    if (dist > Math.abs(node.strike) * 0.01) {
      // > 1% away from spot → reduce the contribution proportionally (don't fully credit a far floor)
      const decay = Math.max(0, 1 - (dist / (Math.abs(node.strike) * 0.02)));
      contrib *= decay;
    }
    score += contrib;
  }
  return Math.max(-100, Math.min(100, score));
}

// --- Component 4: Regime modifier (additive only, see header note) ---
function regimeModifierScore({ regimeScore, spot, structure }) {
  if (regimeScore == null) return 0;
  // §4.3 table:
  //   positive gamma + spot near floor: +20
  //   positive gamma + spot near ceiling: -20
  //   negative gamma: multiplier 1.3× (deferred — additive substitute is small directional bias)
  //   pika cloud: 0.7× (deferred)
  const positiveClear = regimeScore > thresholds.regime_thresholds.positive_clear;
  const negativeClear = regimeScore < thresholds.regime_thresholds.negative_clear;

  if (positiveClear) {
    if (structure.floor && spot < structure.floor.strike + Math.abs(structure.floor.strike) * 0.005) return +20;
    if (structure.ceiling && spot > structure.ceiling.strike - Math.abs(structure.ceiling.strike) * 0.005) return -20;
    return 0;
  }
  if (negativeClear) {
    // §4.3 negative-gamma multiplier deferred to additive: small same-direction nudge based on spot vs king.
    // Without overengineering, return 0 here and let velocity/rolling carry the negative regime urgency.
    return 0;
  }
  return 0;
}

// --- Component 5: Velocity signal (§4.3) ---
function velocitySignalScore({ nodes, structure, velocityByStrike }) {
  let score = 0;
  const minSig = thresholds.node_significance.min_significance_for_gatekeeper;

  // Floor accumulating → +40, Ceiling accumulating → -40
  if (structure.floor) {
    const v = velocityByStrike.get(structure.floor.strike);
    if (v?.window_5m?.direction === 'growing' || v?.window_15m?.direction === 'growing') {
      score += 40;
    }
  }
  if (structure.ceiling) {
    const v = velocityByStrike.get(structure.ceiling.strike);
    if (v?.window_5m?.direction === 'growing' || v?.window_15m?.direction === 'growing') {
      score -= 40;
    }
  }

  // King node accumulating: scale with king's sign (pika growing = bullish, barney growing = bearish).
  if (structure.king) {
    const v = velocityByStrike.get(structure.king.strike);
    const grow = v?.window_5m?.direction === 'growing' || v?.window_15m?.direction === 'growing';
    if (grow) {
      // 1.5× multiplier on king-position-component implemented inline as a bonus.
      score += structure.king.sign === 'pika' ? 25 : -25;
    }
  }

  // Mass accumulation upside / downside: count significant pika nodes growing above spot vs barney nodes growing below.
  let pikaUpGrowing = 0, barneyDownGrowing = 0, pikaDownGrowing = 0, barneyUpGrowing = 0;
  for (const n of nodes) {
    if (n.relativeSignificance < minSig) continue;
    const v = velocityByStrike.get(n.strike);
    const growing = v?.window_5m?.direction === 'growing' && v?.window_15m?.direction === 'growing';
    if (!growing) continue;

    if (n.distanceFromSpot > 0 && n.sign === 'pika') pikaUpGrowing++;
    else if (n.distanceFromSpot < 0 && n.sign === 'barney') barneyDownGrowing++;
    else if (n.distanceFromSpot < 0 && n.sign === 'pika') pikaDownGrowing++;
    else if (n.distanceFromSpot > 0 && n.sign === 'barney') barneyUpGrowing++;
  }
  if (pikaUpGrowing >= 2)     score += 50;
  if (barneyDownGrowing >= 2) score -= 50;

  return Math.max(-100, Math.min(100, score));
}
