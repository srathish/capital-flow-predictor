// Cost-aware P&L foundation (research only): is the vanna-imbalance directional edge
// actually PROFITABLE? Start instrument-agnostic on the UNDERLYING (near-zero cost):
// long when net-vanna above>below, short when below>above, hold 1 day. Report
// expectancy, Sharpe, train/test, and the win/loss move symmetry (does it win as big
// as it loses?). Then estimate the options hurdle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const T = process.argv[2] || 'SPY';
const ohlc = load(path.join(CACHE, `${T}_ohlc.json`)) || {};
const days = Object.keys(ohlc).sort();
const BAND = 0.025;
function vannaAB(day, spot) {
  const s = load(path.join(CACHE, `${T}_gex_${day}.json`)); if (!s) return null;
  let ab = 0, be = 0; for (const r of s) { if (Math.abs(r.k - spot) / spot > BAND) continue; (r.k > spot ? ab += r.van : be += r.van); }
  return ab - be;
}
const rows = [];
for (let i = 0; i < days.length - 1; i++) {
  const d = days[i], nd = days[i + 1], s = ohlc[d].close;
  const v = vannaAB(d, s); if (v == null) continue;
  const ret = (ohlc[nd].close - s) / s;                    // next-day underlying return
  const sig = v > 0 ? 1 : v < 0 ? -1 : 0; if (!sig) continue;
  rows.push({ d, pnl: sig * ret, ret, right: (sig > 0) === (ret > 0) });
}
const split = rows[Math.floor(rows.length / 2)].d;
const sum = a => a.reduce((s, x) => s + x, 0);
const mean = a => a.length ? sum(a) / a.length : NaN;
const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const pct = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
function stats(s, lab) {
  const p = s.map(r => r.pnl);
  const sharpe = mean(p) / std(p) * Math.sqrt(252);
  const winMoves = s.filter(r => r.right).map(r => Math.abs(r.ret)), lossMoves = s.filter(r => !r.right).map(r => Math.abs(r.ret));
  console.log(`${lab.padEnd(12)} n=${String(s.length).padStart(4)}  win% ${(s.filter(r => r.right).length / s.length * 100).toFixed(0)}  mean/day ${pct(mean(p))}  ann.Sharpe ${sharpe.toFixed(2)}  totRet ${pct(sum(p))}  avgWin ${pct(mean(winMoves))} avgLoss ${pct(mean(lossMoves))}`);
}
console.log(`VANNA DIRECTIONAL P&L (underlying, 1-day hold) — ${T}, ${rows.length} days ${rows[0].d}..${rows.at(-1).d}\n`);
stats(rows, 'ALL');
stats(rows.filter(r => r.d < split), 'train');
stats(rows.filter(r => r.d >= split), 'test');
// beta benchmark: buy-and-hold
const bh = rows.map(r => r.ret);
console.log(`\nbuy&hold benchmark: mean/day ${pct(mean(bh))}  ann.Sharpe ${(mean(bh) / std(bh) * Math.sqrt(252)).toFixed(2)}  totRet ${pct(sum(bh))}`);
// options hurdle estimate
const avgAbsMove = mean(rows.map(r => Math.abs(r.ret)));
console.log(`\noptions hurdle: avg |next-day move| = ${pct(avgAbsMove)}. A 1-day ATM directional bet must beat ~1 day theta + half-spread.`);
console.log(`  edge/trade (underlying) = ${pct(mean(rows.map(r => r.pnl)))} — the option version keeps this only if leverage×move > costs.`);
