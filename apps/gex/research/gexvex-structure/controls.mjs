// Controls for the doctrine-vs-pattern-matcher head-to-head. RESEARCH ONLY.
//   (1) volume-matched random-skip: is the doctrine's 10-trade avg better than
//       random 10-fire draws from the same days? (and from all days)
//   (2) overlap cohorts: PM fires the doctrine would APPROVE (same day+ticker+dir,
//       within 30min of a would_enter) vs REJECT — P&L of each cohort.
//   (3) per-day P&L + sign test for the doctrine trades (day-block view).
import '../../scripts/_env-bootstrap.js';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PM_CACHE = path.join(HERE, '..', 'exit-study', 'cache');
const HAIR = 0.03;

const engineOut = JSON.parse(readFileSync(path.join(HERE, 'engine_replay_out.json'), 'utf8'));
const h2h = JSON.parse(readFileSync(path.join(HERE, 'head_to_head_out.json'), 'utf8'));
const fires = JSON.parse(readFileSync(path.join(HERE, '..', 'exit-study', 'fires_index.json'), 'utf8'));
const engineDays = engineOut.wouldEnters.map(w => w.day);
const engineDaySet = new Set(engineDays);

function parseOpt(rows) {
  return rows.map(c => ({ ts: Date.parse(c.start_time), close: Number(c.close) || 0 }))
    .filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
}
function trailLeg(steps, arm, gb, stop) {
  let peak = -Infinity, armed = false;
  for (let i = 0; i < steps.length; i++) {
    const g = steps[i].g;
    if (g > peak) peak = g;
    if (!armed && peak >= arm) armed = true;
    if (stop != null && g <= -stop) return g;
    if (armed && (1 + g) <= (1 + peak) * (1 - gb)) return g;
  }
  return steps.at(-1).g;
}
function scoreFire(f) {
  const fpath = path.join(PM_CACHE, `${f.sym}_${f.day}.json`);
  if (!existsSync(fpath)) return null;
  const opt = parseOpt(JSON.parse(readFileSync(fpath, 'utf8')));
  if (opt.length < 3) return null;
  const entryTs = f.fireTsMs + 60000;
  const ei = opt.findIndex(o => o.ts >= entryTs);
  if (ei < 0 || ei >= opt.length - 1) return null;
  const entry = opt[ei].close;
  if (!(entry > 0)) return null;
  const steps = opt.slice(ei).map(o => ({ g: (o.close - entry) / entry }));
  return trailLeg(steps, 0.50, 0.15, 0.60) - HAIR;
}

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const sum = a => a.reduce((s, x) => s + x, 0);
const pf = a => { const w = sum(a.filter(x => x > 0)); const l = -sum(a.filter(x => x < 0)); return l === 0 ? Infinity : w / l; };
const winp = a => a.length ? 100 * a.filter(x => x > 0).length / a.length : 0;

// score all PM fires on engine days, retaining metadata
const pmSame = [];
for (const f of fires.filter(f => engineDaySet.has(f.day))) {
  const net = scoreFire(f);
  if (net == null) continue;
  pmSame.push({ day: f.day, ticker: f.ticker, dir: f.dir, ts: f.fireTsMs, state: f.state, net });
}
const pmAll = [];
for (const f of fires) { const net = scoreFire(f); if (net != null) pmAll.push({ day: f.day, net }); }

const docTrail = h2h.engine.trail;   // {n, avg_net, total_net, ...}
const docTrades = h2h.engine.perTrade; // per-trade with trail_net

// ---- (1) volume-matched random-skip ----
function randomSkip(pool, k, draws, targetAvg) {
  let geAvg = 0; const avgs = [];
  for (let d = 0; d < draws; d++) {
    let s = 0;
    for (let i = 0; i < k; i++) s += pool[(Math.random() * pool.length) | 0].net;
    const a = s / k; avgs.push(a);
    if (a >= targetAvg) geAvg++;
  }
  avgs.sort((x, y) => x - y);
  return { p_ge: geAvg / draws, poolAvg: mean(pool.map(x => x.net)), median: avgs[avgs.length >> 1] };
}
const K = docTrail.n; const DRAWS = 50000;
const rsSame = randomSkip(pmSame, K, DRAWS, docTrail.avg_net);
const rsAll = randomSkip(pmAll, K, DRAWS, docTrail.avg_net);

