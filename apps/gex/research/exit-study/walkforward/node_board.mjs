// Whole-board reshuffle study (research only). Operator's hypothesis: on a trend day
// the nodes in the trend direction GROW until one BECOMES the King — the King MIGRATES
// and price rides it. Track the full ±BAND window every frame: King migration path,
// per-strike gamma/vanna growth, and — the key question — does node growth LEAD price
// (early growth → later price direction) or just follow it?
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(HERE, '..', '..', '..', 'data', 'skylit-archive', 'intraday');
const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const TICKERS = ['SPXW', 'SPY', 'QQQ'];
const BAND = 0.025;   // ~±10-20 strikes around ATM

function frames(day, t) {
  const p = path.join(ARCHIVE, day, `${t}.jsonl.gz`); if (!fs.existsSync(p)) return [];
  return zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).map(s => ({ ts: Date.parse(s.requestedTs), spot: s.spot, strikes: (s.strikes || []).map(q => ({ k: +q.strike, g: +q.gamma || 0, v: +q.vanna || 0 })).filter(q => Number.isFinite(q.k)) }))
    .filter(s => s.spot != null && Number.isFinite(s.ts)).sort((a, b) => a.ts - b.ts);
}
const kingOf = fr => { let k = null; for (const q of fr.strikes) if (!k || Math.abs(q.g) > Math.abs(k.g)) k = q; return k?.k ?? null; };
const gmap = fr => { const m = {}; for (const q of fr.strikes) if (Math.abs(q.k - fr.spot) / fr.spot <= BAND) m[q.k] = Math.abs(q.g); return m; };
const sgn = x => x > 0 ? 1 : x < 0 ? -1 : 0;

const rows = [];
for (const day of days) for (const t of TICKERS) {
  const fr = frames(day, t); if (fr.length < 9) continue;
  const o = fr[0], mid = fr[Math.floor(fr.length / 2)], c = fr.at(-1);
  const openK = kingOf(o), midK = kingOf(mid), closeK = kingOf(c); if (openK == null) continue;
  // per-strike gamma growth over the FIRST half (open->mid) — the LEAD signal
  const gO = gmap(o), gM = gmap(mid);
  let topGrow = null;
  for (const k of Object.keys(gM)) { const gr = (gM[k] || 0) - (gO[k] || 0); if (!topGrow || gr > topGrow.gr) topGrow = { k: +k, gr }; }
  const priceEarly = sgn(mid.spot - o.spot), priceLate = sgn(c.spot - mid.spot), priceAll = sgn(c.spot - o.spot);
  // efficiency ratio (trend vs chop) full day
  let plen = 0; for (let i = 1; i < fr.length; i++) plen += Math.abs(fr[i].spot - fr[i - 1].spot);
  const er = plen ? Math.abs(c.spot - o.spot) / plen : 0;
  rows.push({ day, t,
    kingMigrated: closeK !== openK, migDir: sgn(closeK - openK), priceAll,
    midKingLeadsLate: sgn(midK - mid.spot) === priceLate && midK !== null,   // mid-King above/below spot predicts late move?
    topGrowSide: topGrow ? sgn(topGrow.k - o.spot) : 0,                        // where the board grew fastest (first half)
    growLeadsLate: topGrow ? sgn(topGrow.k - mid.spot) === priceLate : false,  // does early growth-side predict late price?
    er });
}
const pct = x => `${(x * 100).toFixed(0)}%`;
const rate = (s, f) => s.length ? s.filter(f).length / s.length * 100 : NaN;
console.log(`WHOLE-BOARD RESHUFFLE — ±${(BAND * 100).toFixed(1)}% window, n=${rows.length} sessions\n`);
console.log(`King MIGRATED (close King ≠ open King): ${pct(rate(rows, r => r.kingMigrated) / 100)} of sessions`);
const mig = rows.filter(r => r.kingMigrated);
console.log(`  of those, King migrated IN the day's price direction: ${rate(mig, r => r.migDir === r.priceAll).toFixed(0)}%  (>50% = King follows/leads price)`);
console.log(`\nLEAD TESTS (does the board predict the SECOND half?):`);
console.log(`  mid-session King (above/below spot) predicts late-half price dir: ${rate(rows, r => r.midKingLeadsLate).toFixed(0)}%`);
console.log(`  fastest-GROWING node (1st half) side predicts late-half price dir: ${rate(rows, r => r.growLeadsLate).toFixed(0)}%   (>55% = real lead)`);
// split by trend vs chop
const medER = [...rows].map(r => r.er).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
console.log(`\nby regime (median ER ${medER.toFixed(2)}):`);
for (const [lab, f] of [['TREND day (ER≥med)', r => r.er >= medER], ['CHOP day (ER<med)', r => r.er < medER]]) {
  const s = rows.filter(f);
  console.log(`  ${lab.padEnd(20)} n=${String(s.length).padStart(3)}  King migrated ${rate(s, r => r.kingMigrated).toFixed(0)}%  |  migrated-with-price ${rate(s.filter(r => r.kingMigrated), r => r.migDir === r.priceAll).toFixed(0)}%  |  growth-leads-late ${rate(s, r => r.growLeadsLate).toFixed(0)}%`);
}
