// PULLBACK ENTRY study (RESEARCH ONLY, Clause 0).
//
// MEASURED FACT (live, n=35): median immediate drawdown within 30min of entry = -41%;
// 71% drop >20% within 30min; 57% never tick green. The signal fires on STRUCTURAL
// CONFIRMATION, which by construction only exists AFTER price has moved -> we buy the
// exhaustion of the impulse.
//
// HYPOTHESIS: same signal, but wait for the OPTION price to pull back X% below the
// signal price within a wait window W, then enter. Symmetric by construction (it is a
// pullback in the OPTION mark, so identical mechanics for puts).
//
// METHOD (pre-registered before looking at any result):
//   - signal price E = option close at first candle >= fireTs+60s (same confirmation
//     delay as every prior study in this program; keeps baseline comparable).
//   - TREATMENT: resting limit buy at L = E*(1-X). Triggered when a candle CLOSE at
//     ts in (signalTs, signalTs + W] is <= L. FILL AT L (not at the close) — a resting
//     limit fills at its level, and the close is often below L, so filling at the close
//     would be an optimistic look-ahead. If no close <= L inside W -> NO TRADE (0 P&L).
//   - EXIT IS RE-SIMULATED FROM THE NEW ENTRY. The live trailing stop (arm=0.50,
//     giveback=0.15, exit when (1+g) <= (1+peak)*(1-gb)) is recomputed on gains measured
//     from the NEW entry price, running to EOD. The live STRUCTURE exit cannot be
//     re-simulated from a 5-min surface archive at scale, so the TRAIL is used as the
//     exit for BOTH baseline and treatment — apples-to-apples.
//   - BASELINE: enter at E (market, same confirmation delay), same trail to EOD.
//   - FILL HAIRCUT h on BOTH entry and exit, BOTH arms:
//        realized = (exit*(1-h)) / (entry*(1+h)) - 1
//   - SYSTEM-LEVEL P&L = sum over ALL signals with skipped = 0, divided by N_all.
//     Per-trade average of trades taken is reported too but is NOT the verdict metric.
//
// Usage: node pullback_entry.mjs [haircut=0.03]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ES = path.join(HERE, '..', 'exit-study');
const CACHE = path.join(ES, 'cache');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

const HAIR = Number(process.argv[2] ?? 0.03);
const ARM = 0.50, GB = 0.15;
const XS = [0.10, 0.20, 0.30, 0.40];
const WS = [15, 30, 60];

// ---------- path build ----------
// Returns ABSOLUTE closes (not gains), so an entry at any later bar can be priced.
function buildPath(fire) {
  const opt = load(path.join(CACHE, `${fire.sym}_${fire.day}.json`))
    .map(c => ({ ts: Date.parse(c.start_time), close: Number(c.close) || 0 }))
    .filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const entryTs = fire.fireTsMs + 60000;
  const ei = opt.findIndex(o => o.ts >= entryTs);
  if (ei < 0 || ei >= opt.length - 2) return null;
  const E = opt[ei].close;
  if (!(E > 0)) return null;
  return { fire, E, ei, bars: opt, day: fire.day, ticker: fire.ticker, dir: fire.dir };
}

// ---------- trail leg from an arbitrary entry ----------
// entryPx = fill price; startIdx = first bar whose close can be acted on AFTER entry.
// The entry bar itself is included from startIdx (its close is the first mark we can
// exit on). Returns { gRaw, mae } in gain-fraction terms measured from entryPx.
function trailFrom(bars, startIdx, entryPx) {
  let peak = 0, armed = false, mae = 0, g = 0;
  for (let i = startIdx; i < bars.length; i++) {
    g = bars[i].close / entryPx - 1;
    if (g < mae) mae = g;
    if (g > peak) peak = g;
    if (!armed && peak >= ARM) armed = true;
    if (armed && (1 + g) <= (1 + peak) * (1 - GB)) return { gRaw: g, mae, exited: true };
  }
  return { gRaw: g, mae, exited: false };
}
// apply symmetric fill haircut on entry+exit
const net = (gRaw) => ((1 + gRaw) * (1 - HAIR)) / (1 + HAIR) - 1;

