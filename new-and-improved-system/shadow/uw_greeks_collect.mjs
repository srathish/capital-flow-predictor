#!/usr/bin/env node
// Idea factory collector (shadow/DESIGN_idea_factory.md): UW daily OHLC (regular session) + greek exposure by strike for
// every trading day 2023-11-08 → last close, 25 tickers. Resumable; stops cleanly at the UW daily request limit.
//   node shadow/uw_greeks_collect.mjs          → .cache/uwgreeks/{T}.jsonl + {T}_ohlc.json, .cache/vix_cboe.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UW_API_KEY } from '../feeds/env.js';

const NIS = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(NIS, '.cache', 'uwgreeks'); fs.mkdirSync(C, { recursive: true });
export const TICKERS = ['SPY', 'QQQ', 'IWM', 'DIA', 'SMH', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLI', 'XLP', 'XLU', 'GLD', 'TLT', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA', 'AMD', 'AVGO', 'JPM'];
const START = '2023-11-08';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (s) => console.error(`${new Date().toISOString().slice(11, 19)} ${s}`);
let LIMIT = false;
async function uw(p) { for (let k = 0; k < 6 && !LIMIT; k++) { const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
  if (r?.status === 429) { const b = await r.text().catch(() => ''); if (b.includes('daily_request_limit_hit')) { LIMIT = true; log('UW daily limit hit — stopping (resume after 8pm ET)'); return null; } await sleep(5000 * (k + 1)); continue; }
  if (r?.status === 403 || r?.status === 422) return { data: [] };
  if (!r?.ok) { await sleep(1500 * (k + 1)); continue; } return r.json().catch(() => null); } return null; }

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // VIX (Cboe, same values as FRED)
  { const t = await (await fetch('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv', { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
    const v = {}; for (const l of t.split('\n').slice(1)) { const [d, , , , c] = l.split(','); if (!d || !c) continue; const [m, dd, y] = d.split('/'); v[`${y}-${m}-${dd}`] = +c; }
    fs.writeFileSync(path.join(NIS, '.cache', 'vix_cboe.json'), JSON.stringify(v)); log(`VIX ${Object.keys(v).length} days`); }
  const jobs = [];
  for (const T of TICKERS) {
    const o = await uw(`/stock/${T}/ohlc/1d?timeframe=3Y`); if (LIMIT) break;
    const bars = (o?.data ?? []).filter((r) => r.market_time === 'r').map((r) => ({ d: r.date, o: +r.open, h: +r.high, l: +r.low, c: +r.close, v: +r.volume })).sort((a, b) => a.d.localeCompare(b.d));
    fs.writeFileSync(path.join(C, `${T}_ohlc.json`), JSON.stringify(bars));
    const f = path.join(C, `${T}.jsonl`), have = new Set(fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).d) : []);
    for (const b of bars) if (b.d >= START && !have.has(b.d)) jobs.push({ T, d: b.d, c: b.c, f });
  }
  log(`${jobs.length} greek days to fetch`);
  let done = 0, empty = 0, q = 0;
  const worker = async () => { while (!LIMIT && q < jobs.length) { const J = jobs[q++]; await sleep(150);
    const j = await uw(`/stock/${J.T}/greek-exposure/strike?date=${J.d}`); if (!j) { if (!LIMIT) log(`failed ${J.T} ${J.d}`); continue; }
    const s = (j.data ?? []).map((r) => [+r.strike, +r.call_gex, +r.put_gex, +r.call_delta, +r.put_delta, +r.call_charm, +r.put_charm, +r.call_vanna, +r.put_vanna])
      .filter((x) => x.every(Number.isFinite) && Math.abs(x[0] / J.c - 1) <= 0.3).sort((a, b) => a[0] - b[0]);
    if (!s.length) empty++;
    fs.appendFileSync(J.f, JSON.stringify({ d: J.d, s }) + '\n'); if (++done % 500 === 0) log(`${done}/${jobs.length} (${empty} empty)`); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  log(`done ${done} (${empty} empty)${LIMIT ? ' — stopped at daily limit, re-run after reset' : ''}`);
  if (!LIMIT) fs.writeFileSync(path.join(C, 'DONE'), new Date().toISOString());
}
