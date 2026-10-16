#!/usr/bin/env node
// DESIGN_air_pocket.md amendment 1 collector: daily UW gamma by strike + 1-minute bars + daily OHLC for the 10 random
// Skylit stocks → .cache/uwgreeks/{T}.jsonl, {T}_ohlc.json, .cache/uw/m1/{T}/{d}.json (same formats as the ETF caches).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UW_API_KEY } from '../feeds/env.js';
const SH = path.dirname(fileURLToPath(import.meta.url)), C = path.join(SH, '..', '.cache'), PICKS = JSON.parse(fs.readFileSync(path.join(SH, 'data', 'air_pocket_stocks.json'), 'utf8')).picks;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let LIMIT = false, calls = 0;
async function uw(p) { for (let k = 0; k < 5 && !LIMIT; k++) { await sleep(110); calls++; const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null);
  if (r?.status === 429) { const b = await r.text().catch(() => ''); if (b.includes('daily_request_limit_hit')) { LIMIT = true; console.error('UW daily limit'); return null; } await sleep(4000 * (k + 1)); continue; } if (r?.status === 404 || r?.status === 422 || r?.status === 403) return { data: [] }; if (!r?.ok) { await sleep(1500); continue; } return r.json().catch(() => null); } return null; }
for (const T of PICKS) { const of = path.join(C, 'uwgreeks', `${T}_ohlc.json`);
  if (!fs.existsSync(of)) { const o = await uw(`/stock/${T}/ohlc/1d?timeframe=3Y`); fs.writeFileSync(of, JSON.stringify((o?.data ?? []).filter((b) => b.market_time === 'r').map((b) => ({ d: b.date, o: +b.open, h: +b.high, l: +b.low, c: +b.close, v: +b.volume })).sort((a, b) => a.d.localeCompare(b.d)))); }
  const bars = JSON.parse(fs.readFileSync(of, 'utf8')).filter((b) => b.d >= '2023-11-16' && b.d <= '2026-10-02'), gf = path.join(C, 'uwgreeks', `${T}.jsonl`), have = new Set(fs.existsSync(gf) ? fs.readFileSync(gf, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).d) : []);
  fs.mkdirSync(path.join(C, 'uw', 'm1', T), { recursive: true });
  for (const b of bars) { if (LIMIT) break; const d = b.d;
    if (!have.has(d)) { const g = await uw(`/stock/${T}/greek-exposure/strike?date=${d}`); if (!g) break; const s = (g.data ?? []).map((r) => [+r.strike, +r.call_gex, +r.put_gex, +r.call_delta, +r.put_delta, +r.call_charm, +r.put_charm, +r.call_vanna, +r.put_vanna]); if (s.length) fs.appendFileSync(gf, JSON.stringify({ d, s }) + '\n'); }
    const mf = path.join(C, 'uw', 'm1', T, `${d}.json`); if (!fs.existsSync(mf)) { const m = await uw(`/stock/${T}/ohlc/1m?date=${d}&limit=1000`); if (!m) break; fs.writeFileSync(mf, JSON.stringify((m.data ?? []).map((x) => ({ t: Math.floor(Date.parse(x.start_time) / 1000), o: +x.open, h: +x.high, l: +x.low, c: +x.close, v: +x.volume, m: x.market_time === 'r' ? 'r' : x.market_time })))); } }
  console.error(`${T} done (${calls} calls)`); if (LIMIT) break; }
console.error(`run done ${calls}${LIMIT ? ' (UW limit — re-run after 8pm ET)' : ''}`);
