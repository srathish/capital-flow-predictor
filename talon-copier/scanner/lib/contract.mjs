// contract.mjs — deterministic option-contract construction from the LLM's setup.
// The LLM won't recommend a far-OTM lotto (negative-EV most days), so when it TAGS a
// squeeze, CODE picks the convex contract — taking the lotto on a detected squeeze is
// a STRATEGY decision, not a per-trade judgment. Config-driven, OFF by default so it
// changes nothing until the risk mode (lotto vs core) is chosen.
import { tradingDaysBetween } from './time.mjs';

// Returns a contract {type, expiry, strike, selection_note}. When disabled or the
// setup isn't a squeeze, returns the LLM's own contract unchanged (the "core" default).
export function buildConvexContract(plan, structure, runDate, cfg = {}) {
  if (!cfg.enabled || !plan || plan.direction === 'no_trade') return plan?.contract ?? null;
  // Only convexify explosive squeezes; grinds/pins keep the LLM's near-money contract.
  if (plan.setup_type !== 'squeeze') return plan.contract;

  const spot = structure.spot;
  const isLong = plan.direction === 'long';
  const type = isLong ? 'call' : 'put';
  const otm = cfg.lotto_otm_pct ?? 0.15;

  // Nearest weekly expiry (>= 2 DTE), preferring one within weekly_max_dte.
  const exps = (structure.expirations || [])
    .map((e) => ({ e, dte: tradingDaysBetween(runDate, e) }))
    .filter((x) => x.dte >= 2).sort((a, b) => a.dte - b.dte);
  if (!exps.length) return plan.contract;
  const nearWeekly = (exps.find((x) => x.dte <= (cfg.weekly_max_dte ?? 10)) || exps[0]).e;

  // Far-OTM strike: the real node strike nearest to spot*(1±otm) on the OTM side.
  const targetStrike = isLong ? spot * (1 + otm) : spot * (1 - otm);
  const nodes = [...(structure.gamma?.nodes || []), ...(structure.vanna?.nodes || [])].map((n) => n.strike);
  const cand = nodes.filter((k) => (isLong ? k >= spot : k <= spot));
  const strike = cand.length
    ? cand.reduce((best, k) => (Math.abs(k - targetStrike) < Math.abs(best - targetStrike) ? k : best), cand[0])
    : Math.round(targetStrike);

  return { type, expiry: nearWeekly, strike, selection_note: `deterministic squeeze convexity (${cfg.squeeze_style || 'lotto'}, ~${(otm * 100).toFixed(0)}% OTM, near weekly)` };
}