// ---------- simulate one fire, both arms ----------
function simBaseline(P) {
  const r = trailFrom(P.bars, P.ei, P.E);
  return { taken: true, g: net(r.gRaw), mae: r.mae };
}
function simPullback(P, X, W) {
  const L = P.E * (1 - X);
  const tLim = P.bars[P.ei].ts + W * 60000;
  for (let i = P.ei + 1; i < P.bars.length; i++) {
    const b = P.bars[i];
    if (b.ts > tLim) break;
    if (b.close <= L) {
      if (i >= P.bars.length - 2) return { taken: false }; // no runway left
      const r = trailFrom(P.bars, i, L);   // fill AT the limit level, conservative
      return { taken: true, g: net(r.gRaw), mae: r.mae, waitMin: (b.ts - P.bars[P.ei].ts) / 60000 };
    }
  }
  return { taken: false };
}

// ---------- stats ----------
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const med = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = x => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '  n/a');
const p1 = x => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + 'pt' : 'n/a');
const winr = a => (a.length ? a.filter(x => x > 0).length / a.length : NaN);
function pf(a) { const w = a.filter(x => x > 0).reduce((s, x) => s + x, 0); const l = -a.filter(x => x <= 0).reduce((s, x) => s + x, 0); return l > 0 ? w / l : Infinity; }
// paired bootstrap on per-signal delta (treatment_all - baseline), 2-sided p
function bootP(deltas, iters = 4000) {
  const n = deltas.length, m = mean(deltas);
  if (!n) return 1;
  let ge = 0;
  for (let it = 0; it < iters; it++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += deltas[(Math.random() * n) | 0];
    // centered bootstrap: how often does a re-sample of the mean-centered deltas exceed |m|
    if (Math.abs(s / n - m) >= Math.abs(m)) ge++;
  }
  return (ge + 1) / (iters + 1);
}

// ---------- load ----------
const fires = JSON.parse(fs.readFileSync(path.join(ES, 'fires_index.json'), 'utf8'));
const built = fires.map(buildPath).filter(Boolean);
const days = [...new Set(built.map(b => b.day))].sort();
const cut = days[Math.floor(days.length / 2)];
const train = built.filter(b => b.day < cut);
const test = built.filter(b => b.day >= cut);
console.log(`# PULLBACK ENTRY — haircut ${(HAIR * 100).toFixed(0)}% each side, trail arm=${ARM} gb=${GB}, exit re-simulated from NEW entry`);
console.log(`fires with usable option path: ${built.length}/${fires.length}   days ${days.length}`);
console.log(`walk-forward split at ${cut}: train ${train.length} fires / test ${test.length} fires\n`);

// baseline cache
const BASE = new Map(built.map(P => [P, simBaseline(P)]));

function evalCell(set, X, W) {
  const bg = [], tg = [], deltas = [], takenG = [], skipBaseG = [], bmae = [], tmae = [], waits = [];
  for (const P of set) {
    const b = BASE.get(P);
    const t = simPullback(P, X, W);
    bg.push(b.g); bmae.push(b.mae);
    const tAll = t.taken ? t.g : 0;
    tg.push(tAll);
    deltas.push(tAll - b.g);
    if (t.taken) { takenG.push(t.g); tmae.push(t.mae); waits.push(t.waitMin); }
    else skipBaseG.push(b.g);
  }
  return {
    n: set.length, nTaken: takenG.length, fillRate: takenG.length / set.length,
    baseAll: mean(bg), treatAll: mean(tg), delta: mean(deltas), deltas,
    perTrade: mean(takenG), baseWin: winr(bg), takenWin: winr(takenG),
    basePF: pf(bg), takenPF: pf(takenG),
    skipBaseMean: mean(skipBaseG), skipBaseSum: skipBaseG.reduce((s, x) => s + x, 0),
    skipBaseWin: winr(skipBaseG), nSkip: skipBaseG.length,
    baseMAEmed: med(bmae), treatMAEmed: med(tmae), waitMed: med(waits),
    takenSum: takenG.reduce((s, x) => s + x, 0), baseSum: bg.reduce((s, x) => s + x, 0),
  };
}

