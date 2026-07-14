// ENGINE HEAD-TO-HEAD — replay the DORMANT doctrine engine (bias→trinity→9-step
// synthesis→execution.planTrade) over the archived 5-min Skylit surfaces, exactly
// as ingest/snapshot-poller.js invokes it. RESEARCH ONLY (Clause 0).
//
// Fidelity notes (replicated from prod, verified by reading the code):
//   - computeSurface() STRIPS vanna from the node objects it emits, and the poller
//     feeds surface.nodes (no vanna) to runPerTickerPatterns. So trapdoor /
//     vanna_persistent / overnight_carryover ALWAYS reject on their vanna checks in
//     prod. We pass surface.nodes verbatim -> same behaviour.
//   - poller calls runPerTickerPatterns WITHOUT previousClose -> overnight dead.
//   - Only lifecycle.js is DB-coupled; we reimplement its state machine in-memory
//     with identical logic (upsert preserves first_seen_ms on conflict).
//   - velocity.js + awareness.js hold module-level state keyed by (ticker,strike,day);
//     we import the REAL modules and clear them per day (equivalent, keys are per-day).
//
// 5-MIN CADENCE CAVEAT (loud): prod polls ~1-min; the archive is 5-min. Step 1
// (checkPriceAction) needs >=5 spot samples in the passed spotHistory. A faithful
// 10-min window yields only 2-3 samples at 5-min cadence -> Step 1 would reject
// ~everything as a pure cadence artifact. We therefore pass the FULL trailing
// intraday spot buffer (adapted mode); Step 1's last-5-sample range then spans
// ~20-25 min instead of 5 min. We ALSO record, per tick, whether a strict 10-min
// window would have had >=5 samples, to quantify the artifact separately.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeSurface } from '../../src/domain/significance.js';
import { deriveStructure } from '../../src/domain/structure.js';
import { recordSample, computeVelocity, clearVelocityState } from '../../src/domain/velocity.js';
import { classifyNode } from '../../src/domain/classification.js';
import { updateAwareness, clearAwarenessState } from '../../src/domain/awareness.js';
import { runPerTickerPatterns } from '../../src/domain/patterns/index.js';
import { computeBiasScore } from '../../src/domain/bias.js';
import { classifyTrinity } from '../../src/domain/trinity.js';
import { evaluateSetup } from '../../src/domain/synthesis.js';
import { thresholds, deflectionZone } from '../../src/utils/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(HERE, '..', '..', 'data', 'skylit-archive', 'intraday');
const TICKERS = ['SPXW', 'SPY', 'QQQ'];
const SPOT_HISTORY_WINDOW_MS = 10 * 60 * 1000;
const MIN_GK = thresholds.node_significance.min_significance_for_gatekeeper;

// ---------------- in-memory lifecycle (faithful reimpl of lifecycle.js) ----------
const COOLDOWN_MS = thresholds.tap_separation.cooldown_minutes * 60 * 1000;
const CONSOLIDATION_MS = thresholds.tap_separation.consolidation_threshold_minutes * 60 * 1000;
const DELIVERED_MULTIPLIER = thresholds.tap_separation.distance_multiplier_of_zone;

