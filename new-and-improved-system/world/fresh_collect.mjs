#!/usr/bin/env node
// Fresh-filing data (DESIGN_fresh): per company, every 8-K (with item numbers) and Schedule 13D filed since 2022, from SEC submissions
// JSON (incl. older pages) → .cache/edgar/fresh/<T>.json; plus guidance raise/cut phrases via EDGAR full-text search → .cache/edgar/guidance.json
import fs from 'node:fs';
import path from 'node:path';
import { worldUniverse } from './collect.mjs';
import { pull } from './edgar_exposure.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), OUT = path.join(ROOT, '.cache', 'edgar', 'fresh');
const UA = { 'User-Agent': 'research saieagle@gmail.com' }, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let gateT = 0; const gate = async () => { const now = Date.now(), at = Math.max(now, gateT + 125); gateT = at; if (at > now) await sleep(at - now); };
async function get(u) { for (let k = 0; k < 5; k++) { await gate(); const r = await fetch(u, { headers: UA }).catch(() => null); if (r?.status === 429 || r?.status === 503) { await sleep(4000 * (k + 1)); continue; } return r?.ok ? r.json().catch(() => null) : null; } return null; }
const KEEP = /^(8-K|SC 13D|SCHEDULE 13D)(\/A)?$/;
fs.mkdirSync(OUT, { recursive: true });
const U = worldUniverse(); let n = 0;
async function one({ t, cik }) {
  const f = path.join(OUT, `${t}.json`); if (fs.existsSync(f)) { n++; return; }
  const sub = await get(`https://data.sec.gov/submissions/CIK${cik}.json`); if (!sub) { n++; return; }
  const lists = [sub.filings?.recent ?? {}]; for (const x of sub.filings?.files ?? []) if (x.filingTo >= '2022-01-01') { const y = await get(`https://data.sec.gov/submissions/${x.name}`); if (y) lists.push(y); }
  const rows = []; for (const R of lists) for (let i = 0; i < (R.form ?? []).length; i++) { if (!KEEP.test(R.form[i]) || R.filingDate[i] < '2022-01-01') continue; rows.push({ form: R.form[i], d: R.filingDate[i], acc: R.acceptanceDateTime[i], items: R.items?.[i] ?? '' }); }
  fs.writeFileSync(f, JSON.stringify(rows)); if (++n % 100 === 0) console.error(`… ${n}/${U.length}`);
}
const q = [...U]; await Promise.all(Array.from({ length: 8 }, async () => { while (q.length) await one(q.shift()); }));
console.error(`submissions done ${n}`);
export const RAISE = ['raises full-year guidance', 'raises full year guidance', 'raising full-year guidance', 'raised full-year guidance', 'raises its full-year', 'raises guidance', 'raising guidance', 'raised guidance', 'raises outlook', 'raised its outlook', 'raising its outlook', 'increases full-year guidance', 'increased full-year guidance'];
export const CUT = ['lowers full-year guidance', 'lowers guidance', 'lowering guidance', 'lowered guidance', 'lowers outlook', 'lowered its outlook', 'reduces full-year guidance', 'reduced full-year guidance', 'cuts guidance'];
const T = Object.fromEntries(U.map((x) => [x.t, x.cik]));
const g = await pull([...RAISE, ...CUT], T, 'fts_guidance', 'guidance.json');
console.error(`\nguidance phrase hits ${g.length}`);