// ================= 0. Does the drawdown fact replicate on the replay set? =================
console.log('## 0. Replicating the "we enter at the top" fact on the replay set (n=' + built.length + ')');
{
  const dd30 = [], neverGreen = [];
  for (const P of built) {
    const lim = P.bars[P.ei].ts + 30 * 60000;
    let mn = 0, mx = 0;
    for (let i = P.ei; i < P.bars.length && P.bars[i].ts <= lim; i++) {
      const g = P.bars[i].close / P.E - 1;
      if (g < mn) mn = g; if (g > mx) mx = g;
    }
    dd30.push(mn); neverGreen.push(mx <= 0 ? 1 : 0);
  }
  console.log(`  median 30-min drawdown from signal: ${pct(med(dd30))}   (live n=35 said -41%)`);
  console.log(`  share dropping >20% within 30 min : ${pct(dd30.filter(x => x <= -0.20).length / dd30.length)}   (live said 71%)`);
  console.log(`  share never green within 30 min   : ${pct(mean(neverGreen))}   (live said 57%)\n`);
}

// ================= 1. Full grid, ALL fires =================
console.log('## 1. Grid on ALL fires (system-level = per-signal mean with skipped=0)');
console.log('  X    W    fill%   taken  | perTrade(taken)  | SYSTEM base  SYSTEM treat   delta | skipped: n  baseP&L/trade  win');
const cellsAll = {};
for (const X of XS) for (const W of WS) {
  const c = evalCell(built, X, W); cellsAll[`${X}|${W}`] = c;
  console.log(`  ${(X * 100).toFixed(0).padStart(2)}%  ${String(W).padStart(2)}m  ${pct(c.fillRate).padStart(6)}  ${String(c.nTaken).padStart(4)}   |  ${pct(c.perTrade).padStart(7)}         |  ${pct(c.baseAll).padStart(7)}      ${pct(c.treatAll).padStart(7)}   ${p1(c.delta).padStart(7)} |  ${String(c.nSkip).padStart(4)}   ${pct(c.skipBaseMean).padStart(7)}     ${pct(c.skipBaseWin).padStart(5)}`);
}

// ================= 2. WALK-FORWARD =================
console.log('\n## 2. Walk-forward (train = first half of days, test = second half). Metric = SYSTEM delta vs baseline.');
console.log('  X    W   | TRAIN base  treat   delta  fill% | TEST base  treat   delta  fill% | test p(boot)');
const wf = [];
for (const X of XS) for (const W of WS) {
  const a = evalCell(train, X, W), b = evalCell(test, X, W);
  const p = bootP(b.deltas);
  wf.push({ X, W, tr: a, te: b, p });
  console.log(`  ${(X * 100).toFixed(0).padStart(2)}%  ${String(W).padStart(2)}m  |  ${pct(a.baseAll).padStart(7)}  ${pct(a.treatAll).padStart(7)}  ${p1(a.delta).padStart(7)}  ${pct(a.fillRate).padStart(5)} |  ${pct(b.baseAll).padStart(7)}  ${pct(b.treatAll).padStart(7)}  ${p1(b.delta).padStart(7)}  ${pct(b.fillRate).padStart(5)} |  ${b.p ? '' : ''}${p.toFixed(3)}`);
}
// MC discount
const K = XS.length * WS.length;
const bestTrain = [...wf].sort((a, b) => b.tr.delta - a.tr.delta)[0];
console.log(`\n  Best-in-TRAIN cell: X=${(bestTrain.X * 100).toFixed(0)}% W=${bestTrain.W}m  -> train ${p1(bestTrain.tr.delta)} | TEST ${p1(bestTrain.te.delta)} (honest OOS), boot p=${bestTrain.p.toFixed(3)}, Bonferroni-adj p=${Math.min(1, bestTrain.p * K).toFixed(3)} across K=${K} cells`);
const bestTest = [...wf].sort((a, b) => b.te.delta - a.te.delta)[0];
console.log(`  Best-in-TEST cell (in-sample-on-test, for reference only): X=${(bestTest.X * 100).toFixed(0)}% W=${bestTest.W}m  test ${p1(bestTest.te.delta)}  p=${bestTest.p.toFixed(3)}  Bonf=${Math.min(1, bestTest.p * K).toFixed(3)}`);
const nPosTest = wf.filter(c => c.te.delta > 0).length;
console.log(`  Cells with positive TEST system delta: ${nPosTest}/${K}   (coin-flip null expects ~${(K / 2).toFixed(0)})`);

