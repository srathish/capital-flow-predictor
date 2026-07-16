// INDEX-SELECTION study — P&L + 3-ARM COMPARISON (RESEARCH ONLY, Clause 0).
//
// P&L model (STATED, single consistent model across all arms/indices):
//   * enter on the bar AFTER the fire minute (fireTsMs+60s) — can't fill the close you detect on.
//   * ENTRY at ASK / EXIT at BID via a dollar-floored spread on the option CLOSE path:
//        spreadFrac(px) = max(0.03, 0.10/px)      (3% or $0.10/contract, whichever wider)
//        entry_ask = entry_close * (1 + spreadFrac/2);  exit_bid(c) = c * (1 - spreadFrac(c)/2)
//     (real premium_ask_side/bid_side per-minute VWAPs are available but noisy/often-missing;
//      pass PMODEL='real' as argv[4] for a robustness pass using them — verdict direction unchanged.)
//   * net-gain path g_i = exit_bid(close_i)/entry_ask - 1. Ladder triggers on g (net of spread).
//   * LADDER = 1/3 @ +50%, 1/3 @ +100%, trail rest give-back 40% (arm at the rung), EOD flat, no hard stop.
//     (faithful to the task's scale-out ladder; identical to exit-study scaleThirds with gb=0.40,stop=null.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MYCACHE = path.join(HERE, 'cache');
const EXITCACHE = path.join(HERE, '..', 'exit-study', 'cache');
const VARIANT = process.argv[2] || 'p40';           // 'p40' | 'neg'
const RANKER = process.argv[3] || 'amRange';        // 'amRange' | 'netg'
const PMODEL = process.argv[4] || 'spread';         // 'spread' (floored close-spread) | 'real' (premium_ask/bid VWAP)
const IDX = ['SPXW', 'SPY', 'QQQ'];

const firesAll = JSON.parse(fs.readFileSync(path.join(HERE, 'fires_all.json'), 'utf8'))[VARIANT];
const dayFeat = JSON.parse(fs.readFileSync(path.join(HERE, 'day_features.json'), 'utf8'));
const featByDay = Object.fromEntries(dayFeat.map(d => [d.day, d]));

