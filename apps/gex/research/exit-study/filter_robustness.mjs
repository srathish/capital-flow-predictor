// Overnight study Phase 6b — is the FILTER real? (research only, multiple-comparisons check)
// I picked t+50 + down-tape/afternoon filter. If that's a real effect (not a lucky
// rule×filter combo), the SAME filter should improve MANY exit rules. Test the
// filter's delta across 7 exits, net of calibrated cost, train/test. Plus a
// worst-case spread stress (all p75 = 2.7%, and 2x conservative).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache'), UND = path.join(HERE, 'cache_underlying');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
const spyC = {};
function spy(day) { if (spyC[day]) return spyC[day]; const b = load(path.join(UND, `SPY_${day}.json`)).map(r => ({ ts: Date.parse(r.start_time), close: +r.close })).filter(r => r.close > 0).sort((a, b) => a.ts - b.ts); const reg = b.filter(r => { const h = new Date(r.ts).getUTCHours(); return h >= 13 && h < 20; }); return (spyC[day] = { open: reg[0]?.close, bars: reg }); }
const spyAt = (day, ts) => { const b = spy(day).bars; let i = 0; while (i < b.length - 1 && b[i + 1].ts <= ts) i++; return b[i]?.close; };
function steps(f) {
  const opt = load(path.join(CACHE, `${f.sym}_${f.day}.json`)).map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= f.fireTsMs + 60000); if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close, s = opt.slice(ei), t0 = s[0].ts;
  return s.map(o => ({ dt: (o.ts - t0) / 60000, g: (o.close - entry) / entry }));
}
const target = tp => S => { for (const s of S) { if (s.g >= tp) return s.g; if (s.g <= -0.5) return s.g; } return S.at(-1).g; };
const timeExit = m => S => { for (const s of S) if (s.dt >= m) return s.g; return S.at(-1).g; };
const RULES = { 't+30': target(.3), 't+40': target(.4), 't+50': target(.5), 'time15': timeExit(15), 'time20': timeExit(20), 'time30': timeExit(30), 'hold_eod': S => S.at(-1).g };
const COST = { SPY: 0.019 * 1.5, QQQ: 0.014 * 1.5, SPXW: 0.022 * 1.5 };
const net = (g, rt) => { const h = rt / 2; return ((1 + g) * (1 - h) - (1 + h)) / (1 + h); };

const fires = load(path.join(HERE, 'fires_index.json')).filter(f => f.state === 'BULL_REVERSE');
const R = [];
for (const f of fires) {
  const S = steps(f), sp = spy(f.day); if (!S || !sp.open) continue;
  const tape = (spyAt(f.day, f.fireTsMs) - sp.open) / sp.open;
  const mins = (f.fireTsMs - Date.parse(`${f.day}T13:30:00Z`)) / 60000;
  R.push({ day: f.day, S, cost: COST[f.ticker] ?? 0.03, pass: tape >= -0.002 && !(mins >= 240 && mins < 330) });
}
const days = [...new Set(R.map(r => r.day))].sort(); const split = days[Math.floor(days.length / 2)];
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pct = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
function avgNet(sub, rule, costMode) {
  return { tr: mean(sub.filter(r => r.day < split).map(r => net(RULES[rule](r.S), costMode(r)))), te: mean(sub.filter(r => r.day >= split).map(r => net(RULES[rule](r.S), costMode(r)))) };
}
const calib = r => r.cost, stress = r => 0.027, harsh = r => r.cost * 2;

console.log(`FILTER ROBUSTNESS — does down-tape+afternoon filter help ACROSS exit rules?`);
console.log(`n=${R.length} (filtered ${R.filter(r => r.pass).length})  split ${split}\n`);
console.log('(net @ calibrated cost; ✅ = filter improves TEST)');
console.log('rule'.padEnd(10) + 'OFF test'.padStart(10) + 'ON test'.padStart(10) + 'ON train'.padStart(10) + '  delta(test)');
let helped = 0;
for (const k of Object.keys(RULES)) {
  const off = avgNet(R, k, calib), on = avgNet(R.filter(r => r.pass), k, calib);
  const d = on.te - off.te; if (d > 0) helped++;
  console.log(k.padEnd(10) + pct(off.te).padStart(10) + pct(on.te).padStart(10) + pct(on.tr).padStart(10) + `   ${pct(d)}${d > 0 ? ' ✅' : ''}`);
}
console.log(`\nfilter improved TEST in ${helped}/${Object.keys(RULES).length} exit rules ${helped >= 6 ? '=> ROBUST effect, not a lucky combo' : '=> weak/rule-specific'}`);

console.log('\nSPREAD STRESS (t+50, filtered, test-half net):');
for (const [lab, cm] of [['calibrated (~2-3%)', calib], ['p75 flat (2.7%)', stress], ['harsh 2x (~5-6%)', harsh]]) {
  console.log('  ' + lab.padEnd(20) + pct(avgNet(R.filter(r => r.pass), 't+50', cm).te));
}