// ---- (2) overlap cohorts ----
// A PM fire is "doctrine-approved-adjacent" if a would_enter exists on same
// day+ticker+direction within 30 minutes.
const we = engineOut.wouldEnters.map(w => ({ day: w.day, ticker: w.ticker, dir: w.direction === 'calls' ? 1 : -1, ts: w.tsMs }));
function approved(f) {
  return we.some(w => w.day === f.day && w.ticker === f.ticker && w.dir === f.dir && Math.abs(w.ts - f.ts) <= 30 * 60 * 1000);
}
const approvedCohort = pmSame.filter(approved).map(f => f.net);
const rejectedCohort = pmSame.filter(f => !approved(f)).map(f => f.net);

// ---- (3) per-day doctrine P&L + sign test ----
const byDay = {};
for (const t of docTrades) byDay[t.day] = (byDay[t.day] || 0) + t.trail_net;
const dayPnls = Object.entries(byDay).sort();
const posDays = dayPnls.filter(([, v]) => v > 0).length;
const negDays = dayPnls.filter(([, v]) => v < 0).length;

// ---- output ----
const p = (x, d = 2) => (x >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%';
console.log(`\n=== CONTROLS ===`);
console.log(`\n(1) VOLUME-MATCHED RANDOM-SKIP  (draw ${K} fires, ${DRAWS} draws, live-trail net)`);
console.log(`  doctrine trail avg          = ${p(docTrail.avg_net)}`);
console.log(`  same-day pool avg (n=${pmSame.length})    = ${p(rsSame.poolAvg)}   random-draw median ${p(rsSame.median)}`);
console.log(`  P(random ${K}-draw avg >= doctrine) SAME DAYS = ${(rsSame.p_ge * 100).toFixed(2)}%`);
console.log(`  all-day pool avg (n=${pmAll.length})    = ${p(rsAll.poolAvg)}   random-draw median ${p(rsAll.median)}`);
console.log(`  P(random ${K}-draw avg >= doctrine) ALL DAYS  = ${(rsAll.p_ge * 100).toFixed(2)}%`);
console.log(`  (Bonferroni across 2 exit modes: significance needs p < 0.025)`);

console.log(`\n(2) OVERLAP COHORTS  (PM fires on the 9 engine days, live-trail net)`);
console.log(`  doctrine-APPROVED-adjacent : n=${approvedCohort.length}  avg ${p(mean(approvedCohort))}  win ${winp(approvedCohort).toFixed(0)}%  PF ${pf(approvedCohort) === Infinity ? 'inf' : pf(approvedCohort).toFixed(2)}`);
console.log(`  doctrine-REJECTED          : n=${rejectedCohort.length}  avg ${p(mean(rejectedCohort))}  win ${winp(rejectedCohort).toFixed(0)}%  PF ${pf(rejectedCohort) === Infinity ? 'inf' : pf(rejectedCohort).toFixed(2)}`);
console.log(`  (Note: ${we.length} would_enters -> at most a handful of PM fires land in the approved cohort.)`);

console.log(`\n(3) PER-DAY DOCTRINE P&L (trail net)  — ${posDays} up / ${negDays} down days`);
for (const [d, v] of dayPnls) console.log(`  ${d}  ${p(v, 0)}`);
console.log(`  two-sided sign test p (days) ≈ ${signTest(posDays, negDays).toFixed(3)}`);

function signTest(a, b) {
  const n = a + b; if (n === 0) return 1;
  // exact two-sided binomial at p=0.5
  const k = Math.min(a, b);
  let cum = 0; for (let i = 0; i <= k; i++) cum += choose(n, i);
  return Math.min(1, 2 * cum / Math.pow(2, n));
}
function choose(n, k) { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; }
