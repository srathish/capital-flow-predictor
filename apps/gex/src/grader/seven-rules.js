/**
 * Giul's 7-rule A+ map grader — Skylit-Academy-canonical version.
 *
 * All structural math delegated to OpenClaw v11 domain modules:
 *   - significance.js  → KING + relative significance
 *   - structure.js     → floor / ceiling / gatekeepers / air pockets
 *   - patterns/*       → Rug Setup / Reverse Rug / Pika Cloud / Rainbow Road / etc.
 *   - execution.js     → planTrade (stop, targets, R:R gating)
 *
 * This grader is a THIN Giul-language mapping over those outputs, not a
 * parallel implementation. See apps/gex/docs/skylit-academy.md as rulebook,
 * apps/gex/src/domain/*.js as validated implementation, and
 * apps/gex/docs/findings.md as empirical corrections.
 *
 * Grade → Skylit Chapter 6 "A+ Standard":
 *
 *   A+ = Rug or Reverse Rug detected (high confidence)
 *      + floor and ceiling both structurally present
 *      + planTrade R:R >= 3.0 (spec §6.8 target)
 *      + target strike NOT already tagged this week (Giul rule 6)
 *      + air pocket to target (0 gatekeepers)
 *
 *   A  = Same pattern + planTrade R:R >= 2.0
 *      + ≤1 gatekeeper
 *      + target not delivered
 *
 *   B  = Structural setup only (floor OR ceiling + KING) but no pattern trigger,
 *        OR pattern present but R:R below 2.0 (still above rr_gating reject_below)
 *
 *   C  = No structure / rainbow road / trade rejected by R:R gate / no KING
 */

import { computeSurface } from '../domain/significance.js';
import { deriveStructure } from '../domain/structure.js';
import { runPerTickerPatterns } from '../domain/patterns/index.js';
import { planTrade } from '../domain/execution.js';
import { thresholds } from '../utils/config.js';

// Giul rule 1: KING commands the map only if it's within this many percent
// of spot for the expiration's session horizon. A KING 20% away is a LEAP
// magnet, not this week's structural pivot.
const KING_SEARCH_ZONE_PCT = 0.15;

// Pattern detectors already require min 5% (pika) + 3% (barney) via config.
// Giul's "strong sized node" language matches those thresholds directly.
const A_PLUS_MIN_PATTERN_CONFIDENCE = 0.50;
const A_MIN_PATTERN_CONFIDENCE = 0.30;

// Grade rank for tie-breaking across expirations.
const GRADE_RANK = { 'A+': 4, 'A': 3, 'B': 2, 'C': 1 };

// ---------- Snapshot → OpenClaw domain outputs ----------

function analyzeExpiration({ ticker, spot, strikes, weeklyRange }) {
  // Step 1 — significance surface (§1.3): relSig + KING flag per strike.
  const surface = computeSurface(strikes, spot);

  // Step 2 — structural derivation (§1.5-1.10): floor / ceiling / gatekeepers / air pockets.
  const structure = deriveStructure({ nodes: surface.nodes, spot });

  // Step 3 — pattern detection (§3.1-3.7): all 8 per-ticker patterns.
  const detections = runPerTickerPatterns({
    ticker,
    nodes: surface.nodes,
    spot,
    structure,
    spotHistory: [],
    previousClose: null,
  });

  return { surface, structure, detections };
}

// ---------- Giul's Rule 6: has target strike been touched this week? ----------

function targetDeliveredThisWeek(targetStrike, direction, weeklyRange) {
  if (!weeklyRange || targetStrike == null) return false;
  return direction === 'bull'
    ? weeklyRange.high >= targetStrike
    : weeklyRange.low <= targetStrike;
}

// ---------- KING sits within Giul's session zone? ----------

function kingInSessionZone(king, spot) {
  if (!king) return false;
  const dist = Math.abs(king.strike - spot) / spot;
  return dist <= KING_SEARCH_ZONE_PCT;
}

