// Exit DESIGN study — SCALE-OUT ladders + REGIME-conditioned exits (RESEARCH ONLY, Clause 0).
// 3rd of a parallel exit fan-out. Lane: PARTIAL/SCALE-OUT + regime conditioning.
// Reuses build_dataset.mjs cache (real per-minute UW option marks) + cache_underlying.
//
// Fidelity guardrails (identical to backtest_strategies/backtest_variants):
//   - entry = option close at first candle >= fireTs + 60s (confirmation delay)
//   - every exit evaluated on candle CLOSE only (no intra-bar look-ahead)
//   - realized = (exit_close - entry)/entry ; peak tracked on close basis
//
// Baselines (report vs BOTH):
//   - HOLD-EOD (no management)
//   - LIVE-TRAIL = deployed trail arm0.50 / giveback0.15 / hardstop0.60
//
// Fills: a per-leg haircut (arg1, e.g. 0.02) is charged on every MARKET exit leg
//   (trailing-stop / hard-stop / EOD). PROFIT-TARGET partials are limit orders and
//   fill at the target (no haircut) — the realistic asymmetry for scale-outs.
//   Weighted by the position fraction exited via each mechanism.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const UND = path.join(HERE, 'cache_underlying');
const undKey = t => (t === 'SPXW' ? 'SPY' : t);
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
const HAIR = Number(process.argv[2] || 0);         // per-leg market-exit haircut (fraction)

// ---- build per-fire option path (gain steps) ----
function buildPath(fire) {
  const opt = load(path.join(CACHE, `${fire.sym}_${fire.day}.json`))
    .map(c => ({ ts: Date.parse(c.start_time), close: Number(c.close) || 0 }))
    .filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const entryTs = fire.fireTsMs + 60000;
  const ei = opt.findIndex(o => o.ts >= entryTs);
  if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close;
  if (!(entry > 0)) return null;
  const steps = opt.slice(ei).map(o => ({ ts: o.ts, g: (o.close - entry) / entry }));
  return { fire, entry, steps, day: fire.day, key: `${fire.day}|${undKey(fire.ticker)}` };
}

// ---- regime per (day, undTicker) from REGULAR-session underlying bars ----
// efficiency ratio ER = |net move| / sum(|bar-to-bar move|). High ER = TREND.
// TWO variants:
//   full  : whole session (open->close). NOT tradeable — uses info unknown at fire
//           time. Kept only to characterise the *upper bound* / motivation.
//   causal: only bars with ts <= fireTsMs (info actually available at decision time).
//           This is the honest, tradeable regime signal.
function loadReg(undT, day) {
  return load(path.join(UND, `${undT}_${day}.json`))
    .filter(c => c.market_time === 'r')          // regular session only
    .map(c => ({ ts: Date.parse(c.start_time), close: +c.close, high: +c.high, low: +c.low }))
    .filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
}
function erOf(rows) {
  if (rows.length < 15) return null;
  const first = rows[0].close, last = rows.at(-1).close;
  let pathLen = 0, hi = -Infinity, lo = Infinity;
  for (let i = 0; i < rows.length; i++) {
    if (i) pathLen += Math.abs(rows[i].close - rows[i - 1].close);
    hi = Math.max(hi, rows[i].high); lo = Math.min(lo, rows[i].low);
  }
  const net = Math.abs(last - first);
  return { er: pathLen > 0 ? net / pathLen : 0, netPct: net / first, rangePct: (hi - lo) / first, bars: rows.length };
}
const regFullCache = {}, regRowsCache = {};
function regimeFull(day, undT) {
  const k = `${undT}_${day}`;
  if (!(k in regFullCache)) { const r = loadReg(undT, day); regRowsCache[k] = r; regFullCache[k] = erOf(r); }
  return regFullCache[k];
}
// causal: ER of bars up to fireTsMs (needs >=15 bars available at decision time)
function regimeCausal(day, undT, fireTsMs) {
  const k = `${undT}_${day}`;
  if (!(k in regRowsCache)) { const r = loadReg(undT, day); regRowsCache[k] = r; regFullCache[k] = erOf(r); }
  const upto = regRowsCache[k].filter(c => c.ts <= fireTsMs);
  return erOf(upto);   // null if <15 bars (too early in the session)
}

// ==================== EXIT FAMILIES ====================
// Each returns { g, marketFrac } where marketFrac = position fraction exited via a
// market mechanism (trail/stop/EOD) that eats the haircut. Limit profit-takes are
// haircut-free. Final realized = g - HAIR*marketFrac.

