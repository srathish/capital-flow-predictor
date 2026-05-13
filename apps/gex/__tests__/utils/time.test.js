import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { tradingDayET, formatET, timeOfDayPhase, nowET, nowMs } from '../../src/utils/time.js';

describe('time utils', () => {
  it('tradingDayET formats yyyy-MM-dd in America/New_York', () => {
    const dt = DateTime.fromISO('2026-05-12T15:30:00', { zone: 'America/New_York' });
    expect(tradingDayET(dt)).toBe('2026-05-12');
  });

  it('formatET produces yyyy-MM-dd HH:mm:ss', () => {
    const dt = DateTime.fromISO('2026-05-12T09:30:00', { zone: 'America/New_York' });
    expect(formatET(dt)).toBe('2026-05-12 09:30:00');
  });

  it('timeOfDayPhase: morning before 13:00 ET', () => {
    const dt = DateTime.fromISO('2026-05-12T10:00:00', { zone: 'America/New_York' });
    expect(timeOfDayPhase(dt)).toBe('morning');
  });

  it('timeOfDayPhase: midday between 13:00 and 15:00 ET', () => {
    const dt = DateTime.fromISO('2026-05-12T14:00:00', { zone: 'America/New_York' });
    expect(timeOfDayPhase(dt)).toBe('midday');
  });

  it('timeOfDayPhase: pin_zone after 15:00 ET', () => {
    const dt = DateTime.fromISO('2026-05-12T15:30:00', { zone: 'America/New_York' });
    expect(timeOfDayPhase(dt)).toBe('pin_zone');
  });

  it('nowET / nowMs return DateTime + number respectively', () => {
    expect(typeof nowMs()).toBe('number');
    expect(nowET().zoneName).toBe('America/New_York');
  });
});
