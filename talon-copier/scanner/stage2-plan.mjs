// stage2-plan.mjs — LLM trade planner (GexClaw pattern).
// The model receives ONLY the pre-computed Stage 1 snapshot for ONE ticker (never
// raw chains, never other tickers), reasons, and MUST return its answer as a single
// forced tool call `emit_trade_plan` against a strict schema — no free text is used.
// Every number except the strike choice is validated in code AFTER the call; the LLM
// never sees the validation. Deterministic knobs (size, invalidation basis) are NOT
// in the schema — code applies them.
import { tradingDaysBetween, isMonthlyOpex } from './lib/time.mjs';

export const EMIT_TRADE_PLAN_TOOL = {
  name: 'emit_trade_plan',
  description: 'Emit the single trade plan for this ticker. This is the ONLY way to answer. All price levels must come from the provided node map; do not invent levels.',
  input_schema: {
    type: 'object',
    properties: {
      ticker: { type: 'string' },
      direction: { type: 'string', enum: ['long', 'short', 'no_trade'] },
      thesis: { type: 'string', description: '<=3 sentences: why this flows to the magnet (or why no trade).' },
      entry_trigger: { type: ['number', 'null'], description: 'Price that confirms entry. null iff no_trade.' },
      invalidation: { type: ['number', 'null'], description: 'Level that kills the thesis (applied on a CLOSING basis in code). null iff no_trade.' },
      target: { type: ['number', 'null'], description: 'Primary target — MUST be within 1% of a node strike from the map. null iff no_trade.' },
      runner_target: { type: ['number', 'null'], description: 'Optional stretch target at a further node, or null.' },
      time_stop: { type: ['integer', 'null'], description: 'Exit after N trading days if unresolved. <= contract DTE. null iff no_trade.' },
      contract: {
        type: ['object', 'null'],
        properties: {
          type: { type: 'string', enum: ['call', 'put'] },
          expiry: { type: 'string', description: 'YYYY-MM-DD. Echo the target expiry when one is provided.' },
          strike: { type: 'number' },
          selection_note: { type: 'string' },
        },
        required: ['type', 'expiry', 'strike'],
      },
      confidence: { type: 'integer', minimum: 1, maximum: 5 },
      structural_risks: { type: 'array', items: { type: 'string' } },
    },
    required: ['ticker', 'direction', 'thesis', 'entry_trigger', 'invalidation', 'target', 'runner_target', 'time_stop', 'contract', 'confidence', 'structural_risks'],
  },
};

const SYSTEM = `You are a GEX/VEX structural options planner. You read ONE ticker's dealer-gamma node map (from Skylit) and emit a single trade plan.

Doctrine:
- Price flows toward large gamma nodes ("magnets"/walls) and pins there. A clean long setup: spot sits in a low-gamma pocket with a dominant positive-gamma wall (the magnet) above it and little positive gamma in between (low path resistance). Negative net gamma on the path is FUEL (easier flow-through).
- Persistence matters: a magnet that has been a top node for several sessions is "primed" and more trustworthy than one that appeared today.
- A wall on the path that rivals the magnet can stall price — respect it.
- The target MUST be an actual node strike from the map (within 1%). The invalidation is applied on a CLOSING basis. For a long: invalidation < entry_trigger < target and the contract is a call. For a short: target < entry_trigger < invalidation and the contract is a put.
- If the structure is not clean (no real magnet, heavy path resistance, magnet gamma mostly dies before your expiry), choose direction "no_trade" and null every level.

CRITICAL field rules:
- For a "long" or "short" plan, ALL of entry_trigger, invalidation, target, time_stop, and contract are REQUIRED and must be concrete values — NEVER null. entry_trigger is the concrete price that confirms entry (e.g. a reclaim/breakout level at or just beyond spot); it is always a number, never null.
- null is used ONLY when direction is "no_trade" — then null entry_trigger, invalidation, target, runner_target, time_stop, AND contract.
- runner_target may be null in any case (it is the only optional level).

You MUST answer by calling emit_trade_plan exactly once. Do not write any prose outside the tool call.`;

