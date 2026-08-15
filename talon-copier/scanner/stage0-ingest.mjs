// stage0-ingest.mjs — Universe & ingest (deterministic).
// Per ticker: Skylit aggregate + per-expiry GEX/VEX + spot (GexProvider) and UW
// options-flow + volume/OI (FlowProvider, for the liquidity screen and Stage 3).
// Caches each ticker to data/raw/{date}/{ticker}.json and writes a manifest.
// Failed tickers are skipped+logged (never crash). Staleness rule: if Skylit's
// returned snapshot date is older than the scan date, DROP with a log line.
import path from 'node:path';
import { GexProvider } from './providers/gex-skylit.mjs';
import { FlowProvider } from './providers/flow-uw.mjs';
import { RateLimiter, resolveFromRoot, readJson, writeJson, ensureDir, log, sum } from './lib/util.mjs';
import { isTradingDayET, priorSessions } from './lib/time.mjs';
import fs from 'node:fs';

// Resolve the universe of tickers to scan.
export function loadUniverse(config, { symbols = null, theme = null } = {}) {
  if (symbols && symbols.length) return dedupUpper(symbols);
  if (theme) {
    const t = config.universe.themes?.[theme];
    if (!t) throw new Error(`unknown theme: ${theme}`);
    return dedupUpper(t);
  }
  const file = resolveFromRoot(config.universe.symbols_file);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = (raw.symbols || raw)
    .filter((s) => !(config.universe.exclude_indexes && s.is_index))
    .map((s) => s.name || s.symbol || s.ticker || s)
    .concat(config.universe.extra_symbols || []);
  return dedupUpper(list);
}

function dedupUpper(arr) {
  const seen = new Set(); const out = [];
  for (const t of arr) { const u = String(t).toUpperCase().trim(); if (u && !seen.has(u)) { seen.add(u); out.push(u); } }
  return out;
}

// Snap a requested date to the last trading session on/before it.
export function effectiveScanDate(dateStr) {
  return isTradingDayET(dateStr) ? dateStr : priorSessions(dateStr, 1)[0];
}

function deriveLiquidity(flow) {
  const d = flow?.asOfDay;
  if (!d) return null;
  return {
    options_volume: (d.call_volume || 0) + (d.put_volume || 0),
    total_oi: (d.call_oi || 0) + (d.put_oi || 0),
    avg30_options_volume: (d.avg30_call_volume || 0) + (d.avg30_put_volume || 0),
    net_call_premium: d.net_call_premium ?? null,
    net_put_premium: d.net_put_premium ?? null,
  };
}

export async function ingest({ config, date, expiry = null, symbols = null, theme = null, refresh = false, withFlow = null }) {
  const runDate = effectiveScanDate(date);
  if (runDate !== date) log(`[stage0] ${date} is not a trading session → scanning as-of ${runDate}`);
  const universe = loadUniverse(config, { symbols, theme });
  const flowEnabled = withFlow == null ? !!config.flow_gate?.enabled : withFlow;

  const rl = new RateLimiter(config.ingest.rate_limit);
  const gex = new GexProvider({
    maxStrikes: config.ingest.max_strikes,
    maxExpirations: config.ingest.max_expirations,
    timeoutMs: config.ingest.request_timeout_ms,
    eodHHMM: config.ingest.skylit_eod_hhmm,
    limiter: rl,
  });
  const flow = new FlowProvider({ limiter: rl });
  await gex.init();

  const rawDir = ensureDir(resolveFromRoot(path.join(config.ingest.cache_dir, runDate)));
  const ok = [], dropped = [], failed = [];
  let i = 0, authDead = false;

  for (const ticker of universe) {
    i++;
    if (authDead) { failed.push({ ticker, err: 'auth-dead' }); continue; }
    const cacheFile = path.join(rawDir, `${ticker}.json`);
    if (!refresh && fs.existsSync(cacheFile)) {
      const rec = readJson(cacheFile);
      if (rec && rec.profile) { ok.push(ticker); if (i % 50 === 0) log(`  …${i}/${universe.length} (cache)`); continue; }
    }
    try {
      const profile = await gex.getProfile(ticker, { date: runDate });
      if (!profile) { failed.push({ ticker, err: 'no-gex' }); continue; }
      // Staleness: never score a surface older than the scan date.
      if (profile.asofDate && profile.asofDate < runDate) {
        dropped.push({ ticker, reason: `stale (skylit asof ${profile.asofDate} < ${runDate})` });
        continue;
      }
      let flowRec = null;
      if (flowEnabled && flow.available) {
        try { flowRec = await flow.getFlow(ticker, { asOfDate: runDate, lookbackSessions: config.flow_gate.lookback_sessions }); }
        catch { flowRec = null; }
      }
      const record = {
        ticker, runDate, expiry, ingestedAt: new Date().toISOString(),
        profile,
        flow: flowRec ? { asOfDay: flowRec.asOfDay, series: flowRec.series, live: flowRec.live } : null,
        liquidity: deriveLiquidity(flowRec),
      };
      writeJson(cacheFile, record);
      ok.push(ticker);
    } catch (e) {
      if (e.message === 'AUTH') { authDead = true; failed.push({ ticker, err: 'AUTH' }); log('[stage0] AUTH failure — Skylit session dead, aborting pulls'); continue; }
      failed.push({ ticker, err: String(e.message || e).slice(0, 80) });
    }
    if (i % 50 === 0) log(`  …${i}/${universe.length} (${ok.length} ok, ${dropped.length} drop, ${failed.length} fail)`);
  }

  const manifest = {
    runDate, requestedDate: date, expiry, ingestedAt: new Date().toISOString(),
    universe_n: universe.length, flow_enabled: flowEnabled, auth_dead: authDead,
    ok, dropped, failed,
  };
  writeJson(path.join(rawDir, '_manifest.json'), manifest);
  log(`[stage0] ${runDate}: ${ok.length} ok · ${dropped.length} stale-dropped · ${failed.length} failed → ${rawDir}`);
  return { runDate, rawDir, manifest };
}
