#!/usr/bin/env node
// Stock factory (short horizon) collector: UW greek exposure by strike for the 300 most liquid stocks, one snapshot per
// week (last trading day of each week), 2023-11-10 → last week. The split factor is detected per snapshot from the
// unfiltered chain (|gamma|-weighted median strike ÷ split-adjusted close, snapped to a standard ratio — same method as
// uw_splits_detect.mjs) and strikes are kept within ±30% of the RAW price; the raw ratio is stored so transitional
// split days can be dropped. Resumable; --max=N caps calls per run; stops cleanly at the UW daily limit.
//   node shadow/uw_greeks_weekly.mjs --max=12000   → .cache/uwgreeks_w/{T}.jsonl, .cache/uwgreeks_w/tickers.json
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';
import { universeV2, loadW } from '../world/universe_prices.mjs';
import { splitEvents } from './weekly_basis.mjs';

const NIS = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(NIS, '.cache', 'uwgreeks_w'); fs.mkdirSync(C, { recursive: true });
const MAX = +(process.argv.find((a) => a.startsWith('--max='))?.split('=')[1] ?? 12000), START = '2023-11-08';
const RATIOS = [1 / 20, 1 / 10, 1 / 5, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 1, 3 / 2, 2, 3, 4, 5, 10, 20];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (s) => console.error(`${new Date().toISOString().slice(11, 19)} ${s}`);
let LIMIT = false, calls = 0;
async function uw(p) { for (let k = 0; k < 6 && !LIMIT; k++) { calls++; const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null);
  if (r?.status === 429) { const b = await r.text().catch(() => ''); if (b.includes('daily_request_limit_hit')) { LIMIT = true; log('UW daily limit hit — stopping'); return null; } await sleep(5000 * (k + 1)); continue; }
  if (r?.status === 403 || r?.status === 422 || r?.status === 404) return { data: [] }; if (!r?.ok) { await sleep(1500 * (k + 1)); continue; } return r.json().catch(() => null); } return null; }

// ---- ticker list (fixed once): 300 highest 50-day dollar volume as of 2023-10-31 ----
const TF = path.join(C, 'tickers.json');
if (!fs.existsSync(TF)) { const rows = [];
  // chosen by liquidity AS OF 2023-10-31 (before the study period) so the list carries no knowledge of later winners;
  // stocks that stopped trading later are kept (their missing weeks simply drop out)
  for (const { t } of universeV2(1e9)) { const b = loadW(t).filter((x) => x.d <= '2023-10-31'); if (b.length < 120) continue; const L = b.slice(-50); if (L.at(-1).d < '2023-10-24') continue; rows.push([t, L.reduce((s, x) => s + x.c * x.v, 0) / L.length]); }
  rows.sort((a, b) => b[1] - a[1]); fs.writeFileSync(TF, JSON.stringify(rows.slice(0, 300).map((r) => r[0]))); }
const TICKERS = JSON.parse(fs.readFileSync(TF, 'utf8'));
// week-end dates from SPY (daily idea-factory cache)
const spy = JSON.parse(fs.readFileSync(path.join(NIS, '.cache', 'uwgreeks', 'SPY_ohlc.json'), 'utf8')).map((b) => b.d).filter((d) => d >= START);
const wk = (d) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const WEEKS = [...new Map(spy.map((d) => [wk(d), d])).values()]; // last trading day of each week
// amendment 2: candidate raw/price multipliers per week come only from SEC-confirmed splits (price-break splits are already
// raw in these bars); strikes are kept within ±30% of EVERY candidate raw price; stored snapshots whose window was built on
// a factor that is not a candidate (e.g. the old 1.5 snaps after crashes, BKNG ×20 for a 25:1) are re-fetched.
const NIS2 = path.join(NIS, '.cache'), jobs = [], STALE = [];
const cands = (ev, d) => { let set = [1]; for (const e of ev.filter((x) => x.kind === 'sec')) { if (d < e.after) set = set.map((g) => g * e.q); else if (d < e.at) set = [...set, ...set.map((g) => g * e.q)]; } return [...new Set(set)]; };
for (const T of TICKERS) { const raw = loadW(T), bars = new Map(raw.map((b) => [b.d, b.c])), f = path.join(C, `${T}.jsonl`);
  const old = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const { ev } = splitEvents(NIS2, T, raw, old.map((x) => ({ d: x.d, ratio: x.ratio })));
  const keep = old.filter((x) => { const c = cands(ev, x.d); const ok = x.g ? x.g.every((g) => c.includes(g)) && c.every((g) => x.g.includes(g)) : c.length === 1 && Math.abs(Math.log((x.factor ?? 1) / c[0])) < 0.01 && x.s.length > 0; if (!ok) STALE.push(`${T} ${x.d}`); return ok; });
  if (keep.length !== old.length) fs.writeFileSync(f, keep.map((x) => JSON.stringify(x)).join('\n') + (keep.length ? '\n' : ''));
  const have = new Set(keep.map((x) => x.d));
  for (const d of WEEKS) if (!have.has(d) && bars.has(d)) jobs.push({ T, d, c: bars.get(d), f, g: cands(ev, d), sym: T === 'XYZ' && d < '2025-01-21' ? 'SQ' : T }); }
if (process.argv.includes('--dry')) { log(`dry run: ${jobs.length} snapshots to fetch, ${STALE.length} stale (${STALE.slice(0, 12).join(', ')})`); process.exit(0); }
if (STALE.length) log(`${STALE.length} stored snapshots had a wrong strike window → re-fetching (e.g. ${STALE.slice(0, 6).join(', ')})`);
log(`${TICKERS.length} tickers × ${WEEKS.length} weeks → ${jobs.length} snapshots to fetch (cap ${MAX} calls this run)`);
let q = 0, done = 0;
const worker = async () => { while (!LIMIT && q < jobs.length && calls < MAX) { const J = jobs[q++]; await sleep(150);
  const j = await uw(`/stock/${J.sym}/greek-exposure/strike?date=${J.d}`); if (!j) continue;
  const all = (j.data ?? []).map((r) => [+r.strike, +r.call_gex, +r.put_gex, +r.call_delta, +r.put_delta, +r.call_charm, +r.put_charm, +r.call_vanna, +r.put_vanna]).filter((x) => x.every(Number.isFinite));
  let factor = 1, ratio = null;
  if (all.length) { const w = all.map((x) => [x[0], Math.abs(x[1] + x[2])]).sort((a, b) => a[0] - b[0]), tot = w.reduce((s, x) => s + x[1], 0);
    if (tot > 0) { let acc = 0, med = w[0][0]; for (const [k, g] of w) { acc += g; if (acc >= tot / 2) { med = k; break; } } ratio = med / J.c;
      factor = RATIOS.reduce((b, x) => (Math.abs(Math.log(ratio / x)) < Math.abs(Math.log(ratio / b)) ? x : b), 1); } }
  const s = all.filter((x) => J.g.some((g) => Math.abs(x[0] / (J.c * g) - 1) <= 0.3)).sort((a, b) => a[0] - b[0]);
  fs.appendFileSync(J.f, JSON.stringify({ d: J.d, s, g: J.g, factor, ratio: ratio == null ? null : +ratio.toFixed(4) }) + '\n'); if (++done % 1000 === 0) log(`${done}/${jobs.length}`); } };
await Promise.all([worker(), worker(), worker(), worker()]);
log(`run done: ${done} snapshots, ${calls} calls, ${jobs.length - done} left${LIMIT ? ' (daily limit)' : ''}`);
