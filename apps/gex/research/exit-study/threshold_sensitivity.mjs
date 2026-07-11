// Overnight study Phase 6c — filter THRESHOLD sensitivity (research only).
// Is the filter overfit to its exact cutoffs (-0.2% tape, 240-330m afternoon),
// or robust across a RANGE? A plateau = robust; a lone spike = overfit.
// Also decompose: tape-only vs afternoon-only vs both. t+50 exit, net calibrated
// cost, test-half. Train/test split.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache'), UND = path.join(HERE, 'cache_underlying');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
const spyC = {};
function spy(day) { if (spyC[day]) return spyC[day]; const b = load(path.join(UND, `SPY_${day}.json`)).map(r => ({ ts: Date.parse(r.start_time), close: +r.close })).filter(r => r.close > 0).sort((a, b) => a.ts - b.ts); const reg = b.filter(r => { const h = new Date(r.ts).getUTCHours(); return h >= 13 && h < 20; }); return (spyC[day] = { open: reg[0]?.close, bars: reg }); }
const spyAt = (day, ts) => { const b = spy(day).bars; let i = 0; while (i < b.length - 1 && b[i + 1].ts <= ts) i++; return b[i]?.close; };
function t50(f) {
  const opt = load(path.join(CACHE, `${f.sym}_${f.day}.json`)).map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= f.fireTsMs + 60000); if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close, s = opt.slice(ei), t0 = s[0].ts;
  for (const o of s) { const g = (o.close - entry) / entry; if (g >= 0.5 || g <= -0.5 || (o.ts - t0) / 60000 >= 25) return g; }
  return (s.at(-1).close - entry) / entry;
}
const COST = { SPY: 0.019 * 1.5, QQQ: 0.014 * 1.5, SPXW: 0.022 * 1.5 };
const net = (g, rt) => { const h = rt / 2; return ((1 + g) * (1 - h) - (1 + h)) / (1 + h); };
const fires = load(path.join(HERE, 'fires_index.json')).filter(f => f.state === 'BULL_REVERSE');
const R = [];
for (const f of fires) {
  const g = t50(f), sp = spy(f.day); if (g == null || !sp.open) continue;
  R.push({ day: f.day, g, cost: COST[f.ticker] ?? 0.03, tape: (spyAt(f.day, f.fireTsMs) - sp.open) / sp.open, mins: (f.fireTsMs - Date.parse(`${f.day}T13:30:00Z`)) / 60000 });
}
const days = [...new Set(R.map(r => r.day))].sort(); const split = days[Math.floor(days.length / 2)];
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pct = x => Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%` : '  -';
const testNet = sub => mean(sub.filter(r => r.day >= split).map(r => net(r.g, r.cost)));
const trainNet = sub => mean(sub.filter(r => r.day < split).map(r => net(r.g, r.cost)));

console.log(`THRESHOLD SENSITIVITY — t+50 filtered, net calibrated cost, n=${R.length} split ${split}\n`);
console.log('(A) DOWN-TAPE cutoff sweep (skip if SPY-vs-open < cutoff), no afternoon filter:');
console.log('  cutoff'.padEnd(12) + 'n'.padStart(6) + 'train'.padStart(9) + 'test'.padStart(9));
for (const c of [-0.006, -0.004, -0.002, -0.001, 0, 0.001, 0.003]) {
  const sub = R.filter(r => r.tape >= c);
  console.log('  ' + `${(c * 100).toFixed(1)}%`.padEnd(10) + String(sub.length).padStart(6) + pct(trainNet(sub)).padStart(9) + pct(testNet(sub)).padStart(9));
}
console.log('\n(B) AFTERNOON window sweep (skip fires in [start,330m]), no tape filter:');
console.log('  start'.padEnd(12) + 'n'.padStart(6) + 'train'.padStart(9) + 'test'.padStart(9));
for (const st of [999, 180, 210, 240, 270, 300]) {
  const sub = R.filter(r => !(r.mins >= st && r.mins < 330));
  console.log('  ' + (st === 999 ? 'none' : `${st}m(${(9.5 + st / 60).toFixed(1)}ET)`).padEnd(10) + String(sub.length).padStart(6) + pct(trainNet(sub)).padStart(9) + pct(testNet(sub)).padStart(9));
}
console.log('\n(C) COMPONENT decomposition (test-half net):');
for (const [lab, pred] of [
  ['none (all fires)', () => true],
  ['tape-only (>=-0.2%)', r => r.tape >= -0.002],
  ['afternoon-only', r => !(r.mins >= 240 && r.mins < 330)],
  ['BOTH', r => r.tape >= -0.002 && !(r.mins >= 240 && r.mins < 330)],
]) { const sub = R.filter(pred); console.log('  ' + lab.padEnd(22) + `n=${String(sub.length).padStart(4)}  train ${pct(trainNet(sub)).padStart(7)}  test ${pct(testNet(sub)).padStart(7)}`); }
