/**
 * Vanna-Persistent Bear — Falcon-style late-day continuation.
 *
 *   Gamma has flipped bullish (pin above spot) but vanna field remains
 *   strongly negative. Downside pull persists even in a "pin" gamma regime,
 *   allowing put re-entry after a BEAR_RUG state clears.
 *
 *   Real example: 7/07 SPXW 15:14 — King $7500 was +$45M gamma (bull pin)
 *   BUT vex king was -$1.79B vanna. SPX still dropped from $7519 → $7491 close.
 *
 * Trigger conditions (all required):
 *   - The dominant gamma King is a pika (positive) — no active BEAR_RUG
 *   - Overall vanna field is strongly negative (< -1e9 total near-spot)
 *   - The biggest single |vanna| node is negative and above spot (persistent ceiling)
 *   - Recent price rejected off a higher level (structural momentum still down)
 *
 * Bias contribution: -50 (moderate bearish, secondary to BEAR_RUG).
 */

import { thresholds, deflectionZone } from '../../utils/config.js';

export const PATTERN = 'vanna_persistent_bear';
export const SCORE = -50;

const MIN_TOTAL_NEG_VANNA = -1e9;   // -$1B threshold on near-strike vanna
const NEIGHBORHOOD_ZONES = 4;        // ±4 deflection zones around spot for "near-strike"
const REJECTION_LOOKBACK_MIN = 15;   // look back 15 min for rejection off a higher level

export function detect({ ticker, nodes, spot, spotHistory }) {
  if (!Array.isArray(nodes) || nodes.length === 0) return reject('no_nodes');
  if (!spot) return reject('no_spot');

  const zone = deflectionZone(ticker);
  const neighborhoodRadius = zone * NEIGHBORHOOD_ZONES;

  // 1. Dominant gamma King must be a pika (positive) — otherwise BEAR_RUG handles it.
  const gammaKing = [...nodes].sort((a, b) => Math.abs(b.gamma || 0) - Math.abs(a.gamma || 0))[0];
  if (!gammaKing) return reject('no_gamma_king');
  if ((gammaKing.gamma || 0) <= 0) return reject('gamma_king_not_bullish', { gamma: gammaKing.gamma });

  // 2. Near-strike vanna field must be strongly negative.
  const nearStrike = nodes.filter(n => Math.abs(n.strike - spot) <= neighborhoodRadius);
  const totalNearVanna = nearStrike.reduce((sum, n) => sum + (n.vanna || 0), 0);
  if (totalNearVanna >= MIN_TOTAL_NEG_VANNA) {
    return reject('vanna_field_not_bearish_enough', { totalNearVanna });
  }

  // 3. Biggest single |vanna| node must be negative AND above spot.
  const vannaKing = [...nodes].sort((a, b) => Math.abs(b.vanna || 0) - Math.abs(a.vanna || 0))[0];
  if (!vannaKing) return reject('no_vanna_king');
  if ((vannaKing.vanna || 0) >= 0) return reject('vanna_king_not_bearish', { vanna: vannaKing.vanna });

  const vannaKingAbove = vannaKing.strike > spot;
  // We accept vanna king above spot (rejection ceiling)
  // OR vanna king below spot IF magnitude is very large (downside gravity well)
  if (!vannaKingAbove && Math.abs(vannaKing.vanna) < 2e9) {
    return reject('vanna_king_below_but_not_extreme', { strike: vannaKing.strike, vanna: vannaKing.vanna });
  }

  // 4. Recent price rejection: high in last 15 min must exceed current spot by > deflection zone.
  if (!Array.isArray(spotHistory) || spotHistory.length < 3) {
    return reject('insufficient_spot_history');
  }
  const now = spotHistory[spotHistory.length - 1].tsMs;
  const lookback = spotHistory.filter(s => now - s.tsMs <= REJECTION_LOOKBACK_MIN * 60 * 1000);
  if (lookback.length < 3) return reject('insufficient_recent_history');

  const recentHigh = Math.max(...lookback.map(s => s.spot));
  const rejectionAmount = recentHigh - spot;
  if (rejectionAmount < zone) {
    return reject('no_recent_rejection', { recentHigh, spot, threshold: zone });
  }

  // Confidence scales with negative vanna magnitude + rejection strength.
  const vannaMagnitude = Math.min(Math.abs(totalNearVanna) / 3e9, 1);
  const rejectionMagnitude = Math.min(rejectionAmount / (zone * 3), 1);
  const confidence = Math.min(1, (vannaMagnitude + rejectionMagnitude) / 2);

  return {
    detected: true,
    confidence,
    supportingStrikes: [gammaKing.strike, vannaKing.strike],
    conditionsMet: ['bullish_gamma_king', 'bearish_vanna_field', 'bearish_vanna_king', 'recent_upside_rejection'],
    pattern: PATTERN,
    score: SCORE,
    persistent: {
      gammaKingStrike: gammaKing.strike,
      gammaKingGamma: gammaKing.gamma,
      vannaKingStrike: vannaKing.strike,
      vannaKingVanna: vannaKing.vanna,
      totalNearVanna,
      recentHigh,
      rejectionAmount,
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