function makeLifecycle() {
  const rows = new Map(); // key ticker|strike|day -> row
  const k = (t, s, d) => `${t}|${s}|${d}`;
  function get(t, s, d) { return rows.get(k(t, s, d)); }
  // upsert mirrors db.js: on conflict, first_seen_ms is PRESERVED.
  function upsert(t, s, d, state, tap, firstSeen, lastTapMs, lastTapSpot, inside, insideSince, consol) {
    const key = k(t, s, d);
    const ex = rows.get(key);
    if (!ex) {
      rows.set(key, {
        ticker: t, strike: s, trading_day: d, lifecycle_state: state, tap_count: tap,
        first_seen_ms: firstSeen, last_tap_ms: lastTapMs, last_tap_spot: lastTapSpot,
        inside_zone: inside, inside_since_ms: insideSince, consolidation_logged: consol,
      });
    } else {
      ex.lifecycle_state = state; ex.tap_count = tap; ex.last_tap_ms = lastTapMs;
      ex.last_tap_spot = lastTapSpot; ex.inside_zone = inside;
      ex.inside_since_ms = insideSince; ex.consolidation_logged = consol;
      // first_seen_ms preserved
    }
  }
  function registerTap(t, strike, d, tsMs, spot, prevTap) {
    const newCount = prevTap + 1;
    upsert(t, strike, d, 'Tested', newCount, tsMs, tsMs, spot, 1, tsMs, 0);
  }
  function process({ ticker, spot, nodes, tsMs, tradingDay }) {
    const zone = deflectionZone(ticker);
    for (const node of nodes) {
      if (node.relativeSignificance < MIN_GK) continue;
      const inside = Math.abs(spot - node.strike) <= zone;
      const ex = get(ticker, node.strike, tradingDay);
      if (!ex) {
        upsert(ticker, node.strike, tradingDay, 'Fresh', 0, tsMs, null, null, inside ? 1 : 0, inside ? tsMs : null, 0);
        if (inside) registerTap(ticker, node.strike, tradingDay, tsMs, spot, 0);
        continue;
      }
      const wasInside = ex.inside_zone === 1;
      if (inside && !wasInside) {
        const cooldownElapsed = !ex.last_tap_ms || (tsMs - ex.last_tap_ms) >= COOLDOWN_MS;
        const distantEnough = !ex.last_tap_spot || Math.abs(ex.last_tap_spot - spot) >= DELIVERED_MULTIPLIER * zone;
        const newTap = ex.tap_count === 0 || cooldownElapsed || distantEnough;
        if (newTap) registerTap(ticker, node.strike, tradingDay, tsMs, spot, ex.tap_count);
        else upsert(ticker, node.strike, tradingDay, ex.lifecycle_state, ex.tap_count, ex.first_seen_ms, ex.last_tap_ms, ex.last_tap_spot, 1, tsMs, ex.consolidation_logged);
      } else if (!inside && wasInside) {
        const movedAway = ex.last_tap_spot != null && Math.abs(spot - node.strike) >= DELIVERED_MULTIPLIER * zone;
        const newState = (ex.lifecycle_state === 'Tested' && movedAway) ? 'Delivered' : ex.lifecycle_state;
        upsert(ticker, node.strike, tradingDay, newState, ex.tap_count, ex.first_seen_ms, ex.last_tap_ms, ex.last_tap_spot, 0, null, ex.consolidation_logged);
      } else if (inside && wasInside) {
        const elapsedInside = tsMs - (ex.inside_since_ms || tsMs);
        const shouldLog = elapsedInside >= CONSOLIDATION_MS && ex.consolidation_logged === 0;
        upsert(ticker, node.strike, tradingDay, ex.lifecycle_state, ex.tap_count, ex.first_seen_ms, ex.last_tap_ms, ex.last_tap_spot, 1, ex.inside_since_ms, shouldLog ? 1 : ex.consolidation_logged);
      }
    }
  }
  function listForTickerDay(ticker, day) {
    const out = [];
    for (const r of rows.values()) if (r.ticker === ticker && r.trading_day === day) out.push(r);
    return out;
  }
  function reset() { rows.clear(); }
  return { process, listForTickerDay, reset };
}

// ---------------- funnel accounting ----------------
const funnel = {
  ticksProcessed: 0,
  step1_reject: 0, step2_reject: 0, step3_reject: 0,
  step4_nodir: 0, step4_paradox: 0, step4_quality: 0,
  step5_pass: 0, step6_pass: 0,
  step7_reject: 0, step8_reject: 0, step9_reject: 0,
  wouldEnter: 0,
  step1_strict10min_would_have_ge5: 0, // artifact quantifier
};
const step4Reasons = {};
const step8Reasons = {};
const step9Reasons = {};
const rejectByStep = {}; // stepFailed -> count
const wouldEnters = [];

function bump(obj, key) { obj[key] = (obj[key] || 0) + 1; }

// ---------------- main replay ----------------
const days = readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const perDayFunnel = {};

