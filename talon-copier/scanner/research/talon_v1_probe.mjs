// talon_v1_probe.mjs — the new Talon lives under /api/v1/talon/. Find the covered-universe data endpoint.
import '../../../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../../apps/gex/src/heatseeker/auth.js';
await initAuth();
const token = await getFreshToken();
const H = { Authorization: `Bearer ${token}`, Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Accept: 'application/json' };
async function get(path) {
  try {
    const r = await fetch('https://app.skylit.ai' + path, { headers: H, signal: AbortSignal.timeout(25000) });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, j, t, len: t.length };
  } catch (e) { return { status: 'ERR', t: String(e.message), len: 0 }; }
}
const paths = [
  '/api/v1/talon/preferences',
  '/api/v1/talon/universe',
  '/api/v1/talon/covered-universe',
  '/api/v1/talon/coverage',
  '/api/v1/talon/setups',
  '/api/v1/talon/setups?limit=8',
  '/api/v1/talon/scan',
  '/api/v1/talon/scan/latest',
  '/api/v1/talon/snapshot',
  '/api/v1/talon/snapshot/latest',
  '/api/v1/talon/report',
  '/api/v1/talon/results',
  '/api/v1/talon/watchlist',
  '/api/v1/talon/rows',
  '/api/v1/talon/candidates',
  '/api/v1/talon',
  '/api/v1/talon/',
];
const hits = [];
for (const p of paths) {
  const { status, j, t, len } = await get(p);
  const tag = status === 200 && len > 120 ? '  ✅ DATA' : (status === 200 ? '  (stub)' : '');
  console.log(`${String(status).padEnd(4)} ${String(len).padStart(8)}b  ${p}${tag}`);
  if (status === 200 && len > 120) hits.push({ p, j, t });
}
const shape = (o, d = 0) => {
  if (d > 4) return '…';
  if (Array.isArray(o)) return `ARRAY[${o.length}]` + (o[0] != null ? ' of ' + shape(o[0], d + 1) : '');
  if (o && typeof o === 'object') return '{ ' + Object.keys(o).slice(0, 40).map((k) => `${k}:${Array.isArray(o[k]) ? 'ARR[' + o[k].length + ']' : (o[k] && typeof o[k] === 'object' ? 'obj' : typeof o[k])}`).join(', ') + ' }';
  return typeof o;
};
console.log('\n================ HIT STRUCTURES ================');
for (const { p, j, t } of hits) {
  console.log(`\n--- ${p} ---`);
  if (!j) { console.log('  (non-JSON) ', t.slice(0, 200)); continue; }
  console.log('  shape:', shape(j));
  const arrKey = Object.keys(j).find((k) => Array.isArray(j[k]) && j[k].length);
  const arr = Array.isArray(j) ? j : (arrKey ? j[arrKey] : null);
  if (arr && arr.length) {
    console.log(`  [${arrKey || 'root'}] first-elem keys: ${Object.keys(arr[0]).join(', ')}`);
    console.log('  SAMPLE(0):', JSON.stringify(arr[0]).slice(0, 1400));
  }
}
