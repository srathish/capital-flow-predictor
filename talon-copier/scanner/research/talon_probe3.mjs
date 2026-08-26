// talon_probe3.mjs — probe the REAL Talon/screener endpoints found in the app JS (single token grab).
import '../../../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../../apps/gex/src/heatseeker/auth.js';
await initAuth();
const t = await getFreshToken();
console.log('token len:', t ? t.length : 0, '\n');
const H = { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: 'Bearer ' + t, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' };
const eps = [
  '/api/screener/weekly',
  '/api/screener/weekly?limit=10',
  '/api/v1/talon/followups',
  '/api/v1/talon/setups',
  '/api/v1/talon/scans',
  '/api/v1/talon/watchlist',
  '/api/v1/talon/report',
  '/api/v1/talon/reports',
  '/api/v1/talon/weekly',
  '/api/nexus/agent-scans/',
  '/api/nexus/agent-scans/?limit=10',
  '/api/nexus/feed?limit=10',
  '/api/nexus/ideas?limit=10',
];
function summarize(j) {
  if (j == null) return 'null';
  if (Array.isArray(j)) return `array[${j.length}]`;
  for (const k of ['data', 'results', 'setups', 'scans', 'items', 'reports', 'followups', 'ideas', 'stocks', 'tickers']) if (Array.isArray(j[k])) return `${k}[${j[k].length}]`;
  return typeof j === 'object' ? `{${Object.keys(j).slice(0, 8).join(',')}}` : String(j).slice(0, 50);
}
for (const e of eps) {
  try {
    const r = await fetch('https://app.skylit.ai' + e, { headers: H, signal: AbortSignal.timeout(12000) });
    let j = null, raw = '';
    try { raw = await r.text(); j = JSON.parse(raw); } catch { /* */ }
    console.log(`${String(r.status).padEnd(3)}  ${e.padEnd(40)}  ${summarize(j)}   ${raw.slice(0, 100).replace(/\s+/g, ' ')}`);
  } catch (err) { console.log(`ERR  ${e.padEnd(40)}  ${err.message}`); }
}
