// Node-level regime: the surface net is +gamma on every 2026 low-VIX day, so the deflection/trapdoor
// distinction is LOCAL. Deflection fades off a PIKA (g0>0 node that holds); trapdoor breaks through a
// BARNEY (g0<0 node below spot that accelerates). Check the g0 SIGN at each pick's target strike.
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const load = (day) => { const f = path.join(DIR, `replay_${day}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const near = (fr, et) => fr.reduce((b, x, i) => Math.abs(+etOf(x.ts).replace(':', '') - +et.replace(':', '')) < Math.abs(+etOf(fr[b].ts).replace(':', '') - +et.replace(':', '')) ? i : b, 0);
const at = (fx, k) => fx.strikes.reduce((best, n) => Math.abs(n.strike - k) < Math.abs((best?.strike ?? 1e9) - k) ? n : best, null);
const nearestBarney = (fx, below) => fx.strikes.filter(n => n.g0 < 0 && (below ? n.strike < fx.spot : n.strike > fx.spot)).sort((a, b) => Math.abs(a.strike - fx.spot) - Math.abs(b.strike - fx.spot))[0];
const nearestPika = (fx, above) => fx.strikes.filter(n => n.g0 > 6e6 && (above ? n.strike > fx.spot : n.strike < fx.spot)).sort((a, b) => Math.abs(a.strike - fx.spot) - Math.abs(b.strike - fx.spot))[0];

const picks = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'research', 'doctrine', 'falcon_picks.json'), 'utf8')).picks;
const cache = {};
console.log(`date        et     signal              dir    spot   TARGET(g0@strike)      node    nearest barney↓        nearest pika (wall)`);
for (const p of picks.filter(p => p.underlying !== 'SPY').sort((a, b) => (a.date + a.et).localeCompare(b.date + b.et))) {
  const fr = cache[p.date] !== undefined ? cache[p.date] : (cache[p.date] = load(p.date));
  if (!fr) continue;
  const x = fr[near(fr, p.et)];
  const tgt = at(x, p.strike);
  const nodeSign = !tgt ? '?' : tgt.g0 > 3e6 ? 'PIKA+' : tgt.g0 < -3e6 ? 'BARNEY-' : 'flat~0';
  const bDn = nearestBarney(x, true), pk = nearestPika(x, p.dir === 'SHORT' ? true : false);
  const fm = (n) => n ? `${n.strike}(${(n.g0 / 1e6).toFixed(0)}M)` : '—';
  console.log(`${p.date}  ${p.et}  ${(p.signal || '?').padEnd(18)}  ${(p.dir || '').padEnd(5)}  ${x.spot.toFixed(0)}  ${String(p.strike).padStart(4)}=${((tgt?.g0 || 0) / 1e6).toFixed(0).padStart(4)}M ${nodeSign.padEnd(7)}  ${fm(bDn).padEnd(20)}  ${fm(pk)}`);
}
console.log(`\nRead: deflection SHORT should fade off a PIKA above spot (the wall). trapdoor SHORT should target a BARNEY below spot.`);
