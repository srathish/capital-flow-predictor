#!/usr/bin/env node
// Engines E8/E9: net income and shares outstanding from SEC XBRL companyfacts (first-filed, with filed dates) for every company
// with revenue facts → .cache/edgar/facts3/<T>.json. ≤ 3 requests/second (other SEC collectors may run at the same time).
import fs from 'node:fs';
import path from 'node:path';
import { universeV2 } from './universe_prices.mjs';
const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), OUT = path.join(ROOT, '.cache', 'edgar', 'facts3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let next = 0; const gate = async () => { const now = Date.now(), t = Math.max(now, next); next = t + 340; if (t > now) await sleep(t - now); };
async function get(cik) { for (let k = 0; k < 5; k++) { await gate(); const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { 'User-Agent': 'research saieagle@gmail.com' } }).catch(() => null);
  if (r?.status === 404) return null; if (r?.status === 403 || r?.status === 429) { await sleep(15000 * (k + 1)); continue; } if (!r?.ok) { await sleep(2000 * (k + 1)); continue; } return r.json().catch(() => null); } return null; }
fs.mkdirSync(OUT, { recursive: true });
const hasRev = (t) => { const f = path.join(ROOT, '.cache', 'edgar', 'facts', `${t}.json`); return fs.existsSync(f) && fs.statSync(f).size > 2; };
const U = universeV2(1e9).filter(({ t }) => hasRev(t) && !fs.existsSync(path.join(OUT, `${t}.json`))); let done = 0; console.error(`${U.length} companies`);
for (const { t, cik } of U) { const j = await get(String(cik).padStart(10, '0')), g = j?.facts?.['us-gaap'] ?? {}, dei = j?.facts?.dei ?? {}, o = {};
  for (const tag of ['NetIncomeLoss', 'ProfitLoss']) { const u = g[tag]?.units?.USD; if (u) (o.ni ??= {})[tag] = u.filter((x) => x.start).map((x) => ({ s: x.start, e: x.end, v: x.val, f: x.filed, form: x.form })); }
  for (const [src, tag] of [[dei, 'EntityCommonStockSharesOutstanding'], [g, 'CommonStockSharesOutstanding']]) { const u = src[tag]?.units?.shares; if (u) (o.sh ??= {})[tag] = u.map((x) => ({ e: x.end, v: x.val, f: x.filed, form: x.form })); }
  fs.writeFileSync(path.join(OUT, `${t}.json`), JSON.stringify(o)); if (++done % 500 === 0) console.error(`… ${done}`); }
console.error(`done ${done}`);
