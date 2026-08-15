// plan.test.mjs — Stage 2 planner with a MOCKED LLM (no network). Covers the full
// contract: valid plan, retry-fixes-violation, persistent-violation-discard,
// no_trade nulls, no-tool-call, circuit breaker, and validatePlan cross-field rules.
import { planTicker, planAll, validatePlan, buildPlannerInput } from '../stage2-plan.mjs';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}`); } }
function eq(name, got, want) { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`  ✗ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } }

const CONFIG = {
  planner: { model: 'mock', max_tokens: 3000, thinking_budget: 0, retries: 1, target_within_node_pct: 0.01, max_calls_per_run: 12, circuit_breaker_fail_pct: 0.5 },
  sizing_budget_usd: { '1': 1000, '2': 1500, '3': 2500, '4': 4000, '5': 6000 },
  invalidation_basis: 'close', scan: {},
};
const RUN = '2026-08-14', EXP = '2026-08-21'; // DTE = 5 trading days (8/17..8/21)

function makeMetrics(over = {}) {
  return {
    ticker: 'MU', spot: 972.94, flow_through_score: 0.0544,
    magnet: { strike: 1000, gex: 2.15e6, dist_pct: 0.0278, magnet_norm: 0.105, sign: 'long', expiry_concentration: 0.4, respecified_from: null },
    nodes: [
      { strike: 1000, gex: 2.15e6, gamma_sign: 'long', position: 'above', dist_pct: 0.0278, expiry_concentration: 0.4 },
      { strike: 955, gex: -2.11e6, gamma_sign: 'short', position: 'below', dist_pct: -0.018, expiry_concentration: 0.5 },
      { strike: 1100, gex: 1.5e6, gamma_sign: 'long', position: 'above', dist_pct: 0.13, expiry_concentration: 0.6 },
      { strike: 965, gex: -1.28e6, gamma_sign: 'short', position: 'below', dist_pct: -0.008, expiry_concentration: 0.5 },
      { strike: 950, gex: -1.15e6, gamma_sign: 'short', position: 'below', dist_pct: -0.024, expiry_concentration: 0.5 },
    ],
    path: { path_resistance_norm: 0.059, wall_penalty: 0.37, max_wall_strike: 990, net_path_gamma: 0.3e6, neg_gamma_bonus: 1, n_path_strikes: 5 },
    proximity_weight: 0.618,
    persistence: { days: 2, mult: 1.2, byDate: [{ date: '2026-08-13', hit: true }, { date: '2026-08-12', hit: true }, { date: '2026-08-11', hit: false }] },
    magnet_gamma_before_target_pct: 0.33, ...over,
  };
}
const mkResp = (plan) => ({ content: [{ type: 'tool_use', name: 'emit_trade_plan', input: plan }] });
const goodPlan = { ticker: 'MU', direction: 'long', thesis: 'Spot in a low-gamma pocket under the primed 1000 wall.', entry_trigger: 975, invalidation: 955, target: 1000, runner_target: 1100, time_stop: 5, contract: { type: 'call', expiry: EXP, strike: 1000, selection_note: 'near-magnet' }, confidence: 4, structural_risks: ['wall at 990'] };
const badTarget = { ...goodPlan, target: 980 }; // 980 is >1% from every node
const noTrade = { ticker: 'MU', direction: 'no_trade', thesis: 'Path resistance too heavy; magnet gamma mostly dies before expiry.', entry_trigger: null, invalidation: null, target: null, runner_target: null, time_stop: null, contract: null, confidence: 2, structural_risks: [] };

// A: valid on first try → ok + deterministic sizing applied
const rA = await planTicker(makeMetrics(), { config: CONFIG, targetExpiry: EXP, runDate: RUN, llm: async () => mkResp(goodPlan) });
eq('A status ok', rA.status, 'ok');
eq('A attempts 1', rA.attempts, 1);
eq('A direction long', rA.plan.direction, 'long');
eq('A sizing budget from confidence 4', rA.deterministic.sizing_budget_usd, 4000);
eq('A invalidation basis = close', rA.deterministic.invalidation_basis, 'close');

