#!/usr/bin/env node
// IFRS collector for foreign private issuers (20-F / 40-F / 6-K filers): tickers in universeV2 whose US-GAAP facts are missing/empty
// but that have UW daily bars → SEC companyfacts facts['ifrs-full'] revenue / gross profit / cost of sales, every unit kept (USD, TWD, EUR…),
// → .cache/edgar/facts_ifrs/<T>.json {rev:{tag:[{s,e,v,f,form,unit}]},gp,cost,freq:{annual,sub}}. Resumable; shared ≤3 req/s gate (SEC fair-access shared across collectors). 0 Skylit credits.
import fs from 'node:fs';
import path from 'node:path';
import { universeV2 } from './universe_prices.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), E = path.join(ROOT, '.cache', 'edgar'), OUT = path.join(E, 'facts_ifrs');
export const TAGS = { rev: ['Revenue', 'RevenueFromContractsWithCustomers'], gp: ['GrossProfit'], cost: ['CostOfSales'] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let next = 0; const gate = async () => { const now = Date.now(), t = Math.max(now, next); next = t + 340; if (t > now) await sleep(t - now); };
async function get(cik) { for (let k = 0; k < 5; k++) { await gate(); const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { 'User-Agent': 'research saieagle@gmail.com' } }).catch(() => null);
  if (r?.status === 404) return null; if (!r?.ok) { await sleep((r?.status === 403 || r?.status === 429 ? 15000 : 2000) * (k + 1)); continue; } return r.json().catch(() => null); } return null; }
const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const days = (x) => (Date.parse(x.e) - Date.parse(x.s)) / 864e5;
export const loadIfrs = (t) => rd(path.join(OUT, `${t}.json`));
export function candidates() { return universeV2(1e9).filter(({ t }) => { const g = rd(path.join(E, 'facts', `${t}.json`)), w = rd(path.join(ROOT, '.cache', 'wdaily', `${t}.json`));
  return !(g?.rev && Object.keys(g.rev).length) && Array.isArray(w) && w.length > 0; }); }
if (decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]) {
  fs.mkdirSync(OUT, { recursive: true }); const C = candidates(), U = C.filter(({ t }) => !fs.existsSync(path.join(OUT, `${t}.json`))); let done = 0, miss = 0;
  console.error(`candidates ${C.length} · to fetch ${U.length}`);
  async function worker() { while (U.length) { const { t, cik } = U.shift(); const j = await get(cik); const g = j?.facts?.['ifrs-full'] ?? {}, o = {};
    for (const [k, tags] of Object.entries(TAGS)) for (const tag of tags) for (const [unit, arr] of Object.entries(g[tag]?.units ?? {})) {
      const rows = arr.filter((x) => x.start && x.end).map((x) => ({ s: x.start, e: x.end, v: x.val, f: x.filed, form: x.form, unit })); if (rows.length) ((o[k] ??= {})[tag] ??= []).push(...rows); }
    const rv = Object.values(o.rev ?? {}).flat(); if (rv.length) o.freq = { annual: rv.some((x) => days(x) > 300), sub: rv.some((x) => days(x) <= 190), forms: [...new Set(rv.map((x) => x.form))] };
    if (!j) miss++; fs.writeFileSync(path.join(OUT, `${t}.json`), JSON.stringify(o)); if (++done % 50 === 0) console.error(`… ${done} (${miss} missing)`); } }
  await Promise.all(Array.from({ length: 6 }, worker)); console.error(`done ${done} · missing ${miss}`);
}
