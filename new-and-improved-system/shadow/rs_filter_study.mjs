#!/usr/bin/env node
// Is RELATIVE STRENGTH the stock-picking layer? Apply the stock-selection rules (locked 2026-10-03, from select_study) to
// EVERY strategy we already backtested on real option prices — no new data, no new trades, 0 credits.
//  leader     : stock's 20-day return beats SPY's in the trade's direction (calls: stronger than SPY; puts: weaker)
//  laggard    : the opposite
//  indexWith  : SPY's daily trend (close>EMA20>EMA50) points the trade's way
//  pick       : leader AND indexWith
// Periods: Jan–Mar, Apr–Jun, Jul–Sep. A filter "holds" only if it beats the unfiltered strategy in all 3 periods.
import fs from 'node:fs';
import path from 'node:path';
import { atlasHistory } from '../feeds/skylit.js';
import { dailyTrend } from '../system/stockrules.js';
import { etToUnix } from '../lib/time.js';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), J = path.join(HERE, 'journal');
const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10);
const span = [etToUnix('2026-01-02', '09:30') - 220 * 86400, etToUnix('2026-10-02', '16:00') + 86400];
const STRATS = [['stock2', 'current', 'bounce (baseline)'], ['stock2', 'inverse_trend_vex', 'Rule 1 break+trend+VEX'], ['stock2', 'inverse_trend', 'break+trend'],
  ['stock2', 'confluence_trend_vex', 'Rule 2 confluence'], ['stock3', 'r3', 'R3 break→hold→retest'], ['stock3', 'r3t', 'R3 + buy time'],
  ['stock3', 'g1', 'Giul dip-buy'], ['stock3', 'r1g', 'Rule 1 + Glitch filters'], ['stock3', 'r1t', 'Rule 1 + buy time']];
const PER = { '2026-01-02_2026-03-31': 'Q1', '2026-04-01_2026-06-30': 'Q2', '2026-07-01_2026-10-02': 'Q3' };

const daily = new Map();
async function dm(sym) {
  if (!daily.has(sym)) { const b = await atlasHistory(sym, 'D', ...span); const m = new Map(b.map((x) => [ymd(x.t), x])); daily.set(sym, { m, k: [...m.keys()].sort() }); }
  return daily.get(sym);
}
const spy = await dm('SPY');
async function feat(sym, D, up) {
  const s = await dm(sym), pr = s.k.filter((d) => d < D).map((d) => s.m.get(d)), sp = spy.k.filter((d) => d < D).map((d) => spy.m.get(d));
  if (pr.length < 21 || sp.length < 21) return null;
  const r = (xs) => xs.at(-1).c / xs.at(-21).c - 1, sg = up ? 1 : -1, rs = sg * (r(pr) - r(sp)), tr = dailyTrend(sp.map((b) => b.c));
  return { rs, leader: rs > 0, laggard: rs < 0, indexWith: tr === (up ? 'up' : 'down'), pick: rs > 0 && tr === (up ? 'up' : 'down') };
}

const rows = [];
for (const f of fs.readdirSync(J)) {
  const m = f.match(/^(stock[23])\.([A-Z]+)\.(\d{4}-\d\d-\d\d_\d{4}-\d\d-\d\d)\.([a-z0-9_]+)\.json$/);
  if (!m || !PER[m[3]] || !STRATS.some(([a, b]) => a === m[1] && b === m[4])) continue;
  for (const t of JSON.parse(fs.readFileSync(path.join(J, f), 'utf8')).trades) {
    if (!Number.isFinite(t.retMid)) continue;
    const x = await feat(m[2], t.D, (t.direction ?? t.dir) === 'up'); if (!x) continue;
    rows.push({ strat: `${m[1]}.${m[4]}`, sym: m[2], per: PER[m[3]], D: t.D, mid: t.retMid, worst: t.retWorst, ...x });
  }
}
fs.writeFileSync(path.join(J, 'rs_filter_rows.json'), JSON.stringify(rows));

const $ = (v) => (v >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(v));
const avg = (R, k = 'mid') => (R.length ? R.reduce((a, x) => a + x[k], 0) / R.length : NaN);
const cell = (R) => (R.length ? `${$(avg(R) * 1000).padStart(6)}/t n=${String(R.length).padEnd(3)}` : '      -      ');
const FILT = { all: () => true, leader: (r) => r.leader, laggard: (r) => r.laggard, indexWith: (r) => r.indexWith, pick: (r) => r.pick };
console.log(`rows ${rows.length} (real option prices, mid fill, avg $ per $1k trade)\n`);
const summary = [];
for (const [a, b, name] of STRATS) {
  const S = rows.filter((r) => r.strat === `${a}.${b}`); if (!S.length) continue;
  console.log(`== ${name} (${S.length} trades) ==`);
  for (const [fn, f] of Object.entries(FILT)) {
    const per = ['Q1', 'Q2', 'Q3'].map((q) => S.filter((r) => r.per === q && f(r)));
    const allPer = ['Q1', 'Q2', 'Q3'].map((q) => S.filter((r) => r.per === q));
    const beats = fn !== 'all' && per.every((R, i) => R.length >= 3 && avg(R) > avg(allPer[i]));
    const tot = per.flat();
    console.log(`  ${beats ? '✓' : ' '} ${fn.padEnd(9)} ${per.map(cell).join('  ')}  | total ${$(tot.reduce((x, r) => x + r.mid, 0) * 1000).padStart(7)} worst-fill ${$(tot.reduce((x, r) => x + r.worst, 0) * 1000).padStart(7)}`);
    summary.push({ strat: name, filter: fn, beats, n: tot.length, avg: avg(tot) });
  }
}
console.log('\n== does each filter beat the unfiltered strategy in all 3 periods? ==');
for (const fn of ['leader', 'laggard', 'indexWith', 'pick']) {
  const s = summary.filter((x) => x.filter === fn);
  const better = s.filter((x) => x.avg > summary.find((y) => y.strat === x.strat && y.filter === 'all').avg).length;
  console.log(`  ${fn.padEnd(9)} beats all-3-periods in ${s.filter((x) => x.beats).length}/${s.length} strategies · better overall avg in ${better}/${s.length}`);
}