// Build the ONE-ticker snapshot handed to the model. No raw chains; no other tickers.
export function buildPlannerInput(m, { targetExpiry = null, runDate, config }) {
  const dte = targetExpiry ? tradingDaysBetween(runDate, targetExpiry) : null;
  const snapshot = {
    ticker: m.ticker,
    scan_date: runDate,
    spot: round(m.spot),
    flow_through_score: round(m.flow_through_score, 5),
    magnet: {
      strike: m.magnet.strike,
      signed_gex_millions: round(m.magnet.gex / 1e6, 2),
      sign: m.magnet.sign,
      pct_above_spot: round(m.magnet.dist_pct * 100, 2),
      magnet_norm: round(m.magnet.magnet_norm, 3),
      expiry_concentration: round(m.magnet.expiry_concentration, 2),
      respecified_from: m.magnet.respecified_from,
    },
    node_map: (m.nodes || []).map((n) => ({
      strike: n.strike, signed_gex_millions: round(n.gex / 1e6, 2), gamma: n.gamma_sign,
      position: n.position, pct_from_spot: round(n.dist_pct * 100, 2), expiry_concentration: round(n.expiry_concentration, 2),
    })),
    path_to_magnet: {
      path_resistance_norm: round(m.path.path_resistance_norm, 4),
      net_path_gamma_millions: round(m.path.net_path_gamma / 1e6, 2),
      net_path_gamma_is_negative_fuel: m.path.net_path_gamma < 0,
      biggest_wall_on_path_strike: m.path.max_wall_strike,
      wall_penalty: round(m.path.wall_penalty, 2),
      n_strikes_between: m.path.n_path_strikes,
    },
    proximity_weight: round(m.proximity_weight, 3),
    persistence: {
      consecutive_sessions_as_top_node: m.persistence?.days ?? 0,
      multiplier: round(m.persistence?.mult ?? 1, 2),
      day_by_day: (m.persistence?.byDate || []).map((d) => `${d.date}:${d.hit ? 'node' : '-'}`),
    },
    target_expiry: targetExpiry,
    target_expiry_dte_trading_days: dte,
    target_is_monthly_opex: targetExpiry ? isMonthlyOpex(targetExpiry) : null,
    pct_magnet_gamma_dying_before_target_expiry: m.magnet_gamma_before_target_pct == null ? null : round(m.magnet_gamma_before_target_pct * 100, 0),
    iv_rank: m.iv_rank ?? null,
  };
  const opexNote = snapshot.target_is_monthly_opex
    ? '\nThis target expiry is monthly OPEX (3rd Friday): expect charm/vanna-driven pinning into the print and a large gamma unwind at expiry — weight the pin thesis accordingly.'
    : '';
  const expiryNote = targetExpiry
    ? `\nThe contract expiry is FIXED to ${targetExpiry} — echo it exactly. ${snapshot.pct_magnet_gamma_dying_before_target_expiry}% of the magnet's gamma dies before that expiry.`
    : '\nNo target expiry is fixed — choose an expiry that gives the thesis time to resolve (DTE >= expected resolution + buffer) using the node map.';
  const user = `Ticker snapshot (Skylit dealer-gamma structure, one ticker only):\n\n${JSON.stringify(snapshot, null, 1)}\n${expiryNote}${opexNote}\n\nEmit the plan.`;
  return { system: SYSTEM, user, snapshot };
}

function round(x, d = 2) { if (x == null || !Number.isFinite(x)) return x; const f = 10 ** d; return Math.round(x * f) / f; }

