#!/usr/bin/env node
// Historical companion to edgar_exposure.mjs: concept → company exposure for 2014-01-01 → 2021-12-31 over the WIDE universe
// (every ticker in universeV2(1e9) with a non-empty .cache/wdaily/<T>.json, CIKs from company_tickers.json; ~4,480 companies).
// Same 90 CONCEPTS (imported; edgar_exposure.mjs only runs its main when executed directly).
//
// QUERY PLAN
//   unit of work = concept × year × CIK-batch (100 CIKs — EFTS 500s above ~100) → 90 × 8 × 45 = 32,400 base queries.
//   Each unit: EFTS full-text search, exact phrase, startdt/enddt = that calendar year, forms=10-K,10-Q, paginate from=0,100,…
//   until all hits are read (hits are score-sorted, so the first filing date per company needs every hit; ≤9,900 cap never hit at
//   100 CIKs × ~4 filings/yr). Each unit is reduced to ONE row per ticker: d = earliest file_date that year, f = that filing's form,
//   s = max relevance score across its hits. Cached per unit in .cache/edgar/fts_hist/<concept>_<year>_<batch>.json → resumable.
//   ESTIMATE (sampled 18 concept/batch pairs, 2018): with 8-K ≈1.94 pages/unit → ~63k requests; 10-K+10-Q ≈1.39 → ~45k.
//   SEC fair-access is shared with other collectors on this machine → capped at 3 req/s (shared gate), so 8-K was DROPPED
//   (63k @3/s ≈ 5.8 h > 4 h budget); 10-K+10-Q only ≈ 4.2 h. NOTE: exposure.json (2022–26) includes 8-K; this file does not.
//   Retries: 5 tries, backoff 3s·k on 5xx, 20s·k on 403/429. A unit that still fails is not cached (re-run picks it up).
//   node world/edgar_exposure_hist.mjs   → .cache/edgar/exposure_hist.json  [{t, c, d, f, s}] (one row per ticker-concept-year)
import fs from 'node:fs';
import path from 'node:path';
import { CONCEPTS } from './edgar_exposure.mjs';
import { universeV2 } from './universe_prices.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache', 'edgar'), DIR = path.join(C, 'fts_hist');
const YEARS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021], FORMS = '10-K,10-Q', RPS = 3, WORKERS = 4, BATCH = 100;
const UA = { 'User-Agent': 'research saieagle@gmail.com', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let next = 0, nReq = 0; // shared gate: request slots spaced 1000/RPS ms apart across all workers
const gate = async () => { const now = Date.now(), at = Math.max(now, next); next = at + 1000 / RPS; if (at > now) await sleep(at - now); nReq++; };

async function fts(q, year, ciks, from) {
  const u = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${q}"`)}&dateRange=custom&startdt=${year}-01-01&enddt=${year}-12-31&forms=${FORMS}&ciks=${ciks.join(',')}&from=${from}`;
  for (let k = 1; k <= 5; k++) { await gate(); const r = await fetch(u, { headers: UA }).catch(() => null);
    if (r?.ok) { const j = await r.json().catch(() => null); if (j) return j; }
    await sleep(r && (r.status === 403 || r.status === 429) ? 20000 * k : 3000 * k); }
  return null;
}
async function unit(c, y, b, ch, byCik) { // → rows or null (failed)
  const best = {}; let from = 0;
  for (;;) { const j = await fts(c, y, ch, from); if (!j) return null; const hits = j.hits?.hits ?? [];
    for (const h of hits) { const s = h._source, t = (s.ciks ?? []).map((x) => byCik[x]).find(Boolean); if (!t) continue;
      const sc = +h._score.toFixed(2), o = best[t];
      if (!o) best[t] = { t, c, d: s.file_date, f: s.form, s: sc };
      else { if (s.file_date < o.d) { o.d = s.file_date; o.f = s.form; } if (sc > o.s) o.s = sc; } }
    from += hits.length; if (!hits.length || from >= (j.hits?.total?.value ?? 0) || from >= 9900) break; }
  return Object.values(best);
}
if (decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]) {
  const U = universeV2(1e9).filter(({ t }) => { const f = path.join(ROOT, '.cache', 'wdaily', `${t}.json`); return fs.existsSync(f) && fs.statSync(f).size > 2; });
  const byCik = Object.fromEntries(U.map((u) => [u.cik, u.t])), ciks = U.map((u) => u.cik), batches = [];
  for (let i = 0; i < ciks.length; i += BATCH) batches.push(ciks.slice(i, i + BATCH));
  fs.mkdirSync(DIR, { recursive: true });
  const fileOf = (c, y, b) => path.join(DIR, `${c.replace(/[^a-z0-9]+/gi, '_')}_${y}_${b}.json`);
  const todo = []; for (const c of CONCEPTS) for (const y of YEARS) batches.forEach((ch, b) => { if (!fs.existsSync(fileOf(c, y, b))) todo.push([c, y, b, ch]); });
  const total = CONCEPTS.length * YEARS.length * batches.length, t0 = Date.now(); let done = 0, failed = 0;
  console.error(`${U.length} companies · ${batches.length} batches · ${CONCEPTS.length} concepts × ${YEARS.length} yrs = ${total} units · ${todo.length} to do · ${RPS} req/s · forms ${FORMS}`);
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (todo.length) { const [c, y, b, ch] = todo.shift(); const rows = await unit(c, y, b, ch, byCik);
      if (rows) fs.writeFileSync(fileOf(c, y, b), JSON.stringify(rows)); else failed++;
      if (++done % 200 === 0) console.error(`${new Date().toISOString().slice(11, 19)} ${done}/${done + todo.length} units · ${nReq} req · ${failed} failed · ${((Date.now() - t0) / 60000).toFixed(1)} min · at ${c} ${y}`); }
  }));
  const out = []; for (const c of CONCEPTS) for (const y of YEARS) batches.forEach((_, b) => { const f = fileOf(c, y, b); if (fs.existsSync(f)) out.push(...JSON.parse(fs.readFileSync(f, 'utf8'))); });
  fs.writeFileSync(path.join(C, 'exposure_hist.json'), JSON.stringify(out));
  console.error(`done: ${nReq} requests · ${((Date.now() - t0) / 60000).toFixed(1)} min · ${failed} failed units · ${out.length} rows`);
}
