// talon_probe2.mjs — probe Skylit Talon endpoints with the LIVE session.
// ONE getFreshToken() (single cookie rotation), reuse the JWT for every endpoint.
import '../../../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../../apps/gex/src/heatseeker/auth.js';

await initAuth();
const t = await getFreshToken();
console.log('token len:', t ? t.length : 0, '\n');
const H = { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: 'Bearer ' + t, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' };

const eps = [
  '/api/nexus/agent-scans?limit=10',
  '/api/nexus/agent-scans?agent=talon&limit=10',
  '/api/nexus/agent-setups?limit=20',
  '/api/nexus/agent-setups?status=active&limit=20',
  '/api/nexus/agent-setups?agent=talon&limit=20',
  '/api/nexus/agent-reports?limit=10',
  '/api/nexus/reports?limit=10',
  '/api/nexus/agent-commentary?limit=10',
  '/api/nexus/watchlists',
  '/api/nexus/agent-watchlists',
  '/api/nexus/agents',
  '/api/nexus/agent-runs?limit=10',
  '/api/watchlists',
  '/api/talon/setups',
  '/api/talon/scans',
  '/api/talon/watchlist',
  '/api/talon/report',
  '/api/talon/feed',
  '/api/talon/commentary',
];

function count(j) {
  if (j == null) return 'null';
  if (Array.isArray(j)) return `array[${j.length}]`;
  for (const k of ['data', 'results', 'setups', 'scans', 'items', 'reports', 'watchlists', 'agents']) {
    if (Array.isArray(j[k])) return `${k}[${j[k].length}]`;
  }
  return typeof j === 'object' ? `{${Object.keys(j).slice(0, 6).join(',')}}` : String(j).slice(0, 40);
}

for (const e of eps) {
  try {
    const r = await fetch('https://app.skylit.ai' + e, { headers: H, signal: AbortSignal.timeout(12000) });
    let j = null, raw = '';
    try { raw = await r.text(); j = JSON.parse(raw); } catch { /* non-json */ }
    console.log(`${String(r.status).padEnd(3)}  ${e.padEnd(48)}  ${count(j)}   ${raw.slice(0, 80).replace(/\s+/g, ' ')}`);
  } catch (err) { console.log(`ERR  ${e.padEnd(48)}  ${err.message}`); }
}
