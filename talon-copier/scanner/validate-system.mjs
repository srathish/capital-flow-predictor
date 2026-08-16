#!/usr/bin/env node
// validate-system.mjs — the CORRECT validation of the LLM system: run planFromStructure
// (with the veto removed + new doctrine) on each Talon-watchlist name as-of the entry
// date, and resolve the LLM's OWN hard levels — entry_trigger / target / runner_target /
// invalidation — with a realistic 2-scale exit (half at the first target, half at the
// runner) and a close-basis structural stop. This is the plan AS TRADED, not the
// talonLevels proxy the first pass mistakenly measured.
//   node validate-system.mjs <wk1_talon.json> [wk2 ...]
import { loadConfig, loadEnvKeysFrom, resolveFromRoot, readJson, writeJson, log } from './lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['ANTHROPIC_API_KEY', 'UNUSUAL_WHALES_API_KEY']);
const { planFromStructure, anthropicLLM } = await import('./stage2-plan.mjs');
const { GexProvider } = await import('./providers/gex-skylit.mjs');
const { FlowProvider } = await import('./providers/flow-uw.mjs');
const { resolvePlan } = await import('./lib/resolve-plan.mjs'); // gap-aware fill + close/intraday bounds

const config = loadConfig();
const files = process.argv.slice(2);
if (!files.length) { console.log('usage: node validate-system.mjs <wk_talon.json> [...]'); process.exit(1); }

const gex = new GexProvider({ maxStrikes: config.ingest.max_strikes, maxExpirations: config.ingest.max_expirations, eodHHMM: config.ingest.skylit_eod_hhmm });
await gex.init();
const flow = new FlowProvider();
const weeks = [];
for (const f of files) {
  const wl = readJson(resolveFromRoot(f)) || readJson(f);
  if (!wl) { log(`  · cannot read ${f}`); continue; }
  log(`\n═══ ${wl.week} · entry ${wl.entry_date} → resolve ${wl.resolve_from}…${wl.resolve_to} ═══`);
  let tot = 0, totStop = 0, entered = 0, wins = 0, notrade = 0; const rows = [];
  for (const nm of wl.names) {
    const t = nm.ticker.toUpperCase();
    let plan = null, spot = null;
    try {
      const profile = await gex.getProfile(t, { date: wl.entry_date });
      if (!profile) { rows.push({ t, note: 'no-structure' }); continue; }
      spot = profile.spot;
      const history = await gex.getHistory(t, { asOfDate: profile.asofDate || wl.entry_date, sessions: 12 });
      const r = await planFromStructure(profile, history, { config, runDate: profile.asofDate || wl.entry_date, llm: anthropicLLM });
      if (r.status !== 'ok' || r.plan.direction === 'no_trade') { notrade++; rows.push({ t, dir: r.plan?.direction || 'discarded', R: 0 }); log(`  ${t.padEnd(6)} ${r.plan?.direction || 'discarded'} (0R)`); continue; }
      plan = r.plan;
    } catch (e) { if (e.message === 'AUTH') throw e; rows.push({ t, note: String(e.message).slice(0, 40) }); continue; }
    const ohlc = await flow.getDailyOHLC(t, { limit: 90 }).catch(() => []);
    const res = resolvePlan(plan, ohlc, { from: wl.resolve_from, to: wl.resolve_to });
    if (res.entered) { entered++; if (res.R > 0) wins++; }
    tot += res.R; totStop += res.R_stop;
    rows.push({ t, dir: plan.direction, entry: plan.entry_trigger, tgt: plan.target, run: plan.runner_target, inval: plan.invalidation, ...res });
    log(`  ${t.padEnd(6)} ${plan.direction.padEnd(5)} entry ${plan.entry_trigger} tgt ${plan.target} run ${plan.runner_target ?? '—'} → ${res.outcome} ${res.R >= 0 ? '+' : ''}${res.R.toFixed(2)}R (stop ${res.R_stop >= 0 ? '+' : ''}${res.R_stop.toFixed(2)}R)`);
  }
  weeks.push({ week: wl.week, tot, totStop, entered, wins, notrade, rows });
  log(`  → ${entered} entered · ${wins} green · ${notrade} no_trade · week ${tot >= 0 ? '+' : ''}${tot.toFixed(1)}R close / ${totStop >= 0 ? '+' : ''}${totStop.toFixed(1)}R hard-stop`);
  writeJson(resolveFromRoot(`data/plans/${wl.week}_sysval.json`), { week: wl.week, tot, totStop, entered, wins, notrade, rows });
}
const gC = weeks.reduce((s, w) => s + w.tot, 0), gS = weeks.reduce((s, w) => s + w.totStop, 0);
const gE = weeks.reduce((s, w) => s + w.entered, 0), gW = weeks.reduce((s, w) => s + w.wins, 0);
log(`\n████ FIXED LLM SYSTEM — ${weeks.length} weeks ████`);
for (const w of weeks) log(`  ${w.week}: ${w.tot >= 0 ? '+' : ''}${w.tot.toFixed(1)}R close / ${w.totStop >= 0 ? '+' : ''}${w.totStop.toFixed(1)}R hard-stop  (${w.wins}/${w.entered} green, ${w.notrade} no_trade)`);
log(`  TOTAL: ${gC >= 0 ? '+' : ''}${gC.toFixed(1)}R close / ${gS >= 0 ? '+' : ''}${gS.toFixed(1)}R hard-stop · ${gW}/${gE} green`);
log(`  BENCHMARKS (hard-stop, 4wk): Talon +20.9R · old-LLM-system +7.5R · deterministic-fix +22.4R`);
