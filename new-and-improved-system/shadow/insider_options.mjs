#!/usr/bin/env node
// Does the insider-buy edge (INS_BUY_100K, robust in stock terms) survive as an OPTIONS trade? Locked 2026-10-04 BEFORE running.
// Events: INS_BUY_100K from journal/uw_signals.json with entry 2025-01-02…2026-09-02 (UW minute option data starts 2025).
//   contract  CALL, first listed expiry ≥ entry+35 calendar days, strike nearest the entry-day open (UW listing for that day)
//   entry     10:00 ET 1-min bar of the entry session (close = mid-ish; HIGH = worst fill)
//   exit      close of the 20th session (last 1-min bar ≤ 15:59; LOW = worst fill) — no stops, no targets
//   control   for every event, the same construction on the same stock at a random session in 2025-01…2026-08 (seeded)
// --itm (locked 2026-10-04 after the ATM result, theory: less theta per $ of delta): strike nearest 0.90×open, expiry ≥60 days.
// $1k premium per trade. ✓ if events beat controls at mid AND worst fill, and both halves (by date) are positive.
import fs from 'node:fs';
import path from 'node:path';
import { optionSymbols, contractMinuteBars } from '../feeds/uw.js';
import { loadDaily } from '../desk/common.mjs';
import { etToUnix } from '../lib/time.js';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), OC = path.join(HERE, '..', '.cache', 'options');
const ITM = process.argv.includes('--itm'), MINDAYS = ITM ? 60 : 35, KMULT = ITM ? 0.9 : 1;
const E = JSON.parse(fs.readFileSync(path.join(HERE, 'journal', 'uw_signals.json'), 'utf8')).filter((e) => e.sig === 'INS_BUY_100K' && e.d >= '2025-01-02' && e.d <= '2026-09-02');
async function obars(id, d) { const f = path.join(OC, d, `${id}.json`); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); const b = await contractMinuteBars(id, d); if (b.length) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(b)); } return b; }
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
let seed = 23; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

async function trade(sym, i0) {
  const bars = loadDaily(sym); if (i0 < 0 || i0 + 19 >= bars.length) return null;
  const D = bars[i0].d, X = bars[i0 + 19].d, open = bars[i0].o;
  const calls = (await optionSymbols(sym, D)).filter((o) => o.type === 'call' && o.exp >= addDays(D, MINDAYS));
  if (!calls.length) return { skip: 'no listing' };
  const exp = calls.map((o) => o.exp).sort()[0], strikes = calls.filter((o) => o.exp === exp).sort((a, b) => Math.abs(a.strike - KMULT * open) - Math.abs(b.strike - KMULT * open));
  for (const o of strikes.slice(0, 3)) {
    const eb = (await obars(o.id, D)).filter((b) => b.t >= etToUnix(D, '10:00')); if (!eb.length || eb[0].t > etToUnix(D, '11:00')) continue;
    const xb = (await obars(o.id, X)).filter((b) => b.t <= etToUnix(X, '15:59')); if (!xb.length) return { skip: 'no exit print' };
    const inMid = eb[0].c, inW = eb[0].h, outMid = xb.at(-1).c, outW = xb.at(-1).l;
    return { id: o.id, D, X, inMid, outMid, mid: outMid / inMid - 1, worst: outW / inW - 1 };
  }
  return { skip: 'no entry print' };
}
const rows = [];
for (const e of E) {
  const b = loadDaily(e.s), i0 = b.findIndex((x) => x.d === e.d);
  const ev = await trade(e.s, i0);
  const elig = b.map((x, i) => [x.d, i]).filter(([d]) => d >= '2025-01-02' && d <= '2026-08-28');
  const j = elig.length ? elig[Math.floor(rnd() * elig.length)][1] : -1;
  const ct = await trade(e.s, j);
  rows.push({ s: e.s, d: e.d, val: e.val, ev, ct });
}
fs.writeFileSync(path.join(HERE, 'journal', `insider_options${ITM ? '.itm' : ''}.json`), JSON.stringify(rows, null, 1));
const ok = (x) => x && x.mid != null && Number.isFinite(x.mid);
const st = (v) => { const m = v.reduce((a, x) => a + x, 0) / v.length, sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)), s = [...v].sort((a, b) => a - b); return { n: v.length, m, t: m / (sd / Math.sqrt(v.length)), med: s[s.length >> 1], win: v.filter((x) => x > 0).length / v.length }; };
const $ = (v) => (v >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(v));
const show = (name, v) => { const s = st(v); console.log(`  ${name.padEnd(26)} n ${String(s.n).padStart(3)} · avg ${(s.m * 100).toFixed(1).padStart(6)}% (t ${s.t.toFixed(1)}) · median ${(s.med * 100).toFixed(1).padStart(6)}% · win ${Math.round(s.win * 100)}% · total ${$(s.m * s.n * 1000)}`); };
const EV = rows.filter((r) => ok(r.ev)).sort((a, b) => a.d.localeCompare(b.d)), CT = rows.filter((r) => ok(r.ct)), med = EV[Math.floor(EV.length / 2)]?.d;
console.log(`insider buy ≥$100k → ${ITM ? '~10% ITM call ≥60' : 'ATM call ≥35'} DTE, 10:00 entry, 20-session hold · events ${rows.length} · priced ${EV.length} · controls priced ${CT.length}\n`);
show('EVENTS mid', EV.map((r) => r.ev.mid)); show('EVENTS worst fill', EV.map((r) => r.ev.worst));
show('CONTROL mid', CT.map((r) => r.ct.mid)); show('CONTROL worst fill', CT.map((r) => r.ct.worst));
show(`EVENTS mid, before ${med}`, EV.filter((r) => r.d < med).map((r) => r.ev.mid)); show(`EVENTS mid, from ${med}`, EV.filter((r) => r.d >= med).map((r) => r.ev.mid));
const P = rows.filter((r) => ok(r.ev) && ok(r.ct)); show('EVENT − CONTROL (paired)', P.map((r) => r.ev.mid - r.ct.mid));
const skips = {}; for (const r of rows) if (!ok(r.ev)) skips[r.ev?.skip ?? 'no data'] = (skips[r.ev?.skip ?? 'no data'] ?? 0) + 1; console.log(`\n  unpriced events: ${JSON.stringify(skips)}`);
