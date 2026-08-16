#!/usr/bin/env node
// Walk-forward data collector. Pull Skylit structure (as-of each week's entry Friday) +
// UW daily OHLC ONCE for a fixed universe over ~9 months, cache to disk. Resumable
// (skips cached), flushes periodically. Strategies then run OFFLINE against the cache
// (test_strat.mjs) so we never re-pull. This is the data layer for a regime-diverse,
// overfit-resistant backtest.
import fs from 'node:fs';
import { loadConfig, loadEnvKeysFrom, resolveFromRoot, readJson, writeJson, log } from '../../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { GexProvider } = await import('../../providers/gex-skylit.mjs');
const { FlowProvider } = await import('../../providers/flow-uw.mjs');

// Fixed, non-cherry-picked liquid optionable universe across sectors + benchmark ETFs.
const UNIVERSE = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'AVGO', 'TSLA', 'AMD', 'TSM', 'MU', 'QCOM', 'AMAT', 'LRCX', 'COIN', 'HOOD', 'SOFI', 'PLTR', 'NET', 'SHOP', 'NKE', 'DIS', 'WMT', 'HD', 'MCD', 'XOM', 'CVX', 'JPM', 'BAC', 'FCX', 'SPY', 'QQQ', 'IWM', 'SMH', 'XBI'];

// weekly: entry = prior Friday, resolve Mon..Fri. Nov 2025 → Aug 2026.
const iso = (d) => d.toISOString().slice(0, 10);
const WEEKS = [];
for (let d = new Date('2025-11-17T00:00:00Z'); d <= new Date('2026-08-10T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 7)) {
  const monday = new Date(d), fri = new Date(d), to = new Date(d);
  fri.setUTCDate(monday.getUTCDate() - 3); to.setUTCDate(monday.getUTCDate() + 4);
  WEEKS.push({ entry: iso(fri), from: iso(monday), to: iso(to) });
}

const M = (x) => Math.round((x / 1e6) * 100) / 100;
const OHLC_F = resolveFromRoot('research/backtest/ohlc_cache.json');
const STRUCT_F = resolveFromRoot('research/backtest/struct_cache.json');
const ohlcCache = readJson(OHLC_F) || {};
const structCache = readJson(STRUCT_F) || {};

const config = loadConfig();
const gex = new GexProvider({ maxStrikes: config.ingest.max_strikes, maxExpirations: config.ingest.max_expirations, eodHHMM: config.ingest.skylit_eod_hhmm });
await gex.init();
const flow = new FlowProvider();

log(`universe ${UNIVERSE.length} × weeks ${WEEKS.length} = ${UNIVERSE.length * WEEKS.length} setups`);
// OHLC once per name (full year)
let opull = 0;
for (const t of UNIVERSE) {
  if (ohlcCache[t]) continue;
  const oh = await flow.getDailyOHLC(t, { limit: 260 }).catch(() => []);
  ohlcCache[t] = oh.map((b) => ({ d: b.date, o: b.open, h: b.high, l: b.low, c: b.close }));
  opull++;
}
if (opull) { writeJson(OHLC_F, ohlcCache); log(`OHLC pulled ${opull} names`); }

// structure per (name, entry). Store compact top nodes (aggregate) + per-expiry weight.
let n = 0, pulled = 0, since = 0;
const total = UNIVERSE.length * WEEKS.length;
for (const w of WEEKS) {
  for (const t of UNIVERSE) {
    n++;
    const key = `${t}|${w.entry}`;
    if (structCache[key]) continue;
    try {
      const p = await gex.getProfile(t, { date: w.entry });
      if (!p || !p.strikes?.length) { structCache[key] = { null: 1 }; continue; }
      const g = [...p.strikes].filter((s) => s.gexAgg).sort((a, b) => Math.abs(b.gexAgg) - Math.abs(a.gexAgg)).slice(0, 24).map((s) => ({ k: s.strike, m: M(s.gexAgg) }));
      const v = [...p.strikes].filter((s) => s.vexAgg).sort((a, b) => Math.abs(b.vexAgg) - Math.abs(a.vexAgg)).slice(0, 24).map((s) => ({ k: s.strike, m: M(s.vexAgg) }));
      structCache[key] = { spot: p.spot, asof: p.asofDate, g, v };
      pulled++; since++;
    } catch (e) { if (e.message === 'AUTH') { writeJson(STRUCT_F, structCache); log(`AUTH died at ${key} — flushed, resume later`); process.exit(3); } structCache[key] = { err: String(e.message).slice(0, 20) }; }
    if (since >= 100) { writeJson(STRUCT_F, structCache); since = 0; log(`  … ${n}/${total} (pulled ${pulled})`); }
  }
}
writeJson(STRUCT_F, structCache);
log(`✓ done. structures cached: ${Object.keys(structCache).length} (pulled ${pulled} this run)`);