// Validate the plan against the real node map + cross-field rules. Returns {ok, errors}.
export function validatePlan(plan, ctx) {
  const errors = [];
  const { nodeStrikes, targetExpiry, runDate, targetWithinPct } = ctx;
  if (!plan || typeof plan !== 'object') return { ok: false, errors: ['not an object'] };
  if (!['long', 'short', 'no_trade'].includes(plan.direction)) errors.push(`bad direction: ${plan.direction}`);
  if (!plan.thesis || !String(plan.thesis).trim()) errors.push('empty thesis');
  if (!(Number.isInteger(plan.confidence) && plan.confidence >= 1 && plan.confidence <= 5)) errors.push(`confidence not 1-5: ${plan.confidence}`);
  if (!Array.isArray(plan.structural_risks)) errors.push('structural_risks not array');

  if (plan.direction === 'no_trade') {
    for (const f of ['entry_trigger', 'invalidation', 'target', 'runner_target', 'time_stop', 'contract']) {
      if (plan[f] != null) errors.push(`no_trade requires ${f}=null`);
    }
    return { ok: errors.length === 0, errors };
  }

  const nums = ['entry_trigger', 'invalidation', 'target'];
  for (const f of nums) if (!Number.isFinite(plan[f])) errors.push(`${f} not a finite number`);
  if (Number.isFinite(plan.target)) {
    const near = nodeStrikes.some((k) => Math.abs(plan.target - k) / k <= targetWithinPct);
    if (!near) errors.push(`target ${plan.target} not within ${targetWithinPct * 100}% of any node strike`);
  }
  if (nums.every((f) => Number.isFinite(plan[f]))) {
    if (plan.direction === 'long') {
      if (!(plan.invalidation < plan.entry_trigger)) errors.push('long: invalidation must be below entry_trigger');
      if (!(plan.target > plan.entry_trigger)) errors.push('long: target must be above entry_trigger');
    } else {
      if (!(plan.invalidation > plan.entry_trigger)) errors.push('short: invalidation must be above entry_trigger');
      if (!(plan.target < plan.entry_trigger)) errors.push('short: target must be below entry_trigger');
    }
  }
  const c = plan.contract;
  if (!c || typeof c !== 'object') errors.push('contract missing');
  else {
    if (!['call', 'put'].includes(c.type)) errors.push(`contract.type not call/put: ${c.type}`);
    if (plan.direction === 'long' && c.type !== 'call') errors.push('long must use a call');
    if (plan.direction === 'short' && c.type !== 'put') errors.push('short must use a put');
    if (!Number.isFinite(c.strike)) errors.push('contract.strike not finite');
    if (!c.expiry || !/^\d{4}-\d{2}-\d{2}$/.test(c.expiry)) errors.push(`contract.expiry not YYYY-MM-DD: ${c.expiry}`);
    else {
      if (targetExpiry && c.expiry !== targetExpiry) errors.push(`contract.expiry ${c.expiry} != target ${targetExpiry}`);
      if (c.expiry <= runDate) errors.push('contract.expiry not in the future');
    }
  }
  const dte = (c && c.expiry) ? tradingDaysBetween(runDate, c.expiry) : null;
  if (!(Number.isInteger(plan.time_stop) && plan.time_stop >= 1)) errors.push(`time_stop not a positive integer: ${plan.time_stop}`);
  else if (dte != null && plan.time_stop > dte) errors.push(`time_stop ${plan.time_stop} > contract DTE ${dte}`);
  if (plan.runner_target != null && !Number.isFinite(plan.runner_target)) errors.push('runner_target must be number or null');

  return { ok: errors.length === 0, errors };
}

function extractToolUse(resp) {
  const blocks = (resp && resp.content) || [];
  const tu = blocks.find((b) => b.type === 'tool_use' && b.name === 'emit_trade_plan');
  return tu ? tu.input : null;
}

// Defensive repair for a known model serialization glitch where tool-call parameters
// leak into a preceding string field as `</field><parameter name="X">Y` fragments
// (the value is present, just misplaced). Re-extract any leaked params into their
// proper (currently null/undefined) fields and strip the stray tags from the string.
export function repairLeakedToolParams(plan) {
  if (!plan || typeof plan !== 'object') return plan;
  const coerce = (v) => { const t = String(v).trim(); if (/^-?\d+(\.\d+)?$/.test(t)) return +t; if (t === 'null') return null; if (t === 'true' || t === 'false') return t === 'true'; return t; };
  for (const [k, val] of Object.entries(plan)) {
    if (typeof val !== 'string' || !/<parameter name=|<\/[a-z_]+>/i.test(val)) continue;
    const re = /<parameter name="([a-z_]+)">([^<]*)/gi;
    let mm;
    while ((mm = re.exec(val))) { const key = mm[1]; if (plan[key] == null) plan[key] = coerce(mm[2]); }
    plan[k] = val.replace(/\s*<\/?[a-z_]+>[\s\S]*$/i, '').replace(/\s*<parameter name=[\s\S]*$/i, '').trim();
  }
  return plan;
}

