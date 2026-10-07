#!/usr/bin/env node
// E12 attention-surge collector: ticker → English Wikipedia article via Wikidata (SEC CIK P5531 first, then ticker P249 on NYSE/Nasdaq),
// then daily user pageviews 2015-07-01 → today from the Wikimedia REST API → .cache/wiki/views/<T>.json as [[yyyymmdd, views], ...].
// Universe = universeV2(1e9) names with a non-empty .cache/wdaily price file. Resumable (skips existing view files; --remap rebuilds map).
// Public read-only APIs, ≤ 8 req/s shared gate, 0 Skylit credits.
import fs from 'node:fs';
import path from 'node:path';
import { universeV2 } from './universe_prices.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), DIR = path.join(ROOT, '.cache', 'wiki'), VIEWS = path.join(DIR, 'views');
const UA = { 'User-Agent': 'research saieagle@gmail.com (attention-surge study; read-only)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let next = 0; const gate = async () => { const now = Date.now(), t = Math.max(now, next); next = t + 125; if (t > now) await sleep(t - now); };
async function sparql(q) { for (let k = 0; k < 5; k++) { const r = await fetch('https://query.wikidata.org/sparql?query=' + encodeURIComponent(q), { headers: { ...UA, Accept: 'application/sparql-results+json' } }).catch(() => null);
  if (!r?.ok) { await sleep(5000 * (k + 1)); continue; } return (await r.json()).results.bindings; } throw new Error('sparql failed'); }
const title = (u) => decodeURIComponent(u.split('/wiki/')[1]).replace(/_/g, ' ');
export const loadViews = (t) => { const f = path.join(VIEWS, `${t}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; };

async function buildMap(U) {
  const byCik = new Map(); // cik → [{item, title, tick:Set}]
  for (const b of await sparql(`SELECT ?i ?c ?a (GROUP_CONCAT(DISTINCT ?tk) AS ?tks) WHERE { ?i wdt:P5531 ?c . ?a schema:about ?i ; schema:isPartOf <https://en.wikipedia.org/> . OPTIONAL { ?i wdt:P249 ?tk } } GROUP BY ?i ?c ?a`)) {
    const c = parseInt(b.c.value, 10); if (!c) continue; (byCik.get(c) ?? byCik.set(c, []).get(c)).push({ item: b.i.value, title: title(b.a.value), tk: new Set((b.tks?.value ?? '').split(' ').filter(Boolean)) }); }
  const byTick = new Map(); // NYSE Q13677, Nasdaq Q82059 (+ NYSE American Q846626, NYSE Arca Q7210829)
  for (const b of await sparql(`SELECT DISTINCT ?tk ?a WHERE { ?i p:P414 ?st . ?st ps:P414 ?ex ; pq:P249 ?tk . VALUES ?ex { wd:Q13677 wd:Q82059 wd:Q846626 wd:Q7210829 } ?a schema:about ?i ; schema:isPartOf <https://en.wikipedia.org/> . }`)) {
    const t = b.tk.value.trim().toUpperCase(); if (!byTick.has(t)) byTick.set(t, title(b.a.value)); }
  const map = {}, src = { cik: 0, ticker: 0 };
  for (const { t, cik } of U) { const c = byCik.get(parseInt(cik, 10));
    if (c?.length) { map[t] = (c.find((x) => x.tk.has(t)) ?? c[0]).title; src.cik++; } else if (byTick.has(t)) { map[t] = byTick.get(t); src.ticker++; } }
  console.error(`map: ${Object.keys(map).length}/${U.length} (cik ${src.cik}, ticker ${src.ticker}) · wikidata cik items ${byCik.size}, ticker rows ${byTick.size}`);
  return map;
}
async function views(art, end) { const u = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(art.replace(/ /g, '_'))}/daily/20150701/${end}`;
  for (let k = 0; k < 6; k++) { await gate(); const r = await fetch(u, { headers: UA }).catch(() => null);
    if (r?.status === 404) return []; if (!r?.ok) { await sleep(1500 * 2 ** k); continue; } const j = await r.json().catch(() => null); if (!j) continue;
    return j.items.map((x) => [+x.timestamp.slice(0, 8), x.views]); } return null; }

if (decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]) {
  fs.mkdirSync(VIEWS, { recursive: true });
  const U = universeV2(1e9).filter(({ t }) => { const f = path.join(ROOT, '.cache', 'wdaily', `${t}.json`); return fs.existsSync(f) && fs.statSync(f).size > 2; });
  const MF = path.join(DIR, 'map.json'); let map;
  if (fs.existsSync(MF) && !process.argv.includes('--remap')) map = JSON.parse(fs.readFileSync(MF, 'utf8')); else { map = await buildMap(U); fs.writeFileSync(MF, JSON.stringify(map, null, 0)); }
  console.error(`universe ${U.length} · mapped ${Object.keys(map).length}`);
  const end = new Date().toISOString().slice(0, 10).replace(/-/g, ''), Q = Object.entries(map).filter(([t]) => !fs.existsSync(path.join(VIEWS, `${t}.json`)));
  let done = 0, empty = 0; const fail = [];
  async function worker() { while (Q.length) { const [t, art] = Q.shift(); const v = await views(art, end);
    if (v === null) fail.push(t); else { if (!v.length) empty++; fs.writeFileSync(path.join(VIEWS, `${t}.json`), JSON.stringify(v)); }
    if (++done % 200 === 0) console.error(`… ${done} (${empty} empty, ${fail.length} failed)`); } }
  await Promise.all(Array.from({ length: 6 }, worker)); console.error(`done ${done} · empty ${empty} · failed ${fail.length}${fail.length ? ' ' + fail.slice(0, 30).join(',') : ''}`);
}
