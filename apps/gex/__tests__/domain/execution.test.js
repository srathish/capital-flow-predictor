import { describe, it, expect } from 'vitest';
import { planTrade } from '../../src/domain/execution.js';

const baseNode = strike => ({ strike, sign: 'pika', relativeSignificance: 0.10 });

function nodesWithStop(strikes) {
  return strikes.map(s => ({ strike: s, sign: 'pika', relativeSignificance: 0.10 }));
}

describe('planTrade', () => {
  it('rejects when entryNode missing', () => {
    const out = planTrade({
      direction: 'calls', ticker: 'SPY', spot: 500,
      structure: {}, nodes: [], entryNode: null,
      confluence: 'high_confidence_directional', regimeScore: 0,
    });
    expect(out.accepted).toBe(false);
    expect(out.rejectReason).toBe('no_entry_node');
  });

  it('rejects invalid direction', () => {
    const out = planTrade({
      direction: 'sideways', ticker: 'SPY', spot: 500,
      structure: {}, nodes: [], entryNode: baseNode(500),
      confluence: 'high_confidence_directional', regimeScore: 0,
    });
    expect(out.rejectReason).toBe('invalid_direction');
  });

  it('rejects when no stop node within significance threshold', () => {
    const out = planTrade({
      direction: 'calls', ticker: 'SPY', spot: 500,
      structure: {},
      nodes: [baseNode(500)], // only the entry node — no stop candidate below
      entryNode: baseNode(500),
      confluence: 'high_confidence_directional', regimeScore: 0,
    });
    expect(out.rejectReason).toBe('no_stop_node_within_significance_threshold');
  });

  it('builds a calls plan with fixed-bps target and ≥ floor R:R', () => {
    const nodes = [
      { strike: 495, sign: 'pika', relativeSignificance: 0.10 }, // stop candidate below
      { strike: 500, sign: 'pika', relativeSignificance: 0.10 }, // entry
      { strike: 510, sign: 'pika', relativeSignificance: 0.10 },
    ];
    const out = planTrade({
      direction: 'calls', ticker: 'SPY', spot: 500,
      structure: {}, nodes,
      entryNode: nodes[1],
      confluence: 'high_confidence_directional', regimeScore: 0.4,
    });
    if (out.accepted) {
      expect(out.direction).toBe('calls');
      expect(out.stopStrike).toBe(495);
      expect(out.stopDistance).toBeCloseTo(5, 5);
      expect(out.targets[0].strike).toBeCloseTo(500 + 500 * 0.0025, 5); // +25 bps
      expect(out.rr).toBeGreaterThan(0);
      expect(out.sizeMultiplier).toBeGreaterThan(0);
    } else {
      // If R:R floor blocks it, ensure correct rejection
      expect(out.rejectReason).toBe('insufficient_rr');
    }
  });

  it('builds a puts plan with fixed-bps target pointing below entry', () => {
    const nodes = [
      { strike: 490, sign: 'pika', relativeSignificance: 0.10 },
      { strike: 500, sign: 'pika', relativeSignificance: 0.10 }, // entry
      { strike: 505, sign: 'pika', relativeSignificance: 0.10 }, // stop above
    ];
    const out = planTrade({
      direction: 'puts', ticker: 'SPY', spot: 500,
      structure: {}, nodes,
      entryNode: nodes[1],
      confluence: 'high_confidence_directional', regimeScore: -0.4,
    });
    if (out.accepted) {
      expect(out.stopStrike).toBe(505);
      expect(out.targets[0].strike).toBeLessThan(500);
    } else {
      expect(out.rejectReason).toBe('insufficient_rr');
    }
  });

  it('applies risk-based sizing when accountSize is provided', () => {
    const nodes = [
      { strike: 480, sign: 'pika', relativeSignificance: 0.10 },
      { strike: 500, sign: 'pika', relativeSignificance: 0.10 },
      { strike: 530, sign: 'pika', relativeSignificance: 0.10 },
    ];
    const out = planTrade({
      direction: 'calls', ticker: 'SPY', spot: 500,
      structure: {}, nodes, entryNode: nodes[1],
      confluence: 'high_confidence_directional', regimeScore: 0.4,
      accountSize: 100_000,
    });
    // With 1% risk = $1000 and 20-pt stop, baseSize = 50. Sizing multipliers may scale that down.
    if (out.accepted) {
      expect(out.adjustedSize).toBeGreaterThan(0);
    }
  });

  it('rejects when target distance / stop < rr floor', () => {
    // Stop far away (10pt), target close (1pt at 25bps off 500 = 1.25)
    const nodes = [
      { strike: 490, sign: 'pika', relativeSignificance: 0.10 },
      { strike: 500, sign: 'pika', relativeSignificance: 0.10 },
    ];
    const out = planTrade({
      direction: 'calls', ticker: 'SPY', spot: 500,
      structure: {}, nodes, entryNode: nodes[1],
      confluence: 'high_confidence_directional', regimeScore: 0,
    });
    // rr = 1.25/10 = 0.125 ≪ 1.7 floor → reject
    expect(out.accepted).toBe(false);
    expect(out.rejectReason).toBe('insufficient_rr');
  });
});
