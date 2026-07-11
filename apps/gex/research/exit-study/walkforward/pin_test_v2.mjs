// Doctrine-aligned pin test (research only, READ-ONLY archive, no logic change).
// FIX: the magnet is the PIKA (positive-gamma) node; the BARNEY (negative-gamma)
// node ACCELERATES/repels. My earlier max|gamma| King could grab a barney and
// manufacture a null. Re-test:
//   (a) does price pin to the PIKA King (max +gamma near spot) into the close, vs
//       a mirror placebo?   (b) is price REPELLED from the BARNEY node?
// 5-min Skylit archive, final-30% window, King measured at window start.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(HERE, '..', '..', '..', 'data', 'skylit-archive', 'intraday');
const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const TICKERS = (process.argv[2] || 'SPXW,SPY,QQQ').split(',');
const FINAL = 0.30, NEAR = 0.0015, BAND = 0.02;           // pin within 0.15%; node must be within 2% of spot

function frames(day, t) {
  const p = path.join(ARCHIVE, day, `${t}.jsonl.gz`); if (!fs.existsSync(p)) return [];
  return zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).map(s => ({ ts: Date.parse(s.requestedTs), spot: s.spot, strikes: s.strikes || [] }))
    .filter(s => s.spot != null && Number.isFinite(s.ts)).sort((a, b) => a.ts - b.ts);
}
// dominant POSITIVE-gamma node (pika) and most-NEGATIVE (barney) within BAND of spot
function nodes(fr) {
  let pika = null, barney = null;
  for (const q of fr.strikes) {
    const k = +q.strike, g = +q.gamma || 0; if (!Number.isFinite(k)) continue;
    if (Math.abs(k - fr.spot) / fr.spot > BAND) continue;
    if (g > 0 && (!pika || g > pika.g)) pika = { k, g };
    if (g < 0 && (!barney || g < barney.g)) barney = { k, g };
  }
  return { pika: pika?.k ?? null, barney: barney?.k ?? null };
}

let nP = 0, pinPika = 0, convPika = 0, nB = 0, repelB = 0, per = {};
for (const t of TICKERS) per[t] = { nP: 0, atK: 0, atPl: 0 };
for (const day of days) for (const t of TICKERS) {
  const fr = frames(day, t); if (fr.length < 8) continue;
  const cut = fr[Math.floor(fr.length * (1 - FINAL))].ts;
  const win = fr.filter(f => f.ts >= cut); if (win.length < 3) continue;
  const { pika, barney } = nodes(win[0]); const start = win[0].spot;
  // PIKA pin test
  if (pika != null && Math.abs(start - pika) / start >= NEAR) {
    const placebo = 2 * start - pika;
    const atK = win.filter(f => Math.abs(f.spot - pika) / f.spot < NEAR).length / win.length;
    const atP = win.filter(f => Math.abs(f.spot - placebo) / f.spot < NEAR).length / win.length;
    const conv = Math.abs(win.at(-1).spot - pika) < Math.abs(start - pika);
    nP++; if (atK > atP) pinPika++; if (conv) convPika++;
    per[t].nP++; per[t].atK += atK; per[t].atPl += atP;
  }
  // BARNEY repel test: does price move AWAY from the barney node into the close?
  if (barney != null && Math.abs(start - barney) / start >= NEAR) {
    const away = Math.abs(win.at(-1).spot - barney) > Math.abs(start - barney);
    nB++; if (away) repelB++;
  }
}
const pct = x => `${(x * 100).toFixed(0)}%`;
console.log(`DOCTRINE-ALIGNED PIN — PIKA King (max +gamma within ${pct(BAND)} of spot), final-${pct(FINAL)} window\n`);
console.log(`PIKA pin: price sat at pika-King > mirror-placebo:  ${pct(pinPika / nP)}  (n=${nP}, magnet if >50%)`);
console.log(`PIKA pin: converged toward pika-King into close:    ${pct(convPika / nP)}`);
console.log(`BARNEY repel: price moved AWAY from barney into close: ${pct(repelB / nB)}  (n=${nB}, repel if >50%)`);
console.log('\nby ticker (avg %-window at pika-King vs at placebo):');
for (const t of TICKERS) { const p = per[t]; if (p.nP) console.log(`  ${t.padEnd(5)} n=${String(p.nP).padStart(3)}  atPika ${pct(p.atK / p.nP)}  atPlacebo ${pct(p.atPl / p.nP)}`); }
