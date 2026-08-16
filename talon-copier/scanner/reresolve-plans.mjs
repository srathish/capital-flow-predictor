#!/usr/bin/env node
// reresolve-plans.mjs — re-score the ALREADY-GENERATED LLM plans (from <week>_sysval.json)
// with the CORRECTED gap-aware fill, no LLM. Confirms how much of the +67R was the
// phantom-fill bug. Pass the fixtures (for resolve dates); the sysval is derived by week.
import { loadEnvKeysFrom, resolveFromRoot, readJson, log } from './lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { resolvePlan } = await import('./lib/resolve-plan.mjs');
const { FlowProvider } = await import('./providers/flow-uw.mjs');

const files = process.argv.slice(2);
if (!files.length) { console.log('usage: node reresolve-plans.mjs <wk_talon.json> [...]'); process.exit(1); }
const flow = new FlowProvider();
const weeks = [];
for (const f of files) {
  const wl = readJson(resolveFromRoot(f)) || readJson(f);
  const sv = readJson(resolveFromRoot(`data/plans/${wl.week}_sysval.json`));
  if (!wl || !sv) { log(`  · missing fixture/sysval for ${f}`); continue; }
  let tot = 0, totStop = 0, totIntra = 0, entered = 0, wins = 0; const rows = [];
  for (const r of sv.rows) {
    if (!r.dir || r.dir === 'no_trade' || r.entry == null) continue; // no_trade / no-plan = 0R
    const plan = { direction: r.dir, entry_trigger: r.entry, invalidation: r.inval, target: r.tgt, runner_target: r.run };
    const ohlc = await flow.getDailyOHLC(r.t, { limit: 90 }).catch(() => []);
    const res = resolvePlan(plan, ohlc, { from: wl.resolve_from, to: wl.resolve_to });
    if (res.entered) { entered++; if (res.R_stop > 0) wins++; }
    tot += res.R; totStop += res.R_stop; totIntra += (res.R_intra ?? res.R_stop);
    rows.push({ t: r.t, dir: r.dir, oldR: r.R_stop, trig: r.entry, fill: res.entry, inval: r.inval, R_stop: res.R_stop, outcome: res.outcome });
  }
  weeks.push({ week: wl.week, tot, totStop, totIntra, entered, wins, rows });
  log(`\n═══ ${wl.week} (${wl.resolve_from}→${wl.resolve_to}) ═══`);
  for (const x of rows.sort((a, b) => b.R_stop - a.R_stop)) log(`  ${x.t.padEnd(6)} ${x.dir.padEnd(5)} trig ${String(x.trig).padEnd(8)} fill ${String(x.fill ?? '—').padEnd(8)} → ${x.outcome.padEnd(11)} ${x.R_stop >= 0 ? '+' : ''}${x.R_stop.toFixed(2)}R  (was ${x.oldR >= 0 ? '+' : ''}${(x.oldR ?? 0).toFixed(2)}R)`);
  log(`  → ${entered} entered · ${wins} green · week ${totStop >= 0 ? '+' : ''}${totStop.toFixed(1)}R hard-stop (${tot >= 0 ? '+' : ''}${tot.toFixed(1)}R close)`);
}
const gS = weeks.reduce((s, w) => s + w.totStop, 0), gI = weeks.reduce((s, w) => s + w.totIntra, 0), gE = weeks.reduce((s, w) => s + w.entered, 0), gW = weeks.reduce((s, w) => s + w.wins, 0);
log(`\n████ CORRECTED-FILL LLM SYSTEM — ${weeks.length} weeks ████`);
for (const w of weeks) log(`  ${w.week}: ${w.totStop >= 0 ? '+' : ''}${w.totStop.toFixed(1)}R close-stop / ${w.totIntra >= 0 ? '+' : ''}${w.totIntra.toFixed(1)}R intraday-stop (${w.wins}/${w.entered})`);
log(`  TOTAL: ${gS >= 0 ? '+' : ''}${gS.toFixed(1)}R close-stop / ${gI >= 0 ? '+' : ''}${gI.toFixed(1)}R intraday-stop · ${gW}/${gE} green`);
log(`  BENCHMARKS (hard-stop, 4wk): Talon +20.9R · old-LLM +7.5R · deterministic +22.4R · buggy-fill LLM +67.0R`);
