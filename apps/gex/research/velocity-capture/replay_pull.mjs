// Clean 7/15 replay: pull Skylit historical surface at 1-min, 09:30-16:00 ET,
// storing BOTH the 0DTE (nearest-expiry, column 0) and the AGGREGATE (sum across
// all expirations) gamma+vanna per strike. Lets us verify our data matches Skylit
// and check which view price actually respects for 0DTE. RESEARCH ONLY (Clause 0).
import '../../scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../src/heatseeker/auth.js';
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAY = process.argv[2] || '2026-07-15';
const TICKER = process.argv[3] || 'SPXW';
const BAND = 0.012;
await initAuth();

async function pull(tsIso) {
  const token = await getFreshToken();
  const url = new URL('https://app.skylit.ai/api/data');
  url.searchParams.set('symbol', TICKER);
  url.searchParams.set('max_strikes', '200');
  url.searchParams.set('max_expirations', '10');
  url.searchParams.set('nocache', Math.random().toString());
  url.searchParams.set('timestamp', tsIso);
  const r = await fetch(url.toString(), { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (r.status === 401 || r.status === 403) throw new Error('AUTH');
  if (!r.ok) return null;
  const raw = await r.json();
  if (!raw || raw.CurrentSpot == null) return null;
  const K = raw.Strikes || [], G = raw.GammaValues || [], V = raw.VannaValues || [];
  const spot = raw.CurrentSpot;
  const strikes = [];
  for (let i = 0; i < K.length; i++) {
    const k = +K[i];
    if (!Number.isFinite(k) || Math.abs(k - spot) / spot > BAND) continue;
    const gRow = G[i] || [], vRow = V[i] || [];
    const g0 = (gRow[0]) || 0, v0 = (vRow[0]) || 0;
    const gAgg = gRow.reduce((a, b) => a + (+b || 0), 0);
    const vAgg = vRow.reduce((a, b) => a + (+b || 0), 0);
    strikes.push({ strike: k, g0, v0, gAgg, vAgg });
  }
  return { spot, strikes, exp0: (raw.Expirations || [])[0] || null };
}

const stamps = [];
for (let m = 13 * 60 + 30; m <= 20 * 60; m++) stamps.push(`${DAY}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00.000Z`);

const out = [];
let ok = 0, miss = 0, consec = 0;
for (const ts of stamps) {
  try {
    const s = await pull(ts);
    if (s) { out.push({ ts, ...s }); ok++; consec = 0; }
    else { miss++; }
  } catch (e) { miss++; consec++; if (consec >= 15) { console.log('ABORT: 15 consecutive errors (auth?)'); break; } }
  await new Promise(r => setTimeout(r, 280));
}
const file = path.join(HERE, `replay_${DAY}_${TICKER}.jsonl.gz`);
const ws = zlib.gzipSync(out.map(o => JSON.stringify(o)).join('\n') + '\n');
fs.writeFileSync(file, ws);
console.log(`REPLAY DONE: ${ok} frames (${miss} miss) -> ${file}`);
// quick verification print at 3 timestamps
for (const tgtSpot of [out[0], out.find(o => Math.abs(o.spot - 7529) < 3), out[out.length - 1]].filter(Boolean)) {
  const et = `${(+tgtSpot.ts.slice(11, 13)) - 4}:${tgtSpot.ts.slice(14, 16)}`;
  const near = tgtSpot.strikes.filter(x => Math.abs(x.strike - tgtSpot.spot) / tgtSpot.spot < 0.004);
  console.log(`\n${et}ET spot ${tgtSpot.spot.toFixed(1)} exp0 ${tgtSpot.exp0}:`);
  for (const x of near) console.log(`  ${x.strike}: 0DTE ${(x.g0/1e6).toFixed(1)}M | agg ${(x.gAgg/1e6).toFixed(1)}M`);
}
