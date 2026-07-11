// Into-the-close 0DTE PIN test (research only, READ-ONLY archive, no logic change).
// Operator's refinement: the pin is an END-OF-SESSION phenomenon (gamma concentrates
// into expiration). So measure the King LATE (start of the final window) and ask:
// over the final window, does spot sit pinned near the King MORE than near a
// mirror-strike placebo? And does it converge into the close? 5-min Skylit archive.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(HERE, '..', '..', '..', 'data', 'skylit-archive', 'intraday');
const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const TICKERS = (process.argv[2] || 'SPXW,SPY,QQQ').split(',');
const FINAL = 0.30;                                        // last 30% of the session = the "pin window"
const NEAR = 0.0015;                                       // within 0.15% = "at" a level

function frames(day, t) {
  const p = path.join(ARCHIVE, day, `${t}.jsonl.gz`); if (!fs.existsSync(p)) return [];
  return zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).map(s => ({ ts: Date.parse(s.requestedTs), spot: s.spot, strikes: s.strikes || [] }))
    .filter(s => s.spot != null && Number.isFinite(s.ts)).sort((a, b) => a.ts - b.ts);
}
const kingOf = fr => { let k = null; for (const q of fr.strikes) { const g = Math.abs(+q.gamma || 0); if (!k || g > k.g) k = { strike: +q.strike, g }; } return k?.strike ?? null; };

let n = 0, pinnedK = 0, convergeK = 0, per = {};
for (const t of TICKERS) per[t] = { n: 0, pinK: 0, pinP: 0, conv: 0 };
for (const day of days) for (const t of TICKERS) {
  const fr = frames(day, t); if (fr.length < 8) continue;
  const cut = fr[Math.floor(fr.length * (1 - FINAL))].ts;
  const win = fr.filter(f => f.ts >= cut); if (win.length < 3) continue;
  const king = kingOf(win[0]); if (king == null) continue;
  const start = win[0].spot, startDist = Math.abs(start - king);
  if (startDist / start < NEAR) continue;                 // already pinned at window start -> skip
  const placebo = 2 * start - king;                       // mirror, same distance, other side
  // fraction of final-window frames sitting AT the King vs AT the placebo
  const atK = win.filter(f => Math.abs(f.spot - king) / f.spot < NEAR).length / win.length;
  const atP = win.filter(f => Math.abs(f.spot - placebo) / f.spot < NEAR).length / win.length;
  const closeDist = Math.abs(win.at(-1).spot - king);
  const converged = closeDist < startDist;                // ended nearer the King than window-start
  n++; if (atK > atP) pinnedK++; if (converged) convergeK++;
  per[t].n++; per[t].pinK += atK; per[t].pinP += atP; if (converged) per[t].conv++;
}
const pct = x => `${(x * 100).toFixed(0)}%`;
console.log(`INTO-THE-CLOSE PIN — Skylit King measured at final-${pct(FINAL)} window start, ${days.length} days, n=${n} sessions\n`);
console.log(`sessions where price sat at King MORE than at mirror-placebo: ${pct(pinnedK / n)}  (pin if >50%)`);
console.log(`sessions that CONVERGED toward King into the close:          ${pct(convergeK / n)}  (vs ~50% chance)`);
console.log('\nby ticker (avg %-of-final-window AT-King vs AT-placebo | converged):');
for (const t of TICKERS) { const p = per[t]; if (p.n) console.log(`  ${t.padEnd(5)} n=${String(p.n).padStart(3)}  atKing ${pct(p.pinK / p.n)}  atPlacebo ${pct(p.pinP / p.n)}  converged ${pct(p.conv / p.n)}`); }
