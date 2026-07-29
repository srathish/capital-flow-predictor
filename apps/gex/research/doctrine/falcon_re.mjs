// Reverse-engineer Falcon: reconstruct the SPXW surface at each Falcon pick time and
// show the structure (put wall / call wall / king / net-gamma regime) — to find what
// the picks share (are the anchors the walls? is spot AT a wall when it fires?).
// Usage: node falcon_re.mjs 2026-07-20 [pick ETs...]  (default: reconstruct at picks from falcon_picks.json)
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const day = process.argv[2] || '2026-07-20';
const f = path.join(DIR, `replay_${day}_SPXW.jsonl.gz`);
if (!fs.existsSync(f)) { console.log(`no surface for ${day} yet`); process.exit(0); }
const fr = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l));
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const G = 12e6;
const putWall = (fx, s) => fx.strikes.filter(n => n.g0 >= G && n.strike < s).sort((a, b) => b.g0 - a.g0)[0];
const callWall = (fx, s) => fx.strikes.filter(n => n.g0 >= G && n.strike > s).sort((a, b) => b.g0 - a.g0)[0];
const king = (fx) => fx.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0];
const netG = (fx) => fx.strikes.reduce((a, b) => a + b.g0, 0);

const picks = (JSON.parse(fs.readFileSync(path.join(process.cwd(), 'research', 'doctrine', 'falcon_picks.json'), 'utf8')).picks || []).filter(p => p.date === day);
const times = process.argv.length > 3 ? process.argv.slice(3).map(et => ({ et, strike: '?', dir: '?' })) : picks.map(p => ({ et: p.et, strike: p.strike, dir: p.dir, cp: p.cp }));
if (!times.length) { console.log(`no picks for ${day} in falcon_picks.json`); process.exit(0); }
console.log(`=== FALCON REVERSE-ENGINEER — ${day} ===`);
console.log(`ET     Falcon pick        spot   netG  PUT WALL(target?)  CALL WALL(short from?)  KING`);
const near = (et) => fr.reduce((b, x, i) => Math.abs(+etOf(x.ts).replace(':', '') - +et.replace(':', '')) < Math.abs(+etOf(fr[b].ts).replace(':', '') - +et.replace(':', '')) ? i : b, 0);
const M = (x) => x ? `${x.strike}(${(x.g0 / 1e6).toFixed(0)}M)` : '—';
for (const t of times.sort((a, b) => a.et.localeCompare(b.et))) {
  const x = fr[near(t.et)], s = x.spot;
  const pw = putWall(x, s), cw = callWall(x, s), k = king(x);
  const pick = `${t.dir} ${t.strike}${t.cp || ''}`.padEnd(12);
  const anchorNote = t.strike !== '?' ? (pw && Math.abs(pw.strike - t.strike) <= 10 ? ' [=PUT WALL]' : cw && Math.abs(cw.strike - t.strike) <= 10 ? ' [=CALL WALL]' : k && Math.abs(k.strike - t.strike) <= 10 ? ' [=KING]' : '') : '';
  console.log(`${t.et}  ${pick} ${s.toFixed(0)}  ${netG(x) > 0 ? '+' : '-'}   ${M(pw).padEnd(16)}   ${M(cw).padEnd(20)}  ${M(k)}${anchorNote}`);
}
