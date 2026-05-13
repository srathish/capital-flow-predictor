import { describe, it, expect } from 'vitest';
import { detect } from '../../../src/domain/patterns/pika-cloud.js';
import { computeSurface } from '../../../src/domain/significance.js';

describe('pika-cloud', () => {
  it('detects when ≥3 adjacent pika nodes total ≥15% over ≤5% span', () => {
    // Cluster of 4 pika strikes between 100 and 101.5 (1.5% span of 100 spot, ~95% total sig).
    // Bracket with barney nodes so the pika run breaks cleanly on both sides.
    const specs = [
      { strike: 90, gamma: -1 },     // barney — breaks run
      { strike: 100, gamma: 10 },
      { strike: 100.5, gamma: 10 },
      { strike: 101, gamma: 10 },
      { strike: 101.5, gamma: 10 },
      { strike: 110, gamma: -1 },    // barney — breaks run
    ];
    const { nodes } = computeSurface(specs, 100);
    const out = detect({ nodes, spot: 100 });
    expect(out.detected).toBe(true);
    expect(out.flags).toContain('chop');
    expect(out.cluster.strikes.length).toBeGreaterThanOrEqual(3);
  });

  it('does not detect when cluster size < 3', () => {
    const specs = [
      { strike: 100, gamma: 30 },
      { strike: 100.5, gamma: 30 },
      { strike: 110, gamma: 1 },
    ];
    const { nodes } = computeSurface(specs, 100);
    const out = detect({ nodes, spot: 100 });
    expect(out.detected).toBe(false);
  });

  it('does not detect when cluster span > 5% of spot', () => {
    const specs = [
      { strike: 100, gamma: 10 },
      { strike: 105, gamma: 10 },
      { strike: 110, gamma: 10 },
    ];
    const { nodes } = computeSurface(specs, 100);
    const out = detect({ nodes, spot: 100 });
    expect(out.detected).toBe(false);
  });

  it('does not detect when total significance < 15%', () => {
    const specs = [];
    // Many tiny nodes — adjacent but each well below member threshold
    for (let s = 99.5; s <= 102; s += 0.5) specs.push({ strike: s, gamma: 1 });
    for (let i = 0; i < 100; i++) specs.push({ strike: 50 + i, gamma: 1 });
    const { nodes } = computeSurface(specs, 100);
    const out = detect({ nodes, spot: 100 });
    expect(out.detected).toBe(false);
  });
});
