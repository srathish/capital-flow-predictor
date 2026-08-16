#!/usr/bin/env node
// Probe how far back Skylit historical replay returns structure + UW OHLC returns bars.
// Determines how many regime-diverse weeks a walk-forward backtest can cover.
import { loadConfig, loadEnvKeysFrom, resolveFromRoot, log } from '../../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { GexProvider } = await import('../../providers/gex-skylit.mjs');
const { FlowProvider } = await import('../../providers/flow-uw.mjs');
const config = loadConfig();
const gex = new GexProvider({ maxStrikes: config.ingest.max_strikes, maxExpirations: config.ingest.max_expirations, eodHHMM: config.ingest.skylit_eod_hhmm });
await gex.init();
const flow = new FlowProvider();

const dates = ['2026-08-07', '2026-07-15', '2026-06-15', '2026-05-15', '2026-04-15', '2026-03-16', '2026-02-17', '2026-01-15', '2025-12-15', '2025-11-14'];
log('── Skylit replay depth (NVDA) ──');
for (const d of dates) {
  try { const p = await gex.getProfile('NVDA', { date: d }); log(`  ${d}: ${p ? `spot ${p.spot?.toFixed(2)} asof ${p.asofDate} replay=${p.replayMode} strikes ${p.strikes.length} exps ${p.expirations.length}` : 'NULL'}`); }
  catch (e) { log(`  ${d}: ERR ${e.message}`); if (e.message === 'AUTH') break; }
}
log('\n── UW OHLC depth (NVDA, limit 250) ──');
const oh = await flow.getDailyOHLC('NVDA', { limit: 250 }).catch((e) => { log('ohlc err ' + e.message); return []; });
if (oh.length) { const s = oh.map((d) => d.date).sort(); log(`  ${oh.length} bars, ${s[0]} → ${s[s.length - 1]}`); }
