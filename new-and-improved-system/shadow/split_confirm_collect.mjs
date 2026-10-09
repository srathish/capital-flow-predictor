#!/usr/bin/env node
// For companies whose SEC share counts jump by a standard split ratio (candidates in split_shares.mjs), fetch the share
// and EPS tags that companies RESTATE for prior periods after a split: WeightedAverageNumberOfSharesOutstandingBasic,
// EarningsPerShareBasic, CommonStockSharesOutstanding → .cache/edgar/splitconf/{T}.json [{tag, e, f, v}].
//   node shadow/split_confirm_collect.mjs
import fs from 'node:fs';
import path from 'node:path';
import { candidates } from './split_shares.mjs';
import { universeV2 } from '../world/universe_prices.mjs';

const NIS = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(NIS, '.cache'), OUT = path.join(C, 'edgar', 'splitconf'); fs.mkdirSync(OUT, { recursive: true });
const TAGS = ['WeightedAverageNumberOfSharesOutstandingBasic', 'EarningsPerShareBasic', 'CommonStockSharesOutstanding'];
const CIK = new Map(universeV2(1e9).map((x) => [x.t, x.cik])), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todo = fs.readdirSync(path.join(C, 'edgar', 'facts3')).map((f) => f.replace('.json', '')).filter((t) => candidates(C, t).length && CIK.has(t) && !fs.existsSync(path.join(OUT, `${t}.json`)));
console.error(`${todo.length} candidate companies`);
let n = 0; for (const t of todo) { await sleep(130);
  let j = null; for (let k = 0; k < 4 && !j; k++) { const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(CIK.get(t)).padStart(10, '0')}.json`, { headers: { 'User-Agent': 'research saieagle@gmail.com' } }).catch(() => null);
    if (r?.status === 404) break; if (!r?.ok) { await sleep(2000 * (k + 1)); continue; } j = await r.json().catch(() => null); }
  const g = j?.facts?.['us-gaap'] ?? {}, out = [];
  for (const tag of TAGS) for (const units of Object.values(g[tag]?.units ?? {})) for (const x of units) if (x.end && x.filed && Number.isFinite(x.val)) out.push({ tag, s: x.start ?? null, e: x.end, f: x.filed, v: x.val });
  fs.writeFileSync(path.join(OUT, `${t}.json`), JSON.stringify(out)); if (++n % 100 === 0) console.error(`${n}/${todo.length}`); }
console.error(`done ${n}`);
