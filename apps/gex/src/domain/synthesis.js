/**
 * 9-step synthesis flow — spec §7.
 *
 *   Step 1: What is price doing? (trending / ranging / approaching key level)
 *   Step 2: Where are we relative to structure? (S/R, range extreme, key level)
 *   Step 3: What does the map say? (rainbow_road = no trade)
 *   Step 4: Evaluate the node (lifecycle, tap_count, class, trajectory)
 *   Step 5: Expect the reaction type (direct tap or overshoot)
 *   Step 6: Check the regime (positive vs negative gamma)
 *   Step 7: Check the path (air pockets, gatekeepers, pika clouds blocking target)
 *   Step 8: Confirm across indices (Trinity ≥ 2/3)
 *   Step 9: Make the decision
 *
 * Each step gates progression. Failure at any step → reject with reason.
 *
 * Charts First Doctrine: §0.4 mandates charts first. Current scope is heatmap-only —
 * Step 2's "structural level" check uses heatmap-derived floor/ceiling proximity. When
 * chart context is wired (TV webhook or operator input), pass it as `chartContext` and
 * Step 2 will prefer it over the heatmap fallback.
 */

import { planTrade } from './execution.js';
import { thresholds } from '../utils/config.js';

export function evaluateSetup({
  ticker, spot, tsMs, tradingDay, snapshotId,
  nodes, structure, detections, regimeScore,
  bias, trinity,
  velocityByStrike, classByStrike, lifecycleByStrike,
  spotHistory,                  // recent (tsMs, spot) tuples
  chartContext,                 // optional — see header
  accountSize,                  // optional — for position sizing
}) {
  const trace = [];

  // STEP 1: price doing what
  const step1 = checkPriceAction({ spotHistory });
  trace.push({ step: 1, name: 'price_action', pass: step1.pass, ...step1 });
  if (!step1.pass) return reject(1, step1.reason, trace);

  // STEP 2: structural level
  const step2 = checkStructuralLevel({ chartContext, structure, spot });
  trace.push({ step: 2, name: 'structural_level', pass: step2.pass, ...step2 });
  if (!step2.pass) return reject(2, step2.reason, trace);

  // STEP 3: map readable
  const step3 = checkMap({ detections });
  trace.push({ step: 3, name: 'map_check', pass: step3.pass, ...step3 });
  if (!step3.pass) return reject(3, step3.reason, trace);

  // STEP 4: node evaluation — pick the entry node based on bias direction
  const direction = inferDirection({ bias, trinity });
  if (!direction) {
    // Capture what direction the trinity-or-bias would have suggested if we relaxed the floor.
    // Useful for outcome backfill on currently-rejected setups.
    const hypotheticalDirection =
      bias.biasScore > 0 ? 'calls' :
      bias.biasScore < 0 ? 'puts' : null;
    trace.push({ step: 4, name: 'node_eval', pass: false, reason: 'no_directional_bias', hypotheticalDirection });
    return reject(4, 'no_directional_bias', trace, null, hypotheticalDirection);
  }
  // High-bias paradox filter (iter2): skip when local |bias| is in the empirically-bad
  // range. Replay data showed |bias| ∈ [30, 40] had 50% win rate and -9.4 bps avg —
  // those trades enter momentum-exhaustion conditions where the predicted reversal has
  // already happened. The bound is configurable.
  const biasFilter = thresholds.bias_filter;
  if (biasFilter) {
    const absBias = Math.abs(bias.biasScore);
    if (absBias >= biasFilter.skip_paradox_min && absBias <= biasFilter.skip_paradox_max) {
      trace.push({ step: 4, name: 'node_eval', pass: false, direction, reason: 'bias_paradox_range', absBias });
      return reject(4, 'bias_paradox_range', trace, null, direction);
    }
  }

  const candidate = direction === 'calls' ? structure.floor : structure.ceiling;
  const step4 = checkNodeQuality({ candidate, lifecycleByStrike, classByStrike, velocityByStrike });
  trace.push({ step: 4, name: 'node_eval', pass: step4.pass, direction, candidateStrike: candidate?.strike, ...step4 });
  if (!step4.pass) return reject(4, step4.reason, trace, null, direction);

  // STEP 5: reaction type
  const reactionType = expectedReactionType({ regimeScore, candidate, velocityByStrike });
  trace.push({ step: 5, name: 'reaction_type', pass: true, reactionType });

  // STEP 6: regime — informational, no gate (size adjusted in execution.js).
  // Tried a counter-regime hard gate in iter 2 — killed too many winners (Mar 31 SPXW calls
  // had own_regime ≈ -0.24 and were big winners; trinity confluence overrode local regime).
  // Lesson: own-ticker regime alone isn't a gate. Trinity-level day type might be — defer.
  const regimeLabel = labelRegime(regimeScore);
  trace.push({ step: 6, name: 'regime', pass: true, regimeLabel, regimeScore });

  // STEP 7: path
  const step7 = checkPath({ direction, structure, candidate, detections });
  trace.push({ step: 7, name: 'path', pass: step7.pass, ...step7 });
  if (!step7.pass) return reject(7, step7.reason, trace, null, direction);

  // STEP 8: trinity
  const step8 = checkTrinity({ trinity, direction });
  trace.push({ step: 8, name: 'trinity', pass: step8.pass, ...step8 });
  if (!step8.pass) return reject(8, step8.reason, trace, null, direction);

  // STEP 9: build the trade plan
  const plan = planTrade({
    direction, ticker, spot, structure, nodes,
    entryNode: candidate,
    confluence: trinity.classification,
    regimeScore,
    accountSize,
  });

  if (!plan.accepted) {
    trace.push({ step: 9, name: 'execution_plan', pass: false, ...plan });
    return reject(9, plan.rejectReason, trace, plan, direction);
  }

  trace.push({ step: 9, name: 'execution_plan', pass: true, plan });
  return {
    accepted: true,
    decision: 'would_enter',
    direction,
    plan,
    trace,
    snapshotId,
    ticker, tsMs, tradingDay,
    biasScore: bias.biasScore,
    trinityClassification: trinity.classification,
  };
}

