// doctrine_backtest.mjs — encodes locked doctrine v1. SPXW/SPY/QQQ 0DTE + MU swing, 6mo.
// Corrections vs aplus v2: (1) RELATIVE gate by |value| (pika=flow-through, never gates; king/gk/barney gate);
// (2) REGIME gate (bull setups in bull tape only); (3) CLOSE-BASIS structural stop (OOS +0.19R); (4) ATR stop for MU.
import '/Users/saiyeeshrathish/the final plan/apps/gex/scripts/_env-bootstrap.js';
import fs from 'node:fs';
const K = process.env.SKYLIT_API_KEY;
const H = { Authorization: `Bearer ${K}`, Accept: 'application/json' };
const get = (host, p) => fetch(`https://${host}.skylit.ai${p}`, { headers: H }).then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => null) }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dstr = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const mondayOf = (d) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
const sma = (a, i, n) => i + 1 < n ? null : a.slice(i - n + 1, i + 1).reduce((x, y) => x + y, 0) / n;

// ---- LOCKED PARAMS ----
const GATE_RATIO = 0.7;      // intervening react-node gates path if |value| >= target|value|*RATIO
const INVAL_BUF = 0.002;     // index structural stop buffer (0.2%)
const STOCK_ATR_MULT = 1.0;  // MU stop = 1.0*ATR(14) below/above support
const ENTRY_PROX = 0.01;     // OTE node must be within 1.0% of spot
const NEAR = 0.0008;         // retest touch tolerance
const SWING_DAYS = 6;
const REJECT = ['king', 'gatekeeper', 'barney']; // react-at AND gate nodes (pika=flow-through, never gates/entry)
const ENTRY_TYPES = ['king', 'gatekeeper'];      // strongest S/R to enter on (barney = weaker, path-only)

const SYMS = [
  { board: 'SPXW', px: 'SPX', mode: 'intraday' },
  { board: 'SPY', px: 'SPY', mode: 'intraday' },
  { board: 'QQQ', px: 'QQQ', mode: 'intraday' },
  { board: 'MU', px: 'MU', mode: 'swing' },
];

function scoreDay(bd, spot, weekRange, regime, atr) {
  const nodes = bd.strikes.filter((x) => REJECT.includes(x.nodeType)).map((x) => ({ ...x, av: Math.abs(x.value) }));
  const ent = nodes.filter((x) => ENTRY_TYPES.includes(x.nodeType));
  const out = [];
  // BULL: support (entry) below, target above
  const supB = ent.filter((x) => x.strike < spot).sort((a, b) => b.strike - a.strike)[0];
  const tgtA = ent.filter((x) => x.strike > spot).sort((a, b) => a.strike - b.strike)[0];
  if (supB && tgtA && (spot - supB.strike) / spot <= ENTRY_PROX) {
    const gates = nodes.filter((x) => x.strike > supB.strike && x.strike < tgtA.strike && x.av >= tgtA.av * GATE_RATIO);
    const untouched = !(weekRange && weekRange.lo <= tgtA.strike && tgtA.strike <= weekRange.hi);
    out.push(mk('bull', supB, tgtA, atr, spot, gates.length === 0, untouched, regime === 'bull'));
  }
  // BEAR: resistance (entry) above, target below
  const resA = ent.filter((x) => x.strike > spot).sort((a, b) => a.strike - b.strike)[0];
  const tgtB = ent.filter((x) => x.strike < spot).sort((a, b) => b.strike - a.strike)[0];
  if (resA && tgtB && (resA.strike - spot) / spot <= ENTRY_PROX) {
    const gates = nodes.filter((x) => x.strike < resA.strike && x.strike > tgtB.strike && x.av >= tgtB.av * GATE_RATIO);
    const untouched = !(weekRange && weekRange.lo <= tgtB.strike && tgtB.strike <= weekRange.hi);
    out.push(mk('bear', resA, tgtB, atr, spot, gates.length === 0, untouched, regime === 'bear'));
  }
  return out;
}
function mk(dir, e, t, atr, spot, clear, untouched, aligned) {
  const stop = dir === 'bull'
    ? (atr ? e.strike - STOCK_ATR_MULT * atr : e.strike * (1 - INVAL_BUF))
    : (atr ? e.strike + STOCK_ATR_MULT * atr : e.strike * (1 + INVAL_BUF));
  const grade = !aligned ? 'COUNTER' : !clear ? 'GATED' : untouched ? 'A+' : 'B';
  return { dir, entry: e.strike, entryType: e.nodeType, target: t.strike, stop, clear, untouched, aligned, grade };
}

