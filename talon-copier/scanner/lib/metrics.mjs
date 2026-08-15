// metrics.mjs — Stage 1 pure math. NO I/O, NO LLM. Every metric is normalized
// WITHIN a ticker so cross-sectional ranking is apples-to-apples. Hand-testable.
//
// Sign convention (Skylit): gexAgg > 0 = long-gamma wall (pins/supports/resists);
// gexAgg < 0 = short-gamma (squeeze fuel). "Magnet" = the dominant positive wall
// above spot that price flows toward. Path = strikes strictly between spot and magnet.
import { tradingDaysBetween, weeksForDistance } from './time.mjs';

// Choose the target WEEKLY expiry from the ticker's REAL expirations by where the
// KING's gamma actually lives in the expiry term structure. Score each real expiry
// = |magnet gamma at that expiry| × time-decay(DTE), within a weekly DTE cap so a far
// monthly-OPEX pile can't drag a near move out there. The gamma term structure self-
// adjusts for distance (far-OTM gamma sits at later expiries; a near wall at nearer
// ones), so we don't fight it with a distance heuristic. Prefer the expiry that holds
// the most of the king's gamma soonest.
export function pickWeeklyExpiry(perExpiry, expirations, runDate, wcfg = {}) {
  if (!expirations || !expirations.length || !runDate) return null;
  const minDte = wcfg.min_dte_days ?? 2;
  const maxDte = wcfg.max_dte_days ?? 25;
  const halflife = wcfg.time_decay_halflife_days ?? 7;
  const withDte = expirations.map((e) => ({ e, dte: tradingDaysBetween(runDate, e) }))
    .filter((x) => x.dte >= minDte && x.dte <= maxDte).sort((a, b) => a.dte - b.dte);
  if (!withDte.length) return null;
  let best = withDte[0].e, bestScore = -1;
  for (const { e, dte } of withDte) {
    const g = Math.abs((perExpiry && perExpiry[e]) || 0);
    const score = g * Math.pow(0.5, dte / halflife);
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return best; // bestScore<=0 (no king gamma in window) → nearest expiry in window
}

export function sumAbsGex(strikes) {
  let t = 0;
  for (const s of strikes) t += Math.abs(s.gexAgg);
  return t;
}

// Median strike-grid spacing near spot (used for persistence ±N-step tolerance).
export function strikeStep(strikes, spot) {
  const near = strikes.filter((s) => Math.abs(s.strike - spot) / spot <= 0.05).map((s) => s.strike).sort((a, b) => a - b);
  const diffs = [];
  for (let i = 1; i < near.length; i++) { const d = near[i] - near[i - 1]; if (d > 0) diffs.push(d); }
  if (!diffs.length) return null;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

// Concentration of a node's gamma in its single largest expiry (1 = one expiry, →0 spread).
export function expiryConcentration(perExpiry) {
  const vals = Object.values(perExpiry || {}).map(Math.abs);
  const tot = vals.reduce((a, b) => a + b, 0);
  if (!tot) return null;
  return Math.max(...vals) / tot;
}

// Top-N strikes by |aggregate GEX|, richly annotated.
export function computeNodes(profile, topN = 5) {
  const { spot, strikes } = profile;
  return [...strikes]
    .sort((a, b) => Math.abs(b.gexAgg) - Math.abs(a.gexAgg))
    .slice(0, topN)
    .map((s) => ({
      strike: s.strike,
      gex: s.gexAgg,
      gamma_sign: s.gexAgg >= 0 ? 'long' : 'short',
      position: s.strike > spot ? 'above' : (s.strike < spot ? 'below' : 'at'),
      dist_pct: (s.strike - spot) / spot,
      expiry_concentration: expiryConcentration(s.perExpiry),
    }));
}

// Dominant positive-gamma wall above spot within the proximity band = the magnet.
// Returns null if there is no positive wall above spot inside the band.
export function detectMagnet(profile, { proximityBand = 0.10 } = {}) {
  const { spot, strikes } = profile;
  const total = sumAbsGex(strikes);
  const cand = strikes.filter((s) => s.strike > spot && (s.strike - spot) / spot <= proximityBand && s.gexAgg > 0);
  if (!cand.length) return null;
  const m = cand.reduce((best, s) => (s.gexAgg > best.gexAgg ? s : best), cand[0]);
  return {
    strike: m.strike,
    gex: m.gexAgg,
    dist_pct: (m.strike - spot) / spot,
    magnet_norm: total ? m.gexAgg / total : 0,
    perExpiry: m.perExpiry,
    expiry_concentration: expiryConcentration(m.perExpiry),
  };
}

// Path resistance / wall / net-gamma between spot (exclusive) and magnet (exclusive).
export function pathMetrics(profile, magnetStrike) {
  const { spot, strikes } = profile;
  const total = sumAbsGex(strikes);
  const lo = Math.min(spot, magnetStrike), hi = Math.max(spot, magnetStrike);
  const onPath = strikes.filter((s) => s.strike > lo && s.strike < hi);
  let posSum = 0, netSum = 0, maxWall = 0, maxWallStrike = null;
  for (const s of onPath) {
    netSum += s.gexAgg;
    if (s.gexAgg > 0) { posSum += s.gexAgg; if (s.gexAgg > maxWall) { maxWall = s.gexAgg; maxWallStrike = s.strike; } }
  }
  return {
    path_resistance_norm: total ? posSum / total : 0,
    net_path_gamma: netSum,
    max_wall_gex: maxWall,
    max_wall_strike: maxWallStrike,
    n_path_strikes: onPath.length,
  };
}

// proximity_weight decays with the magnet's % distance above spot. Half-life in %.
export function proximityWeight(distPct, halfLifePct = 0.04) {
  return Math.pow(0.5, Math.max(0, distPct) / halfLifePct);
}

// persistence_mult: consecutive most-recent sessions in which the magnet strike
// (±tolerance) was a top-N node. MULTIPLIER ONLY (never a gate). history is
// most-recent-first; each entry {date, strikes:[{strike,gexAgg}]}.
export function persistenceMult(history, magnetStrike, step, cfg = {}) {
  const topN = cfg.topN || 5;
  const maxMult = cfg.max_mult ?? 1.5;
  const daysForMax = cfg.days_for_max ?? 5;
  const tol = (step || 0) * (cfg.strike_tolerance_steps ?? 1);
  const byDate = [];
  let days = 0, streakOpen = true;
  for (const h of history || []) {
    const tops = [...h.strikes].sort((a, b) => Math.abs(b.gexAgg) - Math.abs(a.gexAgg)).slice(0, topN).map((s) => s.strike);
    const hit = tops.some((k) => Math.abs(k - magnetStrike) <= tol + 1e-9);
    byDate.push({ date: h.date, hit });
    if (streakOpen) { if (hit) days++; else streakOpen = false; }
  }
  const mult = 1 + (Math.min(days, daysForMax) / daysForMax) * (maxMult - 1);
  return { days, mult, byDate };
}

// Fraction of the magnet's gamma that lives in expiries dying BEFORE the target
// expiry (i.e. pull that evaporates before your contract's expiry). null if no target.
export function magnetGammaBeforeTargetPct(magnetPerExpiry, targetExpiry) {
  if (!targetExpiry || !magnetPerExpiry) return null;
  let before = 0, total = 0;
  for (const [exp, g] of Object.entries(magnetPerExpiry)) {
    const a = Math.abs(g);
    total += a;
    if (exp < targetExpiry) before += a;
  }
  return total ? before / total : 0;
}

// The full flow_through_score from pre-computed parts.
export function flowThroughScore({ magnet_norm, persistence_mult, proximity_weight, neg_gamma_bonus, path_resistance_norm, wall_penalty }) {
  const numer = magnet_norm * persistence_mult * proximity_weight * neg_gamma_bonus;
  const denom = 1 + path_resistance_norm + wall_penalty;
  return numer / denom;
}

// Score one ticker end-to-end. history optional (persistence_mult defaults to 1).
// Returns the full metric object (or a {skip} marker when there is no setup).
export function scoreTicker(profile, config, { history = null, targetExpiry = null, runDate = null } = {}) {
  const scan = config.scan;
  const total = sumAbsGex(profile.strikes);
  const nodes = computeNodes(profile, scan.top_n_nodes);
  let magnet = detectMagnet(profile, { proximityBand: scan.proximity_band_pct });
  if (!magnet) return { ticker: profile.ticker, spot: profile.spot, total_abs_gex: total, nodes, magnet: null, skip: 'no-magnet-above-spot', flow_through_score: 0 };

  let path = pathMetrics(profile, magnet.strike);
  let wall_penalty = magnet.gex > 0 ? path.max_wall_gex / magnet.gex : 0;
  let respecified_from = null;

  // Wall-on-path handling: a near wall that rivals the magnet becomes the realistic target.
  if (wall_penalty > scan.wall_penalty_threshold && path.max_wall_strike) {
    if (scan.wall_penalty_action === 'discard') {
      return { ticker: profile.ticker, spot: profile.spot, total_abs_gex: total, nodes, magnet, skip: `wall-on-path (${(wall_penalty).toFixed(2)}x)`, flow_through_score: 0 };
    }
    // respecify: retarget to the dominant near wall, recompute below it
    respecified_from = magnet.strike;
    const ws = profile.strikes.find((s) => s.strike === path.max_wall_strike);
    magnet = {
      strike: ws.strike, gex: ws.gexAgg, dist_pct: (ws.strike - profile.spot) / profile.spot,
      magnet_norm: total ? ws.gexAgg / total : 0, perExpiry: ws.perExpiry, expiry_concentration: expiryConcentration(ws.perExpiry),
    };
    path = pathMetrics(profile, magnet.strike);
    wall_penalty = magnet.gex > 0 ? path.max_wall_gex / magnet.gex : 0;
  }

  const proximity_weight = proximityWeight(magnet.dist_pct, scan.proximity_weight.half_life_pct);
  const neg_gamma_bonus = path.net_path_gamma < 0 ? scan.neg_gamma_path_bonus : 1.0;
  const step = strikeStep(profile.strikes, profile.spot);
  const pers = history
    ? persistenceMult(history, magnet.strike, step, { ...scan.persistence, topN: scan.top_n_nodes })
    : { days: 0, mult: 1.0, byDate: [] };

  const parts = {
    magnet_norm: magnet.magnet_norm,
    persistence_mult: pers.mult,
    proximity_weight,
    neg_gamma_bonus,
    path_resistance_norm: path.path_resistance_norm,
    wall_penalty,
  };
  const score = flowThroughScore(parts);

  // Weekly target selection, king-driven: how many weekly expiries out the distance
  // needs, and the real expiry where the king wall is biggest.
  const wcfg = config.weekly;
  let suggested_weeks = null, suggested_weekly_expiry = null;
  if (wcfg && wcfg.enabled) {
    suggested_weeks = weeksForDistance(magnet.dist_pct, wcfg.dist_to_weeks);
    suggested_weekly_expiry = pickWeeklyExpiry(magnet.perExpiry, profile.expirations, runDate, wcfg);
  }
  const effective_target_expiry = targetExpiry || suggested_weekly_expiry;

  return {
    ticker: profile.ticker,
    spot: profile.spot,
    total_abs_gex: total,
    strike_step: step,
    nodes,
    magnet: {
      strike: magnet.strike, gex: magnet.gex, dist_pct: magnet.dist_pct, magnet_norm: magnet.magnet_norm,
      sign: magnet.gex >= 0 ? 'long' : 'short', expiry_concentration: magnet.expiry_concentration,
      respecified_from,
    },
    path: {
      path_resistance_norm: path.path_resistance_norm, wall_penalty, max_wall_strike: path.max_wall_strike,
      net_path_gamma: path.net_path_gamma, neg_gamma_bonus, n_path_strikes: path.n_path_strikes,
    },
    proximity_weight,
    persistence: pers,
    suggested_weeks,
    suggested_weekly_expiry,
    effective_target_expiry,
    magnet_gamma_before_target_pct: magnetGammaBeforeTargetPct(magnet.perExpiry, effective_target_expiry),
    score_parts: parts,
    flow_through_score: score,
  };
}
