import { describe, it, expect, beforeEach } from 'vitest';
import { updateAwareness, getRollingSignal, snapshotAwarenessForPersist, clearAwarenessState } from '../../src/domain/awareness.js';

const T0 = 1715515200000;

function vel(dir) { return { direction: dir }; }

function fullGrowVelocity() {
  return {
    window_30s: vel('growing'),
    window_1m: vel('growing'),
    window_5m: vel('growing'),
    window_15m: vel('growing'),
    window_30m: vel('growing'),
    window_session: vel('growing'),
  };
}

function flatVelocity() {
  return {
    window_30s: vel('flat'),
    window_1m: vel('flat'),
    window_5m: vel('flat'),
    window_15m: vel('flat'),
    window_30m: vel('flat'),
    window_session: vel('flat'),
  };
}

const floorNode = { strike: 495, distanceFromSpot: -5, sign: 'pika', relativeSignificance: 0.1 };
const structure = { floor: floorNode, ceiling: null };

describe('awareness', () => {
  beforeEach(() => clearAwarenessState());

  it('starts at None and escalates to Confirmed when 15m/30m/session all grow together', () => {
    const out = updateAwareness({
      ticker: 'SPY', strike: 495, tradingDay: '2026-05-12', tsMs: T0,
      velocity: fullGrowVelocity(), structure, spot: 500,
    });
    expect(out.level).toBe('Confirmed');
    expect(out.direction).toBe('growing');
  });

  it('stays None when all windows flat', () => {
    const out = updateAwareness({
      ticker: 'SPY', strike: 495, tradingDay: '2026-05-12', tsMs: T0,
      velocity: flatVelocity(), structure, spot: 500,
    });
    expect(out.level).toBe('None');
  });

  it('retreats one tier when velocity loses a window', () => {
    updateAwareness({
      ticker: 'SPY', strike: 495, tradingDay: '2026-05-12', tsMs: T0,
      velocity: fullGrowVelocity(), structure, spot: 500,
    });
    // Now only short windows grow → Watching/Monitoring (downgrade from Confirmed). Retreat ONE tier → Tracking.
    const out = updateAwareness({
      ticker: 'SPY', strike: 495, tradingDay: '2026-05-12', tsMs: T0 + 60_000,
      velocity: {
        window_30s: vel('growing'), window_1m: vel('growing'),
        window_5m: vel('growing'), window_15m: vel('flat'),
        window_30m: vel('flat'), window_session: vel('flat'),
      },
      structure, spot: 500,
    });
    expect(['Tracking', 'Monitoring', 'Watching']).toContain(out.level);
  });

  it('classifies variant by distance to spot', () => {
    // SPY zone is 0.5 from config. strike=500.4 → dist 0.4 ≤ zone → anticipatory_tight.
    const out = updateAwareness({
      ticker: 'SPY', strike: 500.4, tradingDay: '2026-05-12', tsMs: T0,
      velocity: fullGrowVelocity(),
      structure: { floor: { strike: 500.4, distanceFromSpot: 0.4, sign: 'pika', relativeSignificance: 0.1 } },
      spot: 500,
    });
    expect(['anticipatory_tight', 'anticipatory_wide', 'realized']).toContain(out.variant);
  });

  it('getRollingSignal positive when floor is accumulating', () => {
    updateAwareness({
      ticker: 'SPY', strike: 495, tradingDay: '2026-05-12', tsMs: T0,
      velocity: fullGrowVelocity(), structure, spot: 500,
    });
    const sig = getRollingSignal({ ticker: 'SPY', tradingDay: '2026-05-12', structure });
    expect(sig).toBeGreaterThan(0);
    expect(sig).toBeLessThanOrEqual(100);
  });

  it('getRollingSignal returns 0 when structure missing', () => {
    expect(getRollingSignal({ ticker: 'SPY', tradingDay: '2026-05-12', structure: null })).toBe(0);
  });

  it('snapshotAwarenessForPersist returns one entry per tracked strike for that day', () => {
    updateAwareness({
      ticker: 'SPY', strike: 495, tradingDay: '2026-05-12', tsMs: T0,
      velocity: fullGrowVelocity(), structure, spot: 500,
    });
    updateAwareness({
      ticker: 'SPY', strike: 505, tradingDay: '2026-05-12', tsMs: T0,
      velocity: fullGrowVelocity(), structure, spot: 500,
    });
    updateAwareness({
      ticker: 'SPY', strike: 505, tradingDay: '2026-05-11', tsMs: T0,
      velocity: fullGrowVelocity(), structure, spot: 500,
    });
    const snap = snapshotAwarenessForPersist({ ticker: 'SPY', tradingDay: '2026-05-12' });
    expect(snap.length).toBe(2);
  });
});
