// Radar v2 — a LIVE, SWITCHING signal (flips bull↔bear↔no-trade intraday).
// Fixes v1's failures: use 15-min MOMENTUM (not price-vs-open), and make it
// REGIME-AWARE via net-gamma sign:
//   NEG gamma (trend) → follow momentum; a king pika ahead of the move = magnet (reinforce).
//   POS gamma (pin)   → default NO-TRADE in the middle; only signal on a strong momentum
//                        break or a clean extreme (fade the ceiling / bounce the floor).
// Evaluate by whether it FLIPS at the turns, not by a day-dominant verdict.
// Usage: node direction2.mjs 2026-07-20
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DAY = process.argv[2] || '2026-07-20';
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const load = (tk) => { const f = path.join(DIR, `replay_${DAY}_${tk}.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : []; };
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const kingOf = (n) => [...n].sort((a, b) => Math.abs(b.g0) - Math.abs(a.g0))[0] || null;
const DEFL = { SPXW: 5, SPY: 0.5, QQQ: 0.5 };

function lean(frames, i, tk) {
  const f = frames[i], s = f.spot, nodes = f.strikes;
  const back = frames[Math.max(0, i - 15)];
  const mom = (s - back.spot) / s * 100;                 // 15-min momentum %
  const regNet = frames.slice(Math.max(0, i - 10), i + 1).reduce((a, b) => a + b.strikes.reduce((x, y) => x + y.g0, 0), 0);
  const REG = regNet >= 0 ? 'PIN' : 'TREND';
  const king = kingOf(nodes);
  const z = DEFL[tk] || 5;
  const pikaAbove = [...nodes].filter(n => n.g0 > 0 && n.strike > s).sort((a, b) => b.g0 - a.g0)[0];
  const pikaBelow = [...nodes].filter(n => n.g0 > 0 && n.strike < s).sort((a, b) => b.g0 - a.g0)[0];
  let v = 0; const r = [`m${mom.toFixed(2)}`, REG[0]];
  if (REG === 'TREND') {
    // follow momentum; king pika ahead of the move reinforces (magnet)
    if (mom > 0.1) { v += 1; r.push('mom↑'); } else if (mom < -0.1) { v -= 1; r.push('mom↓'); }
    if (king && king.g0 > 0) { if (king.strike > s && v > 0) { v += 1; r.push('magnet↑'); } if (king.strike < s && v < 0) { v -= 1; r.push('magnet↓'); } }
  } else {
    // PIN/range: sit out the middle; only fade a clean extreme or ride a strong break
    const nearCeil = pikaAbove && Math.abs(pikaAbove.strike - s) <= z * 1.2;
    const nearFloor = pikaBelow && Math.abs(pikaBelow.strike - s) <= z * 1.2;
    if (nearCeil && mom <= 0) { v -= 1; r.push('fadeCeil↓'); }        // rejected at ceiling → short
    else if (nearFloor && mom >= 0) { v += 1; r.push('bounceFloor↑'); } // held floor → long
    else if (mom > 0.25) { v += 1; r.push('break↑'); }                // strong break up out of the pin
    else if (mom < -0.25) { v -= 1; r.push('break↓'); }               // strong break down
    // else: mid-range, no signal (v stays 0)
  }
  return { v, dir: v >= 1 ? 'BULL' : v <= -1 ? 'BEAR' : 'NEUT', r };
}
function trinity(idx, et) {
  const per = {};
  for (const [nm, frames] of Object.entries(idx)) { if (!frames.length) continue; const i = frames.reduce((b, f, k) => Math.abs(+etOf(f.ts).replace(':', '') - +et.replace(':', '')) < Math.abs(+etOf(frames[b].ts).replace(':', '') - +et.replace(':', '')) ? k : b, 0); per[nm] = lean(frames, i, nm); per[nm].spot = frames[i].spot; }
  const dirs = Object.values(per).map(p => p.dir);
  const bull = dirs.filter(d => d === 'BULL').length, bear = dirs.filter(d => d === 'BEAR').length;
  let verdict = 'NO-TRADE';
  if (bull >= 2 && bear === 0) verdict = 'BULLISH'; else if (bear >= 2 && bull === 0) verdict = 'BEARISH';
  return { per, verdict, bull, bear };
}
const idx = { SPXW: load('SPXW'), SPY: load('SPY'), QQQ: load('QQQ') };
if (!idx.SPXW.length) { console.log(`no ${DAY} data`); process.exit(1); }
console.log(`=== RADAR v2 — ${DAY} (a switching signal) ===`);
console.log(`ET     SPXWspot  RADAR       vote   SPXW              SPY               QQQ`);
const marks = ['09:45','10:15','10:45','11:15','11:45','12:15','12:45','13:15','13:45','14:15','14:45','15:15','15:45'];
let prev = null; const switches = [];
for (const et of marks) {
  const t = trinity(idx, et);
  if (t.verdict !== prev) { switches.push(`${et}:${t.verdict}`); prev = t.verdict; }
  const c = (nm) => t.per[nm] ? `${t.per[nm].dir[0]}${t.per[nm].v>=0?'+':''}${t.per[nm].v}(${t.per[nm].r.join(',')})`.padEnd(17) : '—'.padEnd(17);
  const sp = t.per.SPXW ? t.per.SPXW.spot.toFixed(0) : '—';
  console.log(`${et}  ${sp}    ${t.verdict.padEnd(9)} ${t.bull}B/${t.bear}b  ${c('SPXW')} ${c('SPY')} ${c('QQQ')}`);
}
console.log(`\nSWITCHES: ${switches.join('  →  ')}`);
