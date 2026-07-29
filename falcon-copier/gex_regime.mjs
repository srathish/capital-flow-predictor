// HYPOTHESIS (operator): CHOP = weak/scattered GEX, no dominant node; TREND = larger GEX + the node
// KEEPS GROWING above (bull) or below (bear) as price trends toward it.
// Test: day trendiness (efficiency = |net move| / range) vs GEX concentration, total magnitude, and
// directional-node growth (AM->PM). Usage: node gex_regime.mjs
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const aux = (d) => { const f = path.join(DIR, `aux_${d}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { spy: [] }; };
const idxAt = (fr, et) => fr.reduce((b, x, i) => Math.abs(+etOf(x.ts).replace(':', '') - +et.replace(':', '')) < Math.abs(+etOf(fr[b].ts).replace(':', '') - +et.replace(':', '')) ? i : b, 0);
const sumAbs = (fx) => fx.strikes.reduce((t, n) => t + Math.abs(n.g0), 0);
const topPika = (fx) => fx.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0];
const gAt = (fx, k) => (fx.strikes.reduce((best, n) => Math.abs(n.strike - k) < Math.abs((best?.strike ?? 1e9) - k) ? n : best, null)?.g0 || 0);

const days = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();
const rows = [];
for (const d of days) {
  const fr = load(d), a = aux(d); if (!fr || !a.spy.length) continue;
  const cs = a.spy.map(p => p.c); const open = cs[0], close = cs[cs.length - 1], hi = Math.max(...cs), lo = Math.min(...cs);
  const eff = (hi - lo) ? Math.abs(close - open) / (hi - lo) : 0;         // 0=chop, 1=trend
  const dir = Math.sign(close - open);
  const am = fr[idxAt(fr, '10:00')], pm = fr[idxAt(fr, '14:30')];
  const totAM = sumAbs(am) / 1e6, totPM = sumAbs(pm) / 1e6;
  const kp = topPika(am);
  const concAM = kp ? kp.g0 / sumAbs(am) : 0;                            // king's share of all gamma (concentration)
  // directional node: strongest pika on the trend side of the 10:00 spot; track its growth to PM
  const s = am.spot;
  const dirNode = dir >= 0
    ? am.strikes.filter(n => n.g0 > 0 && n.strike >= s).sort((a, b) => b.g0 - a.g0)[0]   // above (bull)
    : am.strikes.filter(n => n.g0 > 0 && n.strike <= s).sort((a, b) => b.g0 - a.g0)[0];  // below (bear)
  const growth = dirNode ? gAt(pm, dirNode.strike) / (dirNode.g0 || 1) : 0;
  rows.push({ d, eff: +eff.toFixed(2), dir, totAM: +totAM.toFixed(0), totPM: +totPM.toFixed(0), conc: +(concAM * 100).toFixed(0), dirNode: dirNode?.strike, growth: +growth.toFixed(2) });
}
rows.sort((a, b) => b.eff - a.eff);
console.log(`=== GEX REGIME TEST · sorted by trendiness (eff = |net move|/range) · n=${rows.length} ===`);
console.log(`day         eff   dir   totGEX(AM→PM)   king-conc%   dirNode  node-growth(AM→PM)`);
for (const r of rows) console.log(`${r.d}  ${r.eff.toFixed(2)}  ${r.dir >= 0 ? 'bull' : 'bear'}   ${String(r.totAM).padStart(3)}→${String(r.totPM).padStart(3)}M        ${String(r.conc).padStart(2)}%       ${r.dirNode || '—'}    ×${r.growth.toFixed(2)} ${r.growth >= 1.15 ? 'GROWING' : r.growth <= 0.85 ? 'shrinking' : ''}`);
// split trend (eff>=0.5) vs chop (eff<0.35) and compare
const T = rows.filter(r => r.eff >= 0.5), C = rows.filter(r => r.eff < 0.35);
const avg = (a, k) => a.length ? (a.reduce((s, r) => s + r[k], 0) / a.length) : 0;
const grow = (a) => a.length ? a.filter(r => r.growth >= 1.15).length / a.length * 100 : 0;
console.log(`\nTREND days (eff≥0.5, n=${T.length}):  avg totGEX ${avg(T, 'totAM').toFixed(0)}M · avg king-conc ${avg(T, 'conc').toFixed(0)}% · dirNode GROWING on ${grow(T).toFixed(0)}% · avg growth ×${avg(T, 'growth').toFixed(2)}`);
console.log(`CHOP  days (eff<0.35, n=${C.length}):  avg totGEX ${avg(C, 'totAM').toFixed(0)}M · avg king-conc ${avg(C, 'conc').toFixed(0)}% · dirNode GROWING on ${grow(C).toFixed(0)}% · avg growth ×${avg(C, 'growth').toFixed(2)}`);
console.log(`\nHypothesis holds if TREND days show higher concentration + node GROWING, and CHOP days show scattered (low conc) GEX.`);
