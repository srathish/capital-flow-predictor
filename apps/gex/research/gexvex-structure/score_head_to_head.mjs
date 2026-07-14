// Score the doctrine-engine would_enters against the pattern-matcher fires on the
// SAME days, with REAL UW option marks. RESEARCH ONLY.
//
// Exit modes for the doctrine engine:
//   (a) PLAN'S OWN exit  — underlying crosses stopStrike -> stop; reaches targetStrike -> target;
//       else EOD. Option mark taken at the crossing minute. (doctrine as designed)
//   (b) LIVE-TRAIL a50/gb15/stop60 on the option-mark path (apples-to-apples w/ tracker)
// Both: entry = first option close at >= decisionTs + 60s (latency); 3% haircut on
// reactive/market exits. Same trailLeg + haircut convention as verify_scaleout.mjs.

import '../../scripts/_env-bootstrap.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_CACHE = path.join(HERE, 'cache_engine');
mkdirSync(ENGINE_CACHE, { recursive: true });
const PM_CACHE = path.join(HERE, '..', 'exit-study', 'cache');
const UND = path.join(HERE, '..', 'exit-study', 'cache_underlying');
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const HAIR = 0.03;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const engineOut = JSON.parse(readFileSync(path.join(HERE, 'engine_replay_out.json'), 'utf8'));
const fires = JSON.parse(readFileSync(path.join(HERE, '..', 'exit-study', 'fires_index.json'), 'utf8'));

function occ(t, day, dir, K) {
  return `${t}${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}${dir > 0 ? 'C' : 'P'}${String(Math.round(K * 1000)).padStart(8, '0')}`;
}
function atmStrike(ticker, spot) {
  const inc = ticker === 'SPXW' ? 5 : 1;
  return Math.round(spot / inc) * inc;
}
async function pullOption(sym, day, dir) {
  const cacheDir = dir === 'engine' ? ENGINE_CACHE : PM_CACHE;
  const f = path.join(cacheDir, `${sym}_${day}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${sym}/intraday?date=${day}`,
        { headers: { Authorization: `Bearer ${KEY}`, 'User-Agent': 'bellwether-research/1.0' }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429) { await sleep(2000 * (a + 1)); continue; }
      if (!r.ok) { writeFileSync(f, '[]'); return []; }
      const rows = (await r.json())?.data || [];
      writeFileSync(f, JSON.stringify(rows));
      await sleep(350);
      return rows;
    } catch { await sleep(1000); }
  }
  writeFileSync(f, '[]'); return [];
}
function parseOpt(rows) {
  return rows.map(c => ({ ts: Date.parse(c.start_time), close: Number(c.close) || 0, high: Number(c.high) || 0 }))
    .filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
}
// Use the ticker's OWN archived spot path (same instrument, 5-min) so stop/target
// strike crossings are in the correct price scale (SPXW ~7400, not the SPY proxy).
const ARCHIVE = path.join(HERE, '..', '..', 'data', 'skylit-archive', 'intraday');
const _undCache = new Map();
function loadUnderlying(ticker, day) {
  const k = `${ticker}|${day}`;
  if (_undCache.has(k)) return _undCache.get(k);
  const f = path.join(ARCHIVE, day, `${ticker}.jsonl.gz`);
  let out = [];
  if (existsSync(f)) {
    const lines = gunzipSync(readFileSync(f)).toString('utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try { const r = JSON.parse(line); if (r.spot != null) out.push({ ts: r.fetchedAtMs, close: r.spot }); } catch {}
    }
    out.sort((a, b) => a.ts - b.ts);
  }
  _undCache.set(k, out);
  return out;
}
// live trail leg (running-peak, causal) — identical to verify_scaleout.mjs
function trailLeg(steps, arm, gb, stop) {
  let peak = -Infinity, armed = false;
  for (let i = 0; i < steps.length; i++) {
    const g = steps[i].g;
    if (g > peak) peak = g;
    if (!armed && peak >= arm) armed = true;
    if (stop != null && g <= -stop) return { g, exit: 'stop' };
    if (armed && (1 + g) <= (1 + peak) * (1 - gb)) return { g, exit: 'trail' };
  }
  return { g: steps.at(-1).g, exit: 'eod' };
}