// ================= 3. What we give up by skipping =================
console.log('\n## 3. THE CRUX — what do the skipped (non-retracing) fires do under the baseline?');
console.log('  X    W   | taken: n  baseP&L-of-taken  treatP&L-of-taken | skipped: n  baseP&L-of-skipped  their win%  their PF | entry gain on taken');
for (const X of XS) for (const W of WS) {
  const takenB = [], takenT = [], skipB = [];
  for (const P of built) {
    const b = BASE.get(P), t = simPullback(P, X, W);
    if (t.taken) { takenB.push(b.g); takenT.push(t.g); } else skipB.push(b.g);
  }
  console.log(`  ${(X * 100).toFixed(0).padStart(2)}%  ${String(W).padStart(2)}m  |  ${String(takenB.length).padStart(4)}  ${pct(mean(takenB)).padStart(7)}          ${pct(mean(takenT)).padStart(7)}        |  ${String(skipB.length).padStart(4)}   ${pct(mean(skipB)).padStart(7)}          ${pct(winr(skipB)).padStart(5)}   ${pf(skipB).toFixed(2).padStart(5)} | ${p1(mean(takenT) - mean(takenB)).padStart(8)}`);
}

// ================= 4. Direction split =================
console.log('\n## 4. Direction split (calls = BULL_REVERSE dir+1; puts = BEAR_* dir-1). SYSTEM delta.');
const calls = built.filter(b => b.dir > 0), puts = built.filter(b => b.dir < 0);
console.log(`  calls n=${calls.length}  puts n=${puts.length}`);
console.log('  X    W   | CALLS base  treat  delta  fill% | PUTS base  treat  delta  fill%');
for (const X of XS) for (const W of WS) {
  const c = evalCell(calls, X, W), p = evalCell(puts, X, W);
  console.log(`  ${(X * 100).toFixed(0).padStart(2)}%  ${String(W).padStart(2)}m  |  ${pct(c.baseAll).padStart(7)} ${pct(c.treatAll).padStart(7)} ${p1(c.delta).padStart(7)} ${pct(c.fillRate).padStart(5)} |  ${pct(p.baseAll).padStart(7)} ${pct(p.treatAll).padStart(7)} ${p1(p.delta).padStart(7)} ${pct(p.fillRate).padStart(5)}`);
}

// ================= 5. MAE / win / PF change on the trades actually taken =================
console.log('\n## 5. Does the pullback entry actually reduce the drawdown we sit through? (trades TAKEN only)');
console.log('  X    W   | median MAE base(same fires)  median MAE pullback | win% base(same)  win% pullback | PF base(same)  PF pullback | median wait');
for (const X of XS) for (const W of WS) {
  const bm = [], tm = [], bg = [], tg = [], ws = [];
  for (const P of built) {
    const t = simPullback(P, X, W); if (!t.taken) continue;
    const b = BASE.get(P);
    bm.push(b.mae); tm.push(t.mae); bg.push(b.g); tg.push(t.g); ws.push(t.waitMin);
  }
  if (!tm.length) continue;
  console.log(`  ${(X * 100).toFixed(0).padStart(2)}%  ${String(W).padStart(2)}m  |  ${pct(med(bm)).padStart(7)}                    ${pct(med(tm)).padStart(7)}       |  ${pct(winr(bg)).padStart(5)}          ${pct(winr(tg)).padStart(5)}       |  ${pf(bg).toFixed(2).padStart(5)}         ${pf(tg).toFixed(2).padStart(5)}    |  ${med(ws).toFixed(0)}m`);
}