// --- step implementations ---

function checkPriceAction({ spotHistory }) {
  if (!Array.isArray(spotHistory) || spotHistory.length < 5) {
    return { pass: false, reason: 'insufficient_price_history' };
  }
  const last5 = spotHistory.slice(-5);
  const range = Math.max(...last5.map(s => s.spot)) - Math.min(...last5.map(s => s.spot));
  const lastSpot = last5[last5.length - 1].spot;
  // Iter 1: lowered from 0.0005 (rejected 33% of snapshots) to 0.0002 (rejects 6%).
  // 60-day replay showed avg 5-min range/spot is 0.094%; the old gate was a third of average movement.
  const isUnstructuredChop = range / lastSpot < 0.0002;
  if (isUnstructuredChop) return { pass: false, reason: 'unstructured_price' };
  return { pass: true, range };
}

function checkStructuralLevel({ chartContext, structure, spot }) {
  // Prefer operator-supplied chart context if wired. Default mode is heatmap-only.
  if (chartContext) {
    if (!chartContext.nearKeyLevel) return { pass: false, reason: 'chart_no_meaningful_level' };
    return { pass: true, source: 'operator_chart' };
  }
  // Heatmap-only: spot is "at a structural level" iff it sits within 0.5% of the floor or ceiling.
  const near =
    (structure.floor && Math.abs(spot - structure.floor.strike) / spot < 0.005) ||
    (structure.ceiling && Math.abs(spot - structure.ceiling.strike) / spot < 0.005);
  if (!near) return { pass: false, reason: 'spot_not_near_heatmap_structure' };
  return { pass: true, source: 'heatmap_structure' };
}

function checkMap({ detections }) {
  const rainbow = detections?.rainbow_road?.detected;
  if (rainbow) return { pass: false, reason: 'rainbow_road' };
  return { pass: true };
}

function inferDirection({ bias, trinity }) {
  if (trinity.direction === 'calls' || trinity.direction === 'puts') return trinity.direction;
  if (bias.biasScore > 30) return 'calls';
  if (bias.biasScore < -30) return 'puts';
  return null;
}

function checkNodeQuality({ candidate, lifecycleByStrike, classByStrike, velocityByStrike }) {
  if (!candidate) return { pass: false, reason: 'no_floor_or_ceiling_for_direction' };
  const lifecycle = lifecycleByStrike.get(candidate.strike);
  if (lifecycle?.lifecycle_state === 'Broken') return { pass: false, reason: 'broken_node' };

  const cls = classByStrike.get(candidate.strike);
  if (cls?.class === 'Hedge') return { pass: false, reason: 'hedge_node' };

  // Tap count gating: 4+ taps = no edge per §6.4
  const tapCount = lifecycle?.tap_count || 0;
  if (tapCount >= 4) return { pass: false, reason: 'tap_4plus_no_edge' };

  // 3rd tap requires high confluence — flagged here, enforced via plan size in execution.
  return { pass: true, lifecycleState: lifecycle?.lifecycle_state || 'Fresh', tapCount, nodeClass: cls?.class || 'Unknown' };
}

function expectedReactionType({ regimeScore, candidate, velocityByStrike }) {
  const isNeg = regimeScore != null && regimeScore < -0.30;
  const isBarney = candidate?.sign === 'barney';
  if (isNeg && isBarney) return 'overshoot_then_revert';
  return 'direct_tap';
}

function labelRegime(score) {
  if (score == null) return 'unknown';
  if (score > 0.30)  return 'positive';
  if (score < -0.30) return 'negative';
  return 'mixed';
}

function checkPath({ direction, structure, candidate, detections }) {
  if (!candidate) return { pass: false, reason: 'no_candidate' };
  // If a pika cloud blocks the path between candidate and the next major level, flag.
  const cloud = detections?.pika_cloud;
  if (cloud?.detected && cloud.cluster) {
    const cloudInPath = direction === 'calls'
      ? cloud.cluster.low > candidate.strike
      : cloud.cluster.high < candidate.strike;
    if (cloudInPath) return { pass: false, reason: 'pika_cloud_in_path' };
  }
  return { pass: true };
}

function checkTrinity({ trinity, direction }) {
  const c = trinity.classification;
  if (c === 'no_trade_environment') return { pass: false, reason: 'trinity_no_trade_env' };
  if (c === 'noise_no_trade')        return { pass: false, reason: 'trinity_noise' };
  if (c === 'structural_divergence') return { pass: false, reason: 'trinity_divergence_informational_only' };
  if (c === 'insufficient_data')     return { pass: false, reason: 'trinity_insufficient_data' };

  // Direction match check
  if (trinity.direction !== 'calls' && trinity.direction !== 'puts') {
    return { pass: false, reason: 'trinity_no_direction' };
  }
  if (trinity.direction !== direction) {
    return { pass: false, reason: 'trinity_direction_mismatch' };
  }
  return { pass: true, classification: c };
}

function reject(stepNum, reason, trace, plan = null, hypotheticalDirection = null) {
  return {
    accepted: false,
    decision: 'reject',
    stepFailed: stepNum,
    rejectReason: reason,
    trace,
    plan,
    direction: hypotheticalDirection, // populated only when we have a sign to infer
  };
}
