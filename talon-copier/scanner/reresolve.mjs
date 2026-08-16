#!/usr/bin/env node
// reresolve.mjs — re-score a saved <week>_score.json over a DIFFERENT window WITHOUT
// re-running the LLM. Reuses the saved our_direction / our_levels / talon_levels; only
// re-pulls OHLC and re-resolves. Lets us test the 0-5 day primary window vs the 4-week
// swing window cheaply.
//   node reresolve.mjs <score.json> <resolve_from> <resolve_to>
import { loadEnvKeysFrom, resolveFromRoot, readJson, log } from './lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { resolveOteSetup, aggregate, renderScoreReport } = await import('./lib/watchlist-score.mjs');
const { FlowProvider } = await import('./providers/flow-uw.mjs');

const [file, from, to] = process.argv.slice(2);
if (!file || !from || !to) { console.log('usage: node reresolve.mjs <score.json> <from> <to>'); process.exit(1); }
const norm = (d) => (d === 'bullish' || d === 'long' ? 'long' : d === 'bearish' || d === 'short' ? 'short' : d);
const saved = readJson(resolveFromRoot(file)) || readJson(file);
if (!saved) { console.log(`could not read ${file}`); process.exit(1); }
const flow = new FlowProvider();

const rows = [];
for (const r of saved.rows) {
  const ohlc = await flow.getDailyOHLC(r.ticker, { limit: 90 }).catch(() => []);
  const talon = resolveOteSetup({ direction: r.talon_direction, ...r.talon_levels, current: r.talon_current ?? null }, ohlc, { from, to });
  const dir = norm(r.our_direction);
  let ours;
  if (dir === 'long' || dir === 'short') ours = resolveOteSetup({ direction: dir, ote: r.our_levels?.ote, invalidation: r.our_levels?.invalidation, first_target: r.our_levels?.first_target, current: r.our_current ?? null }, ohlc, { from, to });
  else ours = { direction: dir, entered: false, outcome: 'stand_aside', R: 0, R_stop: 0 };
  rows.push({ ...r, talon, ours });
  log(`  ${r.ticker.padEnd(6)} talon ${talon.outcome}(${(talon.R ?? 0).toFixed(1)}R) · ours ${r.our_direction} ${ours.outcome}(${(ours.R ?? 0).toFixed(1)}R)`);
}
const result = {
  week: saved.week, entry_date: saved.entry_date, resolve_from: from, resolve_to: to,
  talon_baseline: aggregate(rows.map((r) => r.talon)),
  our_result: aggregate(rows.map((r) => r.ours).filter((x) => x && x.outcome !== 'error')),
  agreement: { direction_match: rows.filter((r) => r.agree_dir).length, of: rows.filter((r) => r.agree_dir != null).length },
  rows,
};
// per-name totals (all setups, stand-aside = 0R) — "if you followed the whole watchlist"
const tT = rows.reduce((s, r) => s + (r.talon.R || 0), 0);
const oT = rows.reduce((s, r) => s + (r.ours.R || 0), 0);
const tTs = rows.reduce((s, r) => s + (r.talon.R_stop ?? r.talon.R ?? 0), 0);
const oTs = rows.reduce((s, r) => s + (r.ours.R_stop ?? r.ours.R ?? 0), 0);
log(`\n${renderScoreReport(result)}`);
log(`\nPer-name total across all ${rows.length} names (stand-aside = 0R):`);
log(`  close-basis (Talon's acceptance rule):  Talon ${tT.toFixed(1)}R · Ours ${oT.toFixed(1)}R`);
log(`  hard-stop-at-floor (caps loss at -1R):  Talon ${tTs.toFixed(1)}R · Ours ${oTs.toFixed(1)}R`);
