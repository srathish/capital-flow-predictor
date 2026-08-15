#!/usr/bin/env node
// scanner.mjs — GEX Node Scanner CLI. Ties the 4 stages together.
//   node scanner.mjs run  --date YYYY-MM-DD [--expiry YYYY-MM-DD] [--tickers A,B] [--theme X] [--refresh] [--no-flow] [--limit N] [--no-plan]
//   node scanner.mjs scan --date YYYY-MM-DD [--expiry ...]        # Stage 0+1 only (no LLM, cheap/deterministic)
//   node scanner.mjs premarket --date YYYY-MM-DD                  # deterministic re-check of an existing plan file
//   node scanner.mjs auth                                         # Skylit auth status
// Skylit session from ENV_FILE=session-b.env; Anthropic + UW keys pulled from repo-root .env.
import path from 'node:path';
import { loadConfig, loadEnvKeysFrom, resolveFromRoot, readJson, writeJson, log, setQuiet } from './lib/util.mjs';
import { etDate, isTradingDayET } from './lib/time.mjs';

loadEnvKeysFrom(resolveFromRoot('../../.env'), ['ANTHROPIC_API_KEY', 'UNUSUAL_WHALES_API_KEY']);

const { ingest, effectiveScanDate } = await import('./stage0-ingest.mjs');
const { scan } = await import('./stage1-scan.mjs');
const { planAll, anthropicLLM } = await import('./stage2-plan.mjs');
const { gateAll } = await import('./stage3-gate.mjs');
const { FlowProvider } = await import('./providers/flow-uw.mjs');
const { GexProvider } = await import('./providers/gex-skylit.mjs');
const { assemblePlans, writePlans, writeReport, discordSummary, postDiscord } = await import('./stage4-report.mjs');
const { backtestScore, backtestCards, backtestSignal, renderBacktestReport, renderCardsReport, renderSignalReport, sessionsInRange } = await import('./backtest.mjs');
const { resolveOutcomes } = await import('./stage7-outcomes.mjs');

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) { const k = t.slice(2); const nx = argv[i + 1]; if (nx === undefined || nx.startsWith('--')) a[k] = true; else { a[k] = nx; i++; } }
    else a._.push(t);
  }
  return a;
}
const etToday = () => etDate(new Date());
const isPast = (d) => d < etToday();

async function cmdScan(args, config) {
  const date = args.date || etToday();
  const expiry = args.expiry || config.target_expiry || null;
  const symbols = args.tickers ? String(args.tickers).split(',') : null;
  await ingest({ config, date, expiry, symbols, theme: args.theme || null, refresh: !!args.refresh, withFlow: args['no-flow'] ? false : null });
  const runDate = effectiveScanDate(date);
  const { scanFile, ranked, out } = await scan({ config, date: runDate, expiry });
  log(`\nTop ${Math.min(out.top_k, ranked.length)} by flow_through_score:`);
  for (const m of ranked.slice(0, out.top_k)) log(`  ${m.ticker.padEnd(6)} ${m.flow_through_score.toFixed(5)} · magnet ${m.magnet.strike} (+${(m.magnet.dist_pct * 100).toFixed(1)}%, ${(m.magnet.gex / 1e6).toFixed(1)}M) · persist ${m.persistence.days}d`);
  return { runDate, scanFile, ranked, out };
}

async function cmdRun(args, config) {
  const { runDate, ranked, out } = await cmdScan(args, config);
  const expiry = args.expiry || config.target_expiry || null;
  if (args['no-plan']) { log('\n[run] --no-plan: stopped after scan.'); return; }
  if (!process.env.ANTHROPIC_API_KEY) { log('\n[run] ANTHROPIC_API_KEY missing — cannot plan. Scan written; stopping.'); return; }

  const limit = args.limit ? +args.limit : config.scan.top_k;
  const toPlan = ranked.slice(0, limit);
  log(`\n[stage2] planning top ${toPlan.length} with ${config.planner.model}…`);
  const { cards, stats, circuitBroken } = await planAll(toPlan, { config, targetExpiry: expiry, runDate, llm: anthropicLLM });
  log(`[stage2] ${stats.ok} ok · ${stats.discarded} discarded · ${stats.no_trade} no-trade${circuitBroken ? ' · ⛔ CIRCUIT BROKEN' : ''}`);

  // Stage 3 — flow gate (per tradable ticker).
  const flowBy = {};
  if (config.flow_gate.enabled) {
    const flow = new FlowProvider();
    if (flow.available) {
      const asOf = isPast(runDate) ? runDate : null;
      for (const c of cards) {
        if (c.status !== 'ok' || c.plan.direction === 'no_trade') continue;
        try { flowBy[c.ticker] = await flow.getFlow(c.ticker, { asOfDate: asOf, lookbackSessions: config.flow_gate.lookback_sessions }); } catch { /* leave unvalidated */ }
      }
    } else log('[stage3] UW key missing — cards will be unvalidated.');
  }
  const gateSummary = gateAll(cards, flowBy, config);
  log(`[stage3] ${gateSummary.confirmed} confirmed · ${gateSummary.neutral} neutral · ${gateSummary.contradicted} vetoed · ${gateSummary.unvalidated} unvalidated`);

  // Stage 4 — output.
  const plans = assemblePlans({ runDate, requestedDate: args.date || etToday(), expiry, scanOut: out, cards, gateSummary, circuitBroken, config });
  const planFile = writePlans(plans, config);
  const { file: reportFile, md } = writeReport(plans, config);
  if (config.output.discord_webhook) { const okd = await postDiscord(config.output.discord_webhook, discordSummary(plans)); log(`[stage4] discord ${okd ? 'posted' : 'failed'}`); }
  log(`[stage4] plans → ${planFile}\n[stage4] report → ${reportFile}\n`);
  console.log(md);
}

