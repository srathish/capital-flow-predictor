import { describe, it, expect, beforeEach } from 'vitest';
import { computeBiasScore } from '../../src/domain/bias.js';
import { clearAwarenessState } from '../../src/domain/awareness.js';

const T0 = 1715515200000;

const baseFloor = { strike: 500, sign: 'pika', relativeSignificance: 0.10, distanceFromSpot: 0 };
const baseCeiling = { strike: 510, sign: 'pika', relativeSignificance: 0.10, distanceFromSpot: 10 };
const baseKing = { strike: 500, sign: 'pika', relativeSignificance: 0.20, distanceFromSpot: 0, isKing: true };

const baseStructure = {
  floor: baseFloor, ceiling: baseCeiling, king: baseKing,
  gatekeepers: [], airPockets: [], liquidityVacuums: [],
};

const baseNodes = [baseFloor, baseCeiling, baseKing];

describe('computeBiasScore', () => {
  beforeEach(() => clearAwarenessState());

  it('clamps output to [-100, +100]', () => {
    const out = computeBiasScore({
      ticker: 'SPY', tradingDay: '2026-05-12', spot: 500, regimeScore: 0.5,
      nodes: baseNodes, structure: baseStructure, detections: {},
      velocityByStrike: new Map(),
      classByStrike: new Map(),
      lifecycleByStrike: new Map(),
    });
    expect(out.biasScore).toBeGreaterThanOrEqual(-100);
    expect(out.biasScore).toBeLessThanOrEqual(100);
  });

  it('exposes weighted component scores and supportingState', () => {
    const out = computeBiasScore({
      ticker: 'SPY', tradingDay: '2026-05-12', spot: 500, regimeScore: 0,
      nodes: baseNodes, structure: baseStructure, detections: {},
      velocityByStrike: new Map(),
      classByStrike: new Map(),
      lifecycleByStrike: new Map(),
    });
    expect(out.components).toHaveProperty('pattern_signal');
    expect(out.components).toHaveProperty('king_node_position');
    expect(out.components).toHaveProperty('floor_ceiling_proximity');
    expect(out.components).toHaveProperty('regime_modifier');
    expect(out.components).toHaveProperty('velocity_signal');
    expect(out.components).toHaveProperty('rolling_signal');
    expect(out.supportingState.kingStrike).toBe(500);
    expect(out.supportingState.spot).toBe(500);
  });

  it('returns 0 king_node_position when structure has no king', () => {
    const out = computeBiasScore({
      ticker: 'SPY', tradingDay: '2026-05-12', spot: 500, regimeScore: 0,
      nodes: [], structure: { floor: null, ceiling: null, king: null, gatekeepers: [], airPockets: [], liquidityVacuums: [] },
      detections: {},
      velocityByStrike: new Map(),
      classByStrike: new Map(),
      lifecycleByStrike: new Map(),
    });
    expect(out.components.king_node_position).toBe(0);
  });

  it('boosts bias when patterns detected (bullish reverse_rug)', () => {
    const noPattern = computeBiasScore({
      ticker: 'SPY', tradingDay: '2026-05-12', spot: 500, regimeScore: 0,
      nodes: baseNodes, structure: baseStructure, detections: {},
      velocityByStrike: new Map(), classByStrike: new Map(), lifecycleByStrike: new Map(),
    });
    const withPattern = computeBiasScore({
      ticker: 'SPY', tradingDay: '2026-05-12', spot: 500, regimeScore: 0,
      nodes: baseNodes, structure: baseStructure,
      detections: { reverse_rug: { detected: true, score: 80, pattern: 'reverse_rug' } },
      velocityByStrike: new Map(), classByStrike: new Map(), lifecycleByStrike: new Map(),
    });
    expect(withPattern.biasScore).toBeGreaterThan(noPattern.biasScore);
  });

  it('zeroes pattern contribution when rainbow_road sets no_trade flag', () => {
    const out = computeBiasScore({
      ticker: 'SPY', tradingDay: '2026-05-12', spot: 500, regimeScore: 0,
      nodes: baseNodes, structure: baseStructure,
      detections: { rainbow_road: { detected: true, score: 0, flags: ['no_trade'], pattern: 'rainbow_road' } },
      velocityByStrike: new Map(), classByStrike: new Map(), lifecycleByStrike: new Map(),
    });
    expect(out.components.pattern_signal).toBe(0);
    expect(out.flags).toContain('no_trade');
  });
});