for (const day of days) {
  clearVelocityState();
  clearAwarenessState();
  const lifecycle = makeLifecycle();
  const latestBiasByTicker = new Map();
  const spotBuf = new Map(); // ticker -> [{tsMs, spot}]
  for (const t of TICKERS) spotBuf.set(t, []);

  // Load + merge all three tickers' snapshots into one chronological stream.
  const events = [];
  for (let ti = 0; ti < TICKERS.length; ti++) {
    const t = TICKERS[ti];
    const f = path.join(ARCHIVE, day, `${t}.jsonl.gz`);
    if (!existsSync(f)) continue;
    const lines = gunzipSync(readFileSync(f)).toString('utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      let rec; try { rec = JSON.parse(line); } catch { continue; }
      if (!rec || !Array.isArray(rec.strikes) || rec.spot == null) continue;
      events.push({ tsMs: rec.fetchedAtMs, tiOrder: ti, ticker: t, rec });
    }
  }
  events.sort((a, b) => (a.tsMs - b.tsMs) || (a.tiOrder - b.tiOrder));

  const dayF = { ticks: 0, wouldEnter: 0 };

  for (const ev of events) {
    const { ticker, rec, tsMs } = ev;
    const snap = { fetchedAtMs: tsMs, spot: rec.spot, expiration: rec.expiration, strikes: rec.strikes };

    // (mirror processSnapshot ordering)
    const surface = computeSurface(snap.strikes, snap.spot);
    const structure = deriveStructure({ nodes: surface.nodes, spot: snap.spot });

    const velocityByStrike = new Map();
    for (const n of surface.nodes) {
      velocityByStrike.set(n.strike, computeVelocity({
        ticker, strike: n.strike, tradingDay: day, tsMs, relativeSignificance: n.relativeSignificance,
      }));
    }
    for (const n of surface.nodes) {
      recordSample({ ticker, strike: n.strike, tradingDay: day, tsMs, relativeSignificance: n.relativeSignificance });
    }

    lifecycle.process({ ticker, spot: snap.spot, nodes: surface.nodes, tsMs, tradingDay: day });
    const lifecycleRows = lifecycle.listForTickerDay(ticker, day);
    const lifecycleByStrike = new Map(lifecycleRows.map(r => [r.strike, r]));

    const classByStrike = new Map();
    for (const n of surface.nodes) {
      if (n.relativeSignificance < MIN_GK) continue;
      classByStrike.set(n.strike, classifyNode({
        node: n, velocity: velocityByStrike.get(n.strike),
        lifecycle: lifecycleByStrike.get(n.strike), spot: snap.spot,
      }));
    }
    for (const node of [structure.floor, structure.ceiling].filter(Boolean)) {
      updateAwareness({ ticker, strike: node.strike, tradingDay: day, tsMs, velocity: velocityByStrike.get(node.strike), structure, spot: snap.spot });
    }

    // spot history buffer (adapted: pass full trailing buffer incl. current)
    const buf = spotBuf.get(ticker);
    buf.push({ tsMs, spot: snap.spot });
    const spotHistory = buf.slice();
    // artifact quantifier: strict prod 10-min window
    const strict10 = buf.filter(s => s.tsMs >= tsMs - SPOT_HISTORY_WINDOW_MS);
    const strict10ge5 = strict10.length >= 5;

    const detections = runPerTickerPatterns({ ticker, nodes: surface.nodes, spot: snap.spot, structure, spotHistory });

    const bias = computeBiasScore({
      ticker, tradingDay: day, spot: snap.spot, regimeScore: surface.regimeScore,
      nodes: surface.nodes, structure, detections, velocityByStrike, classByStrike, lifecycleByStrike,
    });
    latestBiasByTicker.set(ticker, { ...bias, tsMs });
    const trinity = classifyTrinity({ latestBiasByTicker, triggeringTicker: ticker, tsMs });

    const decision = evaluateSetup({
      ticker, spot: snap.spot, tsMs, tradingDay: day, snapshotId: null,
      nodes: surface.nodes, structure, detections, regimeScore: surface.regimeScore,
      bias, trinity, velocityByStrike, classByStrike, lifecycleByStrike,
      spotHistory, chartContext: null,
    });

    funnel.ticksProcessed++; dayF.ticks++;
    if (strict10ge5) funnel.step1_strict10min_would_have_ge5++;

    if (decision.accepted) {
      funnel.wouldEnter++; dayF.wouldEnter++;
      const p = decision.plan;
      wouldEnters.push({
        day, ticker, tsMs, direction: decision.direction, spot: snap.spot,
        biasScore: bias.biasScore, trinity: trinity.classification,
        entryNodeStrike: p.entryNode?.strike, stopStrike: p.stopStrike,
        targetStrike: p.targets?.[0]?.strike, rr: p.rr, sizeMultiplier: p.sizeMultiplier,
        strict10ge5,
      });
    } else {
      bump(rejectByStep, decision.stepFailed);
      const s = decision.stepFailed;
      if (s === 1) funnel.step1_reject++;
      else if (s === 2) funnel.step2_reject++;
      else if (s === 3) funnel.step3_reject++;
      else if (s === 4) {
        if (decision.rejectReason === 'no_directional_bias') funnel.step4_nodir++;
        else if (decision.rejectReason === 'bias_paradox_range') funnel.step4_paradox++;
        else funnel.step4_quality++;
        bump(step4Reasons, decision.rejectReason);
      }
      else if (s === 7) funnel.step7_reject++;
      else if (s === 8) { funnel.step8_reject++; bump(step8Reasons, decision.rejectReason); }
      else if (s === 9) { funnel.step9_reject++; bump(step9Reasons, decision.rejectReason); }
    }
  }
  perDayFunnel[day] = dayF;
}

