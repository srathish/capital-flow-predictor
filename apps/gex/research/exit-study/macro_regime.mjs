// Overnight study Phase 3e — MACRO regime filter (research only).
// Phases 3c/3d: trend-up-day HOLD is a huge edge but NOT identifiable intraday.
// Hypothesis: it's a MACRO market-state effect. Test a realizable higher-timeframe
// filter — SPY trailing multi-day return known at the OPEN (prior closes only) —
// and see if it selects the profitable days across BOTH halves (i.e., would have
// kept us OUT of the chop period). Label = hold_eod on real 0DTE marks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache'), UND = path.join(HERE, 'cache_underlying');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

// SPY daily close series from cached underlying (last regular-session bar per day)
const fires = load(path.join(HERE, 'fires_index.json')).filter(f => f.state === 'BULL_REVERSE');
const days = [...new Set(fires.map(f => f.day))].sort();
const spyClose = {};
for (const d of days) {
  const b = load(path.join(UND, `SPY_${d}.json`)).map(r => ({ ts: Date.parse(r.start_time), close: +r.close }))
    .filter(r => { const h = new Date(r.ts).getUTCHours(); return h >= 13 && h < 20 && r.close > 0; }).sort((a, b) => a.ts - b.ts);
  if (b.length) spyClose[d] = b.at(-1).close;
}
const dl = days.filter(d => spyClose[d]);              // days with a close
const idxOf = d => dl.indexOf(d);
// realizable trailing return as of the OPEN of day d = (prevClose - close N days before)/...
function trail(d, n) {
  const i = idxOf(d); if (i < n) return null;
  const prev = spyClose[dl[i - 1]], base = spyClose[dl[i - 1 - n]];
  return base ? (prev - base) / base : null;
}
function holdEod(f) {
  const opt = load(path.join(CACHE, `${f.sym}_${f.day}.json`)).map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= f.fireTsMs + 60000); if (ei < 0 || ei >= opt.length - 2) return null;
  return (opt.at(-1).close - opt[ei].close) / opt[ei].close;
}
const split = days[Math.floor(days.length / 2)];
const recs = [];
for (const f of fires) {
  const g = holdEod(f); const t5 = trail(f.day, 5); if (g == null || t5 == null) continue;
  recs.push({ isTest: f.day >= split, g, t5, macro: t5 > 0.015 ? 'a_up(>+1.5%)' : t5 > -0.005 ? 'b_flat' : 'c_down(<-0.5%)' });
}
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pct = x => Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%` : '  -';
console.log(`\nMACRO REGIME FILTER — BULL_REVERSE hold-to-close, n=${recs.length} (split ${split})`);
console.log('SPY trailing-5d return known at the open (realizable):\n');
console.log('bucket'.padEnd(16) + 'n'.padStart(5) + 'trainN'.padStart(8) + 'testN'.padStart(7) + 'TRAIN'.padStart(8) + 'TEST'.padStart(8) + 'win%'.padStart(7));
for (const b of [...new Set(recs.map(r => r.macro))].sort()) {
  const s = recs.filter(r => r.macro === b), tr = s.filter(r => !r.isTest), te = s.filter(r => r.isTest);
  const rob = mean(tr.map(r => r.g)) > 0.1 && mean(te.map(r => r.g)) > 0.1 ? ' ✅ROBUST' : '';
  console.log(String(b).padEnd(16) + String(s.length).padStart(5) + String(tr.length).padStart(8) + String(te.length).padStart(7) +
    pct(mean(tr.map(r => r.g))).padStart(8) + pct(mean(te.map(r => r.g))).padStart(8) + (s.filter(r => r.g > 0).length / s.length * 100).toFixed(0).padStart(6) + '%' + rob);
}
// bottom line: filter ON = only macro-up; compare to trading everything
const on = recs.filter(r => r.macro === 'a_up(>+1.5%)'), all = recs;
console.log(`\nSTRATEGY COMPARISON (hold-to-close):`);
console.log(`  trade ALL days:      avg ${pct(mean(all.map(r => r.g)))}  (train ${pct(mean(all.filter(r=>!r.isTest).map(r=>r.g)))} / test ${pct(mean(all.filter(r=>r.isTest).map(r=>r.g)))})  n=${all.length}`);
console.log(`  ONLY macro-up days:  avg ${pct(mean(on.map(r => r.g)))}  (train ${pct(mean(on.filter(r=>!r.isTest).map(r=>r.g)))} / test ${pct(mean(on.filter(r=>r.isTest).map(r=>r.g)))})  n=${on.length}`);
