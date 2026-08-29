// probe_uw_greeks.mjs — map UW's greek-exposure REST surface (fields + per-expiry availability),
// the raw material for replicating Skylit's GEX/VEX.
import { loadEnvKeysFrom, resolveFromRoot, fetchJson } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const KEY = process.env.UNUSUAL_WHALES_API_KEY;
const BASE = 'https://api.unusualwhales.com/api/';
const T = (process.argv[2] || 'SPY').toUpperCase();
const uw = (p) => fetchJson(BASE + p, { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' }, timeoutMs: 15000, retries: 1 }).catch((e) => ({ ERR: e.message }));
const rows = (j) => (Array.isArray(j) ? j : (j && (j.data || j.result)) || []);

for (const p of [
  `stock/${T}/greek-exposure`,
  `stock/${T}/greek-exposure/strike`,
  `stock/${T}/greek-exposure/expiry`,
  `stock/${T}/greek-exposure/strike-expiry`,
  `stock/${T}/spot-exposures`,
  `stock/${T}/spot-exposures/strike`,
  `stock/${T}/spot-exposures/expiry-strike`,
]) {
  const j = await uw(p);
  const r = rows(j);
  const sample = Array.isArray(r) ? r[0] : r;
  console.log(`\n== ${p} ==  ${Array.isArray(r) ? `array[${r.length}]` : (j && j.ERR) || typeof j}`);
  if (sample && typeof sample === 'object') console.log('  keys:', Object.keys(sample).join(', '));
  if (sample && typeof sample === 'object') console.log('  row0:', JSON.stringify(sample).slice(0, 220));
}
