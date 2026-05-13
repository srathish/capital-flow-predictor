import { describe, it, expect, beforeEach } from 'vitest';
import { recordSample, computeVelocity, clearVelocityState } from '../../src/domain/velocity.js';

describe('velocity', () => {
  beforeEach(() => clearVelocityState());

  const ticker = 'SPY';
  const strike = 500;
  const tradingDay = '2026-05-12';
  const T0 = 1715515200000; // arbitrary ms epoch

  it('returns flat for every window with no samples', () => {
    const v = computeVelocity({ ticker, strike, tradingDay, tsMs: T0, relativeSignificance: 0.1 });
    for (const w of Object.values(v)) {
      expect(w.delta).toBe(0);
      expect(w.deltaPerMin).toBe(0);
      expect(w.direction).toBe('flat');
    }
  });

  it('window_5m classifies as growing when Δ ≥ 0.10 pp/min', () => {
    // Record an old sample 5 minutes ago at 0.10 rel-sig, then current at 0.20.
    // That's a 10 pp jump over 5 min = 2 pp/min, well above the 0.10 growing threshold.
    recordSample({ ticker, strike, tradingDay, tsMs: T0, relativeSignificance: 0.10 });
    const tsNow = T0 + 5 * 60 * 1000;
    recordSample({ ticker, strike, tradingDay, tsMs: tsNow, relativeSignificance: 0.20 });

    const v = computeVelocity({ ticker, strike, tradingDay, tsMs: tsNow, relativeSignificance: 0.20 });
    expect(v.window_5m.direction).toBe('growing');
    expect(v.window_5m.deltaPerMin).toBeGreaterThan(0);
  });

  it('window_5m classifies as decaying when Δ ≤ -0.10 pp/min', () => {
    recordSample({ ticker, strike, tradingDay, tsMs: T0, relativeSignificance: 0.20 });
    const tsNow = T0 + 5 * 60 * 1000;
    recordSample({ ticker, strike, tradingDay, tsMs: tsNow, relativeSignificance: 0.10 });

    const v = computeVelocity({ ticker, strike, tradingDay, tsMs: tsNow, relativeSignificance: 0.10 });
    expect(v.window_5m.direction).toBe('decaying');
    expect(v.window_5m.deltaPerMin).toBeLessThan(0);
  });

  it('stable when delta within threshold band', () => {
    recordSample({ ticker, strike, tradingDay, tsMs: T0, relativeSignificance: 0.10 });
    const tsNow = T0 + 5 * 60 * 1000;
    // Δ = 0.0001 (1 bp) over 5 min → 0.02 pp / 5min = 0.004 pp/min, below 0.10 growing
    recordSample({ ticker, strike, tradingDay, tsMs: tsNow, relativeSignificance: 0.1001 });

    const v = computeVelocity({ ticker, strike, tradingDay, tsMs: tsNow, relativeSignificance: 0.1001 });
    expect(v.window_5m.direction).toBe('stable');
  });

  it('window_session uses the first sample of the day', () => {
    recordSample({ ticker, strike, tradingDay, tsMs: T0, relativeSignificance: 0.05 });
    const tsNow = T0 + 60 * 60 * 1000; // 60 minutes later
    recordSample({ ticker, strike, tradingDay, tsMs: tsNow, relativeSignificance: 0.25 });

    const v = computeVelocity({ ticker, strike, tradingDay, tsMs: tsNow, relativeSignificance: 0.25 });
    expect(v.window_session.delta).toBeCloseTo(20, 5); // 0.25-0.05 = 0.20 → 20 pp
    // Spec: session window has no threshold → direction always 'flat' from classify()
    expect(v.window_session.direction).toBe('flat');
  });

  it('prunes samples older than horizon (~31 min)', () => {
    recordSample({ ticker, strike, tradingDay, tsMs: T0, relativeSignificance: 0.10 });
    // ~32 minutes later — older sample should be pruned out of the rolling buffer.
    const tsLate = T0 + 32 * 60 * 1000;
    recordSample({ ticker, strike, tradingDay, tsMs: tsLate, relativeSignificance: 0.15 });

    const v = computeVelocity({ ticker, strike, tradingDay, tsMs: tsLate, relativeSignificance: 0.15 });
    // 30m window: after pruning, only the current sample remains in the buffer →
    // pastValue == current → delta ~0 → 'stable' (between thresholds).
    expect(['flat', 'stable']).toContain(v.window_30m.direction);
    // Session window still tracks the original first-of-day sample.
    expect(v.window_session.delta).toBeCloseTo(5, 5);
  });

  it('clearVelocityState wipes buffers and session opens', () => {
    recordSample({ ticker, strike, tradingDay, tsMs: T0, relativeSignificance: 0.10 });
    clearVelocityState();
    const v = computeVelocity({ ticker, strike, tradingDay, tsMs: T0 + 5 * 60 * 1000, relativeSignificance: 0.20 });
    expect(v.window_session.delta).toBe(0);
  });
});
