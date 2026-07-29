// DIRECTION ENGINE — the real path to beating Falcon: call the DAY'S drift, hold one thesis.
// Intraday is ~symmetric noise; the edge is getting the direction right and letting convexity+mgmt pay.
// Test PRE-SPECIFIED simple factors (no search — n=19 is small) at a decision time, predict rest-of-day
// SPY direction, report hit rate. Factors:
//   massBelow : net 0DTE gamma below spot vs above (project's ONE confirmed factor, SPXW-only)
//   kingSide  : dominant pika below spot (floor→bull) or above (ceiling→bear)
//   tape      : SPY drift open->decision
//   vix       : VIXY drift open->decision (risk-off = bear)
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const aux = (d) => { const f = path.join(DIR, `aux_${d}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { spy: [], vixy: [] }; };
const nearFrame = (fr, et) => fr.reduce((b, x, i) => Math.abs(+etOf(x.ts).replace(':', '') - +et.replace(':', '')) < Math.abs(+etOf(fr[b].ts).replace(':', '') - +et.replace(':', '')) ? i : b, 0);
const spyAt = (a, et) => { let v = null; for (const p of a.spy) { if (p.et <= et) v = p.c; else break; } return v; };
const vixAt = (a, et) => { let v = null; for (const p of a.vixy) { if (p.et <= et) v = p.c; else break; } return v; };
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;

const DECISION = process.argv[2] || '10:30';
const days = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();
const rows = [];
for (const d of days) {
  const fr = load(d), a = aux(d); if (!fr || !a.spy.length) continue;
  const x = fr[nearFrame(fr, DECISION)], s = x.spot;
  // massBelow: net g0 below vs above spot (positive => more pika mass below => support => bull lean)
  const gBelow = x.strikes.filter(n => n.strike < s).reduce((t, n) => t + n.g0, 0);
  const gAbove = x.strikes.filter(n => n.strike > s).reduce((t, n) => t + n.g0, 0);
  const massBelow = sign(gBelow - gAbove);
  // kingSide: dominant pika below (+1 bull) or above (-1 bear)
  const king = x.strikes.filter(n => n.g0 > 0).sort((p, q) => q.g0 - p.g0)[0];
  const kingSide = king ? sign(s - king.strike) : 0; // king below spot => s-king>0 => +1 bull
  // tape + vix drift open->decision
  const spyOpen = a.spy[0]?.c, spyD = spyAt(a, DECISION), vixOpen = a.vixy[0]?.c, vixD = vixAt(a, DECISION);
  const tape = sign((spyD ?? 0) - (spyOpen ?? 0));
  const vix = -sign((vixD ?? 0) - (vixOpen ?? 0)); // vix up => bear => -1
  // ACTUAL rest-of-day drift (decision -> close), on SPY
  const spyClose = a.spy[a.spy.length - 1]?.c;
  const actual = sign((spyClose ?? 0) - (spyD ?? 0));
  const restMovePts = ((spyClose ?? 0) - (spyD ?? 0)) * 10; // SPY->SPX approx x10
  rows.push({ d, spot: +s.toFixed(0), massBelow, kingSide, tape, vix, actual, restMovePts: +restMovePts.toFixed(1) });
}
// evaluate each single factor + a couple simple combos
const factors = {
  massBelow: r => r.massBelow, kingSide: r => r.kingSide, tape: r => r.tape, vix: r => r.vix,
  'tape+vix': r => sign(r.tape + r.vix), 'tape+massBelow': r => sign(r.tape + r.massBelow),
  'tape+king': r => sign(r.tape + r.kingSide), 'all4': r => sign(r.massBelow + r.kingSide + r.tape + r.vix),
};
console.log(`=== DIRECTION ENGINE — decision @ ${DECISION}, predict rest-of-day SPY drift · n=${rows.length} days ===\n`);
console.log(`factor            hit%   n(non-flat)   avg pts when RIGHT   avg pts when WRONG   edge(pts/day)`);
for (const [name, fn] of Object.entries(factors)) {
  const graded = rows.map(r => ({ pred: fn(r), r })).filter(g => g.pred !== 0 && g.r.actual !== 0);
  if (!graded.length) { console.log(`${name.padEnd(16)}  —`); continue; }
  const hits = graded.filter(g => g.pred === g.r.actual);
  const hitPct = hits.length / graded.length * 100;
  // signed captured points = pred * restMove (if you hold pred direction)
  const capt = graded.map(g => g.pred * g.r.restMovePts);
  const avgRight = hits.length ? hits.reduce((a, g) => a + Math.abs(g.r.restMovePts), 0) / hits.length : 0;
  const wrongs = graded.filter(g => g.pred !== g.r.actual);
  const avgWrong = wrongs.length ? wrongs.reduce((a, g) => a + Math.abs(g.r.restMovePts), 0) / wrongs.length : 0;
  const edge = capt.reduce((a, c) => a + c, 0) / capt.length;
  console.log(`${name.padEnd(16)}  ${hitPct.toFixed(0).padStart(3)}%    ${String(graded.length).padStart(2)}            ${avgRight.toFixed(1).padStart(5)}                ${avgWrong.toFixed(1).padStart(5)}                ${edge > 0 ? '+' : ''}${edge.toFixed(1)}`);
}
console.log(`\nper-day (${DECISION}):  day  spot  massBelow king tape vix | actual restPts`);
for (const r of rows) console.log(`  ${r.d}  ${r.spot}   ${String(r.massBelow).padStart(2)}      ${String(r.kingSide).padStart(2)}   ${String(r.tape).padStart(2)}  ${String(r.vix).padStart(2)} |  ${String(r.actual).padStart(2)}   ${r.restMovePts > 0 ? '+' : ''}${r.restMovePts}`);
console.log(`\nedge(pts/day) = avg SPX points captured/day holding the predicted direction into the close. Positive & hit%>55% on a SIMPLE factor = a real, non-overfit direction edge.`);
