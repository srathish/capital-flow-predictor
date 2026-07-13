// ADVERSARIAL VERIFIER for the scale-out ladder claim (RESEARCH ONLY, Clause 0).
// Independent re-implementation. Attacks: (1) fill reality (>=2 consecutive bars
// at/above the limit before crediting a rung), (2) gate-mix / bear-carry (reconstruct
// the post-bull-tape-gate fire mix), (3) look-ahead / survivorship audit,
// (4) report vs LIVE-TRAIL with realistic (>=2-bar + 3% haircut) fills.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const UND = path.join(HERE, 'cache_underlying');
const undKey = t => (t === 'SPXW' ? 'SPY' : t);
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

const HAIR = Number(process.argv[2] || 0.03);      // per market-leg haircut
const NBAR = Number(process.argv[3] || 2);         // consecutive bars required to credit a rung fill
const USE_HIGH = process.argv[4] === 'high';       // limit fills on bar HIGH touch instead of close
const HAIR_ALL = process.argv[5] === 'all';        // charge haircut on the ENTIRE position (limits too)

// ---- build per-fire option path (INDEPENDENT re-impl) ----
// Keep BOTH close and high so we can test close-based vs high-based limit fills.
function buildPath(fire) {
  const opt = load(path.join(CACHE, `${fire.sym}_${fire.day}.json`))
    .map(c => ({ ts: Date.parse(c.start_time), close: Number(c.close) || 0, high: Number(c.high) || 0 }))
    .filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return { fire, drop: 'lt4bars' };
  const entryTs = fire.fireTsMs + 60000;
  const ei = opt.findIndex(o => o.ts >= entryTs);
  if (ei < 0) return { fire, drop: 'no_entry_bar' };
  if (ei >= opt.length - 2) return { fire, drop: 'too_late' };
  const entry = opt[ei].close;
  if (!(entry > 0)) return { fire, drop: 'entry_le0' };
  const steps = opt.slice(ei).map(o => ({ ts: o.ts, g: (o.close - entry) / entry, gh: (o.high - entry) / entry }));
  return { fire, entry, steps, day: fire.day, ticker: fire.ticker };
}

// ---- trail leg (running-peak, causal — identical logic to driver) ----
function trailLeg(steps, startIdx, arm, gb, stop) {
  let peak = -Infinity, armed = false;
  for (let i = startIdx; i < steps.length; i++) {
    const g = steps[i].g;
    if (g > peak) peak = g;
    if (!armed && peak >= arm) armed = true;
    if (stop != null && g <= -stop) return g;
    if (armed && (1 + g) <= (1 + peak) * (1 - gb)) return g;
  }
  return steps.at(-1).g;
}

// ---- rung-fill index requiring N consecutive bars at/above the limit ----
// Returns the index of the Nth consecutive qualifying bar (the confirmed fill),
// or -1 if the level is never held for N consecutive bars. USE_HIGH toggles
// whether "at/above" tests bar HIGH (a touch) or bar CLOSE (a sustained level).
function confirmFill(steps, take, nbar) {
  let run = 0;
  for (let i = 0; i < steps.length; i++) {
    const v = USE_HIGH ? steps[i].gh : steps[i].g;
    if (v >= take) { run += 1; if (run >= nbar) return i; }
    else run = 0;
  }
  return -1;
}

// ---- families ----
const FAM = {};
FAM['HOLD-EOD'] = P => ({ g: P.steps.at(-1).g, marketFrac: 1 });
FAM['LIVE-TRAIL a50/gb15'] = P => ({ g: trailLeg(P.steps, 0, 0.50, 0.15, 0.60), marketFrac: 1 });

