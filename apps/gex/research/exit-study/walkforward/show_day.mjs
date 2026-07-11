// Ground-truth viewer (research only): show the actual King + real intraday price
// path on the highest-conviction (high-share pika) sessions, so we can SEE the
// King-price interaction directly — no aggregation, no hallucination.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(HERE, '..', '..', '..', 'data', 'skylit-archive', 'intraday');
const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const TICKERS = ['SPXW', 'SPY', 'QQQ'];
function frames(day, t) {
  const p = path.join(ARCHIVE, day, `${t}.jsonl.gz`); if (!fs.existsSync(p)) return [];
  return zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).map(s => ({ ts: Date.parse(s.requestedTs), spot: s.spot, strikes: (s.strikes || []).map(q => ({ k: +q.strike, g: +q.gamma || 0 })).filter(q => Number.isFinite(q.k)) }))
    .filter(s => s.spot != null && Number.isFinite(s.ts)).sort((a, b) => a.ts - b.ts);
}
function kingAt(fr) { let king = null, tot = 0; for (const q of fr.strikes) { tot += Math.abs(q.g); if (!king || Math.abs(q.g) > Math.abs(king.g)) king = q; } return king && tot ? { k: king.k, sign: king.g >= 0 ? 'pika' : 'barney', share: Math.abs(king.g) / tot } : null; }

// rank sessions by opening-King share (pika), show the top few
const cand = [];
for (const day of days) for (const t of TICKERS) {
  const fr = frames(day, t); if (fr.length < 8) continue;
  const k = kingAt(fr[0]); if (!k || k.sign !== 'pika') continue;
  if (Math.abs(k.k - fr[0].spot) / fr[0].spot < 0.001) continue;
  cand.push({ day, t, fr, k });
}
cand.sort((a, b) => b.k.share - a.k.share);
const et = ts => new Date(ts - 4 * 3600e3).toISOString().slice(11, 16);   // ET-ish
for (const c of cand.slice(0, Number(process.argv[2] || 4))) {
  const { day, t, fr, k } = c;
  console.log(`\n${'='.repeat(64)}\n${t} ${day} — KING $${k.k} (${k.sign}, share ${(k.share * 100).toFixed(0)}%)  open spot $${fr[0].spot.toFixed(2)}`);
  console.log(`${'time'.padEnd(7)}${'spot'.padStart(10)}${'distToKing'.padStart(12)}  bar`);
  const step = Math.max(1, Math.floor(fr.length / 14));
  for (let i = 0; i < fr.length; i += step) {
    const f = fr[i]; const d = (f.spot - k.k); const dp = d / f.spot * 100;
    const mark = Math.abs(dp) < 0.15 ? ' <-- AT KING' : '';
    const bar = '│' + ' '.repeat(Math.max(0, Math.round(20 + Math.max(-20, Math.min(20, dp * 8))))) + '●';
    console.log(`${et(f.ts).padEnd(7)}${('$' + f.spot.toFixed(2)).padStart(10)}${(dp >= 0 ? '+' : '') + dp.toFixed(2) + '%'}`.padEnd(29) + `${bar}${mark}`);
  }
  const closeDist = Math.abs(fr.at(-1).spot - k.k) / fr.at(-1).spot * 100;
  const minDist = Math.min(...fr.map(f => Math.abs(f.spot - k.k) / f.spot * 100));
  console.log(`  open dist ${(Math.abs(fr[0].spot - k.k) / fr[0].spot * 100).toFixed(2)}% -> close dist ${closeDist.toFixed(2)}% | closest approach ${minDist.toFixed(2)}%`);
}
