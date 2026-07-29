// Pull today's 1-MINUTE GEX for SPX + SPY + QQQ → cache (so the minute-granularity backtest re-runs fast).
// Resumable: skips a symbol already cached with ≥300 frames. Usage: node pull_today.mjs [YYYY-MM-DD]
import '../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../apps/gex/src/heatseeker/auth.js';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DAY = process.argv[2] || '2026-07-29', BAND = 0.012, DIR = path.join(process.cwd(), 'falcon-copier');
await initAuth();
async function pull(sym) {
  const file = path.join(DIR, `today_${sym}.jsonl.gz`);
  if (fs.existsSync(file) && zlib.gunzipSync(fs.readFileSync(file)).toString().trim().split('\n').length >= 300) return `${sym}: have`;
  const out = []; let consec = 0;
  for (let m = 13 * 60 + 30; m <= 20 * 60; m++) {                          // 09:30–16:00 ET (UTC 13:30–20:00)
    const ts = `${DAY}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00.000Z`;
    try {
      const token = await getFreshToken(); const u = new URL('https://app.skylit.ai/api/data');
      u.searchParams.set('symbol', sym); u.searchParams.set('max_strikes', '200'); u.searchParams.set('max_expirations', '10'); u.searchParams.set('nocache', Math.random()); u.searchParams.set('timestamp', ts);
      const r = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (r.status === 401 || r.status === 403) throw new Error('AUTH');
      if (!r.ok) { consec = 0; continue; }
      const raw = await r.json(); if (!raw || raw.CurrentSpot == null) { consec = 0; continue; }
      const spot = raw.CurrentSpot, K = raw.Strikes || [], G = raw.GammaValues || [], V = raw.VannaValues || [], strikes = [];
      for (let i = 0; i < K.length; i++) { const k = +K[i]; if (!Number.isFinite(k) || Math.abs(k - spot) / spot > BAND) continue; strikes.push({ k, g0: (G[i] || [])[0] || 0, v0: (V[i] || [])[0] || 0 }); }
      out.push({ ts, spot, prevClose: raw.PreviousClose, strikes }); consec = 0;
    } catch (e) { consec++; if (consec >= 15) return `${sym}: ABORT (auth) @${out.length}`; }
    await new Promise(r => setTimeout(r, 150));
  }
  if (out.length < 300) return `${sym}: thin(${out.length})`;
  fs.writeFileSync(file, zlib.gzipSync(out.map(o => JSON.stringify(o)).join('\n') + '\n'));
  return `${sym}: ok(${out.length})`;
}
for (const sym of ['SPXW', 'SPY', 'QQQ']) console.log(await pull(sym));
console.log('DONE');
