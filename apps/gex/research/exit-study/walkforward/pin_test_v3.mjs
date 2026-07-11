// Share-conditioned pin test (research only, READ-ONLY archive, no logic change).
// King = 0DTE column max|gamma| (verified == what the live tracker reads).
// Operator watched price pin to a HIGH-SHARE, PIKA King. Prior tests averaged
// weak+strong nodes. Split by the King's relative_significance (share = |g_king| /
// sum|g|) and by sign (pika/barney). Hypothesis: dominant pika Kings pin; weak ones
// don't. Final-30% window, pin vs mirror-placebo.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(HERE, '..', '..', '..', 'data', 'skylit-archive', 'intraday');
const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const TICKERS = (process.argv[2] || 'SPXW,SPY,QQQ').split(',');
const FINAL = 0.30, NEAR = 0.0015;

function frames(day, t) {
  const p = path.join(ARCHIVE, day, `${t}.jsonl.gz`); if (!fs.existsSync(p)) return [];
  return zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).map(s => ({ ts: Date.parse(s.requestedTs), spot: s.spot, strikes: s.strikes || [] }))
    .filter(s => s.spot != null && Number.isFinite(s.ts)).sort((a, b) => a.ts - b.ts);
}
// 0DTE King = max|gamma|; return strike, sign, share
function king(fr) {
  let best = null, tot = 0;
  for (const q of fr.strikes) { const g = +q.gamma || 0; tot += Math.abs(g); if (!best || Math.abs(g) > Math.abs(best.g)) best = { k: +q.strike, g }; }
  if (!best || !tot) return null;
  return { strike: best.k, sign: best.g >= 0 ? 'pika' : 'barney', share: Math.abs(best.g) / tot };
}

const rows = [];
for (const day of days) for (const t of TICKERS) {
  const fr = frames(day, t); if (fr.length < 8) continue;
  const cut = fr[Math.floor(fr.length * (1 - FINAL))].ts;
  const win = fr.filter(f => f.ts >= cut); if (win.length < 3) continue;
  const k = king(win[0]); if (!k) continue;
  const start = win[0].spot; if (Math.abs(start - k.strike) / start < NEAR) continue;
  const placebo = 2 * start - k.strike;
  const atK = win.filter(f => Math.abs(f.spot - k.strike) / f.spot < NEAR).length / win.length;
  const atP = win.filter(f => Math.abs(f.spot - placebo) / f.spot < NEAR).length / win.length;
  rows.push({ sign: k.sign, share: k.share, pinBeatsPlacebo: atK > atP, atK, atP });
}
const pct = x => `${(x * 100).toFixed(0)}%`;
const rate = (s, f) => s.length ? s.filter(f).length / s.length : NaN;
const mean = (s, f) => s.length ? s.reduce((a, r) => a + f(r), 0) / s.length : NaN;
console.log(`SHARE-CONDITIONED PIN — 0DTE King, ${rows.length} sessions\n`);
// share terciles
const sorted = [...rows].sort((a, b) => a.share - b.share);
const t1 = sorted[Math.floor(rows.length / 3)].share, t2 = sorted[Math.floor(rows.length * 2 / 3)].share;
console.log(`share terciles: low<${t1.toFixed(2)}  mid  high>${t2.toFixed(2)}`);
for (const [lab, f] of [['LOW share', r => r.share < t1], ['MID share', r => r.share >= t1 && r.share <= t2], ['HIGH share', r => r.share > t2]]) {
  const s = rows.filter(f);
  console.log(`  ${lab.padEnd(11)} n=${String(s.length).padStart(3)}  pin>placebo ${pct(rate(s, r => r.pinBeatsPlacebo))}  atKing ${pct(mean(s, r => r.atK))}  atPlacebo ${pct(mean(s, r => r.atP))}`);
}
console.log('\nby sign:');
for (const sg of ['pika', 'barney']) {
  const s = rows.filter(r => r.sign === sg);
  console.log(`  ${sg.padEnd(7)} n=${String(s.length).padStart(3)}  pin>placebo ${pct(rate(s, r => r.pinBeatsPlacebo))}  atKing ${pct(mean(s, r => r.atK))}  atPlacebo ${pct(mean(s, r => r.atP))}`);
}
console.log('\nHIGH-share × PIKA (the operator\'s case):');
const hp = rows.filter(r => r.share > t2 && r.sign === 'pika');
console.log(`  n=${hp.length}  pin>placebo ${pct(rate(hp, r => r.pinBeatsPlacebo))}  atKing ${pct(mean(hp, r => r.atK))}  atPlacebo ${pct(mean(hp, r => r.atP))}`);
