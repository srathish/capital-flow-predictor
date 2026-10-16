#!/usr/bin/env node
// Amendment 4: UW earnings history for every ticker picked in .cache/lottery{,_mon} → .cache/lottery_earnings.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UW_API_KEY } from '../feeds/env.js';
const C = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache'), T = new Set();
for (const d of ['lottery', 'lottery_mon']) for (const f of fs.readdirSync(path.join(C, d))) for (const t of Object.keys(JSON.parse(fs.readFileSync(path.join(C, d, f), 'utf8')).picks)) T.add(t);
const out = {}; for (const t of T) { await new Promise((r) => setTimeout(r, 120)); const r = await fetch(`https://api.unusualwhales.com/api/earnings/${t}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null); if (!r?.ok) continue;
  out[t] = ((await r.json()).data ?? []).filter((x) => x.report_date && x.source !== 'estimation').map((x) => ({ d: x.report_date, when: x.report_time })); }
fs.writeFileSync(path.join(C, 'lottery_earnings.json'), JSON.stringify(out)); console.log('tickers', Object.keys(out).length, 'example', JSON.stringify(out.UNH?.slice(0, 6)));
