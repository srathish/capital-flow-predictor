#!/usr/bin/env node
// v5 collector (DESIGN_v5): SEC XBRL companyfacts → revenue / gross profit / cost of revenue facts with filed dates,
// compacted to .cache/edgar/facts/<T>.json. 6 workers behind a shared 8 req/s gate. 0 Skylit credits.
import fs from 'node:fs';
import path from 'node:path';
import { worldUniverse } from './collect.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), OUT = path.join(ROOT, '.cache', 'edgar', 'facts');
export const TAGS = { rev: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  gp: ['GrossProfit'], cost: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization'] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let next = 0; const gate = async () => { const now = Date.now(), t = Math.max(now, next); next = t + 125; if (t > now) await sleep(t - now); };
async function get(cik) { for (let k = 0; k < 5; k++) { await gate(); const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { 'User-Agent': 'research saieagle@gmail.com' } }).catch(() => null);
  if (r?.status === 404) return null; if (!r?.ok) { await sleep(2000 * (k + 1)); continue; } return r.json().catch(() => null); } return null; }
if (decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]) {
  fs.mkdirSync(OUT, { recursive: true }); const U = worldUniverse().filter(({ t }) => !fs.existsSync(path.join(OUT, `${t}.json`))); let done = 0, miss = 0;
  async function worker() { while (U.length) { const { t, cik } = U.shift(); const j = cik ? await get(String(cik).padStart(10, '0')) : null; const g = j?.facts?.['us-gaap'] ?? {}, o = {};
    for (const [k, tags] of Object.entries(TAGS)) for (const tag of tags) { const u = g[tag]?.units?.USD; if (u) (o[k] ??= {})[tag] = u.filter((x) => x.start && x.end).map((x) => ({ s: x.start, e: x.end, v: x.val, f: x.filed, form: x.form })); }
    if (!j) miss++; fs.writeFileSync(path.join(OUT, `${t}.json`), JSON.stringify(o)); if (++done % 100 === 0) console.error(`… ${done} (${miss} missing)`); } }
  await Promise.all(Array.from({ length: 6 }, worker)); console.error(`done ${done} · missing ${miss}`);
}