// ================= 6. Sensitivity: fill at the CLOSE instead of at the limit level =================
console.log('\n## 6. Sensitivity — optimistic variant: fill at the BAR CLOSE (<= L) instead of at L.');
function simPullbackClose(P, X, W) {
  const L = P.E * (1 - X);
  const tLim = P.bars[P.ei].ts + W * 60000;
  for (let i = P.ei + 1; i < P.bars.length; i++) {
    const b = P.bars[i];
    if (b.ts > tLim) break;
    if (b.close <= L) {
      if (i >= P.bars.length - 2) return { taken: false };
      const r = trailFrom(P.bars, i, b.close);
      return { taken: true, g: net(r.gRaw) };
    }
  }
  return { taken: false };
}
console.log('  X    W   | SYSTEM treat(limit-fill)  SYSTEM treat(close-fill)   base');
for (const X of XS) for (const W of WS) {
  const c = evalCell(built, X, W);
  const g2 = built.map(P => { const t = simPullbackClose(P, X, W); return t.taken ? t.g : 0; });
  console.log(`  ${(X * 100).toFixed(0).padStart(2)}%  ${String(W).padStart(2)}m  |  ${pct(c.treatAll).padStart(8)}               ${pct(mean(g2)).padStart(8)}          ${pct(c.baseAll).padStart(7)}`);
}