// scale thirds with N-bar confirmed rung fills
function scaleThirds(t1, t2, gb, stop, nbar) {
  return P => {
    const s = P.steps;
    const i1 = confirmFill(s, t1, nbar);
    if (i1 < 0) return { g: trailLeg(s, 0, 0.50, gb, stop), marketFrac: 1 };   // +50 never held
    const i2 = confirmFill(s, t2, nbar);
    if (i2 < 0) {                                                             // +50 held, +100 not
      const restG = trailLeg(s, i1, t1, gb, stop);
      return { g: (1 / 3) * t1 + (2 / 3) * restG, marketFrac: 2 / 3 };
    }
    const restG = trailLeg(s, i2, t2, gb, stop);
    return { g: (1 / 3) * t1 + (1 / 3) * t2 + (1 / 3) * restG, marketFrac: 1 / 3 };
  };
}
FAM['SCALE ⅓@50 ⅓@100 tr30'] = scaleThirds(0.50, 1.00, 0.30, 0.60, NBAR);

// ---- load + build (track drops for survivorship audit) ----
const fires = load(path.join(HERE, 'fires_index.json'));
const built = [], dropped = [];
for (const f of fires) { const P = buildPath(f); if (P.steps) built.push(P); else dropped.push(P); }
const days = [...new Set(built.map(P => P.day))].sort();

// ---- gate reconstruction: prior close + spot@fire for SPY / QQQ / SPXW(=SPY) ----
// prior close = last regular-session ('r') close of the most recent prior day file.
const undDaysCache = {};
function undDays(t) {
  if (undDaysCache[t]) return undDaysCache[t];
  const files = fs.readdirSync(UND).filter(f => f.startsWith(`${t}_`)).sort();
  const m = {};
  for (const f of files) {
    const day = f.slice(t.length + 1, t.length + 1 + 10);
    const rows = load(path.join(UND, f)).filter(c => c.market_time === 'r')
      .map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
    m[day] = rows;
  }
  undDaysCache[t] = m; return m;
}
function priorClose(t, day) {
  const m = undDays(t); const ds = Object.keys(m).sort();
  const idx = ds.indexOf(day); if (idx <= 0) return null;
  const prev = m[ds[idx - 1]]; return prev && prev.length ? prev.at(-1).close : null;
}
function spotAt(t, day, tsMs) {
  const m = undDays(t); const rows = m[day]; if (!rows || !rows.length) return null;
  let s = null; for (const r of rows) { if (r.ts <= tsMs) s = r.close; else break; }
  return s;
}
// gate blocks a BULL fire iff SPY, QQQ, SPXW(=SPY) ALL below their prior close at fire time.
function gateBlocks(P) {
  if (P.fire.dir <= 0) return false;           // gate only touches bulls
  const day = P.fire.day, ts = P.fire.fireTsMs;
  const spy = spotAt('SPY', day, ts), spyP = priorClose('SPY', day);
  const qqq = spotAt('QQQ', day, ts), qqqP = priorClose('QQQ', day);
  if (spy == null || spyP == null || qqq == null || qqqP == null) return false; // missing → never block
  // SPXW proxied to SPY (same as data build). all-3-below == SPY below && QQQ below.
  return spy < spyP && qqq < qqqP;
}

// ---- stats ----
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const realized = (fn, P) => { const r = fn(P); return r.g - HAIR * (HAIR_ALL ? 1 : (r.marketFrac || 0)); };
function bootDelta(fn, base, subset, B = 3000) {
  const paired = subset.map(P => realized(fn, P) - realized(base, P));
  const n = paired.length; const out = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += paired[(Math.random() * n) | 0]; out.push(s / n); }
  out.sort((a, b) => a - b);
  return { lo: out[(0.025 * B) | 0], hi: out[(0.975 * B) | 0], p: out.filter(x => x <= 0).length / B, point: mean(paired) };
}
function looWorst(fn, base, subset) {
  const dd = [...new Set(subset.map(P => P.day))]; let worst = Infinity;
  for (const d of dd) { const sub = subset.filter(P => P.day !== d); worst = Math.min(worst, mean(sub.map(P => realized(fn, P))) - mean(sub.map(P => realized(base, P)))); }
  return worst;
}
const p1 = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;
const pc = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;

