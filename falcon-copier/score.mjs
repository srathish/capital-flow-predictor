// FALCON-REPLICA 0-100 SCORER + BACKTEST
// Implements the reverse-engineered model:
//   GATE  : spot rejecting a strong PIKA ceiling (short) or off a PIKA/BARNEY floor (long), pre-15:15.
//   SIGN  : node in the path decides the playbook (pika=fade/deflection, barney=trapdoor accelerant).
//   SCORE : node strength(30) + hold/deflection quality(25) + VIX compression(20) + volume(15) + R:R(10).
//   (Trinity radar omitted for now — needs SPY/QQQ surfaces; noted as a gap, weights rescaled to 100.)
// BACKTEST is on the UNDERLYING (spot reaches target vs stop first) — honest directional hit-rate, no
// option marks needed. Then bucket by score to test: does a higher score => better outcome?
// Usage: node score.mjs 2026-07-20   |   node score.mjs ALL
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etMin = (et) => +et.slice(0, 2) * 60 + +et.slice(3);
// --- knobs ---
const WALL = 12e6;      // a "strong" pika
const BARNEY = 8e6;     // a "real" barney (|g0|)
const TAP = 5;          // within $ of the wall to count as rejecting it
const STOP = 6;         // $ beyond the wall = thesis dead
const CEIL_RANGE = 20;  // look for the ceiling within this many $ of spot
const TGT_RANGE = 35;   // target node search range below spot
const LAST_ENTRY = 15 * 60 + 15;

