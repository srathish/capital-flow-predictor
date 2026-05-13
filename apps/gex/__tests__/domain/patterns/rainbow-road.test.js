import { describe, it, expect } from 'vitest';
import { detect } from '../../../src/domain/patterns/rainbow-road.js';
import { computeSurface } from '../../../src/domain/significance.js';
import { deriveStructure } from '../../../src/domain/structure.js';

function buildSurface(specs, spot) {
  const { nodes } = computeSurface(specs, spot);
  const structure = deriveStructure({ nodes, spot });
  return { nodes, structure };
}

describe('rainbow-road', () => {
  it('detects when no node > 10%, king < 8%, no clear floor/ceiling, high entropy', () => {
    // 40 strikes of equal small gammas → each rel_sig ≈ 2.5% (below floor/ceiling 5% threshold).
    // High entropy, no concentration, no clear structure.
    const specs = [];
    for (let i = 0; i < 40; i++) specs.push({ strike: 100 + i, gamma: 1 });
    const { nodes, structure } = buildSurface(specs, 119.5);
    const out = detect({ nodes, structure });
    expect(out.detected).toBe(true);
    expect(out.flags).toContain('no_trade');
  });

  it('does not detect when a single node dominates (low entropy)', () => {
    const specs = [{ strike: 100, gamma: 1000 }, { strike: 105, gamma: 1 }, { strike: 110, gamma: 1 }];
    const { nodes, structure } = buildSurface(specs, 105);
    const out = detect({ nodes, structure });
    expect(out.detected).toBe(false);
  });

  it('returns empty_surface reject for empty input', () => {
    expect(detect({ nodes: [], structure: {} }).rejectReason).toBe('empty_surface');
  });

  it('returns zero_total_significance when all rel_sig is zero', () => {
    const nodes = [{ strike: 100, relativeSignificance: 0 }, { strike: 101, relativeSignificance: 0 }];
    const out = detect({ nodes, structure: {} });
    expect(out.rejectReason).toBe('zero_total_significance');
  });
});
