/**
 * Trinity confluence classifier — spec §5.
 *
 * Inputs: latest bias score per ticker (SPX or SPXW + SPY + QQQ), each with timestamp.
 * Output classifications:
 *   - high_confidence_directional   (3/3 same sign, |avg| > 60)
 *   - moderate_confidence_directional (3/3 same sign, |avg| 30-60)
 *   - partial_alignment             (2/3 same sign, |majority| > 60)
 *   - structural_divergence         (paired-trade candidate, informational only — Overlay #4)
 *   - noise_no_trade
 *   - no_trade_environment          (any ticker has rainbow_road or whipsaw with caution flag)
 *
 * Whipsaw detection (cross-ticker) runs here too: needs the trinity divergence state.
 *
 * Staleness: trinity is evaluated when one ticker's snapshot lands. The other two tickers'
 * biases may be up to ~poll_interval old. We expose staleness in the result so calibration
 * can study it.
 */

import { thresholds } from '../utils/config.js';
import * as whipsaw from './patterns/whipsaw.js';

export const TICKER_ALIASES = {
  SPX: ['SPX', 'SPXW'],   // OpenClaw uses SPXW symbol but the spec uses SPX as label
  SPY: ['SPY'],
  QQQ: ['QQQ'],
};

function canonicalTicker(t) {
  if (t === 'SPXW') return 'SPX';
  return t;
}

/**
 * @param latestBiasByTicker  Map<ticker, { biasScore, components, flags, supportingState, tsMs }>
 * @param triggeringTicker    Which ticker's fresh snapshot triggered this evaluation
 */
export function classifyTrinity({ latestBiasByTicker, triggeringTicker, tsMs }) {
  const biases = {};
  const staleness = {};
  for (const [t, payload] of latestBiasByTicker.entries()) {
    if (!payload) continue;
    const canon = canonicalTicker(t);
    biases[canon] = payload.biasScore;
    staleness[canon] = tsMs - payload.tsMs;
    biases[`${canon}_flags`] = payload.flags || [];
  }

  const tickerKeys = ['SPX', 'SPY', 'QQQ'];
  const present = tickerKeys.filter(k => k in biases);
  if (present.length < 3) {
    return reject('insufficient_trinity_data', { present, staleness, triggeringTicker, tsMs });
  }

  // Hard exclusion: any ticker shows rainbow_road or whipsaw caution
  const noTradeFlags = tickerKeys.filter(k =>
    (biases[`${k}_flags`] || []).some(f => f === 'no_trade' || f === 'no_trade_unless_extreme')
  );
  if (noTradeFlags.length > 0) {
    return classify('no_trade_environment', {
      biases, staleness, triggeringTicker, tsMs,
      reason: 'rainbow_road_or_whipsaw_on_' + noTradeFlags.join(',')
    });
  }

  const scores = tickerKeys.map(k => biases[k]);
  const avg = (scores[0] + scores[1] + scores[2]) / 3;
  const spread = Math.max(...scores) - Math.min(...scores);
  const signs = scores.map(s => Math.sign(s));
  const allSameSign = signs.every(s => s !== 0 && s === signs[0]);
  const positives = signs.filter(s => s > 0).length;
  const negatives = signs.filter(s => s < 0).length;
  const t = thresholds.trinity_thresholds;

  let result;

  if (allSameSign && Math.abs(avg) > t.high_confidence_avg) {
    result = classify('high_confidence_directional', {
      biases, staleness, triggeringTicker, tsMs, avg, spread,
      direction: avg > 0 ? 'calls' : 'puts',
    });
  } else if (allSameSign && Math.abs(avg) > t.moderate_confidence_avg) {
    result = classify('moderate_confidence_directional', {
      biases, staleness, triggeringTicker, tsMs, avg, spread,
      direction: avg > 0 ? 'calls' : 'puts',
    });
  } else if ((positives >= 2 || negatives >= 2) && Math.abs(avg) > t.moderate_confidence_avg) {
    // 2/3 same direction with the third neutral or weakly opposing
    const majoritySign = positives >= 2 ? +1 : -1;
    const majorityScores = scores.filter(s => Math.sign(s) === majoritySign);
    const majorityMag = majorityScores.reduce((s, x) => s + Math.abs(x), 0) / majorityScores.length;
    if (majorityMag > t.high_confidence_avg) {
      result = classify('partial_alignment', {
        biases, staleness, triggeringTicker, tsMs, avg, spread,
        direction: majoritySign > 0 ? 'calls' : 'puts',
      });
    } else {
      result = classify('noise_no_trade', { biases, staleness, triggeringTicker, tsMs, avg, spread });
    }
  } else if (
    spread > t.divergence_spread &&
    positives >= 1 && negatives >= 1 &&
    scores.some(s => Math.abs(s) > t.divergence_individual_min)
  ) {
    result = classify('structural_divergence', {
      biases, staleness, triggeringTicker, tsMs, avg, spread,
      direction: 'informational_only',  // Overlay #4: V1 surfaces, does not auto-execute
    });
  } else {
    result = classify('noise_no_trade', { biases, staleness, triggeringTicker, tsMs, avg, spread });
  }

  // Whipsaw detection per §3.5 — runs at trinity layer.
  const trinityShape = {
    classification: result.classification,
    byTicker: tickerKeys.reduce((acc, k) => {
      acc[k] = {
        biasScore: biases[k],
        flags: biases[`${k}_flags`] || [],
        // hasRangeStructure heuristic: bias score is non-zero AND not flagged no_trade
        hasRangeStructure: Math.abs(biases[k]) > 10 && !(biases[`${k}_flags`] || []).includes('no_trade'),
      };
      return acc;
    }, {}),
  };
  const whipDet = whipsaw.detect({ trinity: trinityShape });
  if (whipDet.detected) {
    result.whipsaw = whipDet;
    result.flags = (result.flags || []).concat(whipDet.flags || []);
  }

  return result;
}

function classify(classification, ctx) {
  return { classification, ...ctx };
}

function reject(reason, ctx) {
  return { classification: 'insufficient_data', reason, ...ctx };
}
