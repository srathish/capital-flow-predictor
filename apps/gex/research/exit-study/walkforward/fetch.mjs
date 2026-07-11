// Walk-forward validator — DATA FETCH (research only).
// UW greek-exposure/strike goes back ~1yr (vs Skylit's 92d), spanning multiple
// regimes. Cache daily GEX/VEX-by-strike + daily OHLC so predict.mjs can run a
// true day-by-day out-of-sample walk-forward of the King-node logic.
import '../../../scripts/_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
fs.mkdirSync(CACHE, { recursive: true });
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TICKERS = (process.argv[2] || 'SPY,QQQ').split(',');

async function get(url) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch('https://api.unusualwhales.com' + url, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(20000) });
      if (r.status === 429) { await sleep(2000 * (a + 1)); continue; }
      if (!r.ok) return null;
      return (await r.json())?.data || (await r.json())?.result || null;
    } catch { await sleep(1000); }
  }
  return null;
}

for (const T of TICKERS) {
  // daily OHLC (regular-session rows)
  const ohlcRaw = await get(`/api/stock/${T}/ohlc/1d?timeframe=1Y`);
  const ohlc = {};
  for (const r of (ohlcRaw || [])) {
    if (r.market_time && r.market_time !== 'r') continue;       // regular session only
    ohlc[r.date] = { open: +r.open, high: +r.high, low: +r.low, close: +r.close };
  }
  const days = Object.keys(ohlc).sort();
  fs.writeFileSync(path.join(CACHE, `${T}_ohlc.json`), JSON.stringify(ohlc));
  console.log(`${T}: ${days.length} trading days ${days[0]}..${days.at(-1)}`);

  // per-day greek exposure by strike
  let n = 0, got = 0;
  for (const d of days) {
    const f = path.join(CACHE, `${T}_gex_${d}.json`);
    if (fs.existsSync(f)) { got++; n++; continue; }
    const rows = await get(`/api/stock/${T}/greek-exposure/strike?date=${d}`);
    if (rows) {
      // keep compact: strike, net_gex, net_vanna
      const compact = rows.map(r => ({ k: +r.strike, gex: (+r.call_gex) + (+r.put_gex), van: (+r.call_vanna) + (+r.put_vanna) })).filter(r => Number.isFinite(r.k));
      fs.writeFileSync(f, JSON.stringify(compact)); got++;
    } else fs.writeFileSync(f, '[]');
    await sleep(380);
    if (++n % 50 === 0) console.log(`  ${T} ${n}/${days.length} (withData ${got})`);
  }
  console.log(`${T} done: ${got}/${days.length} days with strike data`);
}