// ---------- Choose direction from patterns + structure ----------
//
// Skylit doctrine (Chapter 5): Reverse Rug = bullish, Rug Setup = bearish.
// If both fire (rare), pick higher confidence. Fall back to KING sign +
// spot position if no directional pattern fires but structure is clean.

function directionFromPatterns(detections, structure, spot) {
  const rug = detections.rug_setup;
  const rev = detections.reverse_rug;
  const rugConf = rug?.detected ? rug.confidence : 0;
  const revConf = rev?.detected ? rev.confidence : 0;

  if (rugConf > 0 || revConf > 0) {
    if (revConf >= rugConf) {
      return { direction: 'bull', pattern: rev, confidence: revConf };
    }
    return { direction: 'bear', pattern: rug, confidence: rugConf };
  }

  // No directional pattern. Fall back to KING → structural read.
  const k = structure.king;
  if (!k) return { direction: 'none', pattern: null, confidence: 0 };
  const above = k.strike > spot;
  const positive = k.gamma > 0;
  if (!above && positive)  return { direction: 'bull', pattern: null, confidence: 0 };
  if (above && !positive)  return { direction: 'bear', pattern: null, confidence: 0 };
  if (!above && !positive) return { direction: 'bear', pattern: null, confidence: 0 };
  return { direction: 'bull', pattern: null, confidence: 0 };
}

// ---------- Playtype label (for UI/logs — no scoring role) ----------

function labelPlayType(direction, structure, spot) {
  const k = structure.king;
  if (!k) return null;
  const above = k.strike > spot;
  const positive = k.gamma > 0;
  if (direction === 'bull') {
    if (!above && positive) return 'rebound_off_support';
    if (above && positive)  return 'run_to_magnet';
    return 'reverse_rug_bounce';
  }
  if (direction === 'bear') {
    if (above && positive)  return 'reject_off_ceiling';
    if (!above && !positive) return 'cascade_through_support';
    return 'rug_setup_dump';
  }
  return null;
}

// ---------- Gatekeepers between spot and target ----------

function gatekeepersBetween(structure, spot, targetStrike) {
  if (targetStrike == null) return [];
  const lo = Math.min(spot, targetStrike);
  const hi = Math.max(spot, targetStrike);
  return structure.gatekeepers.filter(g => g.strike > lo && g.strike < hi);
}

// ---------- Grade one expiration ----------

