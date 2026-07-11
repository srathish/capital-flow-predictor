// Overnight study Phase 6 — ROBUSTNESS battery on the deployable filter+scalp.
// The +6%/trade edge must survive: (1) transaction costs (mid-price isn't
// fillable), (2) more than one train/test split (walk-forward), (3) resampling
// (block bootstrap by DAY, since intraday fires are correlated), (4) removal of
// the top winners (tail-dependence). Research only.
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
function scalp(f) { // returns {entry, gross} for t+50/25m/-50%
  const opt = load(path.join(CACHE, `${f.sym}_${f.day}.json`)).map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= f.fireTsMs + 60000); if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close, s = opt.slice(ei), t0 = s[0].ts;
  for (const o of s) { const g = (o.close - entry) / entry; if (g >= 0.5 || g <= -0.5 || (o.ts - t0) / 60000 >= 25) return { entry, gross: g }; }
  return { entry, gross: (s.at(-1).close - entry) / entry };
}
// net return after a round-trip spread cost rt (enter +h, exit -h; h=rt/2)
const net = (gross, rt) => { const h = rt / 2; return ((1 + gross) * (1 - h) - (1 + h)) / (1 + h); };

// calibrated round-trip cost by ticker (logged median full-spread x 1.5 exit-widening)
const COST = { SPY: 0.019 * 1.5, QQQ: 0.014 * 1.5, SPXW: 0.022 * 1.5 };
const fires = load(path.join(HERE, 'fires_index.json')).filter(f => f.state === 'BULL_REVERSE');
const R = [];
for (const f of fires) {
  const sc = scalp(f), sp = spy(f.day); if (!sc || !sp.open) continue;
  const tape = (spyAt(f.day, f.fireTsMs) - sp.open) / sp.open;
  const mins = (f.fireTsMs - Date.parse(`${f.day}T13:30:00Z`)) / 60000;
  if (tape < -0.002 || (mins >= 240 && mins < 330)) continue;   // FILTER applied
  R.push({ day: f.day, ticker: f.ticker, entry: sc.entry, gross: sc.gross, cost: COST[f.ticker] ?? 0.03 });
}
const days = [...new Set(R.map(r => r.day))].sort();
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pct = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
console.log(`ROBUSTNESS — filter+scalp deployable strategy, n=${R.length} over ${days.length} days\n`);

// entry premium distribution (for realistic spread context)
const prem = R.map(r => r.entry).sort((a, b) => a - b);
console.log(`entry premium: median $${prem[Math.floor(prem.length / 2)].toFixed(2)}  (p10 $${prem[Math.floor(prem.length * .1)].toFixed(2)} / p90 $${prem[Math.floor(prem.length * .9)].toFixed(2)})`);

// (1) TRANSACTION COST SENSITIVITY
console.log('\n(1) COST SENSITIVITY (round-trip spread as % of premium):');
for (const rt of [0, 0.04, 0.08, 0.12, 0.16, 0.20]) {
  const g = R.map(r => net(r.gross, rt));
  console.log(`  rt=${(rt * 100).toFixed(0).padStart(2)}%  avg ${pct(mean(g)).padStart(7)}  win ${(g.filter(x => x > 0).length / g.length * 100).toFixed(0)}%`);
}

// (2) WALK-FORWARD: multiple split points, TEST-half avg at CALIBRATED per-ticker cost
console.log('\n(2) WALK-FORWARD (test-half avg net @ CALIBRATED cost, per split point):');
for (const frac of [0.3, 0.4, 0.5, 0.6, 0.7]) {
  const sd = days[Math.floor(days.length * frac)];
  const te = R.filter(r => r.day >= sd).map(r => net(r.gross, r.cost)), tr = R.filter(r => r.day < sd).map(r => net(r.gross, r.cost));
  console.log(`  split@${(frac * 100).toFixed(0)}% (${sd})  train ${pct(mean(tr)).padStart(7)}  test ${pct(mean(te)).padStart(7)}  (testN=${te.length})`);
}

// (3) BLOCK BOOTSTRAP by day — CI on mean net at CALIBRATED cost
console.log('\n(3) BLOCK BOOTSTRAP by day (1000x, mean net/trade @ CALIBRATED cost):');
const byDay = {}; for (const r of R) (byDay[r.day] = byDay[r.day] || []).push(net(r.gross, r.cost));
const dl = Object.keys(byDay);
const boots = [];
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
for (let b = 0; b < 1000; b++) {
  const samp = [];
  for (let i = 0; i < dl.length; i++) samp.push(...byDay[dl[Math.floor(rnd() * dl.length)]]);
  boots.push(mean(samp));
}
boots.sort((a, b) => a - b);
console.log(`  mean net/trade  p5 ${pct(boots[50])}  p50 ${pct(boots[500])}  p95 ${pct(boots[950])}   (edge>0 in ${(boots.filter(x => x > 0).length / 10).toFixed(0)}% of resamples)`);

// (4) TAIL-DEPENDENCE: drop top-K winners (gross), recompute @ CALIBRATED cost
console.log('\n(4) TAIL-DEPENDENCE (drop top-K gross winners, mean net @ CALIBRATED cost):');
const sortedNet = R.map(r => ({ g: r.gross, n: net(r.gross, r.cost) })).sort((a, b) => b.g - a.g);
for (const K of [0, 5, 10, 20]) {
  const kept = sortedNet.slice(K).map(x => x.n);
  console.log(`  drop top ${String(K).padStart(2)}  avg ${pct(mean(kept)).padStart(7)}  n=${kept.length}`);
}

// (5) PER-DAY P&L (equal size/trade), daily Sharpe-like
console.log('\n(5) PER-DAY P&L (equal unit/trade, net @ rt=8%):');
const dailies = Object.values(byDay).map(a => a.reduce((s, x) => s + x, 0));
const dm = mean(dailies), dsd = Math.sqrt(mean(dailies.map(x => (x - dm) ** 2)));
console.log(`  avg day ${pct(dm)}  std ${pct(dsd)}  positive days ${(dailies.filter(x => x > 0).length / dailies.length * 100).toFixed(0)}%  daily Sharpe ~${(dm / dsd).toFixed(2)}`);
