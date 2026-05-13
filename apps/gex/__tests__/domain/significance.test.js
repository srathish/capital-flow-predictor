import { describe, it, expect } from 'vitest';
import { computeSurface } from '../../src/domain/significance.js';

describe('computeSurface', () => {
  it('returns zero surface when no gamma anywhere', () => {
    const out = computeSurface(
      [{ strike: 100, gamma: 0 }, { strike: 105, gamma: 0 }],
      100,
    );
    expect(out.totalAbs).toBe(0);
    expect(out.signedTotal).toBe(0);
    expect(out.regimeScore).toBe(0);
    expect(out.kingStrike).toBeNull();
    expect(out.kingGamma).toBe(0);
    expect(out.nodes).toHaveLength(2);
    for (const n of out.nodes) {
      expect(n.absGamma).toBe(0);
      expect(n.sign).toBe('zero');
      expect(n.relativeSignificance).toBe(0);
      expect(n.isKing).toBe(false);
    }
  });

  it('normalizes absolute gamma to a relative-significance distribution that sums to 1', () => {
    const nodes = [
      { strike: 100, gamma: 10 },
      { strike: 105, gamma: -20 },
      { strike: 95, gamma: 30 },
    ];
    const out = computeSurface(nodes, 100);

    const sum = out.nodes.reduce((s, n) => s + n.relativeSignificance, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(out.totalAbs).toBe(60);
    expect(out.signedTotal).toBe(20);
    expect(out.regimeScore).toBeCloseTo(20 / 60, 10);
  });

  it('flags the largest-|gamma| node as king', () => {
    const out = computeSurface(
      [{ strike: 100, gamma: 5 }, { strike: 110, gamma: -50 }, { strike: 120, gamma: 7 }],
      100,
    );
    expect(out.kingStrike).toBe(110);
    expect(out.kingGamma).toBe(-50);
    const kingNode = out.nodes.find(n => n.isKing);
    expect(kingNode.strike).toBe(110);
    expect(kingNode.sign).toBe('barney');
  });

  it('labels signs correctly: positive → pika, negative → barney, zero → zero', () => {
    const out = computeSurface(
      [{ strike: 90, gamma: 1 }, { strike: 100, gamma: -1 }, { strike: 110, gamma: 0 }],
      100,
    );
    const byStrike = Object.fromEntries(out.nodes.map(n => [n.strike, n]));
    expect(byStrike[90].sign).toBe('pika');
    expect(byStrike[100].sign).toBe('barney');
    expect(byStrike[110].sign).toBe('zero');
  });

  it('reports signed distanceFromSpot per node', () => {
    const out = computeSurface([{ strike: 95, gamma: 1 }, { strike: 105, gamma: 1 }], 100);
    const byStrike = Object.fromEntries(out.nodes.map(n => [n.strike, n]));
    expect(byStrike[95].distanceFromSpot).toBe(-5);
    expect(byStrike[105].distanceFromSpot).toBe(5);
  });

  it('regimeScore is +1 when all gamma is pika, -1 when all barney', () => {
    const pos = computeSurface([{ strike: 100, gamma: 1 }, { strike: 110, gamma: 4 }], 100);
    expect(pos.regimeScore).toBe(1);
    const neg = computeSurface([{ strike: 100, gamma: -2 }, { strike: 110, gamma: -3 }], 100);
    expect(neg.regimeScore).toBe(-1);
  });

  it('picks first index as king on ties', () => {
    const out = computeSurface(
      [{ strike: 100, gamma: 10 }, { strike: 105, gamma: 10 }, { strike: 110, gamma: 10 }],
      100,
    );
    expect(out.kingStrike).toBe(100);
  });
});
