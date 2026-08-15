// stage7-outcomes.mjs — outcome logger. For EVERY card in a plans file (confirmed,
// neutral, or vetoed) we resolve against forward OHLC and append to an append-only
// data/outcomes/{card_id}.json. Answers whether flow_through_score ranks edge and
// whether the UW gate earns its keep. Safe to re-run daily until each card resolves.
import path from 'node:path';
import { resolveCard } from './lib/resolve.mjs';
import { FlowProvider } from './providers/flow-uw.mjs';
import { effectiveScanDate } from './stage0-ingest.mjs';
import { resolveFromRoot, readJson, writeJson, ensureDir, log } from './lib/util.mjs';

export function cardId(runDate, plan) {
  const c = plan.contract || {};
  return `${runDate}_${plan.ticker || 'NA'}_${plan.direction}_${c.strike ?? 'NA'}_${c.expiry ?? 'NA'}`;
}

export async function resolveOutcomes({ config, date, flowProvider = null }) {
  const runDate = effectiveScanDate(date);
  const planFile = resolveFromRoot(path.join(config.planner.plans_dir, `${runDate}_plans.json`));
  const plans = readJson(planFile);
  if (!plans) { log(`[outcomes] no plan file for ${runDate}`); return { runDate, resolved: 0, results: [] }; }
  const flow = flowProvider || new FlowProvider();
  const dir = ensureDir(resolveFromRoot(config.outcomes.dir));
  const results = [];

  for (const card of plans.cards) {
    if (card.status !== 'ok' || !card.plan || card.plan.direction === 'no_trade') continue;
    const plan = { ...card.plan, ticker: card.ticker };
    const id = cardId(runDate, plan);
    let ohlc = [];
    try { ohlc = await flow.getDailyOHLC(card.ticker, { limit: 60 }); } catch { /* leave open */ }
    const res = resolveCard(plan, ohlc, runDate);

    const file = path.join(dir, `${id}.json`);
    const rec = readJson(file) || {
      card_id: id, ticker: card.ticker, runDate, plan: card.plan,
      flow_state: card.validation?.state ?? null, vetoed: !!card.vetoed,
      final_confidence: card.final_confidence, sizing_budget_usd: card.sizing_budget_usd,
      flow_through_score: card.flow_through_score, history: [],
    };
    rec.latest = res;
    rec.history.push({ at: new Date().toISOString(), status: res.status, days_to_resolution: res.days_to_resolution });
    writeJson(file, rec);
    results.push({ card_id: id, ticker: card.ticker, flow_state: rec.flow_state, vetoed: rec.vetoed, status: res.status, hit_target: res.hit_target, mfe_pct: res.mfe_pct, mae_pct: res.mae_pct });
  }

  // Small aggregate: does the flow gate separate winners from losers?
  const resolved = results.filter((r) => ['target', 'invalidation', 'time_stop', 'expiry'].includes(r.status));
  const byState = {};
  for (const st of ['confirmed', 'neutral', 'contradicted', 'unvalidated']) {
    const a = resolved.filter((r) => r.flow_state === st);
    if (a.length) byState[st] = { n: a.length, win_rate: a.filter((r) => r.status === 'target').length / a.length };
  }
  const summary = { runDate, total: results.length, resolved: resolved.length, open: results.length - resolved.length, by_flow_state: byState };
  writeJson(path.join(dir, `_summary_${runDate}.json`), { summary, results });
  log(`[outcomes] ${runDate}: ${results.length} cards · ${resolved.length} resolved · ${results.length - resolved.length} open`);
  return { runDate, ...summary, results };
}
