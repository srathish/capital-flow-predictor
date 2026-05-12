/**
 * Whipsaw (defined-range chaos) — spec §3.5
 *
 *   trinity_alignment == "divergence"
 *   AND each ticker has identifiable range structure
 *   AND opposing biases > 60 magnitude on at least two tickers
 *
 * Cross-ticker pattern. Detected at the trinity layer (Sprint 4), not per-ticker.
 * Exposed here so the registry can call into it with the trinity input shape.
 *
 * Bias contribution: 0 with `no_trade_unless_extreme` flag.
 */

export const PATTERN = 'whipsaw';
export const SCORE = 0;

const MIN_OPPOSING_MAG = 60;

export function detect({ trinity }) {
  if (!trinity || !trinity.byTicker) {
    return {
      detected: false, confidence: 0, supportingStrikes: [],
      conditionsMet: [], pattern: PATTERN, score: 0, flags: [],
    };
  }

  const tickers = Object.entries(trinity.byTicker);
  const eachHasStructure = tickers.every(([, t]) => t.hasRangeStructure);
  const opposingHigh = tickers.filter(([, t]) =>
    Math.abs(t.biasScore) >= MIN_OPPOSING_MAG
  );

  const positives = opposingHigh.filter(([, t]) => t.biasScore > 0).length;
  const negatives = opposingHigh.filter(([, t]) => t.biasScore < 0).length;
  const opposingPair = positives >= 1 && negatives >= 1 && opposingHigh.length >= 2;

  if (!eachHasStructure || !opposingPair) {
    return {
      detected: false, confidence: 0, supportingStrikes: [],
      conditionsMet: [], pattern: PATTERN, score: 0, flags: [],
    };
  }

  const conditions = ['each_ticker_has_range', 'opposing_bias_pair_>60'];
  return {
    detected: true,
    confidence: Math.min(1, opposingHigh.length / 3),
    supportingStrikes: [],
    conditionsMet: conditions,
    pattern: PATTERN,
    score: SCORE,
    flags: ['caution', 'no_trade_unless_extreme'],
  };
}
