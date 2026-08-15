// conviction-analysis.mjs — does the LLM's own confidence split winning held-trades
// from losing ones? If yes, selectivity (trade only high-conviction) beats trading
// every day. Underlying P&L (cheap, no UW) — options amplify whatever this shows.
import { readJson, resolveFromRoot } from '../lib/util.mjs';

const TICKERS = ['MU', 'NBIS', 'SNDK'];
const TRAIL = 0.06;
const all = [];
for (const T of TICKERS) {
  const fwd = readJson(resolveFromRoot(`data/backtest/forward_${T}_2026-07-01_2026-08-14.json`));
  const ohlc = readJson(resolveFromRoot(`data/backtest/ohlc/${T}.json`))?.ohlc || [];
  if (!fwd || !ohlc.length) continue;
  const byDate = {}; for (const o of ohlc) byDate[o.date] = o;
  let pos = null;
  const open = (dir, row, bar) => { pos = { dir, entry: bar.close, hw: bar.close, lw: bar.close, conf: row.plan.confidence ?? null, setup: row.plan.setup_type || '—' }; };
  const close = (px) => { const pl = pos.dir === 'long' ? (px - pos.entry) / pos.entry : (pos.entry - px) / pos.entry; all.push({ T, dir: pos.dir, conf: pos.conf, setup: pos.setup, pl: pl * 100 }); pos = null; };
  for (const row of fwd.rows) {
    if (row.error) continue; const bar = byDate[row.date];
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
const stat = (g) => `n=${g.length} avgP&L=${(g.reduce((a, b) => a + b.pl, 0) / g.length).toFixed(1)}% win=${(100 * g.filter((t) => t.pl > 0).length / g.length).toFixed(0)}% total=${g.reduce((a, b) => a + b.pl, 0).toFixed(0)}%`;
console.log(`${all.length} held trades · underlying P&L by LLM confidence\n`);
for (const c of [5, 4, 3, 2, 1]) { const g = all.filter((t) => t.conf === c); if (g.length) console.log(`  confidence ${c}: ${stat(g)}`); }
console.log(`\n  HIGH (conf>=4): ${stat(all.filter((t) => t.conf >= 4))}`);
console.log(`  LOW  (conf<=3): ${stat(all.filter((t) => t.conf <= 3))}`);
