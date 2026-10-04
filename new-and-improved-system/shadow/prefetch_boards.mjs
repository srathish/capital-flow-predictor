#!/usr/bin/env node
// Batched historical map prefetch: 10 symbols per /v1/historical call (5 credits per call, not per symbol), written into the
// per-symbol cache that stock2.mjs / aplus_walk.mjs / features.board read. Weekly expiry = stock2's weeklyExpiry (SPY calendar).
//   node shadow/prefetch_boards.mjs --from 2026-01-02 --to 2026-10-02 --metrics gamma,vanna SYM1 SYM2 ...
import fs from 'node:fs';
import path from 'node:path';
import { heatmapAt, account } from '../feeds/skylit.js';
import { etToUnix, iso } from '../lib/time.js';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i > -1 ? argv.splice(i, 2)[1] : d; };
const FROM = opt('from', '2026-01-02'), TO = opt('to', '2026-10-02'), METRICS = opt('metrics', 'gamma,vanna').split(',');
const SYMS = argv;
const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), CACHE = path.join(HERE, '..', '.cache', 'stock');
const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10);
const days = JSON.parse(fs.readFileSync(path.join(HERE, '..', '.cache', 'daily', 'SPY.json'), 'utf8')).map((b) => ymd(b.t));
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const isTD = (d) => days.includes(d) || d > days[days.length - 1];
const weeklyExpiry = (d) => { let f = addDays(d, (5 - dow(d) + 7) % 7); if (dow(d) >= 4) f = addDays(f, 7); while (!isTD(f) && dow(f) >= 1) f = addDays(f, -1); return f; };
const file = (s, d, exp, m) => path.join(CACHE, s, m === 'gamma' ? `${d}_${exp}.json` : `${d}_${exp}_${m}.json`);

const a0 = await account(); let calls = 0;
for (const D of days.filter((d) => d >= FROM && d <= TO)) {
  const exp = weeklyExpiry(D);
  for (const m of METRICS) {
    const need = SYMS.filter((s) => !fs.existsSync(file(s, D, exp, m)));
    for (let i = 0; i < need.length; i += 10) {
      const batch = need.slice(i, i + 10);
      let arr = null;
      try { arr = await heatmapAt(batch, iso(etToUnix(D, '09:35')), { metric: m, expirations: exp }); } catch (e) { console.error('fail', D, m, batch.join(','), e.message.slice(0, 120)); continue; }
      calls++;
      const by = new Map((arr ?? []).map((x) => [x.symbol, x]));
      for (const s of batch) { fs.mkdirSync(path.join(CACHE, s), { recursive: true }); fs.writeFileSync(file(s, D, exp, m), JSON.stringify(by.get(s) ?? null)); }
      if (calls === 1) { const a1 = await account(); const used = a0.creditsBalance - a1.creditsBalance; console.log(`first batch (${batch.length} symbols) cost ${used} credits`); if (used > 6) { console.error('ABORT: batch costs more than 5 credits'); process.exit(1); } }
    }
  }
}
const a2 = await account(); console.log(`calls ${calls} · credits used ${a0.creditsBalance - a2.creditsBalance} · left ${a2.creditsBalance}`);