// Plan one ticker: soft-forced tool (thinking on) or hard-forced (thinking off), then
// validate; on failure, ONE retry with the errors appended; discard on a second failure.
export async function planTicker(m, { config, targetExpiry = null, runDate, llm }) {
  // When no global --expiry is set, target this ticker's king-driven weekly expiry.
  const effExpiry = targetExpiry || m.effective_target_expiry || m.suggested_weekly_expiry || null;
  const { system, user, snapshot } = buildPlannerInput(m, { targetExpiry: effExpiry, runDate, config });
  const nodeStrikes = [...new Set([m.magnet.strike, ...(m.nodes || []).map((n) => n.strike)])];
  const ctx = { nodeStrikes, targetExpiry: effExpiry, runDate, targetWithinPct: config.planner.target_within_node_pct };
  const useThinking = (config.planner.thinking_budget || 0) > 0;

  let attempts = 0, lastErrors = null, rawPlan = null;
  const maxAttempts = 1 + (config.planner.retries ?? 1);

  while (attempts < maxAttempts) {
    attempts++;
    // Each attempt is a fresh, stateless single-turn call. On retry we append the
    // concrete validator errors to the prompt rather than simulating a tool_use/
    // tool_result cycle — forcing the tool AFTER a tool_result makes the model emit
    // a degenerate empty tool call. The LLM never sees the validator after success.
    const content = attempts === 1
      ? user
      : `${user}\n\nYour previous emit_trade_plan call was REJECTED by the validator:\n- ${lastErrors.join('\n- ')}\nEmit a corrected emit_trade_plan call that fixes ALL of these. Use only node strikes from the map for the target.`;
    const req = {
      model: config.planner.model, max_tokens: config.planner.max_tokens, system,
      messages: [{ role: 'user', content }], tools: [EMIT_TRADE_PLAN_TOOL],
      tool_choice: useThinking ? { type: 'auto' } : { type: 'tool', name: 'emit_trade_plan' },
    };
    if (useThinking) req.thinking = { type: 'enabled', budget_tokens: config.planner.thinking_budget };
    let resp;
    try { resp = await llm(req); }
    catch (e) { lastErrors = [`llm error: ${String(e.message || e).slice(0, 120)}`]; break; }

    const plan = repairLeakedToolParams(extractToolUse(resp));
    if (!plan || Object.keys(plan).length === 0) { lastErrors = ['empty or missing emit_trade_plan tool call']; continue; }
    rawPlan = plan;
    const v = validatePlan(plan, ctx);
    if (v.ok) {
      const budget = config.sizing_budget_usd[String(plan.confidence)] ?? null;
      return {
        ticker: m.ticker, status: 'ok', attempts, plan,
        deterministic: { invalidation_basis: config.invalidation_basis, sizing_budget_usd: budget },
        flow_through_score: m.flow_through_score, snapshot,
      };
    }
    lastErrors = v.errors;
  }
  return { ticker: m.ticker, status: 'discarded', attempts, errors: lastErrors, rejected_plan: rawPlan, flow_through_score: m.flow_through_score, snapshot };
}

// Plan the whole ranked shortlist, with a >50%-schema-failure circuit breaker.
export async function planAll(ranked, { config, targetExpiry = null, runDate, llm }) {
  const cards = [];
  let ok = 0, discarded = 0, no_trade = 0, processed = 0, circuitBroken = false;
  const maxCalls = config.planner.max_calls_per_run || ranked.length;
  const breakerPct = config.planner.circuit_breaker_fail_pct ?? 0.5;

  for (const m of ranked.slice(0, maxCalls)) {
    const r = await planTicker(m, { config, targetExpiry, runDate, llm });
    processed++;
    if (r.status === 'ok') { ok++; if (r.plan.direction === 'no_trade') no_trade++; }
    else discarded++;
    cards.push(r);
    if (processed >= 4 && discarded / processed > breakerPct) {
      circuitBroken = true;
      break;
    }
  }
  return { cards, stats: { processed, ok, discarded, no_trade }, circuitBroken, breaker_threshold: breakerPct };
}

// Real Anthropic client (final answer is a forced/near-forced tool call).
export async function anthropicLLM(req) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY missing');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(req), signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`anthropic ${r.status} ${t.slice(0, 200)}`); }
  return r.json();
}
