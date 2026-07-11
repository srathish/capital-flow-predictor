// Node VELOCITY / acceleration lead test (research only). Operator: a node growing
// with rising VELOCITY should be more predictive than a static delta. Compute true
// per-strike gamma/vanna velocity (Δ per 5-min frame) and acceleration from the
// frame series; aggregate directional vanna+pika velocity in the first half; test
// whether RECENT velocity (and acceleration) leads the 2nd-half price move — and
// whether it beats the static-delta F4 (62% trend).
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
// net directional vanna FLOW between two frames (above - below spot), signed by side
function vFlow(a, b, s) {
  const ia = idx(a), ib = idx(b); let above = 0, below = 0;
  for (const k of Object.keys(ib)) { const K = +k; if (Math.abs(K - s) / s > BAND) continue; const dv = ib[k].v - ((ia[k]?.v) || 0); (K > s ? (above += dv) : (below += dv)); }
  return above - below;   // >0 = vanna building above (bullish pull), <0 = below
}
const rows = [];
for (const day of days) for (const t of TICKERS) {
  const fr = frames(day, t); if (fr.length < 10) continue;
  const midI = Math.floor(fr.length / 2), mid = fr[midI], c = fr.at(-1), s = mid.spot;
  const lateDir = sgn(c.spot - mid.spot); if (lateDir === 0) continue;
  // cumulative (open->mid) vanna flow = the static F4 signal
  const cum = vFlow(fr[0], mid, s);
  // RECENT velocity = vanna flow over the last 3 frames before mid
  const recent = vFlow(fr[midI - 3], mid, s);
  // acceleration = recent-3-frame flow minus the prior-3-frame flow
  const prior = vFlow(fr[midI - 6], fr[midI - 3], s);
  const accel = recent - prior;
  rows.push({ lateDir, cum: sgn(cum), recent: sgn(recent), accel: sgn(accel),
    er: (() => { let pl = 0; for (let i = 1; i < fr.length; i++) pl += Math.abs(fr[i].spot - fr[i - 1].spot); return pl ? Math.abs(c.spot - fr[0].spot) / pl : 0; })() });
}
const hit = (s, key) => { const u = s.filter(r => r[key] !== 0); return u.filter(r => r[key] === r.lateDir).length / u.length * 100; };
const nn = (s, key) => s.filter(r => r[key] !== 0).length;
console.log(`VANNA VELOCITY / ACCELERATION lead test — ${rows.length} sessions\n`);
console.log('signal'.padEnd(40) + 'n'.padStart(5) + 'lead-hit%'.padStart(11));
const rpt = (lab, key, s) => console.log(lab.padEnd(40) + String(nn(s, key)).padStart(5) + hit(s, key).toFixed(0).padStart(10) + '%' + (hit(s, key) >= 55 ? ' ✅' : ''));
rpt('cumulative vanna flow (static, =F4)', 'cum', rows);
rpt('RECENT vanna velocity (last 15min)', 'recent', rows);
rpt('vanna ACCELERATION (velocity rising)', 'accel', rows);
const medER = [...rows].map(r => r.er).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
const trend = rows.filter(r => r.er >= medER);
console.log(`\nTREND days only (n=${trend.length}):`);
rpt('  cumulative vanna flow', 'cum', trend);
rpt('  RECENT vanna velocity', 'recent', trend);
rpt('  vanna ACCELERATION', 'accel', trend);
// combo: recent velocity AND accel agree
const combo = trend.filter(r => r.recent === r.accel && r.recent !== 0);
console.log(`\n  velocity+accel AGREE (trend, n=${combo.length}): lead-hit ${(combo.filter(r => r.recent === r.lateDir).length / combo.length * 100).toFixed(0)}%`);