// canonical trailing stop in GAIN space: arm when peak_g >= arm; exit when price
// falls giveback off peak i.e. (1+g) <= (1+peak)*(1-gb); hard stop at g <= -stop.
function trailLeg(steps, startIdx, arm, gb, stop) {
  let peak = -Infinity, armed = false;
  for (let i = startIdx; i < steps.length; i++) {
    const g = steps[i].g;
    if (g > peak) peak = g;
    if (!armed && peak >= arm) armed = true;
    if (stop != null && g <= -stop) return g;                       // hard stop
    if (armed && (1 + g) <= (1 + peak) * (1 - gb)) return g;         // trail
  }
  return steps.at(-1).g;                                            // EOD
}

const FAM = {};
// --- baselines ---
FAM['HOLD-EOD'] = P => ({ g: P.steps.at(-1).g, marketFrac: 1 });
FAM['LIVE-TRAIL a50/gb15'] = P => ({ g: trailLeg(P.steps, 0, 0.50, 0.15, 0.60), marketFrac: 1 });

// --- (a) half at +50, trail remainder 20% / 30% ---
function scaleHalfTrail(take, gb, stop) {
  return P => {
    const s = P.steps;
    let ti = -1;
    for (let i = 0; i < s.length; i++) if (s[i].g >= take) { ti = i; break; }
    if (ti < 0) {                                   // never hit target: whole pos trails
      return { g: trailLeg(s, 0, 0.50, gb, stop), marketFrac: 1 };
    }
    const restG = trailLeg(s, ti, take, gb, stop);  // remainder armed from the take level
    return { g: 0.5 * take + 0.5 * restG, marketFrac: 0.5 };   // half limit (no hair), half market
  };
}
FAM['SCALE ½@50 trail20'] = scaleHalfTrail(0.50, 0.20, 0.60);
FAM['SCALE ½@50 trail30'] = scaleHalfTrail(0.50, 0.30, 0.60);

// --- (b) 1/3 at +50, 1/3 at +100, trail final third 30% ---
function scaleThirds(t1, t2, gb, stop) {
  return P => {
    const s = P.steps;
    let i1 = -1, i2 = -1;
    for (let i = 0; i < s.length; i++) { if (i1 < 0 && s[i].g >= t1) i1 = i; if (i2 < 0 && s[i].g >= t2) i2 = i; if (i1 >= 0 && i2 >= 0) break; }
    if (i1 < 0) return { g: trailLeg(s, 0, 0.50, gb, stop), marketFrac: 1 };  // never reached +50
    if (i2 < 0) {                                   // hit +50 but not +100: 1/3 booked, 2/3 trails
      const restG = trailLeg(s, i1, t1, gb, stop);
      return { g: (1 / 3) * t1 + (2 / 3) * restG, marketFrac: 2 / 3 };
    }
    const restG = trailLeg(s, i2, t2, gb, stop);    // both booked, final third trails from +100
    return { g: (1 / 3) * t1 + (1 / 3) * t2 + (1 / 3) * restG, marketFrac: 1 / 3 };
  };
}
FAM['SCALE ⅓@50 ⅓@100 tr30'] = scaleThirds(0.50, 1.00, 0.30, 0.60);

// --- (c) fixed full-exit targets ---
function fixedTarget(take, stop) {
  return P => {
    for (const st of P.steps) {
      if (st.g >= take) return { g: take, marketFrac: 0 };          // limit fill at target
      if (stop != null && st.g <= -stop) return { g: st.g, marketFrac: 1 };
    }
    return { g: P.steps.at(-1).g, marketFrac: 1 };
  };
}
FAM['FIXED +75'] = fixedTarget(0.75, 0.60);
FAM['FIXED +100'] = fixedTarget(1.00, 0.60);

// ==================== REGIME-CONDITIONED ====================
// Built separately below (needs per-fire regime label). Two arms:
//   TREND day -> looser (hold-EOD, let winners run)
//   CHOP  day -> tighter/faster (trail arm20/gb15, quick cut)
// Compared vs the FLAT version (same tighter trail applied to ALL days) + baselines.
function regimeExit(isTrend, chopGb) {
  return P => {
    if (isTrend(P)) return { g: P.steps.at(-1).g, marketFrac: 1 };            // TREND: hold EOD
    return { g: trailLeg(P.steps, 0, 0.20, chopGb, 0.60), marketFrac: 1 };    // CHOP: tight trail
  };
}
function flatTight(chopGb) { return P => ({ g: trailLeg(P.steps, 0, 0.20, chopGb, 0.60), marketFrac: 1 }); }

