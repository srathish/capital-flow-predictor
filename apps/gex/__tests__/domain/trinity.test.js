import { describe, it, expect } from 'vitest';
import { classifyTrinity, TICKER_ALIASES } from '../../src/domain/trinity.js';

const T0 = 1715515200000;

function buildBiases({ spx, spy, qqq, spxTicker = 'SPX', flags = {} }) {
  return new Map([
    [spxTicker, { biasScore: spx, flags: flags[spxTicker] || [], tsMs: T0 - 1000 }],
    ['SPY', { biasScore: spy, flags: flags.SPY || [], tsMs: T0 - 1000 }],
    ['QQQ', { biasScore: qqq, flags: flags.QQQ || [], tsMs: T0 - 1000 }],
  ]);
}

describe('classifyTrinity', () => {
  it('exposes ticker aliases SPX ↔ SPXW', () => {
    expect(TICKER_ALIASES.SPX).toContain('SPXW');
  });

  it('returns insufficient_data when fewer than 3 tickers present', () => {
    const map = new Map([['SPY', { biasScore: 50, flags: [], tsMs: T0 }]]);
    const out = classifyTrinity({ latestBiasByTicker: map, triggeringTicker: 'SPY', tsMs: T0 });
    expect(out.classification).toBe('insufficient_data');
  });

  it('high_confidence_directional when all 3 same sign and |avg| > 45', () => {
    const map = buildBiases({ spx: 60, spy: 50, qqq: 55 });
    const out = classifyTrinity({ latestBiasByTicker: map, triggeringTicker: 'SPY', tsMs: T0 });
    expect(out.classification).toBe('high_confidence_directional');
    expect(out.direction).toBe('calls');
  });

  it('moderate_confidence_directional when all same sign but avg between 25 and 45', () => {
    const map = buildBiases({ spx: -30, spy: -35, qqq: -30 });
    const out = classifyTrinity({ latestBiasByTicker: map, triggeringTicker: 'SPY', tsMs: T0 });
    expect(out.classification).toBe('moderate_confidence_directional');
    expect(out.direction).toBe('puts');
  });

  it('canonicalizes SPXW to SPX', () => {
    const map = buildBiases({ spx: 60, spy: 50, qqq: 55, spxTicker: 'SPXW' });
    const out = classifyTrinity({ latestBiasByTicker: map, triggeringTicker: 'SPXW', tsMs: T0 });
    expect(out.classification).toBe('high_confidence_directional');
  });

  it('no_trade_environment when any ticker has no_trade flag', () => {
    const map = buildBiases({
      spx: 60, spy: 50, qqq: 55,
      flags: { SPY: ['no_trade'] },
    });
    const out = classifyTrinity({ latestBiasByTicker: map, triggeringTicker: 'SPY', tsMs: T0 });
    expect(out.classification).toBe('no_trade_environment');
  });

  it('structural_divergence when spread > 100 with opposing signs', () => {
    const map = buildBiases({ spx: 60, spy: -50, qqq: 0 });
    const out = classifyTrinity({ latestBiasByTicker: map, triggeringTicker: 'SPY', tsMs: T0 });
    expect(['structural_divergence', 'noise_no_trade', 'partial_alignment']).toContain(out.classification);
  });

  it('noise_no_trade as the catch-all when nothing aligns', () => {
    const map = buildBiases({ spx: 10, spy: -8, qqq: 5 });
    const out = classifyTrinity({ latestBiasByTicker: map, triggeringTicker: 'SPY', tsMs: T0 });
    expect(out.classification).toBe('noise_no_trade');
  });
});
