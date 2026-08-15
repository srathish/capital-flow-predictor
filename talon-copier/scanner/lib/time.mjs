// time.mjs — America/New_York wall-clock <-> UTC, DST-aware. Skylit's `timestamp`
// param wants a UTC ISO instant; we always express EOD as ET wall-clock (e.g. 16:00 ET)
// and convert to the correct UTC instant regardless of EDT/EST. NO magic offsets.

const TZ = 'America/New_York';

const _fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// Offset in minutes such that (ET wall-clock) = (UTC) + offset. EDT => -240, EST => -300.
function etOffsetMinutes(utcMs) {
  const p = {};
  for (const part of _fmt.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const asIfUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asIfUTC - utcMs) / 60000);
}

// Given an ET calendar date (YYYY-MM-DD) and ET wall time "HH:MM", return the UTC instant.
export function etWallToUtc(dateStr, hhmm = '16:00') {
  const [Y, M, D] = dateStr.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  const guess = Date.UTC(Y, M - 1, D, h, m, 0);
  let off = etOffsetMinutes(guess);
  let utc = guess - off * 60000;
  // One correction pass handles the rare DST-boundary case where the offset at the
  // guessed instant differs from the offset at the resolved instant.
  const off2 = etOffsetMinutes(utc);
  if (off2 !== off) utc = guess - off2 * 60000;
  return new Date(utc);
}

// Skylit `timestamp` value (UTC ISO with ms) for a given ET date + EOD wall time.
export function skylitTimestamp(dateStr, hhmm = '16:00') {
  return etWallToUtc(dateStr, hhmm).toISOString().replace(/\.\d+Z$/, '.000Z');
}

// ET calendar date (YYYY-MM-DD) for a UTC instant (Date or ms).
export function etDate(utc) {
  const p = {};
  for (const part of _fmt.formatToParts(new Date(utc))) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

// Is this ET calendar date a weekend?
export function isWeekendET(dateStr) {
  const [Y, M, D] = dateStr.split('-').map(Number);
  // noon UTC keeps us on the same ET date regardless of DST
  const dow = new Date(Date.UTC(Y, M - 1, D, 12)).getUTCDay();
  return dow === 0 || dow === 6;
}

// US market holidays (fixed subset relevant to 2025-2026 backtests). A "session"
// pull on a holiday returns no fresh snapshot, so we skip these when walking back.
const HOLIDAYS = new Set([
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26',
  '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
]);

export function isTradingDayET(dateStr) {
  return !isWeekendET(dateStr) && !HOLIDAYS.has(dateStr);
}

// The N trading sessions strictly BEFORE `dateStr` (most recent first).
export function priorSessions(dateStr, n) {
  const out = [];
  const [Y, M, D] = dateStr.split('-').map(Number);
  let ms = Date.UTC(Y, M - 1, D, 12);
  const DAY = 86400000;
  let guard = 0;
  while (out.length < n && guard++ < n * 3 + 10) {
    ms -= DAY;
    const d = etDate(ms);
    if (isTradingDayET(d)) out.push(d);
  }
  return out;
}

// The N trading sessions strictly AFTER `dateStr` (soonest first) — used by the
// backtest resolver to walk forward through the prices we already know.
export function forwardSessions(dateStr, n) {
  const out = [];
  const [Y, M, D] = dateStr.split('-').map(Number);
  let ms = Date.UTC(Y, M - 1, D, 12);
  const DAY = 86400000;
  let guard = 0;
  while (out.length < n && guard++ < n * 3 + 10) {
    ms += DAY;
    const d = etDate(ms);
    if (isTradingDayET(d)) out.push(d);
  }
  return out;
}

export { TZ };
