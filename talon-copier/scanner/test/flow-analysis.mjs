// flow-analysis.mjs — does the UW flow verdict at entry separate winning held-trades
// from losing ones? Tag every trade with gateCard's state (confirmed/neutral/
// contradicted) using flow AS-OF the entry date, then bucket. INDEPENDENT data (real
// order flow), unlike vanna. If confirmed beats contradicted, flow is a real filter.
import { loadEnvKeysFrom, loadConfig, readJson, resolveFromRoot } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { FlowProvider } = await import('../providers/flow-uw.mjs');
const { gateCard } = await import('../stage3-gate.mjs');

const config = loadConfig();
const flow = new FlowProvider();
const TICKERS = ['MU', 'NBIS', 'SNDK'];
const TRAIL = 0.06;
const all = [];

for (const T of TICKERS) {
  const fwd = readJson(resolveFromRoot(`data/backtest/forward_${T}_2026-07-01_2026-08-14.json`));
  const ohlc = readJson(resolveFromRoot(`data/backtest/ohlc/${T}.json`))?.ohlc || [];
  if (!fwd || !ohlc.length) continue;
  const byDate = {}; for (const o of ohlc) byDate[o.date] = o;
  const series = await flow.getFlowSeries(T, 70);
  const flowAt = (d) => { const s = series.filter((r) => r.date <= d); return { ticker: T, asOfDate: d, asOfDay: s[s.length - 1], series: s, alerts: [], darkpool: [], live: false }; };
  let pos = null;
  const open = (dir, row, bar) => { const st = gateCard({ status: 'ok', ticker: T, plan: row.plan }, flowAt(row.date), config).state; pos = { dir, entry: bar.close, hw: bar.close, lw: bar.close, fs: st }; };
  const close = (px) => { const pl = pos.dir === 'long' ? (px - pos.entry) / pos.entry : (pos.entry - px) / pos.entry; all.push({ T, dir: pos.dir, fs: pos.fs, pl: pl * 100 }); pos = null; };
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
const stat = (g) => `n=${g.length}  avgP&L ${(g.reduce((a, b) => a + b.pl, 0) / g.length).toFixed(1)}%  win ${(100 * g.filter((t) => t.pl > 0).length / g.length).toFixed(0)}%  total ${g.reduce((a, b) => a + b.pl, 0).toFixed(0)}%`;
console.log(`${all.length} held trades · underlying P&L by UW FLOW verdict at entry (independent data)\n`);
for (const s of ['confirmed', 'neutral', 'contradicted', 'unvalidated']) { const g = all.filter((t) => t.fs === s); if (g.length) console.log(`  ${s.padEnd(13)}: ${stat(g)}`); }
const conf = all.filter((t) => t.fs === 'confirmed'), contra = all.filter((t) => t.fs === 'contradicted');
if (conf.length && contra.length) console.log(`\n  → confirmed avg ${(conf.reduce((a, b) => a + b.pl, 0) / conf.length).toFixed(1)}% vs contradicted ${(contra.reduce((a, b) => a + b.pl, 0) / contra.length).toFixed(1)}% — ${conf.reduce((a, b) => a + b.pl, 0) / conf.length > contra.reduce((a, b) => a + b.pl, 0) / contra.length ? 'flow SEPARATES ✓' : 'no separation'}`);