// Deterministic pre-market re-check (NO LLM): re-pull spot; kill/flag cards whose
// overnight gap breached invalidation or ran past the trigger.
async function cmdPremarket(args, config) {
  const date = args.date || etToday();
  const planFile = resolveFromRoot(path.join(config.planner.plans_dir, `${effectiveScanDate(date)}_plans.json`));
  const plans = readJson(planFile);
  if (!plans) { log(`no plan file at ${planFile}`); return; }
  const gex = new GexProvider({ maxStrikes: config.ingest.max_strikes, maxExpirations: config.ingest.max_expirations, eodHHMM: config.ingest.skylit_eod_hhmm });
  await gex.init();
  const band = config.premarket_recheck.gap_band_pct;
  const results = [];
  for (const c of plans.cards) {
    if (c.status !== 'ok' || !c.plan || c.plan.direction === 'no_trade' || c.vetoed) continue;
    const p = c.plan;
    let spot = null;
    try { spot = (await gex.getProfile(c.ticker, {}))?.spot ?? null; } catch { /* skip */ }
    if (spot == null) { results.push({ ticker: c.ticker, spot: null, status: 'no-data' }); continue; }
    let status = 'live', note = '';
    if (p.direction === 'long') {
      if (spot <= p.invalidation) { status = 'KILL'; note = `gapped to/below invalidation ${p.invalidation}`; }
      else if (spot >= p.target) { status = 'HIT?'; note = `gapped to/through target ${p.target}`; }
      else if ((spot - p.entry_trigger) / p.entry_trigger > band) { status = 'FLAG'; note = `gapped ${((spot - p.entry_trigger) / p.entry_trigger * 100).toFixed(1)}% past trigger`; }
    } else {
      if (spot >= p.invalidation) { status = 'KILL'; note = `gapped to/above invalidation ${p.invalidation}`; }
      else if (spot <= p.target) { status = 'HIT?'; note = `gapped to/through target ${p.target}`; }
      else if ((p.entry_trigger - spot) / p.entry_trigger > band) { status = 'FLAG'; note = `gapped ${((p.entry_trigger - spot) / p.entry_trigger * 100).toFixed(1)}% past trigger`; }
    }
    results.push({ ticker: c.ticker, spot, trigger: p.entry_trigger, target: p.target, invalidation: p.invalidation, status, note });
  }
  const outFile = resolveFromRoot(path.join(config.planner.plans_dir, `${effectiveScanDate(date)}_premarket.json`));
  writeJson(outFile, { date: effectiveScanDate(date), checkedAt: new Date().toISOString(), results });
  log(`\nPre-market re-check ${effectiveScanDate(date)} (spot now vs plan):`);
  for (const r of results) log(`  ${r.status === 'KILL' ? '💀' : r.status === 'FLAG' ? '⚠️ ' : r.status === 'HIT?' ? '✅' : '  '} ${r.ticker.padEnd(6)} spot ${r.spot ?? '—'} · ${r.status}${r.note ? ' — ' + r.note : ''}`);
  log(`→ ${outFile}`);
}