// ==================== load + build ====================
const fires = load(path.join(HERE, 'fires_index.json'));
const built = [];
for (const f of fires) { const P = buildPath(f); if (P) built.push(P); }
// attach regime — both full (look-ahead, motivation only) and causal (tradeable)
for (const P of built) {
  const [d, t] = P.key.split('|');
  P.reg = regimeFull(d, t);
  P.regC = regimeCausal(d, t, P.fire.fireTsMs);
}
const withReg = built.filter(P => P.reg);
const withRegC = built.filter(P => P.regC);
const days = [...new Set(built.map(P => P.day))].sort();
console.error(`built ${built.length}/${fires.length} paths, ${withReg.length} with regime, ${days.length} days (${days[0]}..${days.at(-1)})`);

// ==================== stats helpers ====================
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const med = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const win = a => a.filter(x => x > 0).length / a.length;
const pct = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const p1 = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;
// haircut model: default charges HAIR only on market-exit legs (limit partials fill
// clean). Pass "all" as arg2 to charge HAIR on the WHOLE position (conservative:
// treats even the profit-target limit as slipping vs the mid).
const HAIR_ALL = process.argv[3] === 'all';
const realized = (famFn, P) => { const r = famFn(P); return r.g - HAIR * (HAIR_ALL ? 1 : (r.marketFrac || 0)); };

function bootDelta(famFn, baseFn, subset, B = 3000) {
  const paired = subset.map(P => realized(famFn, P) - realized(baseFn, P));
  const n = paired.length; const out = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += paired[(Math.random() * n) | 0]; out.push(s / n); }
  out.sort((a, b) => a - b);
  return { lo: out[(0.025 * B) | 0], hi: out[(0.975 * B) | 0], p: out.filter(x => x <= 0).length / B, point: mean(paired) };
}
function looWorst(famFn, baseFn) {
  let worst = Infinity;
  for (const d of days) { const sub = built.filter(P => P.day !== d); worst = Math.min(worst, mean(sub.map(P => realized(famFn, P))) - mean(sub.map(P => realized(baseFn, P)))); }
  return worst;
}

// walk-forward chronological halves
const splitIdx = Math.floor(days.length / 2);
const trainDays = new Set(days.slice(0, splitIdx)), testDays = new Set(days.slice(splitIdx));
const trainSet = built.filter(P => trainDays.has(P.day)), testSet = built.filter(P => testDays.has(P.day));

// ==================== REPORT: scale-out families vs both baselines ====================
console.log(`\n# SCALE-OUT + REGIME EXIT STUDY  (market-leg fill haircut = ${(HAIR * 100).toFixed(1)}%)`);
console.log(`built ${built.length} fires / ${days.length} days. Baselines: HOLD-EOD and LIVE-TRAIL(a50/gb15).\n`);

const names = Object.keys(FAM);
function table(label, subset) {
  console.log(`\n===== ${label}  (n=${subset.length}) =====`);
  console.log('family'.padEnd(24) + 'avg'.padStart(8) + 'med'.padStart(8) + 'win%'.padStart(6) + 'ΔvsEOD'.padStart(8) + 'ΔvsTRAIL'.padStart(9));
  for (const nm of names) {
    const g = subset.map(P => realized(FAM[nm], P));
    const dEod = mean(g) - mean(subset.map(P => realized(FAM['HOLD-EOD'], P)));
    const dTr = mean(g) - mean(subset.map(P => realized(FAM['LIVE-TRAIL a50/gb15'], P)));
    console.log(nm.padEnd(24) + pct(mean(g)).padStart(8) + pct(med(g)).padStart(8) + (win(g) * 100).toFixed(0).padStart(5) + '%' + p1(dEod).padStart(8) + p1(dTr).padStart(9));
  }
}
table('ALL FIRES', built);
table('BULL_REVERSE only', built.filter(P => P.fire.state === 'BULL_REVERSE'));

// robustness for scale-out families vs BOTH baselines
console.log(`\n--- ROBUSTNESS (ALL fires): Δ vs HOLD-EOD | Δ vs LIVE-TRAIL, boot95CI, p, LOOworst, WF ---`);
for (const nm of names) {
  if (nm === 'HOLD-EOD' || nm === 'LIVE-TRAIL a50/gb15') continue;
  for (const [bname, bfn] of [['EOD', FAM['HOLD-EOD']], ['TRAIL', FAM['LIVE-TRAIL a50/gb15']]]) {
    const boot = bootDelta(FAM[nm], bfn, built);
    const loo = looWorst(FAM[nm], bfn);
    const trA = mean(trainSet.map(P => realized(FAM[nm], P))) - mean(trainSet.map(P => realized(bfn, P)));
    const teA = mean(testSet.map(P => realized(FAM[nm], P))) - mean(testSet.map(P => realized(bfn, P)));
    const wf = (trA > 0 && teA > 0) ? 'YES' : 'no';
    console.log(`${nm.padEnd(24)} vs ${bname.padEnd(6)} Δ${p1(boot.point).padStart(6)}  CI[${p1(boot.lo)},${p1(boot.hi)}]  p=${boot.p.toFixed(3)}  LOO${p1(loo).padStart(6)}  tr${p1(trA)}/te${p1(teA)} ${wf}`);
  }
}

