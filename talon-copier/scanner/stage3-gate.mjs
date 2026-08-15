// stage3-gate.mjs — UW flow gate (deterministic). Confirms/contradicts each card
// against the ticker's OWN trailing flow (all thresholds are relative percentiles,
// never absolute $). Three decision states (+ 'unvalidated' when UW flow is absent,
// e.g. a GEX-only backtest). The full validation object is appended to every card;
// the LLM never sees any of this. Nothing is ever dropped — vetoed/neutral cards
// stay, flagged, so the outcome logger can grade whether the gate earns its keep.
import { percentileRank } from './lib/util.mjs';

// In-direction vs opposing net opening ask-side premium for a card's direction.
function directionalPremium(day, direction) {
  const call = day?.net_call_premium ?? null;
  const put = day?.net_put_premium ?? null;
  return direction === 'long' ? { inDir: call, opp: put } : { inDir: put, opp: call };
}

function trailingSeriesValues(series, asOfDay, direction, lookback) {
  const dir = direction === 'long' ? 'net_call_premium' : 'net_put_premium';
  const opp = direction === 'long' ? 'net_put_premium' : 'net_call_premium';
  const prior = series.filter((r) => r !== asOfDay && r.date < (asOfDay?.date ?? '9999')).slice(-lookback);
  return {
    inDir: prior.map((r) => r[dir]).filter((x) => x != null),
    opp: prior.map((r) => r[opp]).filter((x) => x != null),
  };
}

// In-direction sweep/block within the plan's price window (live-only signal).
function sweepBlockInDirection(alerts, plan) {
  if (!alerts || !alerts.length) return { present: false, count: 0 };
  const wantCall = plan.direction === 'long';
  const lo = Math.min(plan.entry_trigger, plan.target) * 0.98;
  const hi = Math.max(plan.target, plan.runner_target ?? plan.target) * 1.05;
  const hits = alerts.filter((a) => (a.is_sweep || a.is_block)
    && ((wantCall && (a.option_type === 'call' || a.is_call)) || (!wantCall && (a.option_type === 'put' || !a.is_call)))
    && (a.strike == null || (a.strike >= lo && a.strike <= hi)));
  return { present: hits.length > 0, count: hits.length };
}

// Dark-pool prints clustered near the trigger or target (upgrade-only bonus, live).
function darkpoolNearPlan(darkpool, plan, band = 0.01) {
  if (!darkpool || !darkpool.length) return { present: false, count: 0 };
  const levels = [plan.entry_trigger, plan.target].filter((x) => Number.isFinite(x));
  const hits = darkpool.filter((d) => d.price != null && levels.some((L) => Math.abs(d.price - L) / L <= band));
  return { present: hits.length > 0, count: hits.length };
}

// Gate a single card. Returns the validation object + adjusted confidence + sizing.
export function gateCard(card, flow, config) {
  const g = config.flow_gate;
  const plan = card.plan;
  const confBefore = plan.confidence;

  // no_trade cards aren't directional — nothing to gate.
  if (plan.direction === 'no_trade') {
    return { state: 'n/a', vetoed: false, confidence_before: confBefore, confidence_after: confBefore, flags: [], checks: {}, sizing_budget_usd: null };
  }
  // No UW flow (backtest / UW down) → honestly unvalidated, no confidence change.
  if (!flow || !flow.asOfDay || !(flow.series && flow.series.length)) {
    return { state: 'unvalidated', vetoed: false, confidence_before: confBefore, confidence_after: confBefore, flags: ['no-flow-data'], checks: {}, sizing_budget_usd: config.sizing_budget_usd[String(confBefore)] ?? null };
  }

  const day = flow.asOfDay;
  const { inDir, opp } = directionalPremium(day, plan.direction);
  const trailing = trailingSeriesValues(flow.series, day, plan.direction, g.lookback_sessions);
  const inDirPct = (inDir != null && trailing.inDir.length) ? percentileRank(trailing.inDir, inDir) : null;
  const oppPct = (opp != null && trailing.opp.length) ? percentileRank(trailing.opp, opp) : null;
  const sweep = sweepBlockInDirection(flow.alerts, plan);
  const dp = darkpoolNearPlan(flow.darkpool, plan);

  const inDirConfirms = inDirPct != null && inDirPct >= g.confirm_percentile && (inDir ?? 0) > 0;
  const oppContradicts = oppPct != null && oppPct >= g.contradict_percentile && (opp ?? 0) > 0;
  const sweepOk = !g.require_sweep_or_block || sweep.present;

  const checks = {
    in_direction_premium: inDir, in_direction_percentile: inDirPct,
    opposing_premium: opp, opposing_percentile: oppPct,
    in_direction_confirms: inDirConfirms, opposing_contradicts: oppContradicts,
    sweep_block_in_direction: sweep, sweep_required_met: sweepOk,
    darkpool_near_plan: dp, trailing_n: trailing.inDir.length,
  };

  let state, vetoed = false, confAfter = confBefore;
  const flags = [];
  if (oppContradicts) {
    state = 'contradicted'; vetoed = true; flags.push('flow-contradicts-hard-veto');
  } else if (inDirConfirms && sweepOk) {
    state = 'confirmed';
    if (g.darkpool_bonus && dp.present) { confAfter = Math.min(g.confidence_cap ?? 5, confBefore + 1); flags.push('darkpool-bonus'); }
  } else {
    state = 'neutral'; confAfter = Math.max(1, confBefore - 1); flags.push('flow-neutral-downgrade');
  }

  return {
    state, vetoed, confidence_before: confBefore, confidence_after: confAfter, flags, checks,
    sizing_budget_usd: config.sizing_budget_usd[String(confAfter)] ?? null,
  };
}

// Gate every card. flowByTicker: { TICKER: flowRecord }. Appends card.validation and
// sets card.final_confidence / card.sizing_budget_usd. Never drops anything.
export function gateAll(cards, flowByTicker, config) {
  let confirmed = 0, contradicted = 0, neutral = 0, unvalidated = 0, na = 0;
  for (const card of cards) {
    if (card.status !== 'ok') continue;
    const flow = flowByTicker[card.ticker] || null;
    const v = gateCard(card, flow, config);
    card.validation = v;
    card.final_confidence = v.confidence_after;
    card.sizing_budget_usd = v.sizing_budget_usd;
    card.vetoed = v.vetoed;
    if (v.state === 'confirmed') confirmed++;
    else if (v.state === 'contradicted') contradicted++;
    else if (v.state === 'neutral') neutral++;
    else if (v.state === 'unvalidated') unvalidated++;
    else na++;
  }
  return { confirmed, contradicted, neutral, unvalidated, na };
}