// Walk-forward backtest: replay past dates, resolve magnet-reach top-rank vs control.
async function cmdBacktest(args, config) {
  const from = args.from, to = args.to || from;
  if (!from) { log('backtest needs --from YYYY-MM-DD [--to YYYY-MM-DD]'); return; }
  const dates = sessionsInRange(from, to, args.every ? +args.every : 1);
  if (!dates.length) { log('no trading sessions in range'); return; }
  const symbols = args.tickers ? String(args.tickers).split(',') : null;
  log(`[backtest] ${dates.length} dates ${dates[0]}…${dates[dates.length - 1]} · horizon ${args.horizon ? args.horizon + 'd fixed' : 'king-weekly'} · ${symbols ? symbols.length + ' tickers' : args.theme || 'full universe'}`);
  const { summary, outFile } = await backtestScore({
    config, dates, symbols, theme: args.theme || null,
    horizonDays: args.horizon ? +args.horizon : null, stopPct: args.stop ? +args.stop : 0.05,
    topK: args.topk ? +args.topk : 10, controlK: args.control ? +args.control : 10, refresh: !!args.refresh,
  });
  log(`\n[backtest] → ${outFile}\n`);
  console.log(renderBacktestReport(summary));
}

async function cmdOutcomes(args, config) {
  const date = args.date || etToday();
  await resolveOutcomes({ config, date });
}

// Full-system card backtest on named tickers: real LLM plans resolved vs actual price.
async function cmdBacktestCards(args, config) {
  const from = args.from, to = args.to || from;
  if (!from || !args.tickers) { log('backtest-cards needs --from YYYY-MM-DD and --tickers A,B'); return; }
  if (!process.env.ANTHROPIC_API_KEY) { log('ANTHROPIC_API_KEY missing — cannot plan'); return; }
  const dates = sessionsInRange(from, to, args.every ? +args.every : 5);
  const symbols = String(args.tickers).split(',').map((s) => s.toUpperCase());
  log(`[cards] ${dates.length} dates ${dates[0]}…${dates[dates.length - 1]} · ${symbols.join(',')} · gate ${args['no-gate'] ? 'off' : 'on'}`);
  const { results, outFile } = await backtestCards({ config, dates, symbols, llm: anthropicLLM, gate: !args['no-gate'] });
  log(`\n[cards] → ${outFile}\n`);
  console.log(renderCardsReport(results, symbols));
}

// Daily signal timeline: when does the deterministic scanner flag "get in"?
async function cmdTrack(args, config) {
  const from = args.from, to = args.to || etToday();
  if (!from || !args.tickers) { log('track needs --from YYYY-MM-DD and --tickers A,B'); return; }
  const dates = sessionsInRange(from, to, args.every ? +args.every : 1);
  const symbols = String(args.tickers).split(',').map((s) => s.toUpperCase());
  const threshold = args.threshold ? +args.threshold : (config.signal?.get_in_score ?? 0.04);
  const minP = args['min-persist'] ? +args['min-persist'] : (config.signal?.min_persistence ?? 2);
  const useLlm = !args['no-llm'] && !!process.env.ANTHROPIC_API_KEY;
  log(`[track] ${dates.length} sessions ${dates[0]}…${dates[dates.length - 1]} · ${symbols.join(',')} · get-in ≥ ${threshold} & persist ≥ ${minP} · LLM ${useLlm ? 'on' : 'off'}`);
  const { rows, priceByTicker, outFile } = await backtestSignal({ config, dates, symbols, threshold, minPersistence: minP, llm: useLlm ? anthropicLLM : null, gate: !args['no-gate'] });
  log(`\n[track] → ${outFile}\n`);
  console.log(renderSignalReport(rows, priceByTicker, symbols, threshold, minP));
}

async function cmdAuth() {
  const gex = new GexProvider({});
  const s = await gex.authStatus();
  log(`Skylit auth: ${s.ok ? 'OK' : 'DEAD'} (token len ${s.tokenLen})`);
  log(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'present' : 'MISSING'} · UNUSUAL_WHALES_API_KEY: ${process.env.UNUSUAL_WHALES_API_KEY ? 'present' : 'MISSING'}`);
}

const args = parseArgs(process.argv.slice(2));
if (args.quiet) setQuiet(true);
const cmd = args._[0] || 'run';
const config = loadConfig();
try {
  if (cmd === 'run') await cmdRun(args, config);
  else if (cmd === 'scan') await cmdScan(args, config);
  else if (cmd === 'backtest') await cmdBacktest(args, config);
  else if (cmd === 'backtest-cards') await cmdBacktestCards(args, config);
  else if (cmd === 'track') await cmdTrack(args, config);
  else if (cmd === 'outcomes') await cmdOutcomes(args, config);
  else if (cmd === 'premarket') await cmdPremarket(args, config);
  else if (cmd === 'auth') await cmdAuth();
  else { console.log('commands: run | scan | backtest | outcomes | premarket | auth'); process.exit(1); }
} catch (e) {
  console.error(`[scanner] ${cmd} failed: ${e.message}`);
  process.exit(1);
}
