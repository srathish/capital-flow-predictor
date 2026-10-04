#!/usr/bin/env node
// Minute-bar prefetch in 10-session chunks (Atlas = 1 credit per CALL, any range) → split into the per-day cache
// (.cache/bars/<date>/<SYM>.json) that cache.minuteBars reads.  node shadow/prefetch_minutes.mjs --from D --to D SYM...
import fs from 'node:fs';
import path from 'node:path';
import { atlasHistory, account } from '../feeds/skylit.js';
import { etToUnix } from '../lib/time.js';
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i > -1 ? argv.splice(i, 2)[1] : d; };
const FROM = opt('from', '2026-01-02'), TO = opt('to', '2026-10-02'), SYMS = argv;
const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), ROOT = path.join(HERE, '..', '.cache', 'bars');
const ymdET = (t) => new Date((t - 4 * 3600) * 1000).toISOString().slice(0, 10); // RTH bars → ET date (EDT/EST both safe for 09:30–16:00)
const days = JSON.parse(fs.readFileSync(path.join(HERE, '..', '.cache', 'daily', 'SPY.json'), 'utf8')).map((b) => new Date((b.t + 12 * 3600) * 1000).toISOString().slice(0, 10)).filter((d) => d >= FROM && d <= TO);
const a0 = await account();
for (const s of SYMS) {
  const need = days.filter((d) => !fs.existsSync(path.join(ROOT, d, `${s}.json`)));
  for (let i = 0; i < need.length; i += 10) {
    const ch = need.slice(i, i + 10);
    let bars; try { bars = await atlasHistory(s, '1', etToUnix(ch[0], '09:30'), etToUnix(ch.at(-1), '16:00')); } catch (e) { console.error('fail', s, ch[0], e.message.slice(0, 100)); continue; }
    const by = new Map(); for (const b of bars) { const d = ymdET(b.t); (by.get(d) ?? by.set(d, []).get(d)).push(b); }
    for (const d of ch) { if (!by.has(d)) continue; fs.mkdirSync(path.join(ROOT, d), { recursive: true }); fs.writeFileSync(path.join(ROOT, d, `${s}.json`), JSON.stringify(by.get(d))); }
  }
}
const a1 = await account(); console.log(`credits used ${a0.creditsBalance - a1.creditsBalance} · left ${a1.creditsBalance}`);
