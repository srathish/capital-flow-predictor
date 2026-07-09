import { describe, it, expect } from 'vitest';
import {
  TAPE_TICKERS, bullTapeGateMode, evaluateBullTapeGate,
  recordBullTapeGateFire, bullTapeGateStats,
} from '../../src/tracker/bull-tape-gate.js';

const tape = (spy, qqq, spxw) => ({
  SPY: { spot: spy[0], priorClose: spy[1] },
  QQQ: { spot: qqq[0], priorClose: qqq[1] },
  SPXW: { spot: spxw[0], priorClose: spxw[1] },
});

describe('bullTapeGateMode', () => {
  it('is off when unset, false, or garbage', () => {
    expect(bullTapeGateMode({})).toBe('off');
    expect(bullTapeGateMode({ ENABLE_BULL_TAPE_GATE: 'false' })).toBe('off');
    expect(bullTapeGateMode({ ENABLE_BULL_TAPE_GATE: '1' })).toBe('off');
    expect(bullTapeGateMode({ ENABLE_BULL_TAPE_GATE: 'TRUE' })).toBe('off');
  });
  it('is on for "true" and dry for "dry"', () => {
    expect(bullTapeGateMode({ ENABLE_BULL_TAPE_GATE: 'true' })).toBe('on');
    expect(bullTapeGateMode({ ENABLE_BULL_TAPE_GATE: 'dry' })).toBe('dry');
  });
});

describe('evaluateBullTapeGate', () => {
  it('blocks when SPY, QQQ, and SPX are ALL below prior close', () => {
    const v = evaluateBullTapeGate(tape([748, 750], [714, 716], [6740, 6760]));
    expect(v.pass).toBe(false);
    expect(v.reason).toBe('SPY_QQQ_SPX_BELOW_PRIOR_CLOSE');
    expect(v.data.spy_current).toBe(748);
    expect(v.data.spy_prior_close).toBe(750);
    expect(v.data.spxw_current).toBe(6740);
  });

  it('allows when any single index is above prior close', () => {
    expect(evaluateBullTapeGate(tape([751, 750], [714, 716], [6740, 6760])).pass).toBe(true);
    expect(evaluateBullTapeGate(tape([748, 750], [717, 716], [6740, 6760])).pass).toBe(true);
    expect(evaluateBullTapeGate(tape([748, 750], [714, 716], [6761, 6760])).pass).toBe(true);
  });

  it('allows when all three are above prior close', () => {
    expect(evaluateBullTapeGate(tape([751, 750], [717, 716], [6761, 6760])).pass).toBe(true);
  });

  it('treats exactly-at-prior-close as NOT below (allows)', () => {
    expect(evaluateBullTapeGate(tape([750, 750], [714, 716], [6740, 6760])).pass).toBe(true);
  });

  it('returns unknown and never blocks on missing spot', () => {
    const v = evaluateBullTapeGate(tape([null, 750], [714, 716], [6740, 6760]));
    expect(v.pass).toBe('unknown');
    expect(v.reason).toBe('missing_tape_gate_data');
    expect(v.missing).toContain('SPY_current');
  });

  it('returns unknown on missing prior close', () => {
    const v = evaluateBullTapeGate(tape([748, 750], [714, null], [6740, 6760]));
    expect(v.pass).toBe('unknown');
    expect(v.missing).toContain('QQQ_prior_close');
  });

  it('returns unknown on NaN or absent ticker', () => {
    expect(evaluateBullTapeGate(tape([NaN, 750], [714, 716], [6740, 6760])).pass).toBe('unknown');
    expect(evaluateBullTapeGate({ SPY: { spot: 748, priorClose: 750 } }).pass).toBe('unknown');
    expect(evaluateBullTapeGate(undefined).pass).toBe('unknown');
  });

  it('covers exactly SPY/QQQ/SPXW', () => {
    expect(TAPE_TICKERS).toEqual(['SPY', 'QQQ', 'SPXW']);
  });
});

describe('recordBullTapeGateFire counters (validation summary)', () => {
  it('tracks bulls blocked/allowed/missing and leaves bears unaffected', () => {
    const before = bullTapeGateStats();
    recordBullTapeGateFire({ dir: 1, verdict: { pass: false }, mode: 'on' });
    recordBullTapeGateFire({ dir: 1, verdict: { pass: false }, mode: 'dry' });
    recordBullTapeGateFire({ dir: 1, verdict: { pass: true }, mode: 'on' });
    recordBullTapeGateFire({ dir: 1, verdict: { pass: 'unknown' }, mode: 'on' });
    recordBullTapeGateFire({ dir: -1, verdict: { pass: true }, mode: 'on' });
    const s = bullTapeGateStats();
    expect(s.bull_fires - before.bull_fires).toBe(4);
    expect(s.bull_blocked - before.bull_blocked).toBe(1);          // 'on' block
    expect(s.bull_would_block - before.bull_would_block).toBe(1);  // dry never blocks
    expect(s.bull_allowed - before.bull_allowed).toBe(3);          // dry + pass + unknown
    expect(s.bull_missing_data - before.bull_missing_data).toBe(1);
    expect(s.bear_fires_unaffected - before.bear_fires_unaffected).toBe(1);
  });
});
