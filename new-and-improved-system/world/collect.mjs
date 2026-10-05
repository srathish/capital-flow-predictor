#!/usr/bin/env node
// World-model data collectors (DESIGN §1–§2). All point-in-time, all free (UW quota / SEC EDGAR). 0 Skylit credits.
//   node world/collect.mjs fundamentals   UW earnings history + analyst actions per company → .cache/uw/earnings, .cache/uw/analyst
//   node world/collect.mjs meta           EDGAR submissions per company: SIC code + every 10-K/10-Q/8-K filing date → .cache/edgar/meta/<T>.json
//   node world/collect.mjs links          EDGAR full-text: which universe companies' filings NAME each of the 100 largest companies,
//                                         by year → .cache/edgar/links.json [{from, to, d, f, s}]
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';
import { universeV2 } from './universe_prices.mjs';
import { universeTickers } from './edgar_exposure.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function worldUniverse() { // v2 (1,000 largest) ∪ desk universe ∪ Discord tickers — each rule fixed before results
  const v2 = universeV2(), old = universeTickers(), out = new Map(v2.map((x) => [x.t, x]));
  const names = Object.fromEntries(Object.values(JSON.parse(fs.readFileSync(path.join(C, 'edgar', 'company_tickers.json'), 'utf8'))).map((v) => [v.ticker, v.title]));
  for (const [t, cik] of Object.entries(old)) if (!out.has(t)) out.set(t, { t, cik, name: names[t] ?? t });
  return [...out.values()];
}
async function uw(p) { for (let k = 0; k < 4; k++) { await sleep(260); const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
  if (r?.status === 429) { await sleep(5000 * (k + 1)); continue; } return r?.ok ? r.json().catch(() => null) : null; } return null; }
const UA = { 'User-Agent': 'research saieagle@gmail.com', Accept: 'application/json' };
async function sec(u) { for (let k = 0; k < 5; k++) { await sleep(220); const r = await fetch(u, { headers: UA }).catch(() => null); if (r?.status === 429 || r?.status === 503) { await sleep(3000 * (k + 1)); continue; } return r?.ok ? r.json().catch(() => null) : null; } return null; }
const save = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };

const mode = process.argv[2], U = mode ? worldUniverse() : [];
if (mode) console.error(`${mode}: ${U.length} companies`);
if (mode === 'fundamentals') {
  let n = 0; for (const { t } of U) {
    const fe = path.join(C, 'uw', 'earnings', `${t}.json`), fa = path.join(C, 'uw', 'analyst', `${t}.json`);
    if (!fs.existsSync(fe)) { const j = await uw(`/earnings/${t}`); if (j) save(fe, j.data ?? []); }
    if (!fs.existsSync(fa)) { const j = await uw(`/screener/analysts?ticker=${t}&limit=500`); if (j) save(fa, (j.data ?? []).map((r) => ({ ts: r.timestamp, action: r.action, target: r.target != null ? +r.target : null, firm: r.firm, rec: r.recommendation }))); }
    if (++n % 100 === 0) console.error(`… ${n}`); }
}
if (mode === 'insider') { // open-market purchases (Form 4 code P) for the whole world universe → .cache/uw/insiderP/<T>.json
  let n = 0; for (const { t } of U) { const f = path.join(C, 'uw', 'insiderP', `${t}.json`); if (fs.existsSync(f)) { n++; continue; }
    const out = []; for (let p = 0; p < 4; p++) { const j = await uw(`/insider/transactions?ticker_symbol=${t}&transaction_codes[]=P&limit=500&page=${p}`); const d = j?.data ?? []; out.push(...d.filter((r) => r.transaction_code === 'P').map((r) => ({ f: r.filing_date, d: r.transaction_date, who: r.owner_name, v: Math.abs(r.amount) * +r.price }))); if (d.length < 500) break; }
    save(f, out); if (++n % 100 === 0) console.error(`… ${n}`); }
}
if (mode === 'meta') {
  let n = 0; for (const { t, cik } of U) { const f = path.join(C, 'edgar', 'meta', `${t}.json`); if (fs.existsSync(f)) { n++; continue; }
    const j = await sec(`https://data.sec.gov/submissions/CIK${cik}.json`); if (!j) { n++; continue; }
    const R = j.filings?.recent ?? {}, filings = []; for (let i = 0; i < (R.form ?? []).length; i++) if (['10-K', '10-Q', '8-K', '20-F', '6-K', '40-F'].includes(R.form[i]) && R.filingDate[i] >= '2021-01-01') filings.push({ f: R.form[i], d: R.filingDate[i] });
    save(f, { sic: j.sic, sicDesc: j.sicDescription, name: j.name, filings }); if (++n % 100 === 0) console.error(`… ${n}`); }
}
if (mode === 'links') {
  const big = universeV2(100), ciks = U.map((x) => x.cik), byCik = Object.fromEntries(U.map((x) => [x.cik, x.t])), out = [];
  const clean = (s) => s.replace(/\b(INC|CORP|CORPORATION|LTD|PLC|HOLDINGS?|CO|COMPANY|N\.?V\.?|S\.?A\.?|AG|SE|GROUP|LIMITED|\/[A-Z]+\/?)\b\.?/gi, '').replace(/[,.]+$/g, '').replace(/\s+/g, ' ').trim();
  for (const b of big) { const q = clean(b.name); if (q.length < 4) continue;
    for (const y of [2022, 2023, 2024, 2025, 2026]) { const f = path.join(C, 'edgar', 'links', `${b.t}_${y}.json`); let rows = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
      if (!rows) { rows = []; for (let i = 0; i < ciks.length; i += 100) { const ch = ciks.slice(i, i + 100); let from = 0;
          for (;;) { const j = await sec(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${q}"`)}&dateRange=custom&startdt=${y}-01-01&enddt=${y}-12-31&forms=10-K,10-Q,8-K&ciks=${ch.join(',')}&from=${from}`);
            const hits = j?.hits?.hits ?? []; for (const h of hits) { const t = byCik[(h._source.ciks ?? [])[0]]; if (t && t !== b.t) rows.push({ from: t, to: b.t, d: h._source.file_date, f: h._source.form, s: +h._score.toFixed(2) }); }
            from += hits.length; if (!hits.length || from >= (j?.hits?.total?.value ?? 0) || from >= 9900) break; } }
        save(f, rows); }
      out.push(...rows); }
    console.error(`  ${b.t} ("${q}") · ${out.filter((r) => r.to === b.t).length} mentions`); }
  save(path.join(C, 'edgar', 'links.json'), out);
}
