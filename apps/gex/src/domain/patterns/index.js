/**
 * Pattern registry — runs all per-ticker detectors against a snapshot.
 * Whipsaw is cross-ticker (trinity layer) and is NOT included here.
 *
 * Returns a map { pattern_name: detection_result } for the ticker.
 *
 * Hierarchy of influence (§3.7):
 *   1. Node magnitude (relative_significance)
 *   2. Gamma regime
 *   3. Pattern structure
 *   4. Cross-index alignment
 *
 * For pattern_signal contribution to bias score (§4.3 Component 1):
 *   "If multiple patterns detected, take the highest-magnitude bullish AND
 *    highest-magnitude bearish, sum them, and clamp to [-100, +100]."
 */

import * as rugSetup from './rug-setup.js';
import * as reverseRug from './reverse-rug.js';
import * as pikaCloud from './pika-cloud.js';
import * as beachBall from './beach-ball.js';
import * as rainbowRoad from './rainbow-road.js';
import * as trapdoor from './trapdoor.js';
import * as vannaPersistent from './vanna-persistent.js';
import * as overnightCarryover from './overnight-carryover.js';

const PER_TICKER_DETECTORS = [
  rugSetup, reverseRug, pikaCloud, beachBall, rainbowRoad,
  trapdoor, vannaPersistent, overnightCarryover,
];

export function runPerTickerPatterns({ ticker, nodes, spot, structure, spotHistory, previousClose }) {
  const results = {};
  for (const det of PER_TICKER_DETECTORS) {
    try {
      results[det.PATTERN] = det.detect({ ticker, nodes, spot, structure, spotHistory, previousClose });
    } catch (err) {
      results[det.PATTERN] = {
        detected: false,
        confidence: 0,
        pattern: det.PATTERN,
        score: 0,
        rejectReason: 'detector_error',
        rejectContext: { error: String(err.message || err) },
      };
    }
  }
  return results;
}

/**
 * Compute the aggregate pattern_signal contribution per §4.3 Component 1.
 * Inputs: result map from runPerTickerPatterns.
 * Output: { score, flags: [...], detectedPatterns: [...] }
 */
export function aggregatePatternSignal(detections) {
  const detected = Object.values(detections).filter(d => d.detected);
  const detectedPatterns = detected.map(d => d.pattern);

  // Collect flags
  const flags = new Set();
  for (const d of detected) {
    for (const f of (d.flags || [])) flags.add(f);
  }

  // Rainbow road no_trade overrides everything else
  if (flags.has('no_trade')) {
    return { score: 0, flags: [...flags], detectedPatterns };
  }

  // Highest-magnitude bullish + highest-magnitude bearish, sum, clamp
  let highestBull = 0;
  let highestBear = 0;
  for (const d of detected) {
    if (d.score > highestBull) highestBull = d.score;
    if (d.score < highestBear) highestBear = d.score;
  }
  const summed = highestBull + highestBear;
  const score = Math.max(-100, Math.min(100, summed));

  return { score, flags: [...flags], detectedPatterns };
}
