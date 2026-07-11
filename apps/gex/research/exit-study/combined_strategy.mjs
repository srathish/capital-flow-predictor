// Overnight study Phase 4 — COMBINED realizable strategy (research only).
// Stacks the robust, realizable pieces found tonight:
//   ENTRY FILTER: fire BULL_REVERSE only when SPY >= its open at fire (not
//     down-tape) AND not in the 1:30-3:00 ET afternoon dead-zone.
//   EXIT: fast scalp — take profit at +50%, hard time-stop 25m, stop -50%.
// Compares to (a) no filter + same scalp, (b) the live baseline (~-23% realized).
// All real 0DTE marks, close-basis, train/test split.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache'), UND = path.join(HERE, 'cache_underlying');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
const spyC = {};
function spy(day) {
  if (spyC[day]) return spyC[day];
  const b = load(path.join(UND, `SPY_${day}.json`)).map(r => ({ ts: Date.parse(r.start_time), close: +r.close })).filter(r => r.close > 0).sort((a, b) => a.ts - b.ts);
  const reg = b.filter(r => { const h = new Date(r.ts).getUTCHours(); return h >= 13 && h < 20; });
  return (spyC[day] = { open: reg[0]?.close, bars: reg });
}
const spyAt = (day, ts) => { const b = spy(day).bars; let i = 0; while (i < b.length - 1 && b[i + 1].ts <= ts) i++; return b[i]?.close; };
function scalp(f) { // t+50 / 25m / -50%
  const opt = load(path.join(CACHE, `${f.sym}_${f.day}.json`)).map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= f.fireTsMs + 60000); if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close, s = opt.slice(ei), t0 = s[0].ts;
  for (const o of s) { const g = (o.close - entry) / entry; if (g >= 0.5) return g; if (g <= -0.5) return g; if ((o.ts - t0) / 60000 >= 25) return g; }
  return (s.at(-1).close - entry) / entry;
}
const fires = load(path.join(HERE, 'fires_index.json')).filter(f => f.state === 'BULL_REVERSE');
const days = [...new Set(fires.map(f => f.day))].sort();
const split = days[Math.floor(days.length / 2)];
const recs = [];
for (const f of fires) {
  const g = scalp(f), sp = spy(f.day); if (g == null || !sp.open) continue;
  const tape = (spyAt(f.day, f.fireTsMs) - sp.open) / sp.open;
  const mins = (f.fireTsMs - Date.parse(`${f.day}T13:30:00Z`)) / 60000;
  const afternoon = mins >= 240 && mins < 330;
  recs.push({ isTest: f.day >= split, g, day: f.day, pass: tape >= -0.002 && !afternoon });
}
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pct = x => Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%` : ' -';
function line(label, s) {
  const tr = s.filter(r => !r.isTest).map(r => r.g), te = s.filter(r => r.isTest).map(r => r.g), all = s.map(r => r.g);
  console.log(label.padEnd(28) + `n=${String(s.length).padStart(4)}  avg ${pct(mean(all)).padStart(6)}  train ${pct(mean(tr)).padStart(6)}  test ${pct(mean(te)).padStart(6)}  win ${(all.filter(x => x > 0).length / all.length * 100).toFixed(0)}%`);
}
console.log(`COMBINED STRATEGY — BULL_REVERSE + t+50/25m scalp, n=${recs.length} (split ${split})\n`);
line('no filter (scalp all)', recs);
line('FILTER: not-down-tape+not-PM', recs.filter(r => r.pass));
line('  rejected by filter', recs.filter(r => !r.pass));
// per-day: how many pass/day, avg daily P&L (sum of per-trade % as unit-size proxy)
const byDay = {}; for (const r of recs.filter(r => r.pass)) (byDay[r.day] = byDay[r.day] || []).push(r.g);
const dailies = Object.values(byDay).map(a => a.reduce((s, x) => s + x, 0));
console.log(`\nfiltered: ${Object.keys(byDay).length} active days, ${(recs.filter(r=>r.pass).length/Object.keys(byDay).length).toFixed(1)} trades/day, ` +
  `median day ${pct(dailies.sort((a,b)=>a-b)[Math.floor(dailies.length/2)])}, avg day ${pct(mean(dailies))} (unit size/trade)`);
console.log('\nvs LIVE baseline realized ~ -23% (structure-exit, no filter). Filtered scalp is the deployable candidate.');
