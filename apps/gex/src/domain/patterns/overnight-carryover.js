/**
 * Overnight Carryover (bearish pre-market / early-morning) — Falcon-style edge.
 *
 *   Between prior-day close and current-day open, detect gamma/vanna structural
 *   deterioration that indicates the next session opens with a bearish tilt.
 *   This catches the 08:00-10:30 ET window BEFORE the primary King node has
 *   flipped negative during the trading day.
 *
 *   Real example: 7/07 SPXW 08:45 — King was still +$5.3M pin at $7520.
 *   But a secondary node at $7550 had -$6.6M and vanna above was +$1.7B
 *   *magnet*. The overnight positioning showed dealers had accumulated short
 *   gamma above spot — a Trapdoor forming.
 *
 * Requires two snapshots: `previousClose` (yesterday's 4pm state) and current
 * `nodes` / `spot`. Caller must supply `previousClose` via the detect input.
 *
 * Trigger conditions (all required):
 *   - Any negative-gamma node ABOVE current spot within 1% distance
 *   - That node's magnitude GREW vs previous close (or wasn't there yesterday)
 *   - Overall vanna field above spot is negative (short-vanna cluster forming)
 *   - Overnight ES/SPX move is neutral to down (no strong overnight rally)
 *
 * Bias contribution: -60 (moderate-strong bearish leading indicator).
 */

import { thresholds } from '../../utils/config.js';

export const PATTERN = 'overnight_carryover';
export const SCORE = -60;

const OVERNIGHT_MOVE_TOLERANCE = 0.003; // ES up more than 0.3% overnight = skip
const ABOVE_SPOT_MAX_DIST_PCT = 0.01;   // within 1% above spot

export function detect({ nodes, spot, previousClose }) {
  if (!Array.isArray(nodes) || nodes.length === 0) return reject('no_nodes');
  if (!spot) return reject('no_spot');
  if (!previousClose) return reject('no_previous_close_snapshot');

  const prevSpot = previousClose.spot;
  const prevNodes = previousClose.nodes || [];
  if (!prevSpot) return reject('no_previous_spot');

  // 1. Overnight move check: if market gapped up strongly, this pattern doesn't apply.
  const overnightMove = (spot - prevSpot) / prevSpot;
  if (overnightMove > OVERNIGHT_MOVE_TOLERANCE) {
    return reject('overnight_gap_up_too_strong', { overnightMove });
  }

  // 2. Find negative-gamma nodes above current spot within 1% distance.
  const currentBarneysAbove = nodes.filter(n =>
    n.sign === 'barney' &&
    n.strike > spot &&
    (n.strike - spot) / spot <= ABOVE_SPOT_MAX_DIST_PCT
  ).sort((a, b) => b.relativeSignificance - a.relativeSignificance);

  if (currentBarneysAbove.length === 0) return reject('no_barney_above_spot');
  const primaryBarney = currentBarneysAbove[0];

  // 3. Compare to previous close: this barney should be larger now OR wasn't there before.
  const prevBarneyAtSameStrike = prevNodes.find(n =>
    n.sign === 'barney' && Math.abs(n.strike - primaryBarney.strike) < 1
  );
  const grew = !prevBarneyAtSameStrike ||
    primaryBarney.relativeSignificance > prevBarneyAtSameStrike.relativeSignificance * 1.1;
  if (!grew) {
    return reject('barney_not_growing', {
      currentSig: primaryBarney.relativeSignificance,
      prevSig: prevBarneyAtSameStrike?.relativeSignificance,
    });
  }

  // 4. Vanna field above spot must be net negative.
  const nodesAbove = nodes.filter(n => n.strike > spot && n.strike <= spot * 1.02);
  const totalVannaAbove = nodesAbove.reduce((sum, n) => sum + (n.vanna || 0), 0);
  if (totalVannaAbove >= 0) {
    return reject('vanna_above_not_negative', { totalVannaAbove });
  }

  // Confidence combines barney growth + vanna magnitude + how negative overnight was.
  const barneyGrowth = prevBarneyAtSameStrike
    ? primaryBarney.relativeSignificance / prevBarneyAtSameStrike.relativeSignificance
    : 2; // brand-new node = big signal
  const growthMagnitude = Math.min((barneyGrowth - 1) / 1, 1);
  const vannaMagnitude = Math.min(Math.abs(totalVannaAbove) / 1e9, 1);
  const overnightMagnitude = Math.min(Math.abs(Math.min(overnightMove, 0)) / 0.005, 1);
  const confidence = Math.min(1, (growthMagnitude + vannaMagnitude + overnightMagnitude) / 3);

  return {
    detected: true,
    confidence,
    supportingStrikes: [primaryBarney.strike],
    conditionsMet: ['barney_above_spot', 'barney_growing_overnight', 'vanna_above_negative', 'overnight_no_gap_up'],
    pattern: PATTERN,
    score: SCORE,
    carryover: {
      barneyStrike: primaryBarney.strike,
      barneyGrowthRatio: barneyGrowth,
      totalVannaAbove,
      overnightMove,
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
