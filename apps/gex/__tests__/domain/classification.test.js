import { describe, it, expect } from 'vitest';
import { classifyNode } from '../../src/domain/classification.js';

function vel(direction) {
  return { direction };
}

describe('classifyNode', () => {
  const baseNode = { strike: 500 };
  const spot = 500;

  it('Real when growing on both 5m and 15m', () => {
    const out = classifyNode({
      node: baseNode,
      velocity: { window_5m: vel('growing'), window_15m: vel('growing') },
      lifecycle: null,
      spot,
    });
    expect(out.class).toBe('Real');
    expect(out.reason).toBe('growing_5m_and_15m');
    expect(out.classModifier).toBe(1);
  });

  it('Real when tested with deflection (Delivered lifecycle) within structural range', () => {
    const out = classifyNode({
      node: { strike: 500.4 }, // < 2× SPY zone (1) from spot
      velocity: { window_5m: vel('stable'), window_15m: vel('stable') },
      lifecycle: { tap_count: 1, lifecycle_state: 'Delivered' },
      spot,
    });
    expect(out.class).toBe('Real');
    expect(out.reason).toBe('tested_with_deflection');
  });

  it('Hedge when stable+far+untested', () => {
    const out = classifyNode({
      node: { strike: 520 }, // 4% away, untested
      velocity: { window_5m: vel('stable'), window_15m: vel('stable') },
      lifecycle: null,
      spot,
    });
    expect(out.class).toBe('Hedge');
    expect(out.reason).toBe('stable_far_untested');
    expect(out.classModifier).toBe(0.3);
  });

  it('Hedge decaying gets decaying reason', () => {
    const out = classifyNode({
      node: { strike: 520 },
      velocity: { window_5m: vel('decaying'), window_15m: vel('stable') },
      lifecycle: null,
      spot,
    });
    expect(out.class).toBe('Hedge');
    expect(out.reason).toBe('decaying_far_untested');
  });

  it('Ambiguous when none of the rules apply', () => {
    const out = classifyNode({
      node: { strike: 502 },
      velocity: { window_5m: vel('stable'), window_15m: vel('growing') },
      lifecycle: null,
      spot,
    });
    expect(out.class).toBe('Ambiguous');
    expect(out.classModifier).toBe(0.6);
  });

  it('reports distancePct relative to spot', () => {
    const out = classifyNode({
      node: { strike: 505 },
      velocity: { window_5m: vel('growing'), window_15m: vel('growing') },
      lifecycle: null,
      spot: 500,
    });
    expect(out.distancePct).toBeCloseTo(0.01, 10);
  });
});
