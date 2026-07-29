// The regime IS the switch. For every Falcon/Talon pick we have a surface for, compute the
// 0DTE net-gamma regime at the pick time and check whether the signal name matches:
//   trinity_deflection / trinity_confluence / spy_rev  -> should be POSITIVE gamma (walls HOLD, fade works)
//   trapdoor / spy_rug / barney_floor                  -> should be NEGATIVE gamma (walls BREAK, momentum)
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const load = (day) => { const f = path.join(DIR, `replay_${day}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const near = (fr, et) => fr.reduce((b, x, i) => Math.abs(+etOf(x.ts).replace(':', '') - +et.replace(':', '')) < Math.abs(+etOf(fr[b].ts).replace(':', '') - +et.replace(':', '')) ? i : b, 0);
const netG = (fx) => fx.strikes.reduce((a, b) => a + b.g0, 0);            // whole-surface net (band ±1.2%)
const netGnear = (fx) => fx.strikes.filter(n => Math.abs(n.strike - fx.spot) <= 15).reduce((a, b) => a + b.g0, 0); // ±$15 of spot

const EXPECT = { trinity_deflection: '+', trinity_confluence: '+', spy_rev: '+', trapdoor: '-', spy_rug: '-', barney_floor: '-' };
const picks = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'research', 'doctrine', 'falcon_picks.json'), 'utf8')).picks;
const cache = {};
console.log(`date        et     signal              dir    spot   netG(all)  netG(±15)  regime  expect  MATCH?`);
let match = 0, tested = 0;
for (const p of picks.filter(p => p.underlying !== 'SPY').sort((a, b) => (a.date + a.et).localeCompare(b.date + b.et))) {
  const fr = cache[p.date] !== undefined ? cache[p.date] : (cache[p.date] = load(p.date));
  if (!fr) continue;
  const x = fr[near(fr, p.et)];
  const ng = netG(x), ngn = netGnear(x), reg = ng > 0 ? '+' : '-';
  const exp = EXPECT[p.signal] || '?';
  const ok = exp === '?' ? '·' : (reg === exp ? '✓' : '✗ MISMATCH');
  if (exp !== '?') { tested++; if (reg === exp) match++; }
  console.log(`${p.date}  ${p.et}  ${(p.signal || '?').padEnd(18)}  ${(p.dir || '').padEnd(5)}  ${x.spot.toFixed(0)}  ${(ng / 1e6).toFixed(0).padStart(6)}M   ${(ngn / 1e6).toFixed(0).padStart(6)}M    ${reg}       ${exp}       ${ok}`);
}
console.log(`\nREGIME-MATCH: ${match}/${tested} picks fired in the regime their signal name predicts.`);
console.log(`If deflections cluster in + gamma and trapdoors in - gamma, the regime sign is the master gate for the 0-100 score.`);
