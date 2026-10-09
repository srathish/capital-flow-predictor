#!/usr/bin/env node
// Idea factory amendment 1: UW daily OHLC is split-adjusted but greek-exposure strikes are raw. Detect each ticker's
// split factor per day from the option chain itself: factor = the standard split ratio closest to
// (|gamma|-weighted median strike, unfiltered) ÷ adjusted close. Monthly samples, then binary search for the exact day.
// Writes .cache/uwgreeks/splits.json { T: [{from, to, factor}] } (only factors ≠ 1), then re-fetches affected days with
// the ±30% strike filter applied around the RAW price (adjusted close × factor), replacing those lines.
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';

const NIS = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(NIS, '.cache', 'uwgreeks');
const TICKERS = ['SPY', 'QQQ', 'IWM', 'DIA', 'SMH', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLI', 'XLP', 'XLU', 'GLD', 'TLT', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA', 'AMD', 'AVGO', 'JPM'];
const RATIOS = [1 / 20, 1 / 10, 1 / 5, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 1, 3 / 2, 2, 3, 4, 5, 10, 20];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (s) => console.error(`${new Date().toISOString().slice(11, 19)} ${s}`);
async function uw(p) { for (let k = 0; k < 6; k++) { await sleep(150); const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null);
  if (r?.status === 429) { const b = await r.text(); if (b.includes('daily_request_limit_hit')) throw new Error('UW daily limit'); await sleep(5000 * (k + 1)); continue; } if (!r?.ok) { await sleep(1500); continue; } return r.json(); } return null; }
const raw = async (T, d) => ((await uw(`/stock/${T}/greek-exposure/strike?date=${d}`))?.data ?? []).map((r) => [+r.strike, +r.call_gex, +r.put_gex, +r.call_delta, +r.put_delta, +r.call_charm, +r.put_charm, +r.call_vanna, +r.put_vanna]).filter((x) => x.every(Number.isFinite));
function factorOf(s, adjClose) { if (!s.length) return null; const w = s.map((x) => [x[0], Math.abs(x[1] + x[2])]).sort((a, b) => a[0] - b[0]), tot = w.reduce((q, x) => q + x[1], 0); if (!(tot > 0)) return null;
  let acc = 0, med = w[0][0]; for (const [k, g] of w) { acc += g; if (acc >= tot / 2) { med = k; break; } }
  const r = med / adjClose; return RATIOS.reduce((b, x) => (Math.abs(Math.log(r / x)) < Math.abs(Math.log(r / b)) ? x : b), 1); }

const out = {};
for (const T of TICKERS) {
  const bars = JSON.parse(fs.readFileSync(path.join(C, `${T}_ohlc.json`), 'utf8')).filter((b) => b.d >= '2023-11-08'), cl = new Map(bars.map((b) => [b.d, b.c]));
  const fcache = new Map(), F = async (d) => { if (!fcache.has(d)) fcache.set(d, factorOf(await raw(T, d), cl.get(d))); return fcache.get(d); };
  const months = [...new Map(bars.map((b) => [b.d.slice(0, 7), b.d])).values()]; // first trading day of each month
  const mf = []; for (const d of months) mf.push([d, await F(d)]);
  const last = bars.at(-1).d; mf.push([last, await F(last)]);
  const segs = []; let cur = { from: bars[0].d, factor: mf[0][1] };
  for (let m = 1; m < mf.length; m++) { if (mf[m][1] === cur.factor || mf[m][1] == null) continue;
    let lo = bars.findIndex((b) => b.d === mf[m - 1][0]), hi = bars.findIndex((b) => b.d === mf[m][0]); // factor changes in (lo, hi]
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if ((await F(bars[mid].d)) === cur.factor) lo = mid; else hi = mid; }
    cur.to = bars[lo].d; segs.push(cur); cur = { from: bars[hi].d, factor: mf[m][1] }; }
  cur.to = last; segs.push(cur);
  const odd = segs.filter((s) => s.factor !== 1); if (odd.length) out[T] = odd;
  log(`${T}: ${segs.map((s) => `${s.from}→${s.to} ×${+s.factor.toFixed(3)}`).join(' | ')}`);
}
fs.writeFileSync(path.join(C, 'splits.json'), JSON.stringify(out, null, 1));
// ---- re-fetch affected days with the filter around the raw price ----
for (const [T, segs] of Object.entries(out)) {
  const bars = JSON.parse(fs.readFileSync(path.join(C, `${T}_ohlc.json`), 'utf8')), f = path.join(C, `${T}.jsonl`);
  const lines = new Map(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return [j.d, j]; }));
  let n = 0; for (const b of bars) { const sg = segs.find((s) => b.d >= s.from && b.d <= s.to); if (!sg || b.d < '2023-11-08') continue;
    const s = (await raw(T, b.d)).filter((x) => Math.abs(x[0] / (b.c * sg.factor) - 1) <= 0.3).sort((a, c) => a[0] - c[0]); lines.set(b.d, { d: b.d, s, factor: sg.factor }); n++; }
  fs.writeFileSync(f, [...lines.values()].sort((a, c) => a.d.localeCompare(c.d)).map((j) => JSON.stringify(j)).join('\n') + '\n'); log(`${T}: re-fetched ${n} split-affected days`); }
log('splits done');
