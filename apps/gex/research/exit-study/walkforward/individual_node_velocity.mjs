// Per-NODE velocity lead test (research only). Operator: don't aggregate — track each
// individual strike's own growth velocity/acceleration; a single node accelerating
// (dealers aggressively building it, e.g. "5 strikes up") may LEAD price toward it.
// First half (open->mid): per-strike |gamma| & vanna growth, recent velocity (last
// 15min), acceleration. Find the fastest-growing / fastest-accelerating node (excl
// the immediate ATM); test whether the 2nd-half price move goes TOWARD it (magnet) or
// AWAY (wall reject). Compare vs the aggregate (57/62%).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(HERE, '..', '..', '..', 'data', 'skylit-archive', 'intraday');
const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const TICKERS = ['SPXW', 'SPY', 'QQQ'];
const BAND = 0.025, ATM_EXCL = 0.0015;
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
  const fr = frames(day, t); if (fr.length < 10) continue;
  const mi = Math.floor(fr.length / 2), mid = fr[mi], c = fr.at(-1), s = mid.spot;
  const lateDir = sgn(c.spot - mid.spot); if (lateDir === 0) continue;
  const iO = idx(fr[0]), iM = idx(mid), iR = idx(fr[mi - 3]), iP = idx(fr[mi - 6]);
  let bestGrow = null, bestAccel = null, bestVanGrow = null;
  for (const k of Object.keys(iM)) {
    const K = +k; if (Math.abs(K - s) / s > BAND || Math.abs(K - s) / s < ATM_EXCL) continue;
    const gM = Math.abs(iM[k].g), gO = Math.abs((iO[k]?.g) || 0), gR = Math.abs((iR[k]?.g) || 0), gP = Math.abs((iP[k]?.g) || 0);
    const grow = gM - gO, recentVel = gM - gR, accel = (gM - gR) - (gR - gP);
    const vGrow = Math.abs(iM[k].v) - Math.abs((iO[k]?.v) || 0);
    if (iM[k].g > 0) {                                  // pika nodes (the walls/magnets)
      if (grow > 0 && (!bestGrow || grow > bestGrow.grow)) bestGrow = { K, grow, side: sgn(K - s) };
      if (accel > 0 && (!bestAccel || accel > bestAccel.accel)) bestAccel = { K, accel, side: sgn(K - s) };
    }
    if (vGrow > 0 && (!bestVanGrow || vGrow > bestVanGrow.vGrow)) bestVanGrow = { K, vGrow, side: sgn(K - s) };
  }
  let pl = 0; for (let i = 1; i < fr.length; i++) pl += Math.abs(fr[i].spot - fr[i - 1].spot);
  rows.push({ lateDir,
    growSide: bestGrow?.side ?? 0, accelSide: bestAccel?.side ?? 0, vanGrowSide: bestVanGrow?.side ?? 0,
    er: pl ? Math.abs(c.spot - fr[0].spot) / pl : 0 });
}
const hit = (s, key, dir = 1) => { const u = s.filter(r => r[key] !== 0); return u.length ? u.filter(r => dir * r[key] === r.lateDir).length / u.length * 100 : NaN; };
const nn = (s, key) => s.filter(r => r[key] !== 0).length;
console.log(`PER-NODE VELOCITY lead test — fastest individual node (excl ATM), ${rows.length} sessions\n`);
const rpt = (lab, key, dir, s) => console.log(lab.padEnd(42) + String(nn(s, key)).padStart(5) + hit(s, key, dir).toFixed(0).padStart(9) + '%' + (hit(s, key, dir) >= 55 ? ' ✅' : ''));
console.log('signal'.padEnd(42) + 'n'.padStart(5) + 'lead%'.padStart(10));
rpt('fastest-GROWING pika → price TOWARD it', 'growSide', 1, rows);
rpt('fastest-GROWING pika → price AWAY (reject)', 'growSide', -1, rows);
rpt('fastest-ACCELERATING pika → TOWARD', 'accelSide', 1, rows);
rpt('fastest-ACCELERATING pika → AWAY', 'accelSide', -1, rows);
rpt('fastest-GROWING vanna node → TOWARD', 'vanGrowSide', 1, rows);
const medER = [...rows].map(r => r.er).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
const tr = rows.filter(r => r.er >= medER);
console.log(`\nTREND days only (n=${tr.length}):`);
rpt('  fastest-ACCELERATING pika → TOWARD', 'accelSide', 1, tr);
rpt('  fastest-ACCELERATING pika → AWAY', 'accelSide', -1, tr);
rpt('  fastest-GROWING vanna node → TOWARD', 'vanGrowSide', 1, tr);
console.log('\n(>55% = the individual accelerating node leads price; compare vs aggregate vanna 62%)');
