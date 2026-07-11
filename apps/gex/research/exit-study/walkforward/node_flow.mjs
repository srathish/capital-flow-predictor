// Whole-board-as-living-system (research only). Frame-to-frame gamma+vanna deltas
// across ALL strikes in the ±BAND window. Build directional FLOW features from the
// first half (open->mid) and test which — if any — LEAD the second-half price move
// (mid->close). This isolates lead from the coincident reshuffle. Candidate leads:
//   F1 pika-magnet : price toward the side BUILDING pika walls
//   F2 pika-reject : price AWAY from the side building pika (ceiling/floor holds)
//   F3 barney-accel: price toward the side OPENING an air pocket (barney/thinning)
//   F4 vanna-flow  : price toward the side GAINING vanna (charm/vanna hedging pull)
// A feature that hits >55% on the forward half is a genuine lead.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(HERE, '..', '..', '..', 'data', 'skylit-archive', 'intraday');
const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const TICKERS = ['SPXW', 'SPY', 'QQQ'];
const BAND = 0.025;

function frames(day, t) {
  const p = path.join(ARCHIVE, day, `${t}.jsonl.gz`); if (!fs.existsSync(p)) return [];
  return zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).map(s => ({ ts: Date.parse(s.requestedTs), spot: s.spot, strikes: (s.strikes || []).map(q => ({ k: +q.strike, g: +q.gamma || 0, v: +q.vanna || 0 })).filter(q => Number.isFinite(q.k)) }))
    .filter(s => s.spot != null && Number.isFinite(s.ts)).sort((a, b) => a.ts - b.ts);
}
const idx = fr => { const m = {}; for (const q of fr.strikes) m[q.k] = q; return m; };
const sgn = x => x > 0 ? 1 : x < 0 ? -1 : 0;

const rows = [];
for (const day of days) for (const t of TICKERS) {
  const fr = frames(day, t); if (fr.length < 9) continue;
  const o = fr[0], mid = fr[Math.floor(fr.length / 2)], c = fr.at(-1);
  const iO = idx(o), iM = idx(mid), s = mid.spot;
  let pikaAbove = 0, pikaBelow = 0, barneyAbove = 0, barneyBelow = 0, vanAbove = 0, vanBelow = 0;
  for (const k of Object.keys(iM)) {
    const K = +k; if (Math.abs(K - s) / s > BAND) continue;
    const gm = iM[k].g, go = (iO[k]?.g) || 0, dgAbs = Math.abs(gm) - Math.abs(go);
    const dv = iM[k].v - ((iO[k]?.v) || 0);
    const above = K > s;
    if (gm >= 0) { if (dgAbs > 0) { above ? pikaAbove += dgAbs : pikaBelow += dgAbs; } }
    else { if (dgAbs > 0) { above ? barneyAbove += dgAbs : barneyBelow += dgAbs; } }
    above ? vanAbove += dv : vanBelow += dv;
  }
  const lateDir = sgn(c.spot - mid.spot); if (lateDir === 0) continue;
  rows.push({
    lateDir,
    f1: sgn(pikaAbove - pikaBelow),            // toward pika-building side
    f3: sgn(barneyAbove - barneyBelow),        // toward barney/air-pocket side
    f4: sgn(vanAbove - vanBelow),              // toward vanna-gaining side
    er: (() => { let pl = 0; for (let i = 1; i < fr.length; i++) pl += Math.abs(fr[i].spot - fr[i - 1].spot); return pl ? Math.abs(c.spot - o.spot) / pl : 0; })(),
  });
}
const hit = (s, pred) => s.filter(r => pred(r) === r.lateDir).length / s.filter(r => pred(r) !== 0).length * 100;
const n = (s, pred) => s.filter(r => pred(r) !== 0).length;
console.log(`WHOLE-BOARD FLOW (does the reshuffle LEAD the 2nd half?) — ±${(BAND * 100).toFixed(1)}% window, ${rows.length} sessions\n`);
console.log('feature'.padEnd(34) + 'n'.padStart(5) + 'lead-hit%'.padStart(11));
const feats = [
  ['F1 pika-MAGNET (toward build)', r => r.f1],
  ['F2 pika-REJECT (away from build)', r => -r.f1],
  ['F3 barney-ACCEL (toward air pocket)', r => r.f3],
  ['F4 vanna-FLOW (toward vanna gain)', r => r.f4],
];
for (const [lab, p] of feats) console.log(lab.padEnd(34) + String(n(rows, p)).padStart(5) + hit(rows, p).toFixed(0).padStart(10) + '%' + (hit(rows, p) >= 55 ? ' ✅LEAD' : ''));
const medER = [...rows].map(r => r.er).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
console.log(`\nsame, TREND days only (ER≥${medER.toFixed(2)}):`);
const trend = rows.filter(r => r.er >= medER);
for (const [lab, p] of feats) console.log('  ' + lab.padEnd(32) + String(n(trend, p)).padStart(5) + hit(trend, p).toFixed(0).padStart(10) + '%' + (hit(trend, p) >= 55 ? ' ✅' : ''));
console.log('\n(>55% = the flow genuinely leads price; ~50% = coincident/no forecast)');
