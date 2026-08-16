#!/usr/bin/env node
// OOS test: does the per-expiry STRUCTURE grade (built looking only at Aug-17/MU) sort
// realized R on the 4 PRIOR Talon weeks (Jul 13 - Aug 7) it was never fit to?
// Pull structure as-of each week's entry, grade each name, RE-RESOLVE its plan with the
// CORRECTED gap-aware fill (the saved R_stop is the old phantom-fill bug), then join.
// Pull once → cache dataset.json → slice many ways (analysis is separate, in stats.mjs).
//   node oos.mjs            # build+cache dataset
//   node oos.mjs --rebuild  # force re-pull
import { loadConfig, loadEnvKeysFrom, resolveFromRoot, readJson, writeJson, log } from '../../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['ANTHROPIC_API_KEY', 'UNUSUAL_WHALES_API_KEY']);
const { GexProvider } = await import('../../providers/gex-skylit.mjs');
const { FlowProvider } = await import('../../providers/flow-uw.mjs');
const { resolvePlan } = await import('../../lib/resolve-plan.mjs');

const OUT = resolveFromRoot('research/perexpiry-oos/dataset.json');
if (!process.argv.includes('--rebuild') && readJson(OUT)) { log('dataset.json exists — use --rebuild to re-pull. (analysis lives in stats.mjs)'); process.exit(0); }

const WEEKS = [
  { week: '2026-07-13', entry: '2026-07-10', from: '2026-07-13', to: '2026-07-17' },
  { week: '2026-07-20', entry: '2026-07-17', from: '2026-07-20', to: '2026-07-24' },
  { week: '2026-07-27', entry: '2026-07-24', from: '2026-07-27', to: '2026-07-31' },
  { week: '2026-08-03', entry: '2026-07-31', from: '2026-08-03', to: '2026-08-07' },
];

const M = (x) => Math.round((x / 1e6) * 100) / 100;
const pctOf = (k, spot) => Math.round((k - spot) / spot * 1000) / 10;
const domExpiry = (s, field) => { const map = s[field] || {}; let b = null, bv = 0; for (const [E, v] of Object.entries(map)) if (Math.abs(v) > bv) { bv = Math.abs(v); b = E; } return b ? { E: b, v: map[b] } : null; };

// FEATURE EXTRACTION — the committed baseline grade + extra raw features for hypothesis
// testing. NOTE: this mirrors perexpiry.mjs; kept here so I iterate WITHOUT touching the tool.
function features(profile, dir, window) {
  const spot = profile.spot, S = profile.strikes;
  const maxG = Math.max(...S.map((s) => Math.abs(s.gexAgg)), 1);
  const maxV = Math.max(...S.map((s) => Math.abs(s.vexAgg)), 1);
  const sigG = 0.2 * maxG, sigV = 0.2 * maxV;
  const long = dir === 'long';
  const byExpV = {};
  for (const s of S) for (const [E, v] of Object.entries(s.perExpiryVanna || {})) byExpV[E] = (byExpV[E] || 0) + Math.abs(v);
  const driveV = Object.entries(byExpV).sort((a, b) => b[1] - a[1])[0];
  const wallsDir = S.filter((s) => s.gexAgg > sigG && (long ? s.strike > spot * 1.001 : s.strike < spot * 0.999)).sort((a, b) => (long ? a.strike - b.strike : b.strike - a.strike));
  const t1 = wallsDir[0] || null;
  const magsDir = S.filter((s) => s.vexAgg > sigV && (long ? s.strike > spot : s.strike < spot)).sort((a, b) => b.vexAgg - a.vexAgg);
  const runner = magsDir[0] || null;
  const supp = S.filter((s) => s.gexAgg > sigG && (long ? s.strike < spot * 0.999 : s.strike > spot * 1.001)).sort((a, b) => (long ? b.strike - a.strike : a.strike - b.strike));
  const support = supp[0] || null;
  const strongFloor = !!(support && support.gexAgg >= 0.45 * maxG);
  const room = t1 ? Math.abs(pctOf(t1.strike, spot)) : null;
  let verdict = 'THIN';
  if (!t1 && runner) verdict = 'VANNA-ONLY';
  else if (!t1) verdict = 'NO-STRUCT';
  else if (room < 0.4) verdict = 'PINNED';
  else if (room > 8) verdict = 'WIDE';
  else if (runner) verdict = 'CONFIRM';
  // driving vanna expiry within the trade/resolve window? (magnet on a near clock)
  const driveNear = driveV ? (driveV[0] <= window.to) : false;
  const runnerNear = runner ? ((domExpiry(runner, 'perExpiryVanna') || {}).E <= window.to) : false;
  return {
    verdict, spot,
    vannaMagnetM: runner ? Math.abs(M(runner.vexAgg)) : 0,
    runnerPct: runner ? Math.abs(pctOf(runner.strike, spot)) : null,
    t1RoomPct: room,
    strongFloor, hasSupport: !!support,
    aggVexKingM: M(Math.max(...S.map((s) => Math.abs(s.vexAgg)))),
    driveVexExpiry: driveV ? driveV[0] : null,
    driveNear, runnerNear,
  };
}

const config = loadConfig();
const gex = new GexProvider({ maxStrikes: config.ingest.max_strikes, maxExpirations: config.ingest.max_expirations, eodHHMM: config.ingest.skylit_eod_hhmm });
try { await gex.init(); } catch (e) { console.log('AUTH-FAIL:', e.message); process.exit(2); }
const flow = new FlowProvider();

const data = [];
for (const w of WEEKS) {
  const sv = readJson(resolveFromRoot(`data/plans/${w.week}_sysval.json`));
  const rows = (sv?.rows || []).filter((r) => (r.dir === 'long' || r.dir === 'short') && r.entry != null && r.inval != null && r.tgt != null);
  log(`\n${w.week} (entry ${w.entry}) — ${rows.length} plans`);
  for (const r of rows) {
    try {
      const profile = await gex.getProfile(r.t, { date: w.entry });
      if (!profile) { log(`  ${r.t} no-structure`); continue; }
      const f = features(profile, r.dir, w);
      const plan = { direction: r.dir, entry_trigger: r.entry, invalidation: r.inval, target: r.tgt, runner_target: r.run };
      const ohlc = await flow.getDailyOHLC(r.t, { limit: 90 }).catch(() => []);
      const res = resolvePlan(plan, ohlc, { from: w.from, to: w.to });
      data.push({ week: w.week, t: r.t, dir: r.dir, ...f, R: res.R, R_stop: res.R_stop, R_intra: res.R_intra, outcome: res.outcome, entered: res.entered });
      log(`  ${r.t.padEnd(6)} ${r.dir.padEnd(5)} ${f.verdict.padEnd(10)} magnet ${String(f.vannaMagnetM).padEnd(7)}M  R_stop ${(res.R_stop ?? 0).toFixed(2)}`);
    } catch (e) { if (e.message === 'AUTH') { log('AUTH died'); process.exit(3); } log(`  ${r.t} err ${e.message}`); }
  }
}
writeJson(OUT, { built: WEEKS.map((w) => w.week), n: data.length, rows: data });
log(`\n✓ wrote ${data.length} rows → ${OUT}`);
