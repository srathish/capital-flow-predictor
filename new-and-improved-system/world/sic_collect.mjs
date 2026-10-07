#!/usr/bin/env node
// Node graph: SIC industry code for every company in the graph panel (EDGAR submissions) → .cache/edgar/sic/<T>.json.
// Reuses .cache/edgar/meta when present. 6 workers behind a shared 8 req/s gate. 0 Skylit credits.
import fs from 'node:fs';
import path from 'node:path';
import { universeV2 } from './universe_prices.mjs';
const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), OUT = path.join(C, 'edgar', 'sic');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let next = 0; const gate = async () => { const now = Date.now(), t = Math.max(now, next); next = t + (ALL ? 500 : 125); if (t > now) await sleep(t - now); };
fs.mkdirSync(OUT, { recursive: true });
const panel = JSON.parse(fs.readFileSync(path.join(C, 'graph', 'panel.json'), 'utf8')), cik = new Map(universeV2(1e9).map((x) => [x.t, x.cik]));
const ALL = process.argv.includes('--all'); // --all: every ticker with UW prices (engines need pre-revenue names too)
const L = (ALL ? [...cik.keys()].filter((t) => fs.existsSync(path.join(C, 'wdaily', `${t}.json`)) && fs.statSync(path.join(C, 'wdaily', `${t}.json`)).size > 2) : Object.keys(panel)).filter((t) => !fs.existsSync(path.join(OUT, `${t}.json`))); let n = 0;
async function worker() { while (L.length) { const t = L.shift(), m = path.join(C, 'edgar', 'meta', `${t}.json`);
  if (fs.existsSync(m)) { const j = JSON.parse(fs.readFileSync(m, 'utf8')); fs.writeFileSync(path.join(OUT, `${t}.json`), JSON.stringify({ sic: j.sic, desc: j.sicDesc })); continue; }
  let j = null; for (let k = 0; k < 4 && !j; k++) { await gate(); const r = await fetch(`https://data.sec.gov/submissions/CIK${cik.get(t)}.json`, { headers: { 'User-Agent': 'research saieagle@gmail.com' } }).catch(() => null); if (r?.ok) j = await r.json().catch(() => null); else await sleep(1500 * (k + 1)); }
  fs.writeFileSync(path.join(OUT, `${t}.json`), JSON.stringify({ sic: j?.sic ?? null, desc: j?.sicDescription ?? null })); if (++n % 500 === 0) console.error(`… ${n}`); } }
await Promise.all(Array.from({ length: ALL ? 1 : 6 }, worker)); console.error(`done (${n} fetched)`);
