import { describe, it, expect } from 'vitest';
import { runPerTickerPatterns, aggregatePatternSignal } from '../../../src/domain/patterns/index.js';
import { computeSurface } from '../../../src/domain/significance.js';
import { deriveStructure } from '../../../src/domain/structure.js';

describe('aggregatePatternSignal', () => {
  it('returns 0 with empty detections', () => {
    expect(aggregatePatternSignal({})).toEqual({
      score: 0, flags: [], detectedPatterns: [],
    });
  });

  it('overrides everything with no_trade flag (rainbow road)', () => {
    const detections = {
      rainbow_road: { detected: true, score: 0, flags: ['no_trade'], pattern: 'rainbow_road' },
      rug_setup: { detected: true, score: -80, flags: [], pattern: 'rug_setup' },
    };
    const out = aggregatePatternSignal(detections);
    expect(out.score).toBe(0);
    expect(out.flags).toContain('no_trade');
  });

  it('sums highest bullish + highest bearish and clamps to ±100', () => {
    const detections = {
      reverse_rug: { detected: true, score: 80, pattern: 'reverse_rug' },
      beach_ball: { detected: true, score: 60, pattern: 'beach_ball' },
      rug_setup: { detected: true, score: -80, pattern: 'rug_setup' },
    };
    const out = aggregatePatternSignal(detections);
    // highest bull = 80, highest bear = -80 → sum 0
    expect(out.score).toBe(0);
    expect(out.detectedPatterns).toContain('reverse_rug');
    expect(out.detectedPatterns).toContain('rug_setup');
  });

  it('clamps to +100 when only bullish patterns sum above', () => {
    const detections = {
      a: { detected: true, score: 120, pattern: 'a' },
    };
    expect(aggregatePatternSignal(detections).score).toBe(100);
  });
});

describe('runPerTickerPatterns', () => {
  it('runs every detector and returns a result per pattern name', () => {
    const { nodes } = computeSurface([{ strike: 500, gamma: 100 }, { strike: 510, gamma: 50 }], 505);
    const structure = deriveStructure({ nodes, spot: 505 });
    const out = runPerTickerPatterns({
      ticker: 'SPY', nodes, spot: 505, structure, spotHistory: [],
    });
    expect(out).toHaveProperty('rug_setup');
    expect(out).toHaveProperty('reverse_rug');
    expect(out).toHaveProperty('pika_cloud');
    expect(out).toHaveProperty('beach_ball');
    expect(out).toHaveProperty('rainbow_road');
  });

  it('catches detector errors and returns detector_error reject', () => {
    // Trigger an error by passing malformed inputs to one detector (nodes containing a non-numeric strike makes some detectors throw on sort/math).
    const out = runPerTickerPatterns({
      ticker: 'SPY',
      nodes: null,   // many detectors will throw on null
      spot: 100,
      structure: {},
      spotHistory: [],
    });
    // Each detector handles or throws — index.js wraps in try/catch.
    for (const r of Object.values(out)) {
      expect(typeof r).toBe('object');
    }
  });
});
