// smoke-plan-real.mjs — ONE real Anthropic call to verify model ID + forced-tool +
// thinking mechanics. Uses cached MU metrics from the 8/14 scan (no Skylit needed).
// Run with ANTHROPIC_API_KEY in env.
import { planTicker, anthropicLLM } from '../stage2-plan.mjs';
import { loadConfig, readJson, resolveFromRoot } from '../lib/util.mjs';

const config = loadConfig();
const scan = readJson(resolveFromRoot('data/scans/2026-08-14_scan.json'));
const mu = scan.ranked.find((m) => m.ticker === 'MU');
if (!mu) { console.log('no MU in scan'); process.exit(1); }

console.log(`planning MU (score ${mu.flow_through_score.toFixed(4)}, magnet ${mu.magnet.strike}) w/ ${config.planner.model}, thinking=${config.planner.thinking_budget}…`);
const r = await planTicker(mu, { config, targetExpiry: '2026-08-21', runDate: '2026-08-14', llm: anthropicLLM });
console.log(`\nstatus=${r.status} attempts=${r.attempts}`);
if (r.status === 'ok') {
  console.log(JSON.stringify(r.plan, null, 1));
  console.log('deterministic:', JSON.stringify(r.deterministic));
} else {
  console.log('errors:', r.errors);
  console.log('rejected plan:', JSON.stringify(r.rejected_plan, null, 1));
}
