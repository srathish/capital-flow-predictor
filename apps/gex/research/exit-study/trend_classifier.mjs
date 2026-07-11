// Overnight study Phase 3d — REALIZABLE trend-up-day classifier (research only).
// Phase 3c: holding BULL_REVERSE calls to close on trend-UP days = +65% OOS, but
// "already up X% at fire" failed OOS. Try trend-QUALITY signals computable AT the
// fire (open->fire path only), and test whether they robustly flag hold-to-close
// winners in BOTH train and test:
//   ER_signed = (spy_fire - spy_open) / sum|bar move|   (Kaufman efficiency, signed)
//   vwapHold  = frac of bars since open with SPY > VWAP
//   orbUp     = SPY above first-30min high at fire (opening-range breakout up)
// Label = hold_eod on real 0DTE marks. Train/test split.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache'), UND = path.join(HERE, 'cache_underlying');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
const spyC = {};
function spy(day) {
  if (spyC[day]) return spyC[day];
  const all = load(path.join(UND, `SPY_${day}.json`)).map(r => ({ ts: Date.parse(r.start_time), close: +r.close, high: +r.high, low: +r.low, vol: +r.volume || 0 })).filter(r => r.close > 0).sort((a, b) => a.ts - b.ts);
  const reg = all.filter(r => { const h = new Date(r.ts).getUTCHours(), m = new Date(r.ts).getUTCMinutes(); return (h > 13 || (h === 13 && m >= 30)) && h < 20; });
  return (spyC[day] = reg);
}
function feats(day, fireTs) {
  const b = spy(day); if (b.length < 10) return null;
  const upto = b.filter(x => x.ts <= fireTs); if (upto.length < 6) return null;
  const open = b[0].close, now = upto.at(-1).close;
  let pathLen = 0; for (let i = 1; i < upto.length; i++) pathLen += Math.abs(upto[i].close - upto[i - 1].close);
  const er = pathLen > 0 ? (now - open) / pathLen : 0;
  let pv = 0, vv = 0, above = 0;
  for (const x of upto) { const tp = (x.high + x.low + x.close) / 3; pv += tp * x.vol; vv += x.vol; if (x.close > (vv ? pv / vv : x.close)) above++; }
  const vwapHold = above / upto.length;
  const first30 = b.filter(x => x.ts <= b[0].ts + 30 * 60000);
  const orHigh = Math.max(...first30.map(x => x.high));
  return { er, vwapHold, orbUp: now > orHigh };
}
function holdEod(fire) {
  const opt = load(path.join(CACHE, `${fire.sym}_${fire.day}.json`)).map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= fire.fireTsMs + 60000); if (ei < 0 || ei >= opt.length - 2) return null;
  return (opt.at(-1).close - opt[ei].close) / opt[ei].close;
}

const fires = load(path.join(HERE, 'fires_index.json')).filter(f => f.state === 'BULL_REVERSE');
const days = [...new Set(fires.map(f => f.day))].sort();
const split = days[Math.floor(days.length / 2)];
const recs = [];
for (const f of fires) {
  const ft = feats(f.day, f.fireTsMs), g = holdEod(f); if (!ft || g == null) continue;
  recs.push({
    isTest: f.day >= split, g, ...ft,
    erB: ft.er > 0.4 ? 'a_strongUp(>.4)' : ft.er > 0.15 ? 'b_up(.15-.4)' : ft.er > -0.15 ? 'c_chop(-.15-.15)' : 'd_down(<-.15)',
    vhB: ft.vwapHold > 0.7 ? 'hold>70%' : ft.vwapHold > 0.4 ? 'mid40-70' : 'below<40%',
  });
}
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pct = x => Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%` : '  -';
function seg(label, key) {
  console.log(`\n== HOLD-TO-CLOSE by ${label} ==`);
  for (const b of [...new Set(recs.map(r => r[key]))].sort()) {
    const tr = recs.filter(r => r[key] === b && !r.isTest).map(r => r.g), te = recs.filter(r => r[key] === b && r.isTest).map(r => r.g);
    const trM = mean(tr), teM = mean(te), rob = trM > 0.1 && teM > 0.1 ? ' ✅' : (trM < 0 && teM < 0 ? ' ❌' : '');
    console.log('  ' + String(b).padEnd(18) + `n=${String(tr.length + te.length).padStart(4)} win${(recs.filter(r => r[key] === b).filter(r => r.g > 0).length / recs.filter(r => r[key] === b).length * 100).toFixed(0)}%  train ${pct(trM).padStart(6)}  test ${pct(teM).padStart(6)}${rob}`);
  }
}
console.log(`\nREALIZABLE TREND CLASSIFIER — BULL_REVERSE, n=${recs.length} (split ${split})`);
seg('efficiency ratio @ fire (signed)', 'erB');
seg('VWAP-hold % @ fire', 'vhB');
seg('opening-range breakout up', 'orbUp');
// combined gate: ER>.15 AND vwapHold>.5 AND orbUp
const gate = r => r.er > 0.15 && r.vwapHold > 0.5 && r.orbUp;
const g1 = recs.filter(gate), g0 = recs.filter(r => !gate(r));
console.log('\n== COMBINED GATE (ER>.15 & VWAPhold>.5 & ORBup) — hold-to-close ==');
for (const [lab, s] of [['PASS gate', g1], ['FAIL gate', g0]]) {
  const tr = s.filter(r => !r.isTest).map(r => r.g), te = s.filter(r => r.isTest).map(r => r.g);
  console.log(`  ${lab.padEnd(10)} n=${String(s.length).padStart(4)} win${(s.filter(r => r.g > 0).length / s.length * 100).toFixed(0)}%  train ${pct(mean(tr))}  test ${pct(mean(te))}`);
}