// close-basis structural stop; target on touch (wick ok)
function simulate(bars, s, closeKey = 'c') {
  const tol = s.entry * NEAR; let i0 = -1;
  for (let i = 0; i < bars.length; i++) if (bars[i].l - tol <= s.entry && s.entry <= bars[i].h + tol) { i0 = i; break; }
  if (i0 < 0) return { triggered: false };
  const R = Math.abs(s.target - s.entry) / Math.abs(s.entry - s.stop);
  for (let j = i0; j < bars.length; j++) {
    if (s.dir === 'bull') {
      if (bars[j].h >= s.target) return { triggered: true, win: true, R };
      if (bars[j][closeKey] <= s.stop) return { triggered: true, win: false, R };
    } else {
      if (bars[j].l <= s.target) return { triggered: true, win: true, R };
      if (bars[j][closeKey] >= s.stop) return { triggered: true, win: false, R };
    }
  }
  return { triggered: true, win: null, R };
}

const NOW = Math.floor(Date.now() / 1000);
// SPX regime series
const spxD = (await get('atlas-api', `/v1/history?symbol=SPX&resolution=D&from=${NOW - 260 * 86400}&to=${NOW}`)).j;
const regime = {}; const C = spxD.c;
spxD.t.forEach((t, i) => { const s20 = sma(C, i, 20), s50 = sma(C, i, 50); let r = 'neutral'; if (s20 && s50) { if (C[i] > s20 && s20 > s50) r = 'bull'; else if (C[i] < s20 && s20 < s50) r = 'bear'; } regime[dstr(t)] = r; });

const rows = [];
for (const { board, px, mode } of SYMS) {
  const dq = (await get('atlas-api', `/v1/history?symbol=${px}&resolution=D&from=${NOW - 220 * 86400}&to=${NOW}`)).j;
  const daily = {}, dArr = [];
  dq.t.forEach((t, i) => { const d = dstr(t); daily[d] = { h: dq.h[i], l: dq.l[i], c: dq.c[i] }; dArr.push({ d, o: dq.o[i], h: dq.h[i], l: dq.l[i], c: dq.c[i] }); });
  // ATR14 per index into dArr for swing
  const atrOf = (idx) => { if (idx < 14) return null; let s = 0; for (let k = idx - 13; k <= idx; k++) { const tr = Math.max(dArr[k].h - dArr[k].l, Math.abs(dArr[k].h - dArr[k - 1].c), Math.abs(dArr[k].l - dArr[k - 1].c)); s += tr; } return s / 14; };
  let byDay = {};
  if (mode === 'intraday') for (const [a, b] of [[181, 91], [91, 0]]) { const mq = (await get('atlas-api', `/v1/history?symbol=${px}&resolution=1&from=${NOW - a * 86400}&to=${NOW - b * 86400}`)).j; mq.t?.forEach((t, i) => { const d = dstr(t); (byDay[d] ||= []).push({ o: mq.o[i], h: mq.h[i], l: mq.l[i], c: mq.c[i] }); }); }
  const dates = dArr.map((x) => x.d).slice(-126);
  process.stdout.write(`\n${board} (${mode}): `);
  for (let di = 0; di < dates.length; di++) {
    const d = dates[di];
    if (mode === 'intraday' && (!byDay[d] || byDay[d].length < 200)) continue;
    const exp = mode === 'intraday' ? `&expirations=${d}` : '';
    const bq = await get('api', `/v1/historical?symbols=${board}&at=${d}T13:35:00Z&metric=gamma&maxStrikes=all${exp}`);
    await sleep(550);
    const bd = bq.j?.data?.symbols?.[0]; if (!bd?.strikes?.length) { process.stdout.write('x'); continue; }
    const mon = mondayOf(d), prior = Object.keys(daily).filter((x) => x >= mon && x < d);
    const weekRange = prior.length ? { lo: Math.min(...prior.map((x) => daily[x].l)), hi: Math.max(...prior.map((x) => daily[x].h)) } : null;
    const atr = mode === 'swing' ? atrOf(di) : null;
    const setups = scoreDay(bd, bd.spot, weekRange, regime[d] || 'neutral', atr);
    const bars = mode === 'intraday' ? byDay[d] : dArr.slice(di, di + SWING_DAYS + 1);
    for (const s of setups) rows.push({ sym: board, d, regime: regime[d] || 'neutral', ...s, ...simulate(bars, s) });
    process.stdout.write('.');
  }
}
fs.writeFileSync('/private/tmp/claude-501/-Users-saiyeeshrathish-the-final-plan/a5088226-4255-42ad-8c1a-63d53449d7a5/scratchpad/doctrine_rows.json', JSON.stringify(rows));

