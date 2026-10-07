// Clean daily price layer (2026-10-06). UW daily history has (a) bars on NYSE holidays carrying unadjusted prices (e.g. EXLS ×5
// on MLK Day 2010, Good Friday 2013 — a month-end) and (b) stretches where a split was not adjusted (EXLS ×5 from 2022-07 to its
// 2023-08 5:1 split). This module: merges old + new UW files, drops bars that are not NYSE trading days, and marks a
// quarantine window around every persistent level jump at a clean split ratio. Loaders treat quarantined dates as unusable
// (no eligibility, no returns crossing them). Nothing is "repaired" — a guessed repair could erase a real crash.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache');
const iso = (d) => d.toISOString().slice(0, 10), U = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const nthDow = (y, m, dow, n) => { const d = U(y, m, 1); const off = (dow - d.getUTCDay() + 7) % 7; return U(y, m, 1 + off + 7 * (n - 1)); };
const lastDow = (y, m, dow) => { const d = U(y, m + 1, 0); return U(y, m, d.getUTCDate() - ((d.getUTCDay() - dow + 7) % 7)); };
const observed = (d) => { const w = d.getUTCDay(); return w === 6 ? new Date(d - 864e5) : w === 0 ? new Date(+d + 864e5) : d; };
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return U(y, mo, da); }
const HOL = new Set(['2012-10-29', '2012-10-30', '2018-12-05', '2025-01-09']); // special closures: Hurricane Sandy, Bush and Carter mourning days
for (let y = 2009; y <= 2027; y++) {
  const ny = U(y, 1, 1); if (ny.getUTCDay() !== 6) HOL.add(iso(observed(ny))); // NYSE does not observe New Year's on the prior Friday
  HOL.add(iso(nthDow(y, 1, 1, 3))); HOL.add(iso(nthDow(y, 2, 1, 3))); HOL.add(iso(new Date(+easter(y) - 2 * 864e5))); HOL.add(iso(lastDow(y, 5, 1)));
  if (y >= 2022) HOL.add(iso(observed(U(y, 6, 19)))); HOL.add(iso(observed(U(y, 7, 4)))); HOL.add(iso(nthDow(y, 9, 1, 1))); HOL.add(iso(nthDow(y, 11, 4, 4))); HOL.add(iso(observed(U(y, 12, 25)))); }
export const isTradingDay = (d) => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w !== 0 && w !== 6 && !HOL.has(d); };
const SPLITQ = [2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 100];
const rd = (f) => { try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; } catch { return []; } };
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
// bars: merged + trading days only; bad: [{from, to, at, r}] quarantine windows (200 days before, 400 after each suspect jump)
export function cleanBars(t, { hist = true } = {}) {
  const raw = [...(hist ? rd(path.join(C, 'wdaily_hist', `${t}.json`)) : []), ...rd(path.join(C, 'wdaily', `${t}.json`))], seen = new Set(), bars = [];
  for (const b of raw.sort((x, y) => x.d.localeCompare(y.d))) if (isTradingDay(b.d) && !seen.has(b.d) && b.c > 0) { seen.add(b.d); bars.push(b); }
  const bad = [];
  for (let i = 1; i < bars.length - 3; i++) { const r = bars[i].c / bars[i - 1].c; if (r > 0.45 && r < 2.2) continue; const back = bars[i + 3].c / bars[i - 1].c; if (back > 0.6 && back < 1.7) continue;
    if (SPLITQ.some((q) => Math.abs(r - q) / q < 0.04 || Math.abs(r * q - 1) < 0.04)) bad.push({ from: addD(bars[i].d, -200), to: addD(bars[i].d, 400), at: bars[i].d, r: +r.toFixed(3) }); }
  return { bars, bad }; }
export const inBad = (bad, d) => bad.some((w) => d >= w.from && d <= w.to);
