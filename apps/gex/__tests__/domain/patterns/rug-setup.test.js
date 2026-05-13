import { describe, it, expect } from 'vitest';
import { detect, PATTERN, SCORE } from '../../../src/domain/patterns/rug-setup.js';
import { computeSurface } from '../../../src/domain/significance.js';

function enrich(specs, spot) {
  return computeSurface(specs, spot).nodes;
}

describe('rug-setup', () => {
  it('exports PATTERN name and bearish SCORE', () => {
    expect(PATTERN).toBe('rug_setup');
    expect(SCORE).toBe(-80);
  });

  it('detects when pika above spot + barney just below with no opposing cluster', () => {
    // Build a surface where a single big pika sits above spot and a barney sits just below pika.
    // We need pika.relativeSignificance >= 5% and barney >= 3%.
    const nodes = enrich(
      [
        { strike: 500, gamma: 0.1 },   // current spot — near zero so noise
        { strike: 502, gamma: -50 },   // barney just below pika
        { strike: 505, gamma: 200 },   // pika ceiling above spot
      ],
      500,
    );
    const out = detect({ nodes, spot: 500 });
    expect(out.detected).toBe(true);
    expect(out.pattern).toBe(PATTERN);
    expect(out.score).toBe(SCORE);
    expect(out.supportingStrikes).toContain(505);
    expect(out.supportingStrikes).toContain(502);
  });

  it('rejects when no pika above spot', () => {
    const nodes = enrich(
      [{ strike: 495, gamma: 200 }, { strike: 500, gamma: -50 }],
      500,
    );
    const out = detect({ nodes, spot: 500 });
    expect(out.detected).toBe(false);
    expect(out.rejectReason).toBe('no_qualifying_pika_above_spot');
  });

  it('rejects when no qualifying barney below pika', () => {
    const nodes = enrich(
      [{ strike: 510, gamma: 200 }],
      500,
    );
    const out = detect({ nodes, spot: 500 });
    expect(out.detected).toBe(false);
    expect(out.rejectReason).toBe('no_qualifying_barney_below_pika');
  });

  it('rejects when opposing pika cluster sits between spot and barney', () => {
    // Spot=500, barney=499 (just below spot, qualifies as barney<pika+within 1%),
    // pika cluster at 499.3/499.6 sits in [min(spot,barney), max(spot,barney)] = [499, 500].
    const nodes = enrich(
      [
        { strike: 499, gamma: -30 },     // barney candidate below pika ceiling
        { strike: 499.3, gamma: 30 },    // opposing pika cluster member
        { strike: 499.6, gamma: 30 },    // opposing pika cluster member
        { strike: 500, gamma: 1 },       // spot
        { strike: 505, gamma: 200 },     // pika ceiling
      ],
      500,
    );
    const out = detect({ nodes, spot: 500 });
    expect(out.detected).toBe(false);
    expect(out.rejectReason).toBe('opposing_pika_cluster_between_spot_and_barney');
  });
});