function gradeOneExpiration({ ticker, spot, expObj, weeklyRange }) {
  const strikes = expObj.strikes;
  const { surface, structure, detections } = analyzeExpiration({
    ticker, spot, strikes, weeklyRange,
  });

  // Rainbow road → no-trade override (§3.6).
  const noTrade = detections.rainbow_road?.detected;

  // Skylit KING sits outside Giul's session zone? Downgrade — the map's real
  // pivot is too far to command this expiration's session.
  const kingInZone = kingInSessionZone(structure.king, spot);

  const dir = directionFromPatterns(detections, structure, spot);
  const playType = labelPlayType(dir.direction, structure, spot);
  const patternName = dir.pattern?.pattern || null;

  // Feed execution engine to get canonical R:R + stop + target per §6.
  // Entry node = structure.floor for calls, structure.ceiling for puts.
  let plan = null;
  if (dir.direction === 'bull' && structure.floor) {
    plan = planTrade({
      direction: 'calls',
      ticker, spot, structure, nodes: surface.nodes,
      entryNode: structure.floor,
      confluence: dir.pattern ? 'high_confidence_directional' : 'partial_alignment',
      regimeScore: surface.regimeScore,
    });
  } else if (dir.direction === 'bear' && structure.ceiling) {
    plan = planTrade({
      direction: 'puts',
      ticker, spot, structure, nodes: surface.nodes,
      entryNode: structure.ceiling,
      confluence: dir.pattern ? 'high_confidence_directional' : 'partial_alignment',
      regimeScore: surface.regimeScore,
    });
  }

  // Target strike (from planTrade first target, else fall back to opposing structure).
  const targetStrike = plan?.accepted ? plan.targets[0]?.strike : (
    dir.direction === 'bull' ? structure.ceiling?.strike :
    dir.direction === 'bear' ? structure.floor?.strike : null
  );

  const gks = gatekeepersBetween(structure, spot, targetStrike);
  const delivered = targetDeliveredThisWeek(targetStrike, dir.direction, weeklyRange);
  const rr = plan?.accepted ? plan.rr : 0;
  const rrGating = thresholds.rr_gating;

  // Reasons / downgrades for display.
  const reasons = [];
  const downgrades = [];
  if (dir.pattern) reasons.push(`${patternName}(${(dir.confidence * 100).toFixed(0)}%)`);
  if (structure.floor)   reasons.push(`floor_$${structure.floor.strike}(${(structure.floor.relativeSignificance*100).toFixed(1)}%)`);
  if (structure.ceiling) reasons.push(`ceiling_$${structure.ceiling.strike}(${(structure.ceiling.relativeSignificance*100).toFixed(1)}%)`);
  if (structure.king)    reasons.push(`king_$${structure.king.strike}(${structure.king.sign})`);
  if (plan?.accepted)    reasons.push(`rr_${rr.toFixed(2)}:1`);

  if (noTrade) downgrades.push('rainbow_road_no_trade');
  if (!kingInZone && structure.king) downgrades.push('king_outside_session_zone');
  if (!structure.floor) downgrades.push('no_floor');
  if (!structure.ceiling) downgrades.push('no_ceiling');
  if (!dir.pattern) downgrades.push('no_directional_pattern');
  if (delivered) downgrades.push('target_delivered_this_week');
  if (plan && !plan.accepted) downgrades.push(`plan_rejected_${plan.rejectReason}`);
  if (gks.length > 0) downgrades.push(`${gks.length}_gatekeepers_in_path`);

  // Grade decision.
  let grade;
  if (noTrade) {
    grade = 'C';
  } else if (
    dir.pattern &&
    dir.confidence >= A_PLUS_MIN_PATTERN_CONFIDENCE &&
    structure.floor && structure.ceiling &&
    kingInZone &&
    plan?.accepted && rr >= 3.0 &&
    !delivered &&
    gks.length === 0
  ) {
    grade = 'A+';
  } else if (
    dir.pattern &&
    dir.confidence >= A_MIN_PATTERN_CONFIDENCE &&
    plan?.accepted && rr >= 2.0 &&
    !delivered &&
    gks.length <= 1
  ) {
    grade = 'A';
  } else if (
    structure.king && kingInZone &&
    (structure.floor || structure.ceiling) &&
    plan?.accepted && rr >= rrGating.reject_below
  ) {
    grade = 'B';
  } else {
    grade = 'C';
  }

  // A rough 0-100 score for ranking within a grade tier.
  let score = 0;
  score += dir.pattern ? dir.confidence * 30 : 0;
  score += structure.floor ? 15 : 0;
  score += structure.ceiling ? 15 : 0;
  score += plan?.accepted ? Math.min(30, rr * 10) : 0;
  score += kingInZone ? 5 : 0;
  score += delivered ? 0 : 5;
  score = Math.round(score);

  return buildCard({
    ticker, spot, expObj, dir, patternName, playType,
    structure, surface, plan, targetStrike, gks, delivered,
    rr, score, grade, reasons, downgrades,
  });
}

