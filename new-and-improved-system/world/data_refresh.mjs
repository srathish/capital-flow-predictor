#!/usr/bin/env node
// Live paper test — incremental data refresh (run before each monthly paper run).
//  1. UW daily prices: last ~60 sessions for every ticker that has a price file, merged into .cache/wdaily/<T>.json (+ commodity ETFs).
//  2. SEC: EDGAR daily form indexes since the last refresh → companies in our universe that filed a 10-Q / 10-K (or amendments)
//     → refetch companyfacts and update .cache/edgar/facts (revenue / gross profit / cost), facts2 (capex, inventory, backlog,
//     R&D, op income, deferred revenue) and facts3 (net income, shares) — same extraction as the original collectors.
// UW: ~4.5k requests (limit 40k/day, stops cleanly at the limit). SEC: ≤ 3 requests/second. State in .cache/refresh_state.json.
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';
import { TAGS } from './facts_collect.mjs';
import { TAGS2 } from './facts2_collect.mjs';
import { universeV2 } from './universe_prices.mjs';
import { COMMODITIES } from './commodity_prices.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), ST = path.join(C, 'refresh_state.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), today = new Date().toISOString().slice(0, 10), addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const state = fs.existsSync(ST) ? JSON.parse(fs.readFileSync(ST, 'utf8')) : { secThrough: '2026-10-01' };
const log = (s) => console.error(`${new Date().toISOString().slice(11, 19)} ${s}`);
// ---- 1. prices ----
async function uw(p) { for (let k = 0; k < 6; k++) { await sleep(120); const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
  if (r?.status === 429) { const b = await r.text().catch(() => ''); if (b.includes('daily_request_limit_hit')) { log('UW daily limit — stopping price refresh'); return 'LIMIT'; } await sleep(8000 * (k + 1)); continue; } return r?.ok ? r.json().catch(() => null) : null; } return null; }
const merge = (f, rows) => { const old = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [], m = new Map(old.map((x) => [x.d, x])); for (const x of rows) m.set(x.d, x); const out = [...m.values()].sort((a, b) => a.d.localeCompare(b.d)); fs.writeFileSync(f, JSON.stringify(out)); return out.length - old.length; };
let n = 0, added = 0;
for (const f of fs.readdirSync(path.join(C, 'wdaily'))) { const p = path.join(C, 'wdaily', f); if (fs.statSync(p).size <= 2) continue; const j = await uw(`/stock/${f.replace('.json', '')}/ohlc/1d?limit=60`); if (j === 'LIMIT') break;
  added += merge(p, (j?.data ?? []).filter((b) => b.market_time === 'r').map((b) => ({ d: b.date, o: +b.open, h: +b.high, l: +b.low, c: +b.close, v: +b.volume }))); if (++n % 500 === 0) log(`prices ${n} (+${added} bars)`); }
for (const t of Object.keys(COMMODITIES)) { const j = await uw(`/stock/${t}/ohlc/1d?limit=60`); if (j === 'LIMIT') break; merge(path.join(C, 'commodity', `${t}.json`), (j?.data ?? []).filter((b) => b.market_time === 'r').map((b) => ({ d: b.date, c: +b.close }))); }
{ const j = await uw('/stock/SPY/ohlc/1d?limit=60'); if (j && j !== 'LIMIT') merge(path.join(C, 'wdaily_hist', 'SPY_full.json'), (j.data ?? []).filter((b) => b.market_time === 'r').map((b) => ({ d: b.date, c: +b.close }))); }
log(`prices done: ${n} tickers, +${added} bars`);
// ---- 2. SEC filings since the last refresh ----
let next = 0; const gate = async () => { const now = Date.now(), t = Math.max(now, next); next = t + 340; if (t > now) await sleep(t - now); };
const UA = { 'User-Agent': 'research saieagle@gmail.com' };
async function sec(u, json = true) { for (let k = 0; k < 5; k++) { await gate(); const r = await fetch(u, { headers: UA }).catch(() => null); if (r?.status === 404) return null; if (r?.status === 403 || r?.status === 429) { await sleep(15000 * (k + 1)); continue; } if (!r?.ok) { await sleep(2000 * (k + 1)); continue; } return json ? r.json().catch(() => null) : r.text(); } return null; }
const U = new Map(universeV2(1e9).map((x) => [String(+x.cik), x])), filers = new Set();
for (let d = addD(state.secThrough, 1); d <= today; d = addD(d, 1)) { const dt = new Date(d + 'T12:00:00Z'); if ([0, 6].includes(dt.getUTCDay())) continue; const q = Math.floor(dt.getUTCMonth() / 3) + 1;
  const idx = await sec(`https://www.sec.gov/Archives/edgar/daily-index/${d.slice(0, 4)}/QTR${q}/form.${d.replaceAll('-', '')}.idx`, false); if (!idx) continue;
  for (const line of idx.split('\n')) { const m = line.match(/^(10-Q|10-K|10-Q\/A|10-K\/A)\s+.+?\s+(\d{3,10})\s+\d{4}-?\d{2}-?\d{2}/); if (m && U.has(String(+m[2]))) filers.add(U.get(String(+m[2])).t); } }
log(`SEC: ${filers.size} universe companies filed a 10-Q/10-K since ${state.secThrough}`);
const pick = (g, tags, keep = (x) => x.start) => { const o = {}; for (const tag of tags) { const u = g[tag]?.units?.USD; if (u) o[tag] = u.filter(keep).map((x) => ({ s: x.start, e: x.end, v: x.val, f: x.filed, form: x.form })); } return Object.keys(o).length ? o : undefined; };
for (const t of filers) { const cik = U.get([...U.keys()].find((k) => U.get(k).t === t)).cik, j = await sec(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`); if (!j) continue; const g = j.facts?.['us-gaap'] ?? {}, dei = j.facts?.dei ?? {};
  const f1 = {}; for (const [k, tags] of Object.entries(TAGS)) { const v = pick(g, tags); if (v) f1[k] = v; } if (f1.rev) fs.writeFileSync(path.join(C, 'edgar', 'facts', `${t}.json`), JSON.stringify(f1));
  const f2 = {}; for (const [k, tags] of Object.entries(TAGS2)) { const v = pick(g, tags, () => true); if (v) f2[k] = v; } fs.writeFileSync(path.join(C, 'edgar', 'facts2', `${t}.json`), JSON.stringify(f2));
  const f3 = {}; const ni = pick(g, ['NetIncomeLoss', 'ProfitLoss']); if (ni) f3.ni = ni; for (const [src, tag] of [[dei, 'EntityCommonStockSharesOutstanding'], [g, 'CommonStockSharesOutstanding']]) { const u = src[tag]?.units?.shares; if (u) (f3.sh ??= {})[tag] = u.map((x) => ({ e: x.end, v: x.val, f: x.filed, form: x.form })); }
  fs.writeFileSync(path.join(C, 'edgar', 'facts3', `${t}.json`), JSON.stringify(f3)); }
state.secThrough = addD(today, -1); state.lastRun = new Date().toISOString(); fs.writeFileSync(ST, JSON.stringify(state, null, 1)); log(`refresh done (SEC through ${state.secThrough})`);
