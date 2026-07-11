// Walk-forward gut-check on the vanna-flow lead (research only). The 62% trend-day
// lead is in-sample. Split the days into first/second calendar half and check if the
// cumulative-vanna-flow lead survives BOTH halves (the bull->chop transition that
// killed every other edge). Holds both = credible; flips = regime luck.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(HERE, '..', '..', '..', 'data', 'skylit-archive', 'intraday');
const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const TICKERS = ['SPXW', 'SPY', 'QQQ'];
const BAND = 0.025;
function frames(day, t) {
  const p = path.join(ARCHIVE, day, `${t}.jsonl.gz`); if (!fs.existsSync(p)) return [];
  return zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).map(s => ({ ts: Date.parse(s.requestedTs), spot: s.spot, strikes: (s.strikes || []).map(q => ({ k: +q.strike, v: +q.vanna || 0 })).filter(q => Number.isFinite(q.k)) }))
    .filter(s => s.spot != null && Number.isFinite(s.ts)).sort((a, b) => a.ts - b.ts);
}
const idx = fr => { const m = {}; for (const q of fr.strikes) m[q.k] = q; return m; };
const sgn = x => x > 0 ? 1 : x < 0 ? -1 : 0;
function vFlow(a, b, s) { const ia = idx(a), ib = idx(b); let ab = 0, be = 0; for (const k of Object.keys(ib)) { const K = +k; if (Math.abs(K - s) / s > BAND) continue; const dv = ib[k].v - ((ia[k]?.v) || 0); K > s ? ab += dv : be += dv; } return ab - be; }
const rows = [];
for (const day of days) for (const t of TICKERS) {
  const fr = frames(day, t); if (fr.length < 9) continue;
  const midI = Math.floor(fr.length / 2), mid = fr[midI], c = fr.at(-1);
  const lateDir = sgn(c.spot - mid.spot); if (lateDir === 0) continue;
  let pl = 0; for (let i = 1; i < fr.length; i++) pl += Math.abs(fr[i].spot - fr[i - 1].spot);
  rows.push({ day, pred: sgn(vFlow(fr[0], mid, mid.spot)), lateDir, er: pl ? Math.abs(c.spot - fr[0].spot) / pl : 0 });
}
const uniq = [...new Set(rows.map(r => r.day))].sort();
const split = uniq[Math.floor(uniq.length / 2)];
const hit = s => { const u = s.filter(r => r.pred !== 0); return u.length ? u.filter(r => r.pred === r.lateDir).length / u.length * 100 : NaN; };
const medER = [...rows].map(r => r.er).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
console.log(`VANNA-FLOW LEAD — walk-forward gut-check (split ${split})\n`);
console.log('slice'.padEnd(22) + 'n'.padStart(5) + 'lead-hit%'.padStart(11));
const show = (lab, s) => console.log(lab.padEnd(22) + String(s.filter(r => r.pred !== 0).length).padStart(5) + hit(s).toFixed(0).padStart(10) + '%' + (hit(s) >= 55 ? ' ✅' : ''));
show('ALL train', rows.filter(r => r.day < split));
show('ALL test', rows.filter(r => r.day >= split));
show('TREND train', rows.filter(r => r.day < split && r.er >= medER));
show('TREND test', rows.filter(r => r.day >= split && r.er >= medER));
console.log('\nholds BOTH halves (>=55%) = credible lead; flips = regime luck.');
