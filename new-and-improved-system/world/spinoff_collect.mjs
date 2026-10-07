#!/usr/bin/env node
// Engine E10: companies that filed a Form 10 (10-12B / 10-12G, spin-off or direct registration) 2013 → now, via EDGAR full-text
// search, mapped to today's tickers → .cache/edgar/spinoffs.json {ticker: {cik, firstForm10: date}}. ~1 request/second.
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache', 'edgar');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), UA = { 'User-Agent': 'research saieagle@gmail.com', Accept: 'application/json' };
const t2 = new Map(Object.values(JSON.parse(fs.readFileSync(path.join(C, 'company_tickers.json'), 'utf8'))).map((v) => [String(v.cik_str).padStart(10, '0'), v.ticker]));
const first = new Map();
for (let y = 2013; y <= 2026; y++) for (const forms of ['10-12B,10-12B/A', '10-12G,10-12G/A']) { let from = 0, total = 1;
  while (from < total && from < 10000) { await sleep(1000); const u = `https://efts.sec.gov/LATEST/search-index?q=%22common%20stock%22&forms=${forms}&dateRange=custom&startdt=${y}-01-01&enddt=${y}-12-31&from=${from}`;
    const j = await (await fetch(u, { headers: UA })).json().catch(() => null); if (!j?.hits) { await sleep(5000); continue; } total = j.hits.total?.value ?? 0;
    for (const h of j.hits.hits) for (const cik of h._source.ciks ?? []) { const d = h._source.file_date; if (!first.has(cik) || d < first.get(cik)) first.set(cik, d); }
    from += j.hits.hits.length || 100; }
  console.error(`${y} ${forms}: ${first.size} companies so far`); }
const out = {}; for (const [cik, d] of first) { const t = t2.get(cik); if (t) out[t] = { cik, firstForm10: d }; }
fs.writeFileSync(path.join(C, 'spinoffs.json'), JSON.stringify(out)); console.error(`mapped ${Object.keys(out).length} of ${first.size} Form 10 filers to current tickers`);