function buildCard({
  ticker, spot, expObj, dir, patternName, playType,
  structure, surface, plan, targetStrike, gks, delivered,
  rr, score, grade, reasons, downgrades,
}) {
  const kingNode = structure.king ? {
    strike: structure.king.strike,
    gamma: structure.king.gamma,
    relSig: structure.king.relativeSignificance,
    sign: structure.king.sign,
  } : null;

  const entryNode = dir.direction === 'bull' ? structure.floor :
                    dir.direction === 'bear' ? structure.ceiling : null;
  const buyNode = entryNode ? {
    strike: entryNode.strike,
    gamma: entryNode.gamma,
    relSig: entryNode.relativeSignificance,
    sign: entryNode.sign,
  } : null;

  // Look up target node from surface for full context (relSig, sign).
  let targetNode = null;
  if (targetStrike != null) {
    const found = surface.nodes.find(n => n.strike === targetStrike);
    if (found) {
      targetNode = {
        strike: found.strike,
        gamma: found.gamma,
        relSig: found.relativeSignificance,
        sign: found.sign,
        distancePct: (found.strike - spot) / spot,
      };
    }
  }

  const targetType = targetNode
    ? (dir.direction === 'bull'
        ? (targetNode.sign === 'pika' ? 'magnet' : 'rejection_ceiling')
        : (targetNode.sign === 'pika' ? 'support_magnet' : 'cascade_zone'))
    : null;

  // Biggest blocker in the path (if any) — matches old grader's UX.
  const blocker = gks.length > 0
    ? [...gks].sort((a, b) => b.relativeSignificance - a.relativeSignificance)[0]
    : null;
  const blockerOut = blocker ? {
    strike: blocker.strike, gamma: blocker.gamma,
    relSig: blocker.relativeSignificance, sign: blocker.sign,
  } : null;

  return {
    ticker, spot,
    expiration: expObj.expiration,
    direction: dir.direction,
    grade, score, rr,
    king: kingNode,
    playType,
    patternName,
    patternConfidence: dir.confidence,
    buyNode,
    targetNode,
    targetType,
    airPocketCount: gks.length,
    blocker: blockerOut,
    delivered,
    plan: plan?.accepted ? {
      entryPrice: plan.entryPrice,
      stopStrike: plan.stopStrike,
      stopDistance: plan.stopDistance,
      targets: plan.targets,
    } : null,
    reasons,
    downgrades,
    regimeScore: surface.regimeScore,
  };
}

// ---------- Public entry point ----------

export function gradeSnapshot(snapshot, { targetExpiry = null, weeklyRange = null, maxDaysOut = 90 } = {}) {
  const { ticker, spot, allExpirations } = snapshot;
  if (!spot || !allExpirations?.length) {
    return {
      ticker, spot: spot || null,
      grade: 'C', direction: 'none', score: 0,
      reasons: [], downgrades: ['no_snapshot_data'],
    };
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() + maxDaysOut * 86400_000);
  const eligible = targetExpiry
    ? allExpirations.filter(e => e.expiration === targetExpiry)
    : allExpirations.filter(e => {
        const d = new Date(e.expiration);
        return d >= now && d <= cutoff;
      });
  if (eligible.length === 0) {
    return {
      ticker, spot,
      grade: 'C', direction: 'none', score: 0,
      reasons: [], downgrades: ['no_matching_expiry'],
    };
  }

  const cards = eligible.map(expObj => gradeOneExpiration({ ticker, spot, expObj, weeklyRange }));

  cards.sort((a, b) => {
    const gr = GRADE_RANK[b.grade] - GRADE_RANK[a.grade];
    if (gr !== 0) return gr;
    const sc = b.score - a.score;
    if (sc !== 0) return sc;
    return new Date(a.expiration) - new Date(b.expiration);
  });

  const best = cards[0];
  const otherExpiries = cards.slice(1, 4).map(c => ({
    expiration: c.expiration,
    grade: c.grade,
    direction: c.direction,
    score: c.score,
  }));

  return {
    ticker,
    spot,
    expiryUsed: best.expiration,
    grade: best.grade,
    direction: best.direction,
    score: best.score,
    rr: best.rr,
    king: best.king,
    playType: best.playType,
    patternName: best.patternName,
    patternConfidence: best.patternConfidence,
    buyNode: best.buyNode,
    targetNode: best.targetNode,
    targetType: best.targetType,
    airPocketCount: best.airPocketCount,
    blocker: best.blocker,
    delivered: best.delivered,
    plan: best.plan,
    reasons: best.reasons,
    downgrades: best.downgrades,
    regimeScore: best.regimeScore,
    otherExpiries,
  };
}
