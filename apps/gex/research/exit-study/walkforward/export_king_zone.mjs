// Export archive pika-King zone observations in Athena's king_zone_obs schema
// (research only). Seeds the pooled prior so lean->confirmed grows from both ends.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(HERE, '..', '..', '..', 'data', 'skylit-archive', 'intraday');
const OUT = path.join(HERE, '..', '..', '..', '.coordination', 'bellwether_king_zone_prior.jsonl');
const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const TICKERS = ['SPXW', 'SPY', 'QQQ'];
const FINAL = 0.30, ZONE = 0.004;

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
  const f0 = win[0]; let king = null, tot = 0;
  for (const q of f0.strikes) { tot += Math.abs(q.g); if (!king || Math.abs(q.g) > Math.abs(king.g)) king = q; }
  if (!king || !tot || king.g < 0) continue;               // PIKA only
  const dist = Math.abs(king.k - f0.spot); if (dist / f0.spot < 0.0015) continue;
  let dead = null;
  for (const q of f0.strikes) { const d = Math.abs(q.k - f0.spot); if (d >= 0.6 * dist && d <= 1.4 * dist && q.k !== king.k) { if (!dead || Math.abs(q.g) < Math.abs(dead.g)) dead = q; } }
  if (!dead) continue;
  const zf = lvl => win.filter(f => Math.abs(f.spot - lvl) / f.spot < ZONE).length / win.length;
  rows.push({ source: 'bellwether-archive', cycle_id: null, ts: new Date(f0.ts).toISOString(), ticker: t,
    king_strike: king.k, king_share: +king.g === 0 ? 0 : +(Math.abs(king.g) / tot).toFixed(4), king_sign: 'pika',
    dist_at_entry_pct: +(dist / f0.spot * 100).toFixed(3),
    final_window_zone_frac: +zf(king.k).toFixed(3), dead_strike_zone_frac: +zf(dead.k).toFixed(3) });
}
fs.writeFileSync(OUT, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const m = a => a.reduce((s, x) => s + x, 0) / a.length;
console.log(`wrote ${rows.length} pika-King zone observations -> ${path.relative(path.join(HERE, '..', '..', '..'), OUT)}`);
console.log(`prior means: zone@King ${(m(rows.map(r => r.final_window_zone_frac)) * 100).toFixed(0)}% vs zone@dead ${(m(rows.map(r => r.dead_strike_zone_frac)) * 100).toFixed(0)}%`);
