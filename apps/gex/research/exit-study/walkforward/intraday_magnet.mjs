// Intraday Skylit-King magnet test (research only, READ-ONLY archive, no logic change).
// The daily frame can't see an intraday pin. This tests the REAL claim: within a
// session, does spot gravitate to the Skylit King computed at the open — MORE than
// to a mirror-strike placebo the same distance on the other side? That controls for
// "a random walk gets closer to something." 5-min intraday archive.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(HERE, '..', '..', '..', 'data', 'skylit-archive', 'intraday');
const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const TICKERS = (process.argv[2] || 'SPXW,SPY,QQQ').split(',');

function frames(day, t) {
  const p = path.join(ARCHIVE, day, `${t}.jsonl.gz`); if (!fs.existsSync(p)) return [];
  return zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).map(s => ({ spot: s.spot, strikes: s.strikes || [] })).filter(s => s.spot != null);
}
const kingOf = fr => { let k = null; for (const q of fr.strikes) { const g = Math.abs(+q.gamma || 0); if (!k || g > k.g) k = { strike: +q.strike, g }; } return k?.strike ?? null; };

let touchK = 0, touchP = 0, closerK = 0, n = 0, approachK = 0;
const per = {};
for (const t of TICKERS) { per[t] = { n: 0, closerK: 0, touchK: 0, touchP: 0 }; }
for (const day of days) {
  for (const t of TICKERS) {
    const fr = frames(day, t); if (fr.length < 5) continue;
    const open = fr[0].spot, king = kingOf(fr[0]); if (king == null) continue;
    const startDist = Math.abs(open - king);
    if (startDist / open < 0.002) continue;              // King already at spot -> skip
    const placebo = 2 * open - king;                     // mirror strike, same distance, other side
    let minK = Infinity, minP = Infinity;
    for (const f of fr) { minK = Math.min(minK, Math.abs(f.spot - king)); minP = Math.min(minP, Math.abs(f.spot - placebo)); }
    const tK = minK / open < 0.0015, tP = minP / open < 0.0015;  // "touched" within 0.15%
    const ck = minK < minP;                               // got closer to King than placebo
    n++; if (tK) touchK++; if (tP) touchP++; if (ck) closerK++; if (minK < startDist * 0.5) approachK++;
    per[t].n++; if (ck) per[t].closerK++; if (tK) per[t].touchK++; if (tP) per[t].touchP++;
  }
}
const pct = x => `${(x * 100).toFixed(0)}%`;
console.log(`INTRADAY SKYLIT-KING MAGNET — ${days.length} days, ${TICKERS.join('/')}, n=${n} sessions (King not-at-open)\n`);
console.log(`price got CLOSER to King than to mirror-placebo: ${pct(closerK / n)}  (magnet if >50%)`);
console.log(`price TOUCHED King (<=0.15%):    ${pct(touchK / n)}`);
console.log(`price TOUCHED placebo (<=0.15%): ${pct(touchP / n)}   (King-touch>placebo-touch = pull)`);
console.log(`price halved its distance to King: ${pct(approachK / n)}\n`);
console.log('by ticker (closer-to-King-than-placebo / touch-King / touch-placebo):');
for (const t of TICKERS) { const p = per[t]; if (p.n) console.log(`  ${t.padEnd(5)} n=${String(p.n).padStart(3)}  closer ${pct(p.closerK / p.n)}  touchK ${pct(p.touchK / p.n)}  touchP ${pct(p.touchP / p.n)}`); }
