#!/usr/bin/env node
// Structure collector for the 7 RANDOM stocks (options walk-forward). Writes to the SAME
// cache as collect.mjs, so MU/AAPL/WMT (already in the 35-run) are reused; only the 4 new
// names pull. Resumable. Goes as far back as Skylit serves each name.
import { loadConfig, loadEnvKeysFrom, resolveFromRoot, readJson, writeJson, log } from '../../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { GexProvider } = await import('../../providers/gex-skylit.mjs');
const { FlowProvider } = await import('../../providers/flow-uw.mjs');
const SEVEN = ['HIMS', 'MU', 'MARA', 'AAPL', 'WMT', 'PYPL', 'BMNR'];
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
const ohlc = readJson(OHLC_F) || {}, struct = readJson(STRUCT_F) || {};
const config = loadConfig();
const gex = new GexProvider({ maxStrikes: config.ingest.max_strikes, maxExpirations: config.ingest.max_expirations, eodHHMM: config.ingest.skylit_eod_hhmm });
await gex.init();
const flow = new FlowProvider();
for (const t of SEVEN) { if (!ohlc[t]) { const oh = await flow.getDailyOHLC(t, { limit: 260 }).catch(() => []); ohlc[t] = oh.map((b) => ({ d: b.date, o: b.open, h: b.high, l: b.low, c: b.close })); log(`OHLC ${t}: ${ohlc[t].length}`); } }
writeJson(OHLC_F, ohlc);
let pulled = 0, since = 0;
for (const w of WEEKS) for (const t of SEVEN) {
  const key = `${t}|${w.entry}`; if (struct[key]) continue;
  try {
    const p = await gex.getProfile(t, { date: w.entry });
    if (!p || !p.strikes?.length) { struct[key] = { null: 1 }; continue; }
    const g = [...p.strikes].filter((s) => s.gexAgg).sort((a, b) => Math.abs(b.gexAgg) - Math.abs(a.gexAgg)).slice(0, 24).map((s) => ({ k: s.strike, m: M(s.gexAgg) }));
    const v = [...p.strikes].filter((s) => s.vexAgg).sort((a, b) => Math.abs(b.vexAgg) - Math.abs(a.vexAgg)).slice(0, 24).map((s) => ({ k: s.strike, m: M(s.vexAgg) }));
    struct[key] = { spot: p.spot, asof: p.asofDate, g, v }; pulled++; since++;
  } catch (e) { if (e.message === 'AUTH') { writeJson(STRUCT_F, struct); log('AUTH died — flushed'); process.exit(3); } struct[key] = { err: String(e.message).slice(0, 20) }; }
  if (since >= 50) { writeJson(STRUCT_F, struct); since = 0; log(`  … pulled ${pulled}`); }
}
writeJson(STRUCT_F, struct);
// report depth per name
for (const t of SEVEN) { const ks = WEEKS.filter((w) => struct[`${t}|${w.entry}`]?.spot); log(`${t}: ${ks.length}/${WEEKS.length} weeks with structure (earliest ${ks[0]?.entry || '—'})`); }
log(`✓ done, pulled ${pulled}`);
