// Dose-response + zone-width robustness for the conditional pika pin (research only).
// If the pin is real, edge (zone@King - zone@dead) should RISE with King share and
// hold across zone widths. Flat/noisy => the +12pt was luck. PIKA Kings only.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(HERE, '..', '..', '..', 'data', 'skylit-archive', 'intraday');
const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const TICKERS = (process.argv[2] || 'SPXW,SPY,QQQ').split(',');
const FINAL = 0.30;

function frames(day, t) {
  const p = path.join(ARCHIVE, day, `${t}.jsonl.gz`); if (!fs.existsSync(p)) return [];
  return zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).map(s => ({ ts: Date.parse(s.requestedTs), spot: s.spot, strikes: (s.strikes || []).map(q => ({ k: +q.strike, g: +q.gamma || 0 })).filter(q => Number.isFinite(q.k)) }))
    .filter(s => s.spot != null && Number.isFinite(s.ts)).sort((a, b) => a.ts - b.ts);
}
function setup(fr) {
  let king = null, tot = 0; for (const q of fr.strikes) { tot += Math.abs(q.g); if (!king || Math.abs(q.g) > Math.abs(king.g)) king = q; }
  if (!king || !tot || king.g < 0) return null;            // PIKA only (positive gamma)
  const dist = Math.abs(king.k - fr.spot); if (dist / fr.spot < 0.0015) return null;
  let dead = null;
  for (const q of fr.strikes) { const d = Math.abs(q.k - fr.spot); if (d >= 0.6 * dist && d <= 1.4 * dist && q.k !== king.k) { if (!dead || Math.abs(q.g) < Math.abs(dead.g)) dead = q; } }
  return dead ? { king: king.k, dead: dead.k, share: Math.abs(king.g) / tot } : null;
}
const zoneEdge = (win, king, dead, z) => win.filter(f => Math.abs(f.spot - king) / f.spot < z).length / win.length - win.filter(f => Math.abs(f.spot - dead) / f.spot < z).length / win.length;

const rows = [];
for (const day of days) for (const t of TICKERS) {
  const fr = frames(day, t); if (fr.length < 8) continue;
  const cut = fr[Math.floor(fr.length * (1 - FINAL))].ts;
  const win = fr.filter(f => f.ts >= cut); if (win.length < 4) continue;
  const s = setup(win[0]); if (!s) continue;
  rows.push({ share: s.share, e3: zoneEdge(win, s.king, s.dead, 0.003), e4: zoneEdge(win, s.king, s.dead, 0.004), e5: zoneEdge(win, s.king, s.dead, 0.005) });
}
rows.sort((a, b) => a.share - b.share);
const pct = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const mean = (s, f) => s.length ? s.reduce((a, r) => a + f(r), 0) / s.length : NaN;
console.log(`PIKA PIN DOSE-RESPONSE — ${rows.length} pika-King sessions, edge = zone@King − zone@dead\n`);
console.log('share bin'.padEnd(16) + 'n'.padStart(4) + 'edge@±0.3%'.padStart(12) + 'edge@±0.4%'.padStart(12) + 'edge@±0.5%'.padStart(12));
const B = 5, per = Math.ceil(rows.length / B);
for (let i = 0; i < B; i++) {
  const s = rows.slice(i * per, (i + 1) * per); if (!s.length) continue;
  const lo = s[0].share, hi = s.at(-1).share;
  console.log(`${lo.toFixed(2)}-${hi.toFixed(2)}`.padEnd(16) + String(s.length).padStart(4) + pct(mean(s, r => r.e3)).padStart(12) + pct(mean(s, r => r.e4)).padStart(12) + pct(mean(s, r => r.e5)).padStart(12));
}
// simple correlation share vs edge@0.4
const xs = rows.map(r => r.share), ys = rows.map(r => r.e4), mx = mean(rows, r => r.share), my = mean(rows, r => r.e4);
const cov = mean(rows, r => (r.share - mx) * (r.e4 - my)), sx = Math.sqrt(mean(rows, r => (r.share - mx) ** 2)), sy = Math.sqrt(mean(rows, r => (r.e4 - my) ** 2));
console.log(`\ncorrelation(share, edge@0.4%) = ${(cov / (sx * sy)).toFixed(2)}  (positive + rising bins = real dose-response)`);
