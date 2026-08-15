// metrics.test.mjs — hand-computed asserts for every Stage 1 metric (pure, no network).
import {
  sumAbsGex, computeNodes, detectMagnet, pathMetrics, proximityWeight,
  persistenceMult, magnetGammaBeforeTargetPct, flowThroughScore, scoreTicker, strikeStep,
} from '../lib/metrics.mjs';

let pass = 0, fail = 0;
function approx(name, got, want, tol = 1e-6) {
  if (typeof got === 'number' && Math.abs(got - want) <= tol) { pass++; }
  else { fail++; console.log(`  ✗ ${name}: got ${got}, want ${want}`); }
}
function eq(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; }
  else { fail++; console.log(`  ✗ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

// ---- Fixture 1: canonical setup, spot=100, magnet=110 (+4), neg-gamma path ----
const P = (strikes, spot = 100, ticker = 'TEST') => ({ ticker, spot, strikes });
const f1 = P([
  { strike: 90, gexAgg: -3.0, perExpiry: { '2026-08-21': -3.0 } },
  { strike: 95, gexAgg: -2.0, perExpiry: { '2026-08-21': -2.0 } },
  { strike: 100, gexAgg: 1.0, perExpiry: { '2026-08-21': 1.0 } },
  { strike: 103, gexAgg: 0.5, perExpiry: { '2026-08-21': 0.5 } },
  { strike: 105, gexAgg: -1.0, perExpiry: { '2026-08-21': -1.0 } },
  { strike: 110, gexAgg: 4.0, perExpiry: { '2026-08-21': 3.0, '2026-09-18': 1.0 } },
  { strike: 120, gexAgg: 2.0, perExpiry: { '2026-08-21': 2.0 } },
]);

approx('totalAbsGex', sumAbsGex(f1.strikes), 13.5);
approx('strikeStep (median near-spot spacing)', strikeStep(f1.strikes, 100), 3);

const nodes = computeNodes(f1, 5);
eq('top node strike', nodes[0].strike, 110);
approx('top node gex', nodes[0].gex, 4);
eq('top node position', nodes[0].position, 'above');
approx('top node expiry_concentration (3/4)', nodes[0].expiry_concentration, 0.75);
eq('nodes length', nodes.length, 5);

const mag = detectMagnet(f1, { proximityBand: 0.10 });
eq('magnet strike', mag.strike, 110);
approx('magnet gex', mag.gex, 4);
approx('magnet dist_pct', mag.dist_pct, 0.10);
approx('magnet_norm (4/13.5)', mag.magnet_norm, 4 / 13.5);

const path = pathMetrics(f1, 110);
approx('path_resistance_norm (0.5/13.5)', path.path_resistance_norm, 0.5 / 13.5);
approx('net_path_gamma (0.5-1.0)', path.net_path_gamma, -0.5);
approx('max_wall_gex on path', path.max_wall_gex, 0.5);
eq('max_wall_strike on path', path.max_wall_strike, 103);
eq('n_path_strikes', path.n_path_strikes, 2);

approx('proximity_weight 0.5^(0.10/0.04)=0.5^2.5', proximityWeight(0.10, 0.04), Math.pow(0.5, 2.5));

const hist = [
  { date: 'd-1', strikes: [{ strike: 110, gexAgg: 3.5 }, { strike: 90, gexAgg: -2 }, { strike: 95, gexAgg: -1 }] },
  { date: 'd-2', strikes: [{ strike: 110, gexAgg: 2.0 }, { strike: 88, gexAgg: 1.5 }] },
  { date: 'd-3', strikes: [{ strike: 80, gexAgg: 5 }, { strike: 84, gexAgg: 3 }, { strike: 86, gexAgg: 2 }] },
];
const pers = persistenceMult(hist, 110, 3, { topN: 5, max_mult: 1.5, days_for_max: 5, strike_tolerance_steps: 1 });
eq('persistence days (2 consecutive)', pers.days, 2);
approx('persistence mult (1+2/5*0.5)', pers.mult, 1.2);

approx('before-target pct (3/4 dies before 9/18)', magnetGammaBeforeTargetPct(f1.strikes.find((s) => s.strike === 110).perExpiry, '2026-09-18'), 0.75);
eq('before-target pct null when no target', magnetGammaBeforeTargetPct({ a: 1 }, null), null);

// Full score, hand-derived: (0.2962963*1.2*0.5^2.5*1.2)/(1+0.037037+0.125)
const wantScore = (4 / 13.5 * 1.2 * Math.pow(0.5, 2.5) * 1.2) / (1 + 0.5 / 13.5 + 0.125);
approx('flowThroughScore composed', flowThroughScore({
  magnet_norm: 4 / 13.5, persistence_mult: 1.2, proximity_weight: Math.pow(0.5, 2.5),
  neg_gamma_bonus: 1.2, path_resistance_norm: 0.5 / 13.5, wall_penalty: 0.125,
}), wantScore);

// scoreTicker end-to-end with history + target expiry
const CFG = {
  scan: {
    top_n_nodes: 5, proximity_band_pct: 0.10, wall_penalty_threshold: 0.4, wall_penalty_action: 'respecify',
    neg_gamma_path_bonus: 1.2, persistence: { max_mult: 1.5, days_for_max: 5, strike_tolerance_steps: 1 },
    proximity_weight: { half_life_pct: 0.04 },
  },
};
const st = scoreTicker(f1, CFG, { history: hist, targetExpiry: '2026-09-18' });
eq('scoreTicker magnet strike', st.magnet.strike, 110);
approx('scoreTicker persistence mult', st.persistence.mult, 1.2);
approx('scoreTicker neg_gamma_bonus applied', st.path.neg_gamma_bonus, 1.2);
approx('scoreTicker wall_penalty (0.5/4)', st.path.wall_penalty, 0.125);
approx('scoreTicker before-target pct', st.magnet_gamma_before_target_pct, 0.75);
approx('scoreTicker final score matches hand-derived', st.flow_through_score, wantScore);

// ---- Fixture 2: wall-on-path forces respecify to the nearer dominant wall ----
const f2 = P([
  { strike: 100, gexAgg: 0.2, perExpiry: { '2026-08-21': 0.2 } },
  { strike: 105, gexAgg: 3.0, perExpiry: { '2026-08-21': 3.0 } }, // big wall on path
  { strike: 110, gexAgg: 4.0, perExpiry: { '2026-08-21': 4.0 } }, // original magnet
]);
const st2 = scoreTicker(f2, CFG, {});
eq('respecify: magnet retargeted to near wall 105', st2.magnet.strike, 105);
eq('respecify: records original 110', st2.magnet.respecified_from, 110);
approx('respecify: new wall_penalty 0 (nothing between 100 and 105)', st2.path.wall_penalty, 0);

// ---- Fixture 3: no positive wall above spot → no setup ----
const f3 = P([
  { strike: 95, gexAgg: 2.0, perExpiry: {} },
  { strike: 105, gexAgg: -3.0, perExpiry: {} },
  { strike: 110, gexAgg: -1.0, perExpiry: {} },
]);
const st3 = scoreTicker(f3, CFG, {});
eq('no-magnet skip reason', st3.skip, 'no-magnet-above-spot');
approx('no-magnet score 0', st3.flow_through_score, 0);

// ---- Fixture 4: proximity band excludes a bigger wall just outside 10% ----
const f4 = P([
  { strike: 108, gexAgg: 2.0, perExpiry: {} }, // in band (+8%)
  { strike: 112, gexAgg: 5.0, perExpiry: {} }, // OUT of band (+12%), bigger
]);
const mag4 = detectMagnet(f4, { proximityBand: 0.10 });
eq('band excludes 112, magnet is in-band 108', mag4.strike, 108);

console.log(`\nmetrics.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
