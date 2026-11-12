// Cache UW greek-exposure/strike for SPY and QQQ, every trading day from the token's earliest date (2023-12-13) to 2026-10-16,
// plus UW daily regular-session OHLC and Cboe VIX history. No Skylit credits; UW calls only, ~130 ms apart.
//   node shadow/fetch_gex_strike.mjs
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';

const NIS = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..');
const GX = path.join(NIS, '.cache', 'uw', 'gex_strike'); fs.mkdirSync(GX, { recursive: true });
const H = { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function uw(p) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: H }).catch(() => null);
    if (r?.ok) return (await r.json()).data ?? [];
    if (r?.status === 404) return [];
    await sleep(r?.status === 429 ? 5000 : 1500);
  }
  throw new Error(`UW failed: ${p}`);
}
const FROM = '2023-12-13', TO = '2026-10-16';
// Daily OHLC (regular session rows only) → .cache/uw/daily_<SYM>.json {date: {o,h,l,c}}
const days = new Set();
for (const T of ['SPY', 'QQQ']) {
  const out = {};
  for (let end = TO; end > FROM;) {
    const rows = await uw(`/api/stock/${T}/ohlc/1d?end_date=${end}&limit=500`.replace('/api/api', '/api'));
    const reg = rows.filter((c) => c.market_time === 'r');
    if (!reg.length) break;
    for (const c of reg) out[c.date] = { o: +c.open, h: +c.high, l: +c.low, c: +c.close, v: +c.volume };
    const first = reg.map((c) => c.date).sort()[0];
    if (first <= FROM || first >= end) break;
    end = first;
  }
  fs.writeFileSync(path.join(NIS, '.cache', 'uw', `daily_${T}.json`), JSON.stringify(out));
  Object.keys(out).filter((d) => d >= FROM && d <= TO).forEach((d) => days.add(d));
  console.log(T, 'daily rows', Object.keys(out).length);
}
// VIX from Cboe
{ const t = await (await fetch('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv', { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
  const vix = {};
  for (const l of t.split('\n').slice(1)) { const [d, , , , c] = l.split(','); if (!d) continue; const [m, dd, y] = d.split('/'); vix[`${y}-${m}-${dd}`] = +c; }
  fs.writeFileSync(path.join(NIS, '.cache', 'vix_cboe.json'), JSON.stringify(vix)); console.log('VIX rows', Object.keys(vix).length); }
// Gamma by strike, one file per symbol-day; skip existing
let n = 0;
for (const d of [...days].sort()) {
  for (const T of ['SPY', 'QQQ']) {
    const f = path.join(GX, `${T}_${d}.json`);
    if (fs.existsSync(f)) continue;
    await sleep(130);
    const rows = await uw(`/stock/${T}/greek-exposure/strike?date=${d}`);
    fs.writeFileSync(f, JSON.stringify(rows.map((r) => ({ k: +r.strike, gex: +r.call_gex + +r.put_gex }))));
    if (++n % 100 === 0) console.log(n, d);
  }
}
console.log('fetched', n, 'symbol-days; total files', fs.readdirSync(GX).length);
