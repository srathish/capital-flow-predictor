// dump_skylit_raw.mjs — what does Skylit's /api/data actually expose? (methodology clues vs pre-computed values)
import '../../../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../../apps/gex/src/heatseeker/auth.js';
await initAuth();
const t = await getFreshToken();
const u = new URL('https://app.skylit.ai/api/data');
u.searchParams.set('symbol', process.argv[2] || 'AMD');
u.searchParams.set('max_strikes', '6'); u.searchParams.set('max_expirations', '3'); u.searchParams.set('nocache', Math.random());
const r = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: 'Bearer ' + t, Accept: 'application/json' } });
const j = await r.json();
console.log('TOP-LEVEL KEYS:', Object.keys(j).join(', '), '\n');
for (const k of Object.keys(j)) {
  const v = j[k];
  const d = Array.isArray(v) ? `array[${v.length}]  e.g. ${JSON.stringify(v[0])}`.slice(0, 100) : JSON.stringify(v);
  console.log(`  ${k}: ${String(d).slice(0, 110)}`);
}