const load = (day) => { const f = path.join(DIR, `replay_${day}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const loadAux = (day) => { const f = path.join(DIR, `aux_${day}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { spy: [], vixy: [] }; };
const auxAt = (arr, et) => { let b = null; for (const p of arr) { if (p.et <= et) b = p; else break; } return b; };

function pikaAbove(fx, s) { return fx.strikes.filter(n => n.g0 >= WALL && n.strike >= s - 2 && n.strike <= s + CEIL_RANGE).sort((a, b) => b.g0 - a.g0)[0]; }
function pikaBelow(fx, s) { return fx.strikes.filter(n => n.g0 >= WALL && n.strike <= s + 2 && n.strike >= s - CEIL_RANGE).sort((a, b) => b.g0 - a.g0)[0]; }
function targetBelow(fx, s) { // strongest node (barney accelerant OR dominant pika magnet) below spot
  const c = fx.strikes.filter(n => n.strike < s - 3 && n.strike >= s - TGT_RANGE);
  const barney = c.filter(n => n.g0 <= -BARNEY).sort((a, b) => a.g0 - b.g0)[0];
  const pika = c.filter(n => n.g0 >= WALL).sort((a, b) => b.g0 - a.g0)[0];
  return barney || pika || null;
}
function targetAbove(fx, s) {
  const c = fx.strikes.filter(n => n.strike > s + 3 && n.strike <= s + TGT_RANGE);
  const pika = c.filter(n => n.g0 >= WALL).sort((a, b) => b.g0 - a.g0)[0];
  const barney = c.filter(n => n.g0 <= -BARNEY).sort((a, b) => a.g0 - b.g0)[0];
  return pika || barney || null;
}
const gAt = (fx, k) => (fx.strikes.reduce((best, n) => Math.abs(n.strike - k) < Math.abs((best?.strike ?? 1e9) - k) ? n : best, null)?.g0 || 0);

// how many times earlier today spot tapped `wallK` within TAP and was pushed away (deflection history)
function priorTaps(fr, upto, wallK) {
  let taps = 0, inTap = false;
  for (let j = 0; j < upto; j++) { const near = Math.abs(fr[j].spot - wallK) <= TAP; if (near && !inTap) { taps++; inTap = true; } else if (!near) inTap = false; }
  return taps;
}

function scoreSetup(fr, i, aux, dir, wall, target) {
  const x = fr[i], s = x.spot, et = etOf(x.ts);
  // 1) node strength (30) — the wall being faded
  const nodeStrength = Math.min(30, (wall.g0 / 45e6) * 30);
  // 2) hold/deflection quality (25) — prior taps rejected + wall growing over last ~10min
  const taps = priorTaps(fr, i, wall.strike);
  const g10 = gAt(fr[Math.max(0, i - 10)], wall.strike);
  const growing = wall.g0 >= g10;
  const holdQ = Math.min(25, taps * 7 + (growing ? 11 : 0));
  // 3) VIX compression (20) — low vixy vs its own day range = coiled spring (Glitch Jul16)
  const vixys = aux.vixy.map(p => p.c).filter(Number.isFinite);
  const vmin = Math.min(...vixys), vmax = Math.max(...vixys), vnow = auxAt(aux.vixy, et)?.c;
  const vixPct = (vmax > vmin && vnow != null) ? (vnow - vmin) / (vmax - vmin) : 0.5;
  const vixScore = 20 * (1 - vixPct);
  // 4) volume (15) — rejection on above-median SPY volume
  const vols = aux.spy.map(p => p.v).filter(v => v > 0).sort((a, b) => a - b);
  const vmed = vols.length ? vols[Math.floor(vols.length / 2)] : 0;
  const vnowBar = auxAt(aux.spy, et)?.v || 0;
  const volScore = vmed ? Math.min(15, (vnowBar / vmed) * 7.5) : 7.5;
  // 5) R:R (10) — reward distance to target vs stop
  const reward = Math.abs(s - target.strike), risk = dir === 'short' ? (wall.strike + STOP - s) : (s - (wall.strike - STOP));
  const rr = risk > 0 ? reward / risk : 0;
  const rrScore = Math.min(10, rr * 5);
  const total = nodeStrength + holdQ + vixScore + volScore + rrScore;
  const tgtSign = gAt(x, target.strike) < -BARNEY ? 'barney' : gAt(x, target.strike) >= WALL ? 'pika' : 'node';
  return { total: Math.round(total), parts: { nodeStrength: +nodeStrength.toFixed(0), holdQ, vixScore: +vixScore.toFixed(0), volScore: +volScore.toFixed(0), rrScore: +rrScore.toFixed(0) }, taps, growing, tgtSign, rr: +rr.toFixed(2) };
}

const SCALP = 3;   // favorable SPX pts = a scalpable 0DTE pop (~+20-30% on an ATM option) — how Falcon books
const ADV = 6;     // adverse SPX pts before we're wrong (mental stop, wider than the node)
function simulate(fr, i, dir, targetK, stopK) {
  const entry = fr[i].spot; let maxFav = 0, maxAdv = 0, scalp = null;
  for (let j = i + 1; j < fr.length; j++) {
    const s = fr[j].spot; const fav = dir === 'short' ? entry - s : s - entry, adv = -fav;
    maxFav = Math.max(maxFav, fav); maxAdv = Math.max(maxAdv, adv);
    if (scalp === null) { if (fav >= SCALP) scalp = true; else if (adv >= ADV) scalp = false; } // scalp: +SCALP before -ADV
    if (dir === 'short') { if (s <= targetK) return { r: 'WIN', bars: j - i, maxFav, maxAdv, scalp: scalp ?? true, move: entry - targetK }; if (s >= stopK) return { r: 'LOSS', bars: j - i, maxFav, maxAdv, scalp: scalp ?? false, move: entry - stopK }; }
    else { if (s >= targetK) return { r: 'WIN', bars: j - i, maxFav, maxAdv, scalp: scalp ?? true, move: targetK - entry }; if (s <= stopK) return { r: 'LOSS', bars: j - i, maxFav, maxAdv, scalp: scalp ?? false, move: stopK - entry }; }
  }
  const last = fr[fr.length - 1].spot; return { r: 'EOD', bars: fr.length - 1 - i, maxFav, maxAdv, scalp: scalp ?? (maxFav >= SCALP), move: dir === 'short' ? entry - last : last - entry };
}

function scanDay(day, sink) {
  const fr = load(day); if (!fr) return; const aux = loadAux(day);
  let lastSig = -99;
  for (let i = 5; i < fr.length; i++) {
    const x = fr[i], s = x.spot, et = etOf(x.ts); if (etMin(et) > LAST_ENTRY) break;
    if (i - lastSig < 15) continue; // don't double-count the same rejection (min 15min apart)
    // SHORT: spot rejecting a pika ceiling, target below
    const ceil = pikaAbove(fr[i], s);
    if (ceil && Math.abs(s - ceil.strike) <= TAP && s <= ceil.strike + 1) {
      const tgt = targetBelow(fr[i], s);
      if (tgt) { const sc = scoreSetup(fr, i, aux, 'short', ceil, tgt); const o = simulate(fr, i, 'short', tgt.strike, ceil.strike + STOP); sink.push({ day, et, dir: 'SHORT', spot: +s.toFixed(0), wall: ceil.strike, target: tgt.strike, ...sc, ...o }); lastSig = i; continue; }
    }
    // LONG: spot off a pika floor, target above
    const fl = pikaBelow(fr[i], s);
    if (fl && Math.abs(s - fl.strike) <= TAP && s >= fl.strike - 1) {
      const tgt = targetAbove(fr[i], s);
      if (tgt) { const sc = scoreSetup(fr, i, aux, 'long', fl, tgt); const o = simulate(fr, i, 'long', tgt.strike, fl.strike - STOP); sink.push({ day, et, dir: 'LONG', spot: +s.toFixed(0), wall: fl.strike, target: tgt.strike, ...sc, ...o }); lastSig = i; }
    }
  }
}

// tape gate: SPY momentum over last ~15min at signal time (the ONE proven factor — 77-study program).
// short wants tape DOWN, long wants tape UP. also the day-thesis: SPY vs open (no hindsight at time t).
function spyMom(aux, et) { const a = auxAt(aux.spy, et); if (!a) return { m15: 0, vsOpen: 0 }; const back = aux.spy.filter(p => p.et <= et); const now = back[back.length - 1]?.c, prev = back[Math.max(0, back.length - 16)]?.c, open = aux.spy[0]?.c; return { m15: (now != null && prev != null) ? now - prev : 0, vsOpen: (now != null && open != null) ? now - open : 0 }; }
function attachTape(sig, day) { const aux = loadAux(day); for (const g of sig) { const mm = spyMom(aux, g.et); g.m15 = +mm.m15.toFixed(2); g.vsOpen = +mm.vsOpen.toFixed(2); } }

const arg = process.argv[2] || 'ALL';
const disc = process.argv.includes('--discipline'); // apply tape gate + one-thesis + top-2/day
const days = arg === 'ALL' ? fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort() : [arg];
let sig = [];
for (const d of days) { const s = []; scanDay(d, s); attachTape(s, d); sig.push(...s); }

if (disc) {
  const kept = [];
  for (const d of days) {
    let day = sig.filter(g => g.day === d);
    // tape gate: direction must agree with 15-min SPY momentum AND day-thesis (SPY vs open)
    day = day.filter(g => g.dir === 'SHORT' ? (g.m15 <= 0 && g.vsOpen <= 0) : (g.m15 >= 0 && g.vsOpen >= 0));
    // one thesis/day: keep only the majority direction among survivors
    const nS = day.filter(g => g.dir === 'SHORT').length, nL = day.length - nS;
    const thesis = nS >= nL ? 'SHORT' : 'LONG';
    day = day.filter(g => g.dir === thesis).sort((a, b) => b.total - a.total).slice(0, 2); // top-2 by score
    kept.push(...day);
  }
  sig = kept;
  console.log(`(DISCIPLINE MODE: tape-agree + one-thesis/day + top-2 by score => ${sig.length} signals, ${(sig.length / days.length).toFixed(1)}/day)`);
}
if (process.argv.includes('--emit')) {
  const out = sig.map(g => ({ day: g.day, et: g.et, dir: g.dir, spot: g.spot, wall: g.wall, target: g.target, total: g.total, tgtSign: g.tgtSign }));
  fs.writeFileSync(path.join(process.cwd(), 'falcon-copier', 'signals_disc.json'), JSON.stringify(out, null, 0));
  console.log(`emitted ${out.length} signals -> signals_disc.json`);
}

if (arg !== 'ALL') {
  console.log(`=== SCORER — ${arg} (${sig.length} candidate signals) ===`);
  console.log(`et     dir    spot  wall  tgt   tgt-sign  score  [node hold vix vol rr]  taps grow  rr    outcome`);
  for (const g of sig) console.log(`${g.et}  ${g.dir}  ${g.spot} ${g.wall} ${g.target}  ${g.tgtSign.padEnd(7)}  ${String(g.total).padStart(3)}   [${g.parts.nodeStrength} ${g.parts.holdQ} ${g.parts.vixScore} ${g.parts.volScore} ${g.parts.rrScore}]   ${g.taps}   ${g.growing ? 'Y' : 'n'}   ${String(g.rr).padStart(4)}  ${g.r} (maxFav ${g.maxFav.toFixed(0)})`);
}
// score-vs-outcome buckets — SCALP win = +SCALP pts before -ADV pts (how Falcon actually books)
const buckets = [[0, 40], [40, 55], [55, 70], [70, 100]];
console.log(`\n=== SCORE vs SCALP-OUTCOME (${sig.length} signals across ${days.length} days) · scalp = +${SCALP} pts before -${ADV} pts ===`);
console.log(`score band   n    scalp-win%   avg maxFav($)   avg maxAdv($)`);
for (const [lo, hi] of buckets) {
  const b = sig.filter(g => g.total >= lo && g.total < hi); if (!b.length) { console.log(`${lo}-${hi}       0`); continue; }
  const wr = b.filter(g => g.scalp).length / b.length * 100;
  const mf = b.reduce((a, c) => a + c.maxFav, 0) / b.length; const ma = b.reduce((a, c) => a + c.maxAdv, 0) / b.length;
  console.log(`${String(lo).padStart(3)}-${String(hi).padEnd(3)}    ${String(b.length).padStart(3)}    ${wr.toFixed(0).padStart(3)}%        ${mf.toFixed(1).padStart(5)}          ${ma.toFixed(1).padStart(5)}`);
}
const sw = sig.filter(g => g.scalp).length;
console.log(`\nOVERALL scalp-win: ${sw}/${sig.length} = ${(sw / sig.length * 100).toFixed(0)}%.  Expectancy(pts) ≈ ${(sig.reduce((a, c) => a + (c.scalp ? SCALP : -ADV), 0) / sig.length).toFixed(2)}/trade.  If scalp-win% RISES with the score band, the score ranks.`);