function stat(f) { const r = rows.filter(f).filter((x) => x.triggered); const dec = r.filter((x) => x.win !== null); const w = dec.filter((x) => x.win).length; const e = dec.length ? dec.map((x) => x.win ? x.R : -1).reduce((a, b) => a + b, 0) / dec.length : 0; const avgR = r.length ? r.filter(x=>x.win!==null).reduce((a,x)=>a+x.R,0)/Math.max(1,dec.length) : 0; return `n=${String(r.length).padStart(3)} resolved=${String(dec.length).padStart(3)} WIN ${dec.length ? (w / dec.length * 100).toFixed(0).padStart(2) : '--'}% avgR ${avgR.toFixed(2)} EXPECTANCY ${dec.length ? e.toFixed(2) : '--'}R`; }
console.log('\n\n===== DOCTRINE BACKTEST (6mo, relative-gate + regime + close-basis stop) =====');
console.log('regime days:', JSON.stringify(['bull', 'bear', 'neutral'].reduce((a, r) => { a[r] = new Set(rows.filter((x) => x.regime === r).map((x) => x.d)).size; return a; }, {})));
console.log('\n-- by GRADE (indices only) --');
for (const g of ['A+', 'B', 'GATED', 'COUNTER']) console.log(`  ${g.padEnd(8)}`, stat((x) => x.sym !== 'MU' && x.grade === g));
console.log('\n-- ALIGNED vs COUNTER (indices) --');
console.log('  ALIGNED ', stat((x) => x.sym !== 'MU' && x.aligned));
console.log('  COUNTER ', stat((x) => x.sym !== 'MU' && !x.aligned));
console.log('\n-- CLEAR vs GATED (aligned indices) --');
console.log('  CLEAR   ', stat((x) => x.sym !== 'MU' && x.aligned && x.clear));
console.log('  GATED   ', stat((x) => x.sym !== 'MU' && x.aligned && !x.clear));
console.log('\n-- UNTOUCHED vs DELIVERED (aligned+clear indices) --');
console.log('  UNTOUCH ', stat((x) => x.sym !== 'MU' && x.aligned && x.clear && x.untouched));
console.log('  DELIVER ', stat((x) => x.sym !== 'MU' && x.aligned && x.clear && !x.untouched));
console.log('\n-- per index (A+ only) --');
for (const b of ['SPXW', 'SPY', 'QQQ']) console.log(`  ${b.padEnd(5)} A+`, stat((x) => x.sym === b && x.grade === 'A+'));
console.log('\n-- MU swing (ATR stop) --');
for (const g of ['A+', 'B', 'GATED', 'COUNTER']) console.log(`  MU ${g.padEnd(8)}`, stat((x) => x.sym === 'MU' && x.grade === g));
console.log('  MU ALIGNED', stat((x) => x.sym === 'MU' && x.aligned));
const acc = await get('api', '/v1/account'); console.log('\ncredits left:', acc.j?.data?.creditsBalance);
