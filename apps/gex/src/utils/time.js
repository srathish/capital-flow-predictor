import { DateTime } from 'luxon';

const ET = 'America/New_York';

export function nowET() {
  return DateTime.now().setZone(ET);
}

export function nowMs() {
  return Date.now();
}

export function tradingDayET(dt = nowET()) {
  return dt.toFormat('yyyy-MM-dd');
}

export function formatET(dt = nowET()) {
  return dt.toFormat('yyyy-MM-dd HH:mm:ss');
}

export function timeOfDayPhase(dt = nowET()) {
  const minutes = dt.hour * 60 + dt.minute;
  if (minutes < 13 * 60) return 'morning';
  if (minutes < 15 * 60) return 'midday';
  return 'pin_zone';
}
