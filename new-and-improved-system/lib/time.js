// ET ↔ UTC helpers (US DST: 2nd Sunday of March → 1st Sunday of November).
function nthSunday(year, month /*0-11*/, n) { const d = new Date(Date.UTC(year, month, 1)); const first = (7 - d.getUTCDay()) % 7 + 1; return first + 7 * (n - 1); }
export function etOffsetHours(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dstStart = Date.UTC(y, 2, nthSunday(y, 2, 2)), dstEnd = Date.UTC(y, 10, nthSunday(y, 10, 1));
  const t = Date.UTC(y, m - 1, d);
  return t >= dstStart && t < dstEnd ? 4 : 5;
}
/** 'YYYY-MM-DD' + 'HH:MM' (ET) → unix seconds */
export function etToUnix(dateStr, hhmm) { const [h, mi] = hhmm.split(':').map(Number); const [y, m, d] = dateStr.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d, h + etOffsetHours(dateStr), mi) / 1000); }
export const iso = (unix) => new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const todayET = () => { const n = new Date(); const et = new Date(n.getTime() - 4 * 3600e3); return et.toISOString().slice(0, 10); };
