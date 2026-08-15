// regime-analysis.mjs — does the entry Efficiency Ratio (trend vs chop, trailing-only)
// separate winning held-trades from losing ones? Tag every trend-hold trade across
// MU/NBIS/SNDK with its entry-day ER, then tercile. NO threshold tuned to P&L — just
// show the relationship. If high-ER trades win and low-ER lose, the filter is real.
import { readJson, resolveFromRoot } from '../lib/util.mjs';
import { efficiencyRatio } from '../lib/regime.mjs';

const TICKERS = ['MU', 'NBIS', 'SNDK'];
const TRAIL = 0.06, N = 8;
const all = [];

for (const T of TICKERS) {
  const fwd = readJson(resolveFromRoot(`data/backtest/forward_${T}_2026-07-01_2026-08-14.json`));
  const ohlc = readJson(resolveFromRoot(`data/backtest/ohlc/${T}.json`))?.ohlc || [];
  if (!fwd || !ohlc.length) { console.log(`skip ${T}`); continue; }
  const byDate = {}; for (const o of ohlc) byDate[o.date] = o;
  const closesUpTo = (d) => ohlc.filter((o) => o.date <= d).map((o) => o.close);
  let pos = null;
  const open = (dir, row, bar) => { pos = { dir, entry: bar.close, hw: bar.close, lw: bar.close, er: efficiencyRatio(closesUpTo(row.date), N) }; };
  const close = (exitPx) => { const pl = pos.dir === 'long' ? (exitPx - pos.entry) / pos.entry : (pos.entry - exitPx) / pos.entry; all.push({ T, dir: pos.dir, er: pos.er, pl: pl * 100 }); pos = null; };
  for (const row of fwd.rows) {
    if (row.error) continue;
    const bar = byDate[row.date];
    if (pos && bar) {
      if (pos.dir === 'long') pos.hw = Math.max(pos.hw, bar.high); else pos.lw = Math.min(pos.lw, bar.low);
      if (pos.dir === 'long' && bar.close < pos.hw * (1 - TRAIL)) close(bar.close);
      else if (pos.dir === 'short' && bar.close > pos.lw * (1 + TRAIL)) close(bar.close);
      else if (pos && ((pos.dir === 'long' && row.migration === 'down_bearish') || (pos.dir === 'short' && row.migration === 'up_bullish'))) close(bar.close);
    }
    if (!pos && (row.verdict === 'long' || row.verdict === 'short') && row.plan && bar) open(row.verdict, row, bar);
  }
  if (pos) { const last = fwd.rows.filter((r) => byDate[r.date]).slice(-1)[0]; close(byDate[last.date].close); }
}

const withEr = all.filter((t) => t.er != null).sort((a, b) => a.er - b.er);
const n = withEr.length;
const stat = (g) => `n=${g.length} avgER=${(g.reduce((a, b) => a + b.er, 0) / g.length).toFixed(2)} avgP&L=${(g.reduce((a, b) => a + b.pl, 0) / g.length).toFixed(1)}% win=${(100 * g.filter((t) => t.pl > 0).length / g.length).toFixed(0)}% total=${g.reduce((a, b) => a + b.pl, 0).toFixed(0)}%`;
const t1 = withEr.slice(0, Math.floor(n / 3)), t2 = withEr.slice(Math.floor(n / 3), Math.floor(2 * n / 3)), t3 = withEr.slice(Math.floor(2 * n / 3));
console.log(`${n} held trades across ${TICKERS.join('/')} · trailing-${N} Efficiency Ratio at entry\n`);
console.log('By ER tercile (does trending-at-entry predict the trade works?):');
console.log('  LOW ER  (choppiest):', stat(t1));
console.log('  MID ER             :', stat(t2));
console.log('  HIGH ER (trending) :', stat(t3));
const trend = withEr.filter((t) => t.er >= 0.4), chop = withEr.filter((t) => t.er < 0.4);
console.log('\nRound split at ER 0.40:');
console.log('  ER>=0.40 (trend):', stat(trend));
console.log('  ER<0.40  (chop) :', stat(chop));
console.log('\nAll trades (sorted by entry ER):');
for (const t of withEr) console.log(`  ER ${t.er.toFixed(2)}  ${t.T.padEnd(4)} ${t.dir === 'long' ? 'L' : 'S'}  ${t.pl >= 0 ? '+' : ''}${t.pl.toFixed(1)}%`);