// ==================== REGIME analysis ====================
// Run for BOTH label sources: full (look-ahead upper bound) and causal (tradeable).
function runRegime(labelSrc, tag) {
  const pool = built.filter(P => labelSrc(P));
  const trainER = pool.filter(P => trainDays.has(P.day)).map(P => labelSrc(P).er);
  const erThresh = med(trainER);          // TREND if ER >= train-median ER (threshold fit on TRAIN only)
  const isTrend = P => { const r = labelSrc(P); return r && r.er >= erThresh; };
  const trendSet = pool.filter(isTrend), chopSet = pool.filter(P => !isTrend(P));
  console.log(`\n\n===== REGIME SPLIT [${tag}] =====`);
  console.log(`ER threshold (train-median) = ${erThresh.toFixed(3)}. pool=${pool.length} TREND=${trendSet.length} CHOP=${chopSet.length}`);
  console.log(`TREND avg fullNetPct ${(mean(trendSet.map(P => P.reg.netPct)) * 100).toFixed(2)}%  CHOP ${(mean(chopSet.map(P => P.reg.netPct)) * 100).toFixed(2)}%`);
  console.log(`Baseline behaviour by regime (avg realized):`);
  for (const [nm, fn] of [['HOLD-EOD', FAM['HOLD-EOD']], ['LIVE-TRAIL', FAM['LIVE-TRAIL a50/gb15']]])
    console.log(`  ${nm.padEnd(12)} TREND ${pct(mean(trendSet.map(P => realized(fn, P))))}   CHOP ${pct(mean(chopSet.map(P => realized(fn, P))))}`);

  console.log(`\nREGIME-CONDITIONED (TREND->hold-EOD, CHOP->tight trail a20) vs FLAT + baselines:`);
  const trTr = trainSet.filter(labelSrc), teTr = testSet.filter(labelSrc);
  for (const chopGb of [0.15, 0.20]) {
    const rc = regimeExit(isTrend, chopGb), flat = flatTight(chopGb);
    for (const [nm, fn] of [['REGIME(chopGb' + chopGb + ')', rc], ['FLAT-tight(gb' + chopGb + ')', flat]]) {
      const dEod = bootDelta(fn, FAM['HOLD-EOD'], pool), dTr = bootDelta(fn, FAM['LIVE-TRAIL a50/gb15'], pool);
      const trA = mean(trTr.map(P => realized(fn, P))) - mean(trTr.map(P => realized(FAM['HOLD-EOD'], P)));
      const teA = mean(teTr.map(P => realized(fn, P))) - mean(teTr.map(P => realized(FAM['HOLD-EOD'], P)));
      console.log(`  ${nm.padEnd(22)} avg ${pct(mean(pool.map(P => realized(fn, P)))).padStart(7)}  ΔEOD ${p1(dEod.point).padStart(6)}(p${dEod.p.toFixed(3)})  ΔTRAIL ${p1(dTr.point).padStart(6)}(p${dTr.p.toFixed(3)})  WFvsEOD tr${p1(trA)}/te${p1(teA)} ${(trA > 0 && teA > 0) ? 'YES' : 'no'}`);
    }
  }
  console.log(`Core hypothesis — REGIME minus FLAT (does conditioning add value?):`);
  for (const chopGb of [0.15, 0.20]) {
    const rc = regimeExit(isTrend, chopGb), flat = flatTight(chopGb);
    const b = bootDelta(rc, flat, pool);
    let w = Infinity; for (const d of days) { const sub = pool.filter(P => P.day !== d); if (sub.length) w = Math.min(w, mean(sub.map(P => realized(rc, P))) - mean(sub.map(P => realized(flat, P)))); }
    const trA = mean(trTr.map(P => realized(rc, P))) - mean(trTr.map(P => realized(flat, P)));
    const teA = mean(teTr.map(P => realized(rc, P))) - mean(teTr.map(P => realized(flat, P)));
    console.log(`  chopGb${chopGb}: REGIME−FLAT Δ${p1(b.point)} CI[${p1(b.lo)},${p1(b.hi)}] p=${b.p.toFixed(3)} LOO${p1(w)}  WF tr${p1(trA)}/te${p1(teA)} ${(trA > 0 && teA > 0) ? 'YES' : 'no'}`);
  }
}
runRegime(P => P.reg, 'FULL-DAY / LOOK-AHEAD (upper bound, NOT tradeable)');
runRegime(P => P.regC, 'CAUSAL / bars<=fire (tradeable)');
