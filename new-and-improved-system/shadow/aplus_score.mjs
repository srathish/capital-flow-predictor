#!/usr/bin/env node
// Can we capture Giul/Glitch's DISCRETION? Score every historical node setup (the bounce trades = Giul's "buy the king/floor")
// on the confluences they say make an A+ setup — computed AT ENTRY TIME, no look-ahead — then test whether the score separates
// winners from losers. Cutoff chosen on TRAIN (orig-10, Jan–Jun); judged on TEST (orig-10 Jul–Sep) and NEW names (all periods).
import fs from 'node:fs';
import path from 'node:path';
import { atlasHistory } from '../feeds/skylit.js';
import { minuteBars } from './cache.js';
import { tapCount } from '../map/living.js';
import { dailyTrend, vexLean } from '../system/stockrules.js';
import { etToUnix } from '../lib/time.js';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname);
const CACHE = path.join(HERE, '..', '.cache', 'stock');
const ORIG = ['AAPL', 'NVDA', 'AMZN', 'META', 'GOOGL', 'AMD', 'TSLA', 'AVGO', 'ORCL', 'MSFT'], NEW = ['NFLX', 'CRM', 'ADBE', 'COST'];
const PER = ['2026-01-02_2026-03-31', '2026-04-01_2026-06-30', '2026-07-01_2026-10-02'];
const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10);

const span = [etToUnix('2026-01-02', '09:30') - 220 * 86400, etToUnix('2026-10-02', '16:00') + 86400];
const spy = await atlasHistory('SPY', 'D', ...span); const spyMap = new Map(spy.map((b) => [ymd(b.t), b])); const spyKeys = [...spyMap.keys()].sort();
const rows = [];
for (const sym of [...ORIG, ...NEW]) {
  const daily = await atlasHistory(sym, 'D', ...span); const dmap = new Map(daily.map((b) => [ymd(b.t), b])); const dk = [...dmap.keys()].sort();
  for (const per of PER) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(HERE, 'journal', `stock2.${sym}.${per}.current.json`), 'utf8')); } catch { continue; }
    for (const t of j.trades) {
      const D = t.D, up = t.direction === 'up', L = t.node;
      const prior = dk.filter((d) => d < D), last20 = prior.slice(-20).map((d) => dmap.get(d)), pd = dmap.get(prior[prior.length - 1]);
      const tEntry = etToUnix(D, t.et), bars = (await minuteBars(sym, D)).filter((b) => b.t <= tEntry);
      if (!last20.length || !pd || !bars.length) continue;
      const zone = L * 0.0015;
      // 1 trend + 2 index
      const chart = dailyTrend(prior.map((d) => dmap.get(d).c)), idx = dailyTrend(spyKeys.filter((d) => d < D).map((d) => spyMap.get(d).c));
      const fTrend = (up && chart === 'up') || (!up && chart === 'down');
      const fIndex = up ? idx !== 'down' : idx !== 'up';
      // 3 fib golden zone of the last 20-day swing (in the trade's direction)
      const hi = Math.max(...last20.map((b) => b.h)), lo = Math.min(...last20.map((b) => b.l));
      const iHi = last20.findIndex((b) => b.h === hi), iLo = last20.findIndex((b) => b.l === lo);
      const retr = up ? (hi - L) / (hi - lo) : (L - lo) / (hi - lo);
      const fFib = (up ? iLo < iHi : iHi < iLo) && retr >= 0.5 && retr <= 0.65;
      // 4 liquidity sweep: took the prior-day low (high) earlier today, and price is back above (below) it at entry
      const sessLo = Math.min(...bars.map((b) => b.l)), sessHi = Math.max(...bars.map((b) => b.h)), px = bars[bars.length - 1].c;
      const fSweep = up ? sessLo < pd.l && px > pd.l : sessHi > pd.h && px < pd.h;
      // 5 chart level at the node: prior-day H/L or a recent daily swing point within 0.3%
      const swings = []; for (let i = 2; i < last20.length - 2; i++) { const w = last20.slice(i - 2, i + 3); if (last20[i].h === Math.max(...w.map((b) => b.h))) swings.push(last20[i].h); if (last20[i].l === Math.min(...w.map((b) => b.l))) swings.push(last20[i].l); }
      const fChart = [pd.h, pd.l, ...swings].some((lv) => Math.abs(lv - L) / L <= 0.003);
      // 6 fresh level (first tap today)
      const fFresh = tapCount(bars.slice(0, -1), L, zone).taps === 0;
      // 7 VEX lean (only if that vanna map is already cached — never fetch)
      let fVex = null; const vf = fs.readdirSync(path.join(CACHE, sym)).find((f) => f.startsWith(`${D}_`) && f.endsWith('_vanna.json'));
      if (vf) { const lean = vexLean(JSON.parse(fs.readFileSync(path.join(CACHE, sym, vf), 'utf8'))); if (lean) fVex = lean === t.direction; }
      // 8 timing (after the 10:15 reshuffle)
      const fTime = t.et >= '10:15';
      const flags = { trend: fTrend, index: fIndex, fib: fFib, sweep: fSweep, chartLevel: fChart, fresh: fFresh, vex: fVex, time: fTime };
      const score = Object.values(flags).filter((x) => x === true).length;
      rows.push({ sym, per, D, dir: t.direction, setup: t.setup, ret: t.retMid, worst: t.retWorst, score, ...flags, set: NEW.includes(sym) ? 'NEW' : per === PER[2] ? 'TEST' : 'TRAIN' });
    }
  }
}
fs.writeFileSync(path.join(HERE, 'journal', 'aplus_rows.json'), JSON.stringify(rows));

const $ = (v) => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(0);
const stat = (R) => R.length ? `n=${String(R.length).padStart(4)} win ${String(Math.round(R.filter((x) => x.ret > 0).length / R.length * 100)).padStart(3)}% avg ${(R.reduce((a, x) => a + x.ret, 0) / R.length * 100).toFixed(1).padStart(6)}%  total ${$(R.reduce((a, x) => a + x.ret, 0) * 1000).padStart(8)}` : 'n=   0';
console.log(`scored ${rows.length} setups\n`);
console.log('=== each confluence on its own (TRAIN only: orig-10, Jan–Jun) — avg return WITH vs WITHOUT ===');
const TR = rows.filter((r) => r.set === 'TRAIN');
for (const f of ['trend', 'index', 'fib', 'sweep', 'chartLevel', 'fresh', 'vex', 'time']) {
  const yes = TR.filter((r) => r[f] === true), no = TR.filter((r) => r[f] === false);
  console.log(`  ${f.padEnd(11)} WITH ${stat(yes)}   |   WITHOUT ${stat(no)}`);
}
console.log('\n=== by A+ SCORE (count of confluences) ===');
for (const set of ['TRAIN', 'TEST', 'NEW']) {
  console.log(`-- ${set} --`);
  for (let s = 0; s <= 8; s++) { const R = rows.filter((r) => r.set === set && r.score === s); if (R.length) console.log(`  score ${s}: ${stat(R)}`); }
}
