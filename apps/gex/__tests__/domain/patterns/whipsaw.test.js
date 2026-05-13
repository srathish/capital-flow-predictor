import { describe, it, expect } from 'vitest';
import { detect } from '../../../src/domain/patterns/whipsaw.js';

describe('whipsaw', () => {
  it('returns not-detected on empty input', () => {
    expect(detect({ trinity: null }).detected).toBe(false);
    expect(detect({ trinity: {} }).detected).toBe(false);
  });

  it('detects when each ticker has range structure and ≥1 positive + ≥1 negative with |bias|≥60', () => {
    const trinity = {
      byTicker: {
        SPX: { biasScore: +70, hasRangeStructure: true, flags: [] },
        SPY: { biasScore: -65, hasRangeStructure: true, flags: [] },
        QQQ: { biasScore: +20, hasRangeStructure: true, flags: [] },
      },
    };
    const out = detect({ trinity });
    expect(out.detected).toBe(true);
    expect(out.flags).toContain('caution');
    expect(out.flags).toContain('no_trade_unless_extreme');
  });

  it('does not detect when one ticker lacks range structure', () => {
    const trinity = {
      byTicker: {
        SPX: { biasScore: +70, hasRangeStructure: false, flags: [] },
        SPY: { biasScore: -70, hasRangeStructure: true, flags: [] },
        QQQ: { biasScore: 0, hasRangeStructure: true, flags: [] },
      },
    };
    expect(detect({ trinity }).detected).toBe(false);
  });

  it('does not detect when no opposing-pair with magnitude ≥60', () => {
    const trinity = {
      byTicker: {
        SPX: { biasScore: +30, hasRangeStructure: true, flags: [] },
        SPY: { biasScore: -30, hasRangeStructure: true, flags: [] },
        QQQ: { biasScore: 0, hasRangeStructure: true, flags: [] },
      },
    };
    expect(detect({ trinity }).detected).toBe(false);
  });
});
