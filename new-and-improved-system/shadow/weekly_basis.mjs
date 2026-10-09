// Short stock factory — price / option-chain basis (DESIGN_stock_factory amendment 2).
// UW daily bars are split-adjusted for some tickers (NVDA) but not others (KLAC, ODFL, CELH, MNST, NVO, AZN, AMC, MRNA),
// and UW greek strikes are always raw. Confirmed split events come from two sources:
//   (a) PRICE BREAK in the bars by a standard ratio (±6%) that persists, confirmed as a split when the option-chain centre
//       moved with the price (stored strike-centre ÷ close ratio continuous across the break; a crash leaves strikes
//       behind so the ratio jumps). Before the options data starts, a break within ±3% of an exact ratio is accepted.
//   (b) SEC-confirmed splits (split_shares.mjs) for series UW already adjusted (no price break).
// adjustedBars() back-adjusts (a) so prices are continuous; factorAt(d) = product of later event ratios = raw ÷ adjusted.
import path from 'node:path';
import { sharesAdjusted } from './split_shares.mjs';

const STD = [2, 3, 4, 5, 8, 10, 15, 20, 25, 30, 40, 50];
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
function snapRatio(r, tol) { for (const q of STD) { if (Math.abs(r * q - 1) < tol) return 1 / q; if (Math.abs(r / q - 1) < tol) return q; } return null; }

// events for one ticker; bars = raw UW bars [{d,o,h,l,c,v}], snaps = [{d, ratio}] (ratio = strike centre ÷ close at fetch)
export function splitEvents(C, t, bars, snaps = []) {
  const ev = [], unexplained = [], sec = (sharesAdjusted(C, t)?.splits ?? []).filter((sp) => sp.ratio >= 2 || sp.ratio <= 0.5), usedSec = new Set();
  for (let i = 1; i < bars.length - 3; i++) { const r = bars[i].c / bars[i - 1].c; if (r > 0.6 && r < 1.7) continue; const back = bars[i + 3].c / bars[i - 1].c; if (back > 0.6 && back < 1.7) continue;
    const d = bars[i].d, before = snaps.filter((s) => s.ratio && days(s.d, d) > 0 && days(s.d, d) <= 21).map((s) => s.ratio), after = snaps.filter((s) => s.ratio && days(d, s.d) >= 0 && days(d, s.d) <= 21).map((s) => s.ratio);
    const secHit = sec.findIndex((sp) => Math.abs(Math.log(sp.ratio * r)) < 0.06 && days(sp.after, d) >= -120 && days(d, sp.at) >= -120);
    if (before.length && after.length) { // options decide: strikes moved with the price = corporate action (any ratio), else a real move
      if (Math.abs(Math.log(med(after) / med(before))) < Math.log(1.3)) { ev.push({ d, q: 1 / r, kind: 'break', how: 'option strikes moved with the price' }); if (secHit >= 0) usedSec.add(secHit); }
      continue; }
    if (secHit >= 0) { ev.push({ d, q: sec[secHit].ratio, kind: 'break', how: 'price break matching an SEC-confirmed split' }); usedSec.add(secHit); continue; }
    const q = snapRatio(r, 0.03); if (q) { ev.push({ d, q: 1 / q, kind: 'break', how: 'price break at an exact split ratio (before options data)' }); continue; }
    unexplained.push(d); }
  sec.forEach((sp, k) => { if (!usedSec.has(k)) ev.push({ after: sp.after, at: sp.at, q: sp.ratio, kind: 'sec', how: 'SEC restated prior share counts (prices already adjusted)' }); });
  return { ev, unexplained }; }
export function adjustedBars(bars, ev) { const out = bars.map((b) => ({ ...b }));
  for (const e of ev.filter((x) => x.kind === 'break')) for (const b of out) if (b.d < e.d) { b.o /= e.q; b.h /= e.q; b.l /= e.q; b.c /= e.q; b.v *= e.q; }
  return out; }
// raw ÷ adjusted at date d; for an SEC event whose filing bracket contains d, the snapshot's own ratio decides (null = ambiguous)
export function factorAt(ev, d, ratioAdj = null) { let f = 1;
  for (const e of ev) { if (e.kind === 'break') { if (d < e.d) f *= e.q; continue; }
    if (d < e.after) f *= e.q; else if (d < e.at) { if (ratioAdj == null) return null; const inc = Math.abs(Math.log(ratioAdj / (f * e.q))), exc = Math.abs(Math.log(ratioAdj / f)); if (Math.min(inc, exc) > Math.log(1.3)) return null; if (inc < exc) f *= e.q; } }
  return f; }
// a snapshot within 7 days of a break event, or of a resolved SEC switch, is transitional
export const nearEvent = (ev, d) => ev.some((e) => (e.kind === 'break' ? Math.abs(days(e.d, d)) <= 7 : false));