// ---- score the doctrine would_enters ----
const engineRows = [];
for (const w of engineOut.wouldEnters) {
  const dir = w.direction === 'calls' ? 1 : -1;
  const K = atmStrike(w.ticker, w.spot);
  const sym = occ(w.ticker, w.day, dir, K);
  const rows = await pullOption(sym, w.day, 'engine');
  const opt = parseOpt(rows);
  const rec = { ...w, sym, K, dir };
  if (opt.length < 3) { rec.drop = 'lt3bars'; engineRows.push(rec); continue; }
  const entryTs = w.tsMs + 60000;
  const ei = opt.findIndex(o => o.ts >= entryTs);
  if (ei < 0 || ei >= opt.length - 1) { rec.drop = 'no_entry_bar_or_too_late'; engineRows.push(rec); continue; }
  const entry = opt[ei].close;
  if (!(entry > 0)) { rec.drop = 'entry_le0'; engineRows.push(rec); continue; }
  const path0 = opt.slice(ei);
  const steps = path0.map(o => ({ ts: o.ts, g: (o.close - entry) / entry }));

  // (b) live-trail
  const tl = trailLeg(steps, 0.50, 0.15, 0.60);
  rec.entry = entry;
  rec.trail_gross = tl.g; rec.trail_exit = tl.exit;
  rec.trail_net = tl.g - HAIR; // reactive exits always -> haircut (marketFrac 1)

  // (a) plan's own exit via underlying crossings
  const und = loadUnderlying(w.ticker, w.day);
  const undPath = und.filter(u => u.ts >= entryTs);
  let planG = null, planExit = 'eod', hitTs = null;
  const stop = w.stopStrike, tgt = w.targetStrike;
  for (const u of undPath) {
    const s = u.close;
    const stopHit = dir > 0 ? s <= stop : s >= stop;
    const tgtHit = dir > 0 ? s >= tgt : s <= tgt;
    if (stopHit) { planExit = 'stop'; hitTs = u.ts; break; }
    if (tgtHit) { planExit = 'target'; hitTs = u.ts; break; }
  }
  if (hitTs != null) {
    // option mark at/just after the crossing minute
    let oi = path0.findIndex(o => o.ts >= hitTs);
    if (oi < 0) oi = path0.length - 1;
    planG = (path0[oi].close - entry) / entry;
  } else {
    planG = steps.at(-1).g; // EOD
  }
  rec.plan_gross = planG; rec.plan_exit = planExit;
  // haircut: target = limit fill (no haircut); stop/eod = market (haircut)
  rec.plan_net = planExit === 'target' ? planG : planG - HAIR;
  rec.undBars = undPath.length;
  engineRows.push(rec);
}

// ---- score pattern-matcher fires (live-trail + haircut) ----
function scorePMset(subset) {
  const out = [];
  for (const f of subset) {
    const fpath = path.join(PM_CACHE, `${f.sym}_${f.day}.json`);
    if (!existsSync(fpath)) { continue; }
    const opt = parseOpt(JSON.parse(readFileSync(fpath, 'utf8')));
    if (opt.length < 3) continue;
    const entryTs = f.fireTsMs + 60000;
    const ei = opt.findIndex(o => o.ts >= entryTs);
    if (ei < 0 || ei >= opt.length - 1) continue;
    const entry = opt[ei].close;
    if (!(entry > 0)) continue;
    const steps = opt.slice(ei).map(o => ({ g: (o.close - entry) / entry }));
    const tl = trailLeg(steps, 0.50, 0.15, 0.60);
    out.push({ day: f.day, ticker: f.ticker, state: f.state, dir: f.dir, net: tl.g - HAIR, gross: tl.g, exit: tl.exit });
  }
  return out;
}

const engineDays = [...new Set(engineOut.wouldEnters.map(w => w.day))];
const pmAll = scorePMset(fires);
const pmSameDays = scorePMset(fires.filter(f => engineDays.includes(f.day)));

// ---- stats helpers ----
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const sum = a => a.reduce((s, x) => s + x, 0);
function pf(a) { const w = sum(a.filter(x => x > 0)); const l = -sum(a.filter(x => x < 0)); return l === 0 ? Infinity : w / l; }
function winpct(a) { return a.length ? 100 * a.filter(x => x > 0).length / a.length : 0; }
function maxDrawdownByDayEquity(rows) {
  // rows: [{day, net}] — build per-day P&L then equity curve, return max drawdown (in return pts)
  const byDay = {};
  for (const r of rows) { byDay[r.day] = (byDay[r.day] || 0) + r.net; }
  const daysSorted = Object.keys(byDay).sort();
  let eq = 0, peak = 0, maxDD = 0;
  for (const d of daysSorted) { eq += byDay[d]; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq - peak); }
  return maxDD;
}

