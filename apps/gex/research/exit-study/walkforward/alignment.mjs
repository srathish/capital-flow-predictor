// Walk-forward — INDEX ALIGNMENT test (research only). User hypothesis: when all
// three indices are bearish (down day), do puts win next day (and vice versa for
// calls)? Pure regime/momentum signal. SPY/QQQ/IWM daily closes, ~1yr.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const load = f => JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'));
const SPY = load('SPY_ohlc.json'), QQQ = load('QQQ_ohlc.json'), IWM = load('IWM_ohlc.json');
const days = Object.keys(SPY).filter(d => QQQ[d] && IWM[d]).sort();

const recs = [];
for (let i = 1; i < days.length - 5; i++) {
  const d = days[i], p = days[i - 1];
  const dir = idx => idx[d].close > idx[p].close ? 1 : 0;
  const votes = dir(SPY) + dir(QQQ) + dir(IWM);           // 0..3 up today
  const sc = SPY[d].close, sc1 = SPY[days[i + 1]].close, sc5 = SPY[days[i + 5]].close;
  const qc = QQQ[d].close, qc1 = QQQ[days[i + 1]].close;
  recs.push({ d, votes, spyUp1: sc1 > sc, qqqUp1: qc1 > qc, spyUp5: sc5 > sc,
    spyRet1: (sc1 - sc) / sc, spyRet5: (sc5 - sc) / sc });
}
const pct = x => `${(x * 100).toFixed(1)}%`;
const rate = (sub, f) => sub.length ? sub.filter(f).length / sub.length : NaN;
const mean = (sub, f) => sub.length ? sub.reduce((s, r) => s + f(r), 0) / sub.length : NaN;
const baseUp = rate(recs, r => r.spyUp1);
console.log(`INDEX ALIGNMENT (SPY/QQQ/IWM) — ${recs.length} days ${recs[0].d}..${recs.at(-1).d}`);
console.log(`baseline: SPY next-day UP = ${pct(baseUp)}\n`);
console.log('today votes'.padEnd(16) + 'n'.padStart(5) + 'nextDayUP'.padStart(11) + 'SPY fwd1'.padStart(10) + 'SPY fwd5'.padStart(10));
for (const v of [3, 2, 1, 0]) {
  const sub = recs.filter(r => r.votes === v);
  console.log(`${v}/3 up`.padEnd(16) + String(sub.length).padStart(5) + pct(rate(sub, r => r.spyUp1)).padStart(11) + pct(mean(sub, r => r.spyRet1)).padStart(10) + pct(mean(sub, r => r.spyRet5)).padStart(10));
}
console.log('\nTRADEABLE READ:');
const allUp = recs.filter(r => r.votes === 3), allDn = recs.filter(r => r.votes === 0);
console.log(`  after ALL-3-UP (n=${allUp.length}):   next-day CALLS win ${pct(rate(allUp, r => r.spyUp1))}  (edge vs base ${pct(rate(allUp, r => r.spyUp1) - baseUp)}) | fwd5 ${pct(mean(allUp, r => r.spyRet5))}`);
console.log(`  after ALL-3-DOWN (n=${allDn.length}): next-day PUTS win ${pct(1 - rate(allDn, r => r.spyUp1))}  (edge vs base ${pct((1 - rate(allDn, r => r.spyUp1)) - (1 - baseUp))}) | fwd5 ${pct(mean(allDn, r => r.spyRet5))}`);
// regime robustness: split halves
console.log('\nrobustness (all-down -> next-day DOWN rate, by half):');
const h = Math.floor(recs.length / 2);
for (const [lab, sub] of [['H1', recs.slice(0, h)], ['H2', recs.slice(h)]]) {
  const ad = sub.filter(r => r.votes === 0);
  console.log(`  ${lab} ${sub[0].d}..${sub.at(-1).d}  all-down n=${ad.length}  next-day DOWN ${pct(1 - rate(ad, r => r.spyUp1))}`);
}