const LAD = FAM['SCALE ⅓@50 ⅓@100 tr30'], EOD = FAM['HOLD-EOD'], TR = FAM['LIVE-TRAIL a50/gb15'];

console.log(`# SCALE-OUT VERIFY  (haircut=${(HAIR*100).toFixed(1)}% market-leg, rung fill needs ${NBAR} consec bars ${USE_HIGH?'HIGH-touch':'CLOSE'})`);
console.log(`built ${built.length}/${fires.length}  dropped ${dropped.length}  days ${days.length}`);
const dr = {}; for (const d of dropped) dr[d.drop] = (dr[d.drop]||0)+1;
console.log(`drop reasons: ${JSON.stringify(dr)}`);

function line(label, subset) {
  if (!subset.length) { console.log(`${label.padEnd(28)} n=0`); return; }
  const lad = subset.map(P => realized(LAD, P));
  const dE = mean(lad) - mean(subset.map(P => realized(EOD, P)));
  const dT = mean(lad) - mean(subset.map(P => realized(TR, P)));
  const bT = bootDelta(LAD, TR, subset);
  console.log(`${label.padEnd(28)} n=${String(subset.length).padStart(4)}  ladAvg ${pc(mean(lad)).padStart(7)}  ΔEOD ${p1(dE).padStart(6)}  ΔTRAIL ${p1(dT).padStart(6)}  CIvsTR[${p1(bT.lo)},${p1(bT.hi)}] p=${bT.p.toFixed(3)}`);
}

console.log(`\n== per-subset ladder vs baselines ==`);
line('ALL', built);
line('BEAR_RUG', built.filter(P => P.fire.state === 'BEAR_RUG'));
line('BEAR (all bearish dir-)', built.filter(P => P.fire.dir < 0));
line('BULL_REVERSE', built.filter(P => P.fire.state === 'BULL_REVERSE'));

// gate reconstruction
const blocked = built.filter(gateBlocks);
const postGate = built.filter(P => !gateBlocks(P));
console.log(`\n== gate-mix: bull fires blocked by tape gate = ${blocked.length} of ${built.filter(P=>P.fire.dir>0).length} bulls ==`);
line('POST-GATE mix (kept)', postGate);
line('DROP-ALL-BULL (worst)', built.filter(P => P.fire.dir < 0));

console.log(`\n== headline robustness on POST-GATE mix, ladder vs LIVE-TRAIL ==`);
const bT = bootDelta(LAD, TR, postGate);
const loo = looWorst(LAD, TR, postGate);
const splitIdx = Math.floor(days.length / 2);
const trainDays = new Set(days.slice(0, splitIdx)), testDays = new Set(days.slice(splitIdx));
const trainSet = postGate.filter(P => trainDays.has(P.day)), testSet = postGate.filter(P => testDays.has(P.day));
const trA = mean(trainSet.map(P => realized(LAD, P))) - mean(trainSet.map(P => realized(TR, P)));
const teA = mean(testSet.map(P => realized(LAD, P))) - mean(testSet.map(P => realized(TR, P)));
console.log(`Δ vs TRAIL ${p1(bT.point)}  CI[${p1(bT.lo)},${p1(bT.hi)}]  p=${bT.p.toFixed(3)}  LOOworst ${p1(loo)}  WF tr${p1(trA)}/te${p1(teA)} ${(trA>0&&teA>0)?'YES':'NO'}`);

// survivorship: state mix of dropped
console.log(`\n== survivorship: state mix built vs dropped ==`);
for (const st of ['BEAR_RUG','BULL_REVERSE','BEAR_CONTINUE','BEAR_TRAPDOOR']) {
  const b = built.filter(P=>P.fire.state===st).length;
  const d = dropped.filter(P=>P.fire.state===st).length;
  console.log(`  ${st.padEnd(16)} built ${String(b).padStart(4)}  dropped ${String(d).padStart(3)}`);
}
