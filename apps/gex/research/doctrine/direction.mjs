// Trinity direction engine (the Phase-1 gate): read SPXW/SPY/QQQ and decide the
// day's tradeable direction — BULLISH / BEARISH / NO-TRADE — so we only fire the
// aligned side. Uses only data available AT each timestamp (no look-ahead).
// Per index lean = trend-vs-open + king magnet (pika above=up / below=down) +
// rolling floor(↑)/ceiling(↓). Trinity = majority agree AND zero dissent.
// Usage: node direction.mjs 2026-07-21
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DAY = process.argv[2] || '2026-07-21';
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const load = (tk) => { const f = path.join(DIR, `replay_${DAY}_${tk}.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : []; };
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const kingOf = (nodes) => [...nodes].sort((a, b) => Math.abs(b.g0) - Math.abs(a.g0))[0] || null;
const floorOf = (nodes, s) => [...nodes].filter(n => n.g0 > 0 && n.strike < s).sort((a, b) => b.g0 - a.g0)[0] || null;
const ceilOf = (nodes, s) => [...nodes].filter(n => n.g0 > 0 && n.strike > s).sort((a, b) => b.g0 - a.g0)[0] || null;

// per-index directional lean at frame i (lookback 15 frames for rolling)
function lean(frames, i) {
  const f = frames[i], s = f.spot, open = frames[0].spot, nodes = f.strikes;
  const king = kingOf(nodes), floor = floorOf(nodes, s), ceil = ceilOf(nodes, s);
  const j = Math.max(0, i - 15), pf = frames[j];
  const floorJ = floorOf(pf.strikes, pf.spot), ceilJ = ceilOf(pf.strikes, pf.spot);
  let v = 0; const r = [];
  if (s > open * 1.0005) { v += 1; r.push('>open'); } else if (s < open * 0.9995) { v -= 1; r.push('<open'); }
  if (king) { const above = king.strike > s; if (king.g0 > 0) { v += above ? 1 : -1; r.push(above ? 'kPika↑' : 'kPika↓'); } else { v += above ? 0.5 : -0.5; r.push(above ? 'kBarn↑' : 'kBarn↓'); } }
  if (floor && floorJ && floor.strike > floorJ.strike) { v += 1; r.push('floor↑'); }
  if (ceil && ceilJ && ceil.strike < ceilJ.strike) { v -= 1; r.push('ceil↓'); }
  return { v, dir: v >= 1 ? 'BULL' : v <= -1 ? 'BEAR' : 'NEUT', s, r };
}
function trinity(idx, et) {
  const per = {};
  for (const [nm, frames] of Object.entries(idx)) {
    if (!frames.length) continue;
    const i = frames.reduce((b, f, k) => Math.abs(+etOf(f.ts).replace(':', '') - +et.replace(':', '')) < Math.abs(+etOf(frames[b].ts).replace(':', '') - +et.replace(':', '')) ? k : b, 0);
    per[nm] = lean(frames, i);
  }
  const dirs = Object.values(per).map(p => p.dir);
  const bull = dirs.filter(d => d === 'BULL').length, bear = dirs.filter(d => d === 'BEAR').length;
  let verdict = 'NO-TRADE';
  if (bull >= 2 && bear === 0) verdict = 'BULLISH';
  else if (bear >= 2 && bull === 0) verdict = 'BEARISH';
  return { per, verdict, bull, bear };
}

const idx = { SPXW: load('SPXW'), SPY: load('SPY'), QQQ: load('QQQ') };
if (!idx.SPXW.length) { console.log(`no ${DAY} data — pull it first`); process.exit(1); }
console.log(`=== TRINITY DIRECTION — ${DAY} ===`);
console.log(`ET     verdict     vote      SPXW           SPY            QQQ`);
const marks = ['09:45', '10:15', '10:45', '11:15', '11:45', '12:15', '12:45', '13:15', '13:45', '14:15', '14:45', '15:15'];
const tally = {};
for (const et of marks) {
  const t = trinity(idx, et);
  tally[t.verdict] = (tally[t.verdict] || 0) + 1;
  const cell = (nm) => t.per[nm] ? `${t.per[nm].dir[0]}${t.per[nm].v >= 0 ? '+' : ''}${t.per[nm].v}(${t.per[nm].r.join(',')})`.padEnd(14) : '—'.padEnd(14);
  console.log(`${et}  ${t.verdict.padEnd(10)} ${t.bull}B/${t.bear}b   ${cell('SPXW')} ${cell('SPY')} ${cell('QQQ')}`);
}
console.log(`\nDAY TALLY: ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join('  ')}`);
const dom = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
console.log(`DOMINANT DIRECTION: ${dom[0]} (${dom[1]}/${marks.length} marks)  →  gate: fire only ${dom[0] === 'BULLISH' ? 'BULL/calls' : dom[0] === 'BEARISH' ? 'BEAR/puts' : 'NOTHING'}`);