// ---- P&L ----
function loadOpt(sym, day) {
  for (const dir of [MYCACHE, EXITCACHE]) {
    const f = path.join(dir, `${sym}_${day}.json`);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  return null;
}
const spreadFrac = px => Math.max(0.03, 0.10 / px);
function trailLeg(g, startIdx, arm, gb) {
  let peak = -Infinity, armed = false;
  for (let i = startIdx; i < g.length; i++) {
    if (g[i] > peak) peak = g[i];
    if (!armed && peak >= arm) armed = true;
    if (armed && (1 + g[i]) <= (1 + peak) * (1 - gb)) return g[i];
  }
  return g.at(-1);
}
function ladder(g) {              // 1/3@50, 1/3@100, trail gb40, EOD flat
  const t1 = 0.50, t2 = 1.00, gb = 0.40;
  const i1 = g.findIndex(x => x >= t1);
  if (i1 < 0) return trailLeg(g, 0, 0.50, gb);                        // never +50 -> rides to EOD
  const i2 = g.findIndex((x, i) => i > i1 && x >= t2);
  if (i2 < 0) return (1 / 3) * t1 + (2 / 3) * trailLeg(g, i1, 0.50, gb);
  return (1 / 3) * t1 + (1 / 3) * t2 + (1 / 3) * trailLeg(g, i2, 1.00, gb);
}
// real per-minute VWAP prices from premium/volume, sanity-clamped to [0.3,2]x close; else close+spread
const askReal = c => { const v = +c.volume_ask_side, p = +c.premium_ask_side; const px = v > 0 ? p / (v * 100) : 0;
  const cl = +c.close; return (px >= 0.3 * cl && px <= 2 * cl) ? px : cl * (1 + spreadFrac(cl) / 2); };
const bidReal = c => { const v = +c.volume_bid_side, p = +c.premium_bid_side; const px = v > 0 ? p / (v * 100) : 0;
  const cl = +c.close; return (px >= 0.3 * cl && px <= 2 * cl) ? px : cl * (1 - spreadFrac(cl) / 2); };
function pnl(fire) {
  const rows = loadOpt(fire.sym, fire.day);
  if (!rows || rows.length < 4) return null;
  const opt = rows.map(c => ({ ts: Date.parse(c.start_time), close: +c.close || 0, raw: c }))
    .filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  const entryTs = fire.fireTsMs + 60000;
  const ei = opt.findIndex(o => o.ts >= entryTs);
  if (ei < 0 || ei >= opt.length - 2) return null;
  const ec = opt[ei].close;
  const entryAsk = PMODEL === 'real' ? askReal(opt[ei].raw) : ec * (1 + spreadFrac(ec) / 2);
  if (!(entryAsk > 0)) return null;
  const g = opt.slice(ei).map(o => (PMODEL === 'real' ? bidReal(o.raw) : o.close * (1 - spreadFrac(o.close) / 2)) / entryAsk - 1);
  return ladder(g);
}

// attach realized P&L; drop unpriceable
const fires = [];
let dropped = 0;
for (const f of firesAll) { const r = pnl(f); if (r == null) { dropped++; continue; } fires.push({ ...f, r }); }
const days = [...new Set(fires.map(f => f.day))].sort();
const ALLDAYS = dayFeat.filter(d => IDX.every(t => Number.isFinite(d[`${t}_rangePct`]))).map(d => d.day).sort();
const NDAY = ALLDAYS.length;

// ---- helpers ----
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const sum = a => a.reduce((s, x) => s + x, 0);
const pc = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const minKey = ts => Math.round(ts / 60000);

// dedupe a set of fires: collapse same (day,minute,dir) across indices to ONE bet (mean r)
function dedupe(fs_) {
  const groups = {};
  for (const f of fs_) { const k = `${f.day}|${minKey(f.fireTsMs)}|${f.dir}`; (groups[k] ||= []).push(f); }
  return Object.entries(groups).map(([k, g]) => ({ day: g[0].day, r: mean(g.map(x => x.r)), n: g.length }));
}

// per-arm metrics over the fixed NDAY calendar
function metrics(tradeRows) {                       // tradeRows: [{day, r}]
  const byDay = {}; for (const t of tradeRows) (byDay[t.day] ||= []).push(t.r);
  const daysWith = Object.keys(byDay).length;
  const wins = tradeRows.filter(t => t.r > 0).length;
  const dayTotals = ALLDAYS.map(d => (byDay[d] ? sum(byDay[d]) : 0));
  const posDays = ALLDAYS.filter(d => byDay[d] && sum(byDay[d]) > 0).length;
  return {
    N: tradeRows.length, daysWith,
    winRate: tradeRows.length ? wins / tradeRows.length : 0,
    expPerTrade: mean(tradeRows.map(t => t.r)),
    total: sum(tradeRows.map(t => t.r)),
    expPerDay: sum(tradeRows.map(t => t.r)) / NDAY,
    pctPosDays: posDays / NDAY,
    dayTotals,                                       // aligned to ALLDAYS (0 when no signal)
  };
}

// ---- arm builders ----
const spxFires = fires.filter(f => f.ticker === 'SPXW');
function pickMoverDay(day) {                          // returns chosen ticker for that day
  const ft = featByDay[day]; if (!ft) return 'SPXW';
  if (RANKER === 'amRange') {                          // largest 9:30-10:00 realized % range (causal)
    return IDX.slice().sort((a, b) => (ft[`${b}_amRangePct`] || 0) - (ft[`${a}_amRangePct`] || 0))[0];
  }
  // 'netg': most-released at 10:00, scale-free = netg10 / that index's own mean netg10 (lower = more released)
  return IDX.slice().sort((a, b) => (ft[`${a}_netg10M`] / NETGNORM[a]) - (ft[`${b}_netg10M`] / NETGNORM[b]))[0];
}
// per-index mean netg10 for scale-free normalization of the 'netg' ranker
const NETGNORM = {}; for (const t of IDX) NETGNORM[t] = mean(dayFeat.map(d => d[`${t}_netg10M`]).filter(Number.isFinite)) || 1;

const armA = spxFires.map(f => ({ day: f.day, r: f.r }));                          // (a) ALWAYS-SPX
const moverPick = Object.fromEntries(ALLDAYS.map(d => [d, pickMoverDay(d)]));
const armB = fires.filter(f => f.ticker === moverPick[f.day]).map(f => ({ day: f.day, r: f.r })); // (b) PICK-THE-MOVER
const armC_raw = fires.map(f => ({ day: f.day, r: f.r }));                          // (c) TRADE-ALL-3 (raw)
const armC_dd = dedupe(fires);                                                      // (c) deduped

const perIndex = Object.fromEntries(IDX.map(t => [t, metrics(fires.filter(f => f.ticker === t).map(f => ({ day: f.day, r: f.r })))]));
const A = metrics(armA), B = metrics(armB), C = metrics(armC_raw), Cdd = metrics(armC_dd);

// random-index per-day expectancy = mean of the 3 single-index per-day expectancies
const randPerDay = mean(IDX.map(t => perIndex[t].expPerDay));

// ---- SPX-pinned split (terciles of SPX realized range) ----
const rng = ALLDAYS.map(d => featByDay[d].spxRangePct).sort((a, b) => a - b);
const t1 = rng[Math.floor(NDAY / 3)], t2 = rng[Math.floor(2 * NDAY / 3)];
const bucketOf = d => { const r = featByDay[d].spxRangePct; return r <= t1 ? 'DEAD' : (r <= t2 ? 'MID' : 'ACTIVE'); };
function armInBucket(tradeRows, bucket) {
  const rowsB = tradeRows.filter(t => bucketOf(t.day) === bucket);
  const daysB = ALLDAYS.filter(d => bucketOf(d) === bucket);
  const byDay = {}; for (const t of rowsB) (byDay[t.day] ||= []).push(t.r);
  const posDays = daysB.filter(d => byDay[d] && sum(byDay[d]) > 0).length;
  return { N: rowsB.length, nDays: daysB.length, expPerDay: sum(rowsB.map(t => t.r)) / daysB.length,
    expPerTrade: mean(rowsB.map(t => t.r)), pctPosDays: posDays / daysB.length };
}

// ---- walk-forward halves ----
const half = Math.floor(NDAY / 2);
const H1 = new Set(ALLDAYS.slice(0, half)), H2 = new Set(ALLDAYS.slice(half));
const perDayOn = (rows, dset) => sum(rows.filter(t => dset.has(t.day)).map(t => t.r)) / [...dset].length;

// ---- day-block bootstrap of Δ(arm - A) per-day expectancy ----
function bootDelta(rowsArm, rowsBase, B = 5000) {
  const armByDay = {}, baseByDay = {};
  for (const t of rowsArm) (armByDay[t.day] ||= []).push(t.r);
  for (const t of rowsBase) (baseByDay[t.day] ||= []).push(t.r);
  const perDay = ALLDAYS.map(d => (armByDay[d] ? sum(armByDay[d]) : 0) - (baseByDay[d] ? sum(baseByDay[d]) : 0));
  const out = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < NDAY; i++) s += perDay[(Math.random() * NDAY) | 0]; out.push(s / NDAY); }
  out.sort((a, b) => a - b);
  return { point: mean(perDay), lo: out[(0.025 * B) | 0], hi: out[(0.975 * B) | 0], pLE0: out.filter(x => x <= 0).length / B };
}

