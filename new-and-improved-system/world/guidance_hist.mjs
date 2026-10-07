#!/usr/bin/env node
// Historical guidance raise/cut phrase hits (EDGAR full-text search) over the WIDE universe, 8-K only, 2014-01-01 → 2026-10-31.
// Universe = every ticker in universeV2(1e9) with a non-empty .cache/wdaily/<T>.json (CIK → ticker map from universeV2).
// RAISE / CUT copied VERBATIM from fresh_collect.mjs (that file has no main guard — importing it would re-run its whole collection).
//
// QUERY PLAN
//   Probe (2026-10-07): unfiltered 8-K hit totals for 2014→2026 are tiny (≈2.9k documents across all 22 phrases, max 471/phrase),
//   so CIK batching (22 × 13 × 45 ≈ 12.9k units) is pointless. Instead: unit = phrase × year, NO ciks filter, paginate from=0,100,…
//   → ~286 units ≈ 300 requests. Hits are filtered to the universe locally. Raw hits are cached per unit in
//   .cache/edgar/fts_guid/<phrase>_<year>.json → resumable. ≤ 3 req/s shared gate; backoff 15s·k on 403/429, 3s·k otherwise.
//   Note: EFTS tokenises hyphens, so 'raises full-year guidance' ≡ 'raises full year guidance' (identical 471 hits) — both kept as
//   separate c values per spec; count unique (t, d, dir) for events.
//   node world/guidance_hist.mjs → .cache/edgar/guidance_hist.json [{t, c, d, f, s, dir}] (one row per ticker × phrase × file date)
import fs from 'node:fs';
import path from 'node:path';
import { universeV2 } from './universe_prices.mjs';

export const RAISE = ['raises full-year guidance', 'raises full year guidance', 'raising full-year guidance', 'raised full-year guidance', 'raises its full-year', 'raises guidance', 'raising guidance', 'raised guidance', 'raises outlook', 'raised its outlook', 'raising its outlook', 'increases full-year guidance', 'increased full-year guidance'];
export const CUT = ['lowers full-year guidance', 'lowers guidance', 'lowering guidance', 'lowered guidance', 'lowers outlook', 'lowered its outlook', 'reduces full-year guidance', 'reduced full-year guidance', 'cuts guidance'];

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache', 'edgar'), DIR = path.join(C, 'fts_guid');
const YEARS = Array.from({ length: 13 }, (_, i) => 2014 + i), END = '2026-10-31', FORMS = '8-K', RPS = 3, WORKERS = 3;
const UA = { 'User-Agent': 'research saieagle@gmail.com', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let next = 0, nReq = 0;
const gate = async () => { const now = Date.now(), at = Math.max(now, next); next = at + 1000 / RPS; if (at > now) await sleep(at - now); nReq++; };

async function fts(q, y, from) {
  const u = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${q}"`)}&dateRange=custom&startdt=${y}-01-01&enddt=${y === 2026 ? END : `${y}-12-31`}&forms=${FORMS}&from=${from}`;
  for (let k = 1; k <= 5; k++) { await gate(); const r = await fetch(u, { headers: UA }).catch(() => null);
    if (r?.ok) { const j = await r.json().catch(() => null); if (j) return j; }
    await sleep(r && (r.status === 403 || r.status === 429) ? 15000 * k : 3000 * k); }
  return null;
}
async function unit(c, y) { // raw hits [{ciks, d, f, s}] or null
  const out = []; let from = 0;
  for (;;) { const j = await fts(c, y, from); if (!j) return null; const hits = j.hits?.hits ?? [];
    for (const h of hits) out.push({ ciks: h._source.ciks ?? [], d: h._source.file_date, f: h._source.form, s: +h._score.toFixed(2) });
    from += hits.length; if (!hits.length || from >= (j.hits?.total?.value ?? 0) || from >= 9900) break; }
  return out;
}
if (decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]) {
  const U = universeV2(1e9).filter(({ t }) => { const f = path.join(ROOT, '.cache', 'wdaily', `${t}.json`); return fs.existsSync(f) && fs.statSync(f).size > 2; });
  const byCik = Object.fromEntries(U.map((u) => [u.cik, u.t]));
  fs.mkdirSync(DIR, { recursive: true });
  const fileOf = (c, y) => path.join(DIR, `${c.replace(/[^a-z0-9]+/gi, '_')}_${y}.json`);
  const P = [...RAISE.map((c) => [c, 'raise']), ...CUT.map((c) => [c, 'cut'])];
  const todo = []; for (const [c] of P) for (const y of YEARS) if (!fs.existsSync(fileOf(c, y))) todo.push([c, y]);
  const t0 = Date.now(); let done = 0, failed = 0;
  console.error(`${U.length} companies · ${P.length} phrases × ${YEARS.length} yrs = ${P.length * YEARS.length} units · ${todo.length} to do · ${RPS} req/s · forms ${FORMS}`);
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (todo.length) { const [c, y] = todo.shift(); const rows = await unit(c, y);
      if (rows) fs.writeFileSync(fileOf(c, y), JSON.stringify(rows)); else failed++;
      if (++done % 25 === 0) console.error(`${done} units · ${nReq} req · ${failed} failed · ${((Date.now() - t0) / 60000).toFixed(1)} min`); }
  }));
  const best = new Map();
  for (const [c, dir] of P) for (const y of YEARS) { const f = fileOf(c, y); if (!fs.existsSync(f)) continue;
    for (const h of JSON.parse(fs.readFileSync(f, 'utf8'))) for (const t of new Set(h.ciks.map((x) => byCik[x]).filter(Boolean))) {
      const k = `${t}|${c}|${h.d}`, o = best.get(k); if (!o) best.set(k, { t, c, d: h.d, f: h.f, s: h.s, dir }); else if (h.s > o.s) o.s = h.s; } }
  const out = [...best.values()].sort((a, b) => a.d.localeCompare(b.d) || a.t.localeCompare(b.t));
  fs.writeFileSync(path.join(C, 'guidance_hist.json'), JSON.stringify(out));
  console.error(`done: ${nReq} requests · ${((Date.now() - t0) / 60000).toFixed(1)} min · ${failed} failed units · ${out.length} rows`);
}