const engScored = engineRows.filter(r => r.trail_net != null && !r.drop);
const engTrailNet = engScored.map(r => r.trail_net);
const engPlanNet = engScored.map(r => r.plan_net);
const pmAllNet = pmAll.map(r => r.net);
const pmSameNet = pmSameDays.map(r => r.net);

const report = {
  engineDays,
  engine: {
    would_enters_total: engineOut.wouldEnters.length,
    scored: engScored.length,
    dropped: engineRows.filter(r => r.drop).map(r => ({ day: r.day, ticker: r.ticker, dir: r.direction, drop: r.drop })),
    trail: { n: engTrailNet.length, avg_net: mean(engTrailNet), total_net: sum(engTrailNet), winpct: winpct(engTrailNet), pf: pf(engTrailNet), maxDD_by_day: maxDrawdownByDayEquity(engScored.map(r=>({day:r.day,net:r.trail_net}))) },
    plan: { n: engPlanNet.length, avg_net: mean(engPlanNet), total_net: sum(engPlanNet), winpct: winpct(engPlanNet), pf: pf(engPlanNet), maxDD_by_day: maxDrawdownByDayEquity(engScored.map(r=>({day:r.day,net:r.plan_net}))) },
    perTrade: engScored.map(r => ({ day: r.day, ticker: r.ticker, dir: r.direction, sym: r.sym, entry: r.entry, trail_net: r.trail_net, trail_exit: r.trail_exit, plan_net: r.plan_net, plan_exit: r.plan_exit })),
  },
  pattern_matcher_all: { n: pmAllNet.length, avg_net: mean(pmAllNet), total_net: sum(pmAllNet), winpct: winpct(pmAllNet), pf: pf(pmAllNet), maxDD_by_day: maxDrawdownByDayEquity(pmAll) },
  pattern_matcher_same_days: { n: pmSameNet.length, avg_net: mean(pmSameNet), total_net: sum(pmSameNet), winpct: winpct(pmSameNet), pf: pf(pmSameNet), maxDD_by_day: maxDrawdownByDayEquity(pmSameDays) },
};
writeFileSync(path.join(HERE, 'head_to_head_out.json'), JSON.stringify(report, null, 2));

// ---- console ----
const p = (x, d=1) => (x >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%';
console.log(`\n=== DOCTRINE ENGINE would_enters (n=${engineOut.wouldEnters.length}, scored=${engScored.length}) ===`);
console.log('per-trade (net of 3% haircut):');
for (const r of engScored) {
  console.log(`  ${r.day} ${r.ticker.padEnd(4)} ${r.direction.padEnd(5)} entry=${r.entry.toFixed(2).padStart(7)}  trail ${p(r.trail_net).padStart(8)} (${r.trail_exit})  plan ${p(r.plan_net).padStart(8)} (${r.plan_exit})`);
}
for (const r of engineRows.filter(r=>r.drop)) console.log(`  ${r.day} ${r.ticker} ${r.direction}  DROPPED: ${r.drop}`);
console.log(`\n--- HEAD TO HEAD (net, 3% haircut, live-trail a50/gb15) ---`);
const fmt = (o) => `n=${String(o.n).padStart(4)}  avg ${p(o.avg_net,2).padStart(8)}  win ${o.winpct.toFixed(0).padStart(3)}%  PF ${o.pf===Infinity?'inf':o.pf.toFixed(2)}  total ${p(o.total_net,0).padStart(7)}  maxDD ${p(o.maxDD_by_day,0)}`;
console.log(`Doctrine (trail exit) : ${fmt(report.engine.trail)}`);
console.log(`Doctrine (plan exit)  : ${fmt(report.engine.plan)}`);
console.log(`Pattern-matcher SAME9 : ${fmt(report.pattern_matcher_same_days)}`);
console.log(`Pattern-matcher ALL   : ${fmt(report.pattern_matcher_all)}`);
console.log(`\nwrote head_to_head_out.json`);
