// 1-min per-strike surface capture (RESEARCH ONLY — data collection, no trading logic).
// Skylit exposes no native velocity; it's derived from gamma change over time. The
// 5-min archive is too coarse for a clean per-node velocity/acceleration. This polls
// the 0DTE index surface every 60s during market hours and persists the near-spot
// per-strike gamma+vanna so we can compute velocity at 1-min resolution forward.
// Clause 0: touches nothing in the fire-loop; reuses shared auth; ~3 polls/min (same
// footprint as the live tracker).
import '../../scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../src/heatseeker/auth.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'data');
fs.mkdirSync(OUT, { recursive: true });
const TICKERS = ['SPXW', 'SPY', 'QQQ'];
const BAND = 0.03;                       // keep strikes within ±3% of spot (velocity study window)
const POLL_MS = 60_000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// market-hours guard (ET ≈ UTC-4 in summer): 13:30–20:00 UTC, Mon–Fri
function marketOpen() {
  const now = new Date();
  const wd = now.getUTCDay(); if (wd === 0 || wd === 6) return false;
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return mins >= 13 * 60 + 30 && mins <= 20 * 60;
}
async function snap(ticker, token) {
  const url = new URL('https://app.skylit.ai/api/data');
  url.searchParams.set('symbol', ticker); url.searchParams.set('max_strikes', '250');
  url.searchParams.set('max_expirations', '3'); url.searchParams.set('nocache', 'v' + Date.now());
  const r = await fetch(url.toString(), { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (r.status === 401 || r.status === 403) throw new Error('AUTH');   // surface auth errors for backoff
  if (!r.ok) return null;
  const raw = await r.json(); const spot = raw.CurrentSpot; if (spot == null) return null;
  const K = raw.Strikes || [], G = raw.GammaValues || [], V = raw.VannaValues || [];
  const strikes = [];
  for (let i = 0; i < K.length; i++) {
    const k = +K[i]; if (!Number.isFinite(k) || Math.abs(k - spot) / spot > BAND) continue;
    strikes.push({ k, g: (G[i]?.[0]) || 0, v: (V[i]?.[0]) || 0 });   // column 0 = nearest expiry (live King source)
  }
  return { ts: Date.now(), ticker, spot, strikes };
}

async function main() {
  if (!(await initAuth())) { console.error('auth failed'); process.exit(1); }
  console.log(`[velocity-capture] started; polling ${TICKERS.join('/')} every ${POLL_MS / 1000}s during market hours -> ${OUT}`);
  // DEFENSIVE (Athena's ops note): shared Clerk session — never hammer a flapping auth.
  // Back off exponentially on consecutive AUTH errors so the poller is a good citizen and
  // NOT the cause of auth flakiness for the fire-loop / bridge.
  let authFails = 0;
  for (;;) {
    if (marketOpen()) {
      let token; try { token = await getFreshToken(); } catch { token = null; }
      if (!token) { authFails++; }
      else {
        const day = new Date().toISOString().slice(0, 10);
        const file = path.join(OUT, `${day}.jsonl`);
        let authHit = false;
        for (const t of TICKERS) {
          try { const s = await snap(t, token); if (s) fs.appendFileSync(file, JSON.stringify(s) + '\n'); }
          catch (e) { if (String(e.message).includes('AUTH')) authHit = true; }
          await sleep(400);
        }
        authFails = authHit ? authFails + 1 : 0;
      }
    }
    // healthy → POLL_MS; on repeated auth trouble back off up to ~16 min so we don't add pressure
    const backoff = authFails > 0 ? Math.min(POLL_MS * 2 ** authFails, 16 * 60_000) : POLL_MS;
    if (authFails > 0) console.warn(`[velocity-capture] auth trouble x${authFails} — backing off ${Math.round(backoff / 1000)}s (yielding the shared session)`);
    await sleep(backoff);
  }
}
main();
