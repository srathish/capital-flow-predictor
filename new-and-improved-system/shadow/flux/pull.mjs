// Flux Field 1-minute history for SPY and QQQ, ~1 year, 30 trading days per call (1 credit each). Cached to .cache/flux/<T>.json
import fs from 'node:fs';
import { SKYLIT_API_KEY } from '../../feeds/env.js';
let spent = 0, remaining = null; const CAP = 40;
async function rest(host, path) { if (spent + 1 > CAP) throw new Error('credit cap ' + CAP); spent++;
  for (let a = 0; a < 4; a++) { const r = await fetch(`https://${host}.skylit.ai${path}`, { headers: { Authorization: `Bearer ${SKYLIT_API_KEY}` } }); remaining = r.headers.get('x-credits-remaining') ?? remaining;
    if (r.status === 429 || r.status >= 500) { await new Promise((x) => setTimeout(x, 2000 * (a + 1))); continue; } const j = await r.json().catch(() => null); if (!r.ok) throw new Error(r.status + ' ' + JSON.stringify(j?.error ?? j).slice(0, 160)); return j; } throw new Error('retries exhausted'); }
const OUT = new URL('../../.cache/flux/', import.meta.url); fs.mkdirSync(OUT, { recursive: true });
for (const T of ['SPY', 'QQQ']) {
  const all = new Map(); let date = '2026-11-05';
  for (let k = 0; k < 14; k++) {
    let j; try { j = await rest('api', `/v1/underlying/${T}/flux-field?interval=30D&resolution=1min&anchor=session&date=${date}`); } catch (e) { console.log(T, date, 'error', String(e).slice(0, 120)); break; }
    const pts = j?.data?.points ?? []; if (!pts.length) break;
    for (const p of pts) all.set(p.time, p);
    const first = Math.min(...pts.map((p) => p.time)); date = new Date((first < 1e12 ? first * 1000 : first) - 864e5).toISOString().slice(0, 10);
    console.log(T, 'call', k + 1, 'points', pts.length, 'oldest', new Date(first < 1e12 ? first * 1000 : first).toISOString().slice(0, 10));
  }
  fs.writeFileSync(new URL(`${T}.json`, OUT), JSON.stringify([...all.values()].sort((a, b) => a.time - b.time)));
}
console.log('credits spent this run', spent, '| remaining', remaining);
