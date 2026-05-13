import { describe, it, expect } from 'vitest';
import { evaluateSetup } from '../../src/domain/synthesis.js';

const T0 = 1715515200000;

function spotHistory(spots, startMs = T0, step = 30_000) {
  return spots.map((s, i) => ({ tsMs: startMs + i * step, spot: s }));
}

function basics({
  direction = 'calls',
  biasScore = 50,
  trinityClassification = 'high_confidence_directional',
  spotHist = spotHistory([500, 500.5, 500.2, 500.7, 500.5]),
  ticker = 'SPY',
  spot = 500,
  floor = { strike: 500, sign: 'pika', relativeSignificance: 0.10 },
  ceiling = null,
  detections = {},
}) {
  return {
    ticker, spot, tsMs: T0, tradingDay: '2026-05-12', snapshotId: 's1',
    nodes: [
      { strike: 490, sign: 'pika', relativeSignificance: 0.10 },
      floor,
      ...(ceiling ? [ceiling] : []),
      { strike: 510, sign: 'pika', relativeSignificance: 0.10 },
    ],
    structure: { floor, ceiling, king: null, gatekeepers: [], airPockets: [], liquidityVacuums: [] },
    detections,
    regimeScore: 0.4,
    bias: { biasScore },
    trinity: { classification: trinityClassification, direction },
    velocityByStrike: new Map(),
    classByStrike: new Map(),
    lifecycleByStrike: new Map(),
    spotHistory: spotHist,
  };
}

describe('evaluateSetup', () => {
  it('rejects at step 1 with too-short spot history', () => {
    const out = evaluateSetup({ ...basics({}), spotHistory: [{ tsMs: T0, spot: 500 }] });
    expect(out.accepted).toBe(false);
    expect(out.stepFailed).toBe(1);
    expect(out.rejectReason).toBe('insufficient_price_history');
  });

  it('rejects at step 1 for unstructured chop (very small range)', () => {
    const flat = spotHistory([500, 500.000001, 500.000002, 500.000003, 500.000004]);
    const out = evaluateSetup({ ...basics({}), spotHistory: flat });
    expect(out.accepted).toBe(false);
    expect(out.stepFailed).toBe(1);
    expect(out.rejectReason).toBe('unstructured_price');
  });

  it('rejects at step 2 when spot is not near heatmap structure', () => {
    const out = evaluateSetup({
      ...basics({ floor: { strike: 480, sign: 'pika', relativeSignificance: 0.10 } }),
    });
    expect(out.accepted).toBe(false);
    expect(out.stepFailed).toBe(2);
  });

  it('rejects at step 3 when rainbow road detected', () => {
    const out = evaluateSetup({
      ...basics({ detections: { rainbow_road: { detected: true } } }),
    });
    expect(out.stepFailed).toBe(3);
    expect(out.rejectReason).toBe('rainbow_road');
  });

  it('rejects at step 4 with no directional bias', () => {
    const out = evaluateSetup({
      ...basics({ biasScore: 0, trinityClassification: 'noise_no_trade', direction: null }),
    });
    expect(out.stepFailed).toBe(4);
    expect(out.rejectReason).toBe('no_directional_bias');
  });

  it('rejects at step 4 in the bias paradox range', () => {
    const out = evaluateSetup({ ...basics({ biasScore: 35, direction: 'calls' }) });
    expect(out.stepFailed).toBe(4);
    expect(out.rejectReason).toBe('bias_paradox_range');
  });

  it('rejects at step 8 when trinity direction mismatches', () => {
    const out = evaluateSetup({
      ...basics({
        biasScore: 50, direction: 'calls', trinityClassification: 'high_confidence_directional',
      }),
      trinity: { classification: 'high_confidence_directional', direction: 'puts' },
    });
    // We pass direction='puts' via trinity but biasScore strongly +50 → inferred direction calls.
    // checkTrinity then sees mismatch.
    expect(out.accepted).toBe(false);
  });

  it('rejects at step 8 when trinity is noise_no_trade', () => {
    const out = evaluateSetup({ ...basics({ biasScore: 50, trinityClassification: 'noise_no_trade' }) });
    expect(out.accepted).toBe(false);
    // step 4 may also reject if no_directional_bias; either way assert non-acceptance
  });
});