// B: bad target first, corrected on retry → ok, attempts 2
const rB = await planTicker(makeMetrics(), { config: CONFIG, targetExpiry: EXP, runDate: RUN, llm: async (req) => mkResp(req.messages.length === 1 ? badTarget : goodPlan) });
eq('B status ok after retry', rB.status, 'ok');
eq('B attempts 2', rB.attempts, 2);

// C: persistent bad target → discarded after retries
const rC = await planTicker(makeMetrics(), { config: CONFIG, targetExpiry: EXP, runDate: RUN, llm: async () => mkResp(badTarget) });
eq('C status discarded', rC.status, 'discarded');
eq('C attempts 2', rC.attempts, 2);
ok('C errors mention target-not-near-node', rC.errors.some((e) => /target .* not within/.test(e)));

// D: no_trade with all nulls → ok
const rD = await planTicker(makeMetrics(), { config: CONFIG, targetExpiry: EXP, runDate: RUN, llm: async () => mkResp(noTrade) });
eq('D no_trade accepted', rD.status, 'ok');
eq('D direction no_trade', rD.plan.direction, 'no_trade');

// E: never calls the tool → discarded
const rE = await planTicker(makeMetrics(), { config: CONFIG, targetExpiry: EXP, runDate: RUN, llm: async () => ({ content: [{ type: 'text', text: 'I think MU looks good but I will not call the tool.' }] }) });
eq('E status discarded (no tool call)', rE.status, 'discarded');
ok('E errors mention missing tool call', rE.errors.some((e) => /no emit_trade_plan/.test(e)));

// F: circuit breaker trips at >50% schema failures over >=4
const ranked = Array.from({ length: 6 }, (_, i) => makeMetrics({ ticker: `T${i}` }));
const rF = await planAll(ranked, { config: CONFIG, targetExpiry: EXP, runDate: RUN, llm: async () => mkResp(badTarget) });
ok('F circuit broken', rF.circuitBroken === true);
eq('F processed exactly 4 before breaking', rF.stats.processed, 4);
eq('F all 4 discarded', rF.stats.discarded, 4);

// ---- validatePlan cross-field unit checks ----
const ctx = { nodeStrikes: [1000, 955, 1100, 965, 950], targetExpiry: EXP, runDate: RUN, targetWithinPct: 0.01 };
ok('valid plan passes', validatePlan(goodPlan, ctx).ok);
ok('expiry-echo mismatch caught', validatePlan({ ...goodPlan, contract: { ...goodPlan.contract, expiry: '2026-08-28' } }, ctx).errors.some((e) => /!= target/.test(e)));
ok('time_stop > DTE caught', validatePlan({ ...goodPlan, time_stop: 6 }, ctx).errors.some((e) => /time_stop 6 > contract DTE 5/.test(e)));
ok('long invalidation on wrong side caught', validatePlan({ ...goodPlan, invalidation: 990 }, ctx).errors.some((e) => /invalidation must be below/.test(e)));
ok('long must use a call', validatePlan({ ...goodPlan, contract: { ...goodPlan.contract, type: 'put' } }, ctx).errors.some((e) => /long must use a call/.test(e)));
ok('no_trade with non-null level caught', validatePlan({ ...noTrade, target: 1000 }, ctx).errors.some((e) => /no_trade requires target=null/.test(e)));
ok('confidence out of range caught', !validatePlan({ ...goodPlan, confidence: 7 }, ctx).ok);

// buildPlannerInput hygiene: one ticker only, includes OPEX + before-target context, no raw chains
const { system, user, snapshot } = buildPlannerInput(makeMetrics(), { targetExpiry: EXP, runDate: RUN, config: CONFIG });
ok('snapshot is single ticker', snapshot.ticker === 'MU' && !/other tickers|universe/i.test(user));
ok('snapshot flags monthly OPEX for 8/21', snapshot.target_is_monthly_opex === true);
ok('snapshot carries before-target %', snapshot.pct_magnet_gamma_dying_before_target_expiry === 33);
ok('snapshot has DTE', snapshot.target_expiry_dte_trading_days === 5);
ok('system enforces forced tool call', /emit_trade_plan exactly once/.test(system));

console.log(`\nplan.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