// survivors reaching each stage (a tick "reaches" step N if it didn't reject before N)
const reach = {};
reach.step1 = funnel.ticksProcessed;
reach.step2 = reach.step1 - funnel.step1_reject;
reach.step3 = reach.step2 - funnel.step2_reject;
reach.step4 = reach.step3 - funnel.step3_reject;
reach.step5 = reach.step4 - funnel.step4_nodir - funnel.step4_paradox - funnel.step4_quality;
reach.step7 = reach.step5; // steps 5,6 are non-gating
reach.step8 = reach.step7 - funnel.step7_reject;
reach.step9 = reach.step8 - funnel.step8_reject;
reach.wouldEnter = reach.step9 - funnel.step9_reject;

const out = {
  meta: { days: days.length, dayList: days, tickers: TICKERS, generatedAt: new Date().toISOString() },
  funnel, reach, rejectByStep, step4Reasons, step8Reasons, step9Reasons,
  perDayFunnel, wouldEnters,
};
writeFileSync(path.join(HERE, 'engine_replay_out.json'), JSON.stringify(out));

// ---- console summary ----
console.log(`\n=== DOCTRINE ENGINE REPLAY — ${days.length} archive days ===`);
console.log(`ticks processed: ${funnel.ticksProcessed}`);
console.log(`\nFUNNEL (survivors reaching each gate -> rejects at that gate):`);
console.log(`  Step1 price_action     reach ${reach.step1}  reject ${funnel.step1_reject}`);
console.log(`  Step2 structural_level reach ${reach.step2}  reject ${funnel.step2_reject}`);
console.log(`  Step3 map(rainbow)     reach ${reach.step3}  reject ${funnel.step3_reject}`);
console.log(`  Step4 node_eval        reach ${reach.step4}  reject ${funnel.step4_nodir + funnel.step4_paradox + funnel.step4_quality} (nodir ${funnel.step4_nodir}, paradox ${funnel.step4_paradox}, quality ${funnel.step4_quality})`);
console.log(`  Step5/6 (non-gating)   reach ${reach.step5}`);
console.log(`  Step7 path             reach ${reach.step7}  reject ${funnel.step7_reject}`);
console.log(`  Step8 trinity          reach ${reach.step8}  reject ${funnel.step8_reject}`);
console.log(`  Step9 execution_plan   reach ${reach.step9}  reject ${funnel.step9_reject}`);
console.log(`  => WOULD_ENTER         ${funnel.wouldEnter}`);
console.log(`\nStep4 reasons:`, step4Reasons);
console.log(`Step8 reasons:`, step8Reasons);
console.log(`Step9 reasons:`, step9Reasons);
console.log(`\nCADENCE ARTIFACT: ticks where strict 10-min window had >=5 samples: ${funnel.step1_strict10min_would_have_ge5}/${funnel.ticksProcessed} (${(100*funnel.step1_strict10min_would_have_ge5/funnel.ticksProcessed).toFixed(1)}%)`);
console.log(`would_enter by direction:`, wouldEnters.reduce((a, w) => { a[w.direction] = (a[w.direction]||0)+1; return a; }, {}));
console.log(`would_enter by ticker:`, wouldEnters.reduce((a, w) => { a[w.ticker] = (a[w.ticker]||0)+1; return a; }, {}));
console.log(`would_enter days:`, [...new Set(wouldEnters.map(w=>w.day))].length);
console.log(`\nwrote engine_replay_out.json (${wouldEnters.length} would_enters)`);
