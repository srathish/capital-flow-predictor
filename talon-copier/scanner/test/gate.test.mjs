// gate.test.mjs — Stage 3 flow gate, deterministic hand-built flow (no network).
import { gateCard, gateAll } from '../stage3-gate.mjs';

let pass = 0, fail = 0;
function eq(name, got, want) { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  ✗ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } }
function ok(name, cond) { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}`); } }

const CFG = {
  flow_gate: { lookback_sessions: 20, confirm_percentile: 0.6, contradict_percentile: 0.6, require_sweep_or_block: false, darkpool_bonus: true, confidence_cap: 5 },
  sizing_budget_usd: { '1': 1000, '2': 1500, '3': 2500, '4': 4000, '5': 6000 },
};
const trail = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
function flowRec(asOfCall, asOfPut, { calls = trail, puts = trail, alerts = [], darkpool = [] } = {}) {
  const series = [];
  for (let i = 0; i < Math.max(calls.length, puts.length); i++) series.push({ date: `2026-07-${String(i + 1).padStart(2, '0')}`, net_call_premium: calls[i] ?? null, net_put_premium: puts[i] ?? null });
  const asOfDay = { date: '2026-08-14', net_call_premium: asOfCall, net_put_premium: asOfPut };
  series.push(asOfDay);
  return { series, asOfDay, alerts, darkpool };
}
const longCard = (confidence = 3, over = {}) => ({ status: 'ok', ticker: 'MU', plan: { direction: 'long', entry_trigger: 978, target: 1000, runner_target: 1100, confidence, contract: { type: 'call' }, ...over } });

// 1. confirmed: today's call premium tops trailing, put premium low
let v = gateCard(longCard(3), flowRec(20, 1), CFG);
eq('confirmed state', v.state, 'confirmed');
ok('confirmed not vetoed', v.vetoed === false);
eq('confirmed confidence unchanged', v.confidence_after, 3);
eq('confirmed sizing $2500', v.sizing_budget_usd, 2500);

// 2. contradicted: today's put premium tops trailing (opposing a long) → hard veto
v = gateCard(longCard(3), flowRec(5, 20), CFG);
eq('contradicted state', v.state, 'contradicted');
ok('contradicted vetoed', v.vetoed === true);
eq('contradicted confidence unchanged (kept+flagged)', v.confidence_after, 3);
ok('contradicted flag', v.flags.includes('flow-contradicts-hard-veto'));

// 3. neutral: nothing meaningful either way → downgrade 1
v = gateCard(longCard(3), flowRec(3, 3), CFG);
eq('neutral state', v.state, 'neutral');
eq('neutral confidence -1', v.confidence_after, 2);
eq('neutral sizing $1500', v.sizing_budget_usd, 1500);

// 4. unvalidated: no flow (backtest / UW down) → no change, flagged
v = gateCard(longCard(3), null, CFG);
eq('unvalidated state', v.state, 'unvalidated');
eq('unvalidated confidence unchanged', v.confidence_after, 3);
ok('unvalidated flag', v.flags.includes('no-flow-data'));

// 5. dark-pool bonus: confirmed + DP print near the 1000 target → +1
v = gateCard(longCard(3), flowRec(20, 1, { darkpool: [{ price: 999.5, size: 100000 }] }), CFG);
eq('DP-bonus state confirmed', v.state, 'confirmed');
eq('DP-bonus confidence +1', v.confidence_after, 4);
ok('DP-bonus flag', v.flags.includes('darkpool-bonus'));

// 6. cap: confidence 5 + DP stays 5
v = gateCard(longCard(5), flowRec(20, 1, { darkpool: [{ price: 1000, size: 1 }] }), CFG);
eq('DP-bonus capped at 5', v.confidence_after, 5);

// 7. no_trade card → n/a, untouched
v = gateCard({ status: 'ok', ticker: 'MU', plan: { direction: 'no_trade', confidence: 2 } }, flowRec(20, 1), CFG);
eq('no_trade state n/a', v.state, 'n/a');
eq('no_trade confidence unchanged', v.confidence_after, 2);

// 8. sweep required: confirming premium but no sweep → neutral; with a sweep → confirmed
const CFG2 = { ...CFG, flow_gate: { ...CFG.flow_gate, require_sweep_or_block: true } };
v = gateCard(longCard(3), flowRec(20, 1), CFG2);
eq('sweep-required, none present → neutral', v.state, 'neutral');
v = gateCard(longCard(3), flowRec(20, 1, { alerts: [{ is_sweep: true, option_type: 'call', strike: 1000 }] }), CFG2);
eq('sweep-required, present → confirmed', v.state, 'confirmed');

// gateAll: appends validation, sets final_confidence, drops nothing
const cards = [longCard(3), longCard(3), { status: 'ok', ticker: 'X', plan: { direction: 'no_trade', confidence: 1 } }];
const flowBy = { MU: flowRec(20, 1) };
const summary = gateAll(cards, flowBy, CFG);
ok('gateAll keeps all cards', cards.length === 3);
ok('gateAll appends validation to every ok card', cards.every((c) => c.validation));
ok('gateAll sets final_confidence', cards[0].final_confidence === 3);
eq('gateAll summary', summary, { confirmed: 2, contradicted: 0, neutral: 0, unvalidated: 0, na: 1 });

console.log(`\ngate.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
