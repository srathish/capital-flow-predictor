#!/usr/bin/env node
// Node-graph step 1: more numbers per company from SEC XBRL companyfacts (first domino + flow signals):
// capex, inventory, order backlog (RPO), R&D, operating income, deferred revenue — with filed dates (point-in-time).
// All SEC operating companies (universeV2 wide) → .cache/edgar/facts2/<T>.json. 6 workers, shared 8 req/s gate. 0 Skylit credits.
import fs from 'node:fs';
import path from 'node:path';
import { universeV2 } from './universe_prices.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), OUT = path.join(ROOT, '.cache', 'edgar', 'facts2');
export const TAGS2 = { capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'], inv: ['InventoryNet'],
  rpo: ['RevenueRemainingPerformanceObligation'], rnd: ['ResearchAndDevelopmentExpense', 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost'],
  opinc: ['OperatingIncomeLoss'], defrev: ['ContractWithCustomerLiabilityCurrent', 'DeferredRevenueCurrent'] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let next = 0; const gate = async () => { const now = Date.now(), t = Math.max(now, next); next = t + 125; if (t > now) await sleep(t - now); };
async function get(cik) { for (let k = 0; k < 5; k++) { await gate(); const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { 'User-Agent': 'research saieagle@gmail.com' } }).catch(() => null);
  if (r?.status === 404) return null; if (!r?.ok) { await sleep(2000 * (k + 1)); continue; } return r.json().catch(() => null); } return null; }
if (decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]) {
  fs.mkdirSync(OUT, { recursive: true });
  const hasRev = (t) => { const f = path.join(ROOT, '.cache', 'edgar', 'facts', `${t}.json`); return fs.existsSync(f) && fs.statSync(f).size > 2; };
  const U = universeV2(1e9).filter(({ t }) => hasRev(t) && !fs.existsSync(path.join(OUT, `${t}.json`))); let done = 0; console.error(`${U.length} companies`);
  async function worker() { while (U.length) { const { t, cik } = U.shift(); const j = await get(String(cik).padStart(10, '0')); const g = j?.facts?.['us-gaap'] ?? {}, o = {};
    for (const [k, tags] of Object.entries(TAGS2)) for (const tag of tags) { const u = g[tag]?.units?.USD; if (u) (o[k] ??= {})[tag] = u.map((x) => ({ s: x.start, e: x.end, v: x.val, f: x.filed, form: x.form })); }
    fs.writeFileSync(path.join(OUT, `${t}.json`), JSON.stringify(o)); if (++done % 500 === 0) console.error(`… ${done}`); } }
  await Promise.all(Array.from({ length: 6 }, worker)); console.error(`done ${done}`);
}
