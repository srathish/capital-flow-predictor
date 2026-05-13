import { describe, it, expect } from 'vitest';
import { deriveStructure, spotPositionVsNode } from '../../src/domain/structure.js';
import { computeSurface } from '../../src/domain/significance.js';

function makeNodes(specs) {
  const surf = computeSurface(specs.map(s => ({ strike: s.strike, gamma: s.gamma })), specs.spot ?? 100);
  return surf.nodes;
}

describe('deriveStructure', () => {
  it('finds floor as highest-sig pika below spot, ceiling as highest-sig pika above spot', () => {
    const nodes = makeNodes([
      { strike: 90, gamma: 50 },   // pika below — small
      { strike: 95, gamma: 200 },  // pika below — big → floor
      { strike: 100, gamma: 1 },   // weak king-candidate
      { strike: 105, gamma: 200 }, // pika above — big → ceiling
      { strike: 110, gamma: 60 },  // pika above — smaller
    ]);
    const out = deriveStructure({ nodes, spot: 100 });
    expect(out.floor.strike).toBe(95);
    expect(out.ceiling.strike).toBe(105);
    expect(out.king.strike).toBeTypeOf('number');
  });

  it('returns null floor/ceiling when no pika nodes', () => {
    const nodes = makeNodes([
      { strike: 95, gamma: -10 },
      { strike: 105, gamma: -10 },
    ]);
    const out = deriveStructure({ nodes, spot: 100 });
    expect(out.floor).toBeNull();
    expect(out.ceiling).toBeNull();
  });

  it('drops floor/ceiling that fall below min-significance gate', () => {
    // Many small nodes so any single node has < 5% relative significance
    const specs = [];
    for (let s = 80; s <= 120; s += 1) specs.push({ strike: s, gamma: s === 100 ? 0 : 1 });
    const nodes = makeNodes(specs);
    const out = deriveStructure({ nodes, spot: 100 });
    expect(out.floor).toBeNull();
    expect(out.ceiling).toBeNull();
  });

  it('finds gatekeepers between floor and ceiling anchors', () => {
    const nodes = makeNodes([
      { strike: 90, gamma: 50 },    // floor candidate
      { strike: 95, gamma: 20 },    // gatekeeper candidate (between floor + king/ceiling)
      { strike: 100, gamma: 100 },  // king
      { strike: 105, gamma: 20 },   // gatekeeper candidate
      { strike: 110, gamma: 50 },   // ceiling candidate
    ]);
    const out = deriveStructure({ nodes, spot: 100 });
    expect(out.floor).toBeTruthy();
    expect(out.ceiling).toBeTruthy();
    // 95 and 105 sit between floor(90) and ceiling(110), with rel_sig > 3% in this distribution.
    const gkStrikes = out.gatekeepers.map(g => g.strike).sort((a, b) => a - b);
    expect(gkStrikes).toContain(95);
    expect(gkStrikes).toContain(105);
    // Anchors themselves are excluded
    expect(gkStrikes).not.toContain(90);
    expect(gkStrikes).not.toContain(110);
  });

  it('returns no gatekeepers when fewer than 2 anchors exist', () => {
    const nodes = makeNodes([
      { strike: 100, gamma: 50 },
      { strike: 105, gamma: 30 },
    ]);
    const out = deriveStructure({ nodes, spot: 100 });
    expect(out.gatekeepers).toEqual([]);
  });

  it('detects air pockets and liquidity vacuums spanning ≥3% of spot', () => {
    // Build wide gap of weak strikes between two anchors.
    const specs = [
      { strike: 90, gamma: 1000 },   // strong floor
      // Air pocket of weak strikes:
      { strike: 95, gamma: 1 },
      { strike: 100, gamma: 1 },
      { strike: 105, gamma: 1 },
      { strike: 110, gamma: 1000 },  // strong ceiling
    ];
    const nodes = makeNodes(specs);
    const out = deriveStructure({ nodes, spot: 100 });
    expect(out.airPockets.length).toBeGreaterThan(0);
    // 100 → 3% vacuum threshold = 3. Pocket span 95→105 = 10 ≥ 3, so it is a vacuum.
    expect(out.liquidityVacuums.length).toBeGreaterThan(0);
  });
});

describe('spotPositionVsNode', () => {
  const node = { strike: 100 };
  const zone = 0.5;

  it('returns "absent" when node missing', () => {
    expect(spotPositionVsNode(100, null, 0.5)).toBe('absent');
  });

  it('categorizes by distance / zone', () => {
    expect(spotPositionVsNode(102, node, zone)).toBe('well_above'); // 2 > 2*z
    expect(spotPositionVsNode(100.75, node, zone)).toBe('just_above'); // z < d <= 2z
    expect(spotPositionVsNode(100, node, zone)).toBe('at');
    expect(spotPositionVsNode(100.25, node, zone)).toBe('at'); // within ±z is "at"
    expect(spotPositionVsNode(99.25, node, zone)).toBe('just_below');
    expect(spotPositionVsNode(98, node, zone)).toBe('well_below');
  });
});
