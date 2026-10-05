#!/usr/bin/env node
// STEP 1 of the world model (DESIGN.md §1): company → concept exposure, point-in-time, from SEC EDGAR full-text search.
// For every concept in the fixed taxonomy (§7) and every calendar year 2022–2026: which universe companies' 10-K / 10-Q / 8-K filings
// mention it, with the FILING DATE and EDGAR's relevance score. Cached per concept-year in .cache/edgar/fts/. Free, ~5 req/s.
//   node world/edgar_exposure.mjs        → .cache/edgar/exposure.json  [{t (ticker), c (concept), d (file_date), f (form), s (score)}]
import fs from 'node:fs';
import path from 'node:path';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), ROOT = path.join(HERE, '..'), C = path.join(ROOT, '.cache', 'edgar');
export const CONCEPTS = [
  'GPU', 'accelerator', 'CPU', 'custom ASIC', 'DRAM', 'NAND', 'high bandwidth memory', 'flash storage', 'hard disk drive', 'advanced packaging', 'wafer', 'lithography', 'EUV',
  'etch', 'deposition', 'semiconductor test', 'foundry', 'analog semiconductor', 'power semiconductor', 'silicon carbide', 'gallium nitride',
  'data center', 'hyperscale', 'cloud computing', 'colocation', 'optical transceiver', 'fiber optic', 'Ethernet switch', 'InfiniBand', 'liquid cooling', 'server', 'rack',
  'electricity demand', 'power purchase agreement', 'natural gas turbine', 'nuclear power', 'small modular reactor', 'uranium', 'grid', 'transformer', 'battery storage', 'solar', 'wind',
  'oil', 'natural gas', 'LNG', 'refining', 'bitcoin mining', 'hashrate', 'digital assets', 'stablecoin', 'artificial intelligence', 'large language model', 'inference', 'AI agents',
  'cybersecurity', 'SaaS', 'subscription', 'smartphone', 'personal computer', 'automotive', 'electric vehicle', 'autonomous driving', 'GLP-1', 'obesity', 'biosimilar', 'vaccine',
  'medical device', 'defense', 'satellite', 'launch vehicle', 'drone', 'aerospace', 'tariff', 'rare earth', 'copper', 'lithium', 'steel', 'construction', 'interest rate', 'mortgage',
  'credit card', 'consumer spending', 'housing', 'restaurant', 'travel', 'advertising', 'e-commerce', 'freight', 'shipping',
];
export const CONSTRAINTS = ['supply constrained', 'supply constraints', 'shortage', 'lead times', 'sold out', 'allocation', 'capacity constrained', 'price increases', 'backlog', 'capacity expansion'];
const MODE = process.argv[2] === 'constraints' ? 'constraints' : 'concepts', TERMS = MODE === 'constraints' ? CONSTRAINTS : CONCEPTS;
const YEARS = [2022, 2023, 2024, 2025, 2026];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'research saieagle@gmail.com', Accept: 'application/json' };
export function universeTickers() {
  const uni = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'apps/gex/research/stock-gex/universe-structures.json'), 'utf8')).rows.map((r) => r.ticker);
  const extra = fs.readdirSync(path.join(ROOT, '.cache', 'daily')).map((f) => f.replace('.json', ''));
  const map = {}; for (const v of Object.values(JSON.parse(fs.readFileSync(path.join(C, 'company_tickers.json'), 'utf8')))) map[v.ticker] = String(v.cik_str).padStart(10, '0');
  const out = {}; for (const t of new Set([...uni, ...extra])) if (map[t]) out[t] = map[t]; return out; // ETFs have no CIK → dropped
}
async function fts(q, year, ciks, from) {
  const u = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${q}"`)}&dateRange=custom&startdt=${year}-01-01&enddt=${year}-12-31&forms=10-K,10-Q,8-K&ciks=${ciks.join(',')}&from=${from}`;
  for (let k = 0; k < 5; k++) { await sleep(220); const r = await fetch(u, { headers: UA }).catch(() => null);
    if (r?.status === 429 || r?.status === 503) { await sleep(3000 * (k + 1)); continue; } if (!r?.ok) return null; return r.json().catch(() => null); }
  return null;
}
export async function pull(terms, T, sub, outName) { // T = {ticker: cik}; cached per term-year under .cache/edgar/<sub>/
  const byCik = Object.fromEntries(Object.entries(T).map(([t, c]) => [c, t])), ciks = Object.values(T), out = [];
  for (const c of terms) for (const y of YEARS) {
    const f = path.join(C, sub, `${c.replace(/[^a-z0-9]+/gi, '_')}_${y}.json`);
    let rows = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    if (!rows) { rows = []; for (let i = 0; i < ciks.length; i += 100) { const ch = ciks.slice(i, i + 100); let from = 0;
        for (;;) { const j = await fts(c, y, ch, from); if (!j) break; const hits = j.hits?.hits ?? [];
          for (const h of hits) { const t = (h._source.ciks ?? []).map((x) => byCik[x]).find(Boolean); if (t) rows.push({ t, c, d: h._source.file_date, f: h._source.form, s: +h._score.toFixed(2) }); }
          from += hits.length; if (!hits.length || from >= (j.hits?.total?.value ?? 0) || from >= 9900) break; } }
      fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(rows)); }
    out.push(...rows); process.stderr.write(`\r${sub} ${c.padEnd(28)} ${y} · ${rows.length}   `);
  }
  fs.writeFileSync(path.join(C, outName), JSON.stringify(out)); return out;
}
if (decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]) {
  const T = universeTickers(), byCik = Object.fromEntries(Object.entries(T).map(([t, c]) => [c, t])), ciks = Object.values(T);
  console.error(`${MODE}: ${Object.keys(T).length} companies with CIKs · ${TERMS.length} terms · ${YEARS.length} years`);
  const out = [];
  for (const c of TERMS) for (const y of YEARS) {
    const f = path.join(C, 'fts', `${c.replace(/[^a-z0-9]+/gi, '_')}_${y}.json`);
    let rows = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    if (!rows) { rows = []; const chunks = []; for (let i = 0; i < ciks.length; i += 100) chunks.push(ciks.slice(i, i + 100));
      for (const ch of chunks) { let from = 0; for (;;) { const j = await fts(c, y, ch, from); if (!j) break; const hits = j.hits?.hits ?? [];
        for (const h of hits) { const s = h._source, cik = (s.ciks ?? [])[0]; const t = byCik[cik] ?? (s.ciks ?? []).map((x) => byCik[x]).find(Boolean); if (t) rows.push({ t, c, d: s.file_date, f: s.form, s: +h._score.toFixed(2) }); }
        from += hits.length; if (!hits.length || from >= (j.hits?.total?.value ?? 0) || from >= 9900) break; } }
      fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(rows)); }
    out.push(...rows);
    process.stderr.write(`\r${c.padEnd(28)} ${y} · ${rows.length} filings   `);
  }
  fs.writeFileSync(path.join(C, MODE === 'constraints' ? 'constraints.json' : 'exposure.json'), JSON.stringify(out));
  console.error(`\nexposure rows ${out.length}`);
}