// ================= 8. DECOMPOSITION + VOLUME-MATCHED RANDOM CONTROL =================
// The pre-registered "system delta" is CONFOUNDED: the baseline system is NEGATIVE
// (-6.8%/fire under trail-to-EOD), so ANY volume reduction mechanically pushes the
// per-signal mean toward 0. Skipping 80% of a losing system "gains" 0.8*6.8 = +5.4pt
// for free. So the honest control is a VOLUME-MATCHED RANDOM SKIP: take a random
// fraction f of signals at the signal price. Its system P&L = f * baseAll.
//   system_treat - system_random(f) = f * [ mean(treat_taken) - baseAll ]
// i.e. the rule only adds value if the trades it TAKES beat the AVERAGE baseline trade.
//
// Decomposition of the raw system delta:
//   delta = f*[mean(treat_taken) - mean(base_taken)]   (ENTRY GAIN, always > 0)
//         - (1-f)*mean(base_skipped)                   (FOREGONE, the crux)
function evalSets(set, X, W) {
  const bt = [], tt = [], bs = [];
  for (const P of set) {
    const b = BASE.get(P), t = simPullback(P, X, W);
    if (t.taken) { bt.push(b.g); tt.push(t.g); } else bs.push(b.g);
  }
  const N = set.length, f = tt.length / N;
  const baseAll = mean(set.map(P => BASE.get(P).g));
  return { N, f, baseAll, mBT: mean(bt), mTT: mean(tt), mBS: bs.length ? mean(bs) : 0,
           entryGain: f * (mean(tt) - mean(bt)), foregone: (1 - f) * (bs.length ? mean(bs) : 0),
           vsRandom: f * (mean(tt) - baseAll) };
}
console.log('\n## 8. DECOMPOSITION + VOLUME-MATCHED RANDOM-SKIP CONTROL (the honest test)');
console.log('  Raw system delta = ENTRY GAIN (better fills on fires taken) - FOREGONE (baseline P&L of fires skipped)');
console.log('  vs-RANDOM = system_treat - f*baseAll. Positive only if trades TAKEN beat the AVERAGE baseline trade.');
console.log('  X    W   |   f   | perTrade(taken)  avg baseline trade | ENTRY GAIN  FOREGONE  = raw delta | vs RANDOM-SKIP@f');
for (const X of XS) for (const W of WS) {
  const e = evalSets(built, X, W);
  console.log(`  ${(X * 100).toFixed(0).padStart(2)}%  ${String(W).padStart(2)}m  | ${pct(e.f).padStart(5)} |  ${pct(e.mTT).padStart(7)}          ${pct(e.baseAll).padStart(7)}         | ${p1(e.entryGain).padStart(7)}   ${p1(-e.foregone).padStart(7)}   ${p1(e.entryGain - e.foregone).padStart(7)} |  ${p1(e.vsRandom).padStart(7)}`);
}
console.log('\n  Walk-forward on the vs-RANDOM metric (the confound-free one):');
console.log('  X    W   | TRAIN vsRandom | TEST vsRandom | test perTrade(taken) vs test baseAll | day-block boot p (test)');
// day-block bootstrap on the per-signal quantity  q_i = taken_i*(treat_i - baseAll)  (mean = vsRandom)
function blockBootP(set, X, W, iters = 3000) {
  const baseAll = mean(set.map(P => BASE.get(P).g));
  const byDay = new Map();
  for (const P of set) {
    const t = simPullback(P, X, W);
    const q = t.taken ? (t.g - baseAll) : 0;
    if (!byDay.has(P.day)) byDay.set(P.day, []);
    byDay.get(P.day).push(q);
  }
  const dayArr = [...byDay.values()];
  const obs = mean(dayArr.flat());
  let ge = 0;
  for (let it = 0; it < iters; it++) {
    const s = [];
    for (let i = 0; i < dayArr.length; i++) s.push(...dayArr[(Math.random() * dayArr.length) | 0]);
    if (Math.abs(mean(s) - obs) >= Math.abs(obs)) ge++;
  }
  return { obs, p: (ge + 1) / (iters + 1) };
}
let posTestVsRand = 0;
for (const X of XS) for (const W of WS) {
  const a = evalSets(train, X, W), b = evalSets(test, X, W);
  const bb = blockBootP(test, X, W);
  if (b.vsRandom > 0) posTestVsRand++;
  console.log(`  ${(X * 100).toFixed(0).padStart(2)}%  ${String(W).padStart(2)}m  |   ${p1(a.vsRandom).padStart(7)}      |  ${p1(b.vsRandom).padStart(7)}     |  ${pct(b.mTT).padStart(7)}   vs   ${pct(b.baseAll).padStart(7)}          |  ${bb.p.toFixed(3)}`);
}
console.log(`\n  Cells beating a volume-matched RANDOM skip on the TEST half: ${posTestVsRand}/12`);

// ================= 7. Fat-tail check: are the big winners being skipped? =================
console.log('\n## 7. Fat-tail check — baseline P&L decile of the SKIPPED fires (X=20%, W=30m and X=30%, W=60m)');
for (const [X, W] of [[0.20, 30], [0.30, 60]]) {
  const rows = built.map(P => ({ b: BASE.get(P).g, t: simPullback(P, X, W).taken }));
  const sorted = [...rows].sort((a, b) => a.b - b.b);
  const dec = 10, sz = Math.floor(sorted.length / dec);
  const line = [];
  for (let d = 0; d < dec; d++) {
    const slice = sorted.slice(d * sz, d === dec - 1 ? sorted.length : (d + 1) * sz);
    line.push(`D${d + 1}:${(100 * slice.filter(s => s.t).length / slice.length).toFixed(0)}%`);
  }
  console.log(`  X=${(X * 100).toFixed(0)}% W=${W}m  fill-rate by baseline-P&L decile (D1=worst .. D10=best): ${line.join(' ')}`);
  const top = sorted.slice(-Math.floor(sorted.length * 0.1));
  console.log(`    top-10% baseline winners: mean baseline ${pct(mean(top.map(t => t.b)))}, of these ${pct(top.filter(t => t.t).length / top.length)} get a pullback fill`);
}
