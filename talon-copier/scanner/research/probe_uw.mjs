// probe_uw.mjs — test whether our UW API key can hit a "terminal" endpoint.
import { loadEnvKeysFrom, resolveFromRoot } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const key = process.env.UNUSUAL_WHALES_API_KEY;
console.log('UW key present:', !!key, key ? `(len ${key.length})` : '');
const eps = [
  '/api/terminal', '/api/option-flow/terminal', '/api/flow/terminal', '/api/options-flow/terminal',
  '/api/flow-terminal', '/api/terminal/flow', '/api/option-flow-alerts/terminal', '/api/screener/terminal',
  '/api/terminal/query', '/api/terminal/search',
];
for (const e of eps) {
  try {
    const r = await fetch('https://api.unusualwhales.com' + e, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    const t = await r.text();
    console.log(`  ${e.padEnd(38)} → ${r.status}  ${t.slice(0, 90).replace(/\s+/g, ' ')}`);
  } catch (err) { console.log(`  ${e.padEnd(38)} → ERR ${err.message}`); }
}
