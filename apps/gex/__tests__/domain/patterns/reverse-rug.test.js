import { describe, it, expect } from 'vitest';
import { detect, PATTERN, SCORE } from '../../../src/domain/patterns/reverse-rug.js';
import { computeSurface } from '../../../src/domain/significance.js';

function enrich(specs, spot) {
  return computeSurface(specs, spot).nodes;
}

describe('reverse-rug', () => {
  it('exports bullish SCORE', () => {
    expect(PATTERN).toBe('reverse_rug');
    expect(SCORE).toBe(80);
  });

  it('detects pika below spot + barney just above with no opposing cluster', () => {
    const nodes = enrich(
      [
        { strike: 495, gamma: 200 },   // pika floor below spot
        { strike: 498, gamma: -50 },   // barney just above pika, below upper bound
        { strike: 500, gamma: 0.1 },   // spot
      ],
      500,
    );
    const out = detect({ nodes, spot: 500 });
    expect(out.detected).toBe(true);
    expect(out.score).toBe(80);
    expect(out.supportingStrikes).toContain(495);
    expect(out.supportingStrikes).toContain(498);
  });

  it('rejects when no qualifying pika below spot', () => {
    const nodes = enrich([{ strike: 510, gamma: 200 }], 500);
    const out = detect({ nodes, spot: 500 });
    expect(out.detected).toBe(false);
    expect(out.rejectReason).toBe('no_qualifying_pika_below_spot');
  });

  it('rejects when no qualifying barney above pika within 1% of spot', () => {
    const nodes = enrich(
      [{ strike: 495, gamma: 200 }], // pika fine, no barney at all
      500,
    );
    const out = detect({ nodes, spot: 500 });
    expect(out.detected).toBe(false);
    expect(out.rejectReason).toBe('no_qualifying_barney_above_pika');
  });
});
