// talon_universe_probe.mjs — find the NEW Talon "covered universe" endpoint (AOI/OTE/structure archetypes).
import '../../../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../../apps/gex/src/heatseeker/auth.js';
await initAuth();
const token = await getFreshToken();
const H = { Authorization: `Bearer ${token}`, Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Accept: 'application/json' };
async function get(path) {
  try {
    const r = await fetch('https://app.skylit.ai' + path, { headers: H, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, j, t, len: t.length };
  } catch (e) { return { status: 'ERR', t: e.message, len: 0 }; }
}
// terminology from the new UI: covered universe, AOI, OTE, actionable, strict watch, magnet ladder
const paths = [
  '/api/nexus/agent-scans?limit=3',
  '/api/nexus/agent-setups?limit=8',
  '/api/nexus/agent-setups?status=actionable&limit=8',
  '/api/nexus/covered-universe',
  '/api/nexus/universe',
  '/api/nexus/universe-scan',
  '/api/nexus/covered-universe/latest',
  '/api/nexus/agent-universe?limit=8',
  '/api/nexus/agent-coverage?limit=8',
  '/api/nexus/coverage?limit=8',
  '/api/talon/covered-universe',
  '/api/talon/universe',
  '/api/talon/setups?limit=8',
  '/api/talon/coverage',
  '/api/nexus/agent-scans/latest',
  '/api/nexus/agent-reports?limit=3',
  '/api/nexus/snapshots?limit=3',
  '/api/nexus/agent-snapshot',
];
const hits = [];
for (const p of paths) {
  const { status, j, t, len } = await get(p);
  const tag = (status === 200 && len > 50) ? '  ✅' : '';
  console.log(`${String(status).padEnd(4)} ${String(len).padStart(7)}b  ${p}${tag}`);
  if (status === 200 && j && len > 50) hits.push({ p, j });
}
console.log('\n================ STRUCTURE OF HITS ================');
function shape(obj, depth = 0, maxd = 3) {
  if (depth > maxd) return '…';
  if (Array.isArray(obj)) return `ARRAY[${obj.length}]` + (obj[0] ? ' of ' + shape(obj[0], depth + 1, maxd) : '');
  if (obj && typeof obj === 'object') return '{ ' + Object.keys(obj).slice(0, 30).map((k) => `${k}: ${Array.isArray(obj[k]) ? 'ARR[' + obj[k].length + ']' : typeof obj[k]}`).join(', ') + ' }';
  return typeof obj;
}
for (const { p, j } of hits) {
  console.log(`\n--- ${p} ---`);
  console.log(shape(j));
  // drill into the first array of setups we can find + print one full sample
  const arrKey = Object.keys(j).find((k) => Array.isArray(j[k]) && j[k].length);
  const arr = Array.isArray(j) ? j : (arrKey ? j[arrKey] : null);
  if (arr && arr.length) {
    console.log(`  first element keys: ${Object.keys(arr[0]).join(', ')}`);
    console.log('  SAMPLE:', JSON.stringify(arr[0]).slice(0, 900));
  }
}
