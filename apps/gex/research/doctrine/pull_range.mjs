// Bulk-pull SPXW 1-min surface (Skylit) + SPY volume & VIXY (UW) for a date range,
// for the frozen-checklist 2-month backtest. Skips days already pulled (resumable).
// Usage: ENV_FILE/ENV_FILE_PATH=session-b.env node pull_range.mjs 2026-06-01 2026-07-28
import '../../scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../src/heatseeker/auth.js';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const BAND = 0.012;
const START = process.argv[2] || '2026-06-01', END = process.argv[3] || '2026-07-28';
await initAuth();

// trading days (skip weekends; holidays return empty and are skipped)
const days = [];
for (let d = new Date(START + 'T12:00:00Z'); d <= new Date(END + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
  const dow = d.getUTCDay(); if (dow === 0 || dow === 6) continue;
  days.push(d.toISOString().slice(0, 10));
}
console.log(`range ${START}..${END}: ${days.length} weekdays`);

async function pullSpxw(day) {
  const file = path.join(DIR, `replay_${day}_SPXW.jsonl.gz`);
  if (fs.existsSync(file) && zlib.gunzipSync(fs.readFileSync(file)).toString().trim().split('\n').length >= 300) return 'have';
  const out = []; let miss = 0, consec = 0;
  for (let m = 13 * 60 + 30; m <= 20 * 60; m++) {
    const ts = `${day}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00.000Z`;
    try {
      const token = await getFreshToken();
      const u = new URL('https://app.skylit.ai/api/data');
      u.searchParams.set('symbol', 'SPXW'); u.searchParams.set('max_strikes', '200'); u.searchParams.set('max_expirations', '10'); u.searchParams.set('nocache', Math.random().toString()); u.searchParams.set('timestamp', ts);
      const r = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (r.status === 401 || r.status === 403) throw new Error('AUTH');
      if (!r.ok) { miss++; consec = 0; continue; }
      const raw = await r.json();
      if (!raw || raw.CurrentSpot == null) { miss++; consec = 0; continue; }
      const K = raw.Strikes || [], G = raw.GammaValues || [], V = raw.VannaValues || [], spot = raw.CurrentSpot, strikes = [];
      for (let i = 0; i < K.length; i++) { const k = +K[i]; if (!Number.isFinite(k) || Math.abs(k - spot) / spot > BAND) continue; const gR = G[i] || [], vR = V[i] || []; strikes.push({ strike: k, g0: gR[0] || 0, v0: vR[0] || 0, gAgg: gR.reduce((a, b) => a + (+b || 0), 0), vAgg: vR.reduce((a, b) => a + (+b || 0), 0) }); }
      out.push({ ts, spot, strikes }); consec = 0;
    } catch (e) { miss++; consec++; if (consec >= 15) return 'ABORT'; }
    await new Promise(r => setTimeout(r, 200));
  }
  if (out.length < 300) return `thin(${out.length})`;
  fs.writeFileSync(file, zlib.gzipSync(out.map(o => JSON.stringify(o)).join('\n') + '\n'));
  return `ok(${out.length})`;
}

async function pullAux(day) {
  const file = path.join(DIR, `aux_${day}.json`);
  if (fs.existsSync(file)) return;
  const etOf = t => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5);
  const ohlc = async (tk) => { const r = await fetch(`https://api.unusualwhales.com/api/stock/${tk}/ohlc/1m?date=${day}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(20000) }).catch(() => null); if (!r || !r.ok) return []; return ((await r.json())?.data || []).map(x => ({ et: etOf(x.start_time), c: +x.close, v: +(x.volume || x.total_volume || 0) })).filter(p => p.et >= '09:30' && p.et <= '16:00').sort((a, b) => a.et.localeCompare(b.et)); };
  const spy = await ohlc('SPY'); await new Promise(r => setTimeout(r, 250)); const vixy = await ohlc('VIXY');
  fs.writeFileSync(file, JSON.stringify({ spy, vixy }));
}

let done = 0;
for (const day of days) {
  const s = await pullSpxw(day);
  if (s === 'ABORT') { console.log(`${day}: ABORT (auth) — stop; re-auth session B and re-run to resume`); break; }
  await pullAux(day);
  console.log(`${day}: ${s}`); done++;
}
console.log(`DONE: ${done}/${days.length} days processed`);
