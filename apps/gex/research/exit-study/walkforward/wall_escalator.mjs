// Wall-vs-escalator precursor test (research only). Ground-truth said the pika King
// PINS on chop days (wall) and price BREAKS AWAY on trend days (escalator). So the
// zone-edge (zone@King - zone@dead) should concentrate in CHOP days. Classify each
// high-share pika session two ways and split:
//   (a) total-gamma sign at window start (realizable; +gamma = pin regime, Clause 8)
//   (b) realized efficiency ratio of the final window (low ER = chop, high = trend)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(HERE, '..', '..', '..', 'data', 'skylit-archive', 'intraday');
const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const TICKERS = ['SPXW', 'SPY', 'QQQ'];
const FINAL = 0.30, ZONE = 0.004, SHARE_MIN = 0.21;        // dominant pika only (the pin regime)

function frames(day, t) {
  const p = path.join(ARCHIVE, day, `${t}.jsonl.gz`); if (!fs.existsSync(p)) return [];
  return zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).map(s => ({ ts: Date.parse(s.requestedTs), spot: s.spot, strikes: (s.strikes || []).map(q => ({ k: +q.strike, g: +q.gamma || 0 })).filter(q => Number.isFinite(q.k)) }))
    .filter(s => s.spot != null && Number.isFinite(s.ts)).sort((a, b) => a.ts - b.ts);
}
const rows = [];
for (const day of days) for (const t of TICKERS) {
  const fr = frames(day, t); if (fr.length < 8) continue;
  const cut = fr[Math.floor(fr.length * (1 - FINAL))].ts;
  const win = fr.filter(f => f.ts >= cut); if (win.length < 4) continue;
  const f0 = win[0]; let king = null, tot = 0, totG = 0;
  for (const q of f0.strikes) { tot += Math.abs(q.g); totG += q.g; if (!king || Math.abs(q.g) > Math.abs(king.g)) king = q; }
  if (!king || !tot || king.g < 0) continue;
  const share = Math.abs(king.g) / tot; if (share < SHARE_MIN) continue;   // dominant pika
  const dist = Math.abs(king.k - f0.spot); if (dist / f0.spot < 0.0015) continue;
  let dead = null;
  for (const q of f0.strikes) { const d = Math.abs(q.k - f0.spot); if (d >= 0.6 * dist && d <= 1.4 * dist && q.k !== king.k) { if (!dead || Math.abs(q.g) < Math.abs(dead.g)) dead = q; } }
  if (!dead) continue;
  const zf = lvl => win.filter(f => Math.abs(f.spot - lvl) / f.spot < ZONE).length / win.length;
  // realized efficiency ratio over the final window
  let plen = 0; for (let i = 1; i < win.length; i++) plen += Math.abs(win[i].spot - win[i - 1].spot);
  const er = plen ? Math.abs(win.at(-1).spot - win[0].spot) / plen : 0;   // low=chop, high=trend
  rows.push({ day, t, edge: zf(king.k) - zf(dead.k), zK: zf(king.k), zD: zf(dead.k), posGamma: totG > 0, er });
}
const pct = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
const mean = (s, f) => s.length ? s.reduce((a, r) => a + f(r), 0) / s.length : NaN;
console.log(`WALL vs ESCALATOR — dominant-pika Kings (share>=${SHARE_MIN}), zone-edge by regime, n=${rows.length}\n`);
console.log('split (a) total-gamma sign at window start:');
for (const [lab, f] of [['pos-gamma (pin regime)', r => r.posGamma], ['neg-gamma (trend regime)', r => !r.posGamma]]) {
  const s = rows.filter(f); console.log(`  ${lab.padEnd(24)} n=${String(s.length).padStart(3)}  zone-edge ${pct(mean(s, r => r.edge))}  (King ${pct(mean(s, r => r.zK))} vs dead ${pct(mean(s, r => r.zD))})`);
}
const medER = [...rows].map(r => r.er).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
console.log(`\nsplit (b) realized efficiency ratio (median ${medER.toFixed(2)}; low=chop):`);
for (const [lab, f] of [['CHOP day (ER<median)', r => r.er < medER], ['TREND day (ER>=median)', r => r.er >= medER]]) {
  const s = rows.filter(f); console.log(`  ${lab.padEnd(24)} n=${String(s.length).padStart(3)}  zone-edge ${pct(mean(s, r => r.edge))}  (King ${pct(mean(s, r => r.zK))} vs dead ${pct(mean(s, r => r.zD))})`);
}
console.log('\n=> WALL confirmed if the pin edge is POSITIVE on chop/pos-gamma days and ~0/negative on trend days.');
