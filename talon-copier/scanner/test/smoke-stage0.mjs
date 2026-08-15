// smoke-stage0.mjs — LIVE smoke test of Stage 0 (needs ENV_FILE=session-b.env).
// Validates: Skylit current+historical pull, per-expiry decomposition, aggregate,
// UW flow series, caching, manifest, weekend-snapping, staleness rule.
import path from 'node:path';
import { ingest, effectiveScanDate } from '../stage0-ingest.mjs';
import { GexProvider } from '../providers/gex-skylit.mjs';
import { loadConfig, readJson, resolveFromRoot } from '../lib/util.mjs';

const config = loadConfig();
const SUB = ['MU', 'NBIS', 'SNDK'];
const REQ = '2026-08-15'; // Saturday → should snap to Friday 2026-08-14

console.log('=== effectiveScanDate ===');
const eff = effectiveScanDate(REQ);
console.log(`  requested ${REQ} → effective ${eff} ${eff === '2026-08-14' ? '✓ (snapped to Fri)' : '✗'}`);

console.log('\n=== running Stage 0 ingest on', SUB.join(','), '===');
const { runDate, rawDir, manifest } = await ingest({ config, date: REQ, symbols: SUB, withFlow: true });
console.log('  manifest:', JSON.stringify({ runDate: manifest.runDate, ok: manifest.ok, dropped: manifest.dropped, failed: manifest.failed }));

console.log('\n=== cached MU record shape ===');
const mu = readJson(path.join(rawDir, 'MU.json'));
if (!mu) { console.log('  ✗ no MU cache'); process.exit(1); }
const p = mu.profile;
console.log(`  spot ${p.spot} · asof ${p.asof} (${p.asofDate}) · replayMode ${p.replayMode} · prevClose ${p.previousClose}`);
console.log(`  #strikes ${p.strikes.length} · #expirations ${p.expirations.length} · totalAbsGex ${(p.totalAbsGex / 1e6).toFixed(1)}M`);
console.log(`  expirations: ${p.expirations.join(', ')}`);
const top = [...p.strikes].sort((a, b) => Math.abs(b.gexAgg) - Math.abs(a.gexAgg)).slice(0, 6);
console.log('  top-6 aggregate GEX nodes (strike : signed GEX):');
for (const s of top) console.log(`    ${s.strike} : ${(s.gexAgg / 1e6).toFixed(2)}M ${s.gexAgg >= 0 ? '(+)' : '(–)'}  ${Math.abs(s.strike - p.spot) / p.spot * 100 <= 12 ? `[${((s.strike - p.spot) / p.spot * 100).toFixed(1)}%]` : ''}`);
const k = top[0];
console.log(`  per-expiry decomposition of top node ${k.strike}:`);
for (const [exp, g] of Object.entries(k.perExpiry).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6)) console.log(`    ${exp}: ${(g / 1e6).toFixed(2)}M`);

console.log('\n=== flow + liquidity ===');
console.log('  liquidity:', JSON.stringify(mu.liquidity));
console.log('  flow series len:', mu.flow?.series?.length, '· asOfDay date:', mu.flow?.asOfDay?.date);

console.log('\n=== historical persistence probe (MU node over prior 5 sessions) ===');
const gex = new GexProvider({ maxStrikes: config.ingest.max_strikes, maxExpirations: config.ingest.max_expirations, eodHHMM: config.ingest.skylit_eod_hhmm });
const hist = await gex.getHistory('MU', { asOfDate: runDate, sessions: 5 });
for (const h of hist) {
  const t3 = [...h.strikes].sort((a, b) => Math.abs(b.gexAgg) - Math.abs(a.gexAgg)).slice(0, 3).map((s) => `${s.strike}(${(s.gexAgg / 1e6).toFixed(1)}M)`).join(' ');
  console.log(`  ${h.date} spot ${h.spot.toFixed(1)} · top3: ${t3}`);
}
console.log('\n✓ smoke-stage0 complete');