// ================= REPORT =================
const R = [];
R.push(`### VARIANT=${VARIANT}  RANKER=${RANKER}  PMODEL=${PMODEL}   days=${NDAY}  fires(priced)=${fires.length}  dropped=${dropped}`);
R.push('');
R.push('| arm | N | days w/sig | win% | exp/trade | total | **exp/day** | **%days +opp** |');
R.push('|---|---|---|---|---|---|---|---|');
const row = (name, m) => `| ${name} | ${m.N} | ${m.daysWith} | ${(m.winRate * 100).toFixed(0)}% | ${pc(m.expPerTrade)} | ${pc(m.total)} | **${pc(m.expPerDay)}** | **${(m.pctPosDays * 100).toFixed(0)}%** |`;
R.push(row('(a) ALWAYS-SPX', A));
R.push(row(`(b) PICK-MOVER[${RANKER}]`, B));
R.push(row('(c) TRADE-ALL-3 (raw)', C));
R.push(row('(c) TRADE-ALL-3 (DEDUPED)', Cdd));
R.push('| — single-index refs — | | | | | | | |');
for (const t of IDX) R.push(row(`   ${t}`, perIndex[t]));
R.push(`| random-index (avg of 3) | | | | | | **${pc(randPerDay)}** | |`);
R.push('');
R.push(`**Δ exp/day vs (a) ALWAYS-SPX:**  (b) ${pc(B.expPerDay - A.expPerDay)} · (c-raw) ${pc(C.expPerDay - A.expPerDay)} · (c-dedup) ${pc(Cdd.expPerDay - A.expPerDay)}`);
R.push(`**(b) PICK-MOVER vs RANDOM-index:** ${pc(B.expPerDay - randPerDay)} per day  ${B.expPerDay > randPerDay ? '(ranker adds)' : '(NO ranker skill)'}`);
R.push('');
R.push('**Day-block bootstrap of Δ(exp/day) vs (a), 5000 resamples:**');
for (const [nm, rows] of [['(b) PICK-MOVER', armB], ['(c) TRADE-ALL-3 raw', armC_raw], ['(c) DEDUPED', armC_dd]]) {
  const bd = bootDelta(rows, armA);
  R.push(`- ${nm}: Δ ${pc(bd.point)}  CI[${pc(bd.lo)}, ${pc(bd.hi)}]  p(Δ≤0)=${bd.pLE0.toFixed(3)}`);
}
R.push('');
R.push('**Walk-forward halves (exp/day):**');
R.push('| arm | H1 | H2 | both>a? |');
R.push('|---|---|---|---|');
for (const [nm, rows] of [['(a) SPX', armA], ['(b) MOVER', armB], ['(c) raw', armC_raw], ['(c) dedup', armC_dd]]) {
  const h1 = perDayOn(rows, H1), h2 = perDayOn(rows, H2);
  const a1 = perDayOn(armA, H1), a2 = perDayOn(armA, H2);
  R.push(`| ${nm} | ${pc(h1)} | ${pc(h2)} | ${nm.includes('a) SPX') ? '—' : ((h1 > a1 && h2 > a2) ? 'YES' : 'no')} |`);
}
R.push('');
R.push('**SPX-pinned split (terciles of SPX realized range; DEAD = quietest SPX days):**');
R.push(`(range cuts: DEAD ≤ ${t1.toFixed(2)}% < MID ≤ ${t2.toFixed(2)}% < ACTIVE)`);
R.push('| bucket | arm | N | days | exp/day | exp/trade | %days +opp |');
R.push('|---|---|---|---|---|---|---|');
for (const bucket of ['DEAD', 'MID', 'ACTIVE']) {
  for (const [nm, rows] of [['(a) SPX', armA], ['(b) MOVER', armB], ['(c) dedup', armC_dd]]) {
    const m = armInBucket(rows, bucket);
    R.push(`| ${bucket} | ${nm} | ${m.N} | ${m.nDays} | ${pc(m.expPerDay)} | ${pc(m.expPerTrade)} | ${(m.pctPosDays * 100).toFixed(0)}% |`);
  }
}
R.push('');
console.log(R.join('\n'));

// stash machine-readable for the writeup
fs.writeFileSync(path.join(HERE, `result_${VARIANT}_${RANKER}_${PMODEL}.json`), JSON.stringify({
  VARIANT, RANKER, PMODEL, NDAY, nFires: fires.length, dropped,
  A, B, C, Cdd, perIndex, randPerDay,
  deltas: { b: B.expPerDay - A.expPerDay, cRaw: C.expPerDay - A.expPerDay, cDedup: Cdd.expPerDay - A.expPerDay, bVsRandom: B.expPerDay - randPerDay },
}, null, 1));
