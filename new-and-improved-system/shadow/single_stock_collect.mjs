#!/usr/bin/env node
// DESIGN_single_stock_premium.md collector: per ticker, W (weekly) and D (one-day) entries; ATM + wing legs' closing
// bid/ask on the entry date. → .cache/ssprem/{T}.json { [t0|kind]: {e, S, legs:{C,P,WC1,WP1,WC2,WP2}} }. Resumable.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UW_API_KEY } from '../feeds/env.js';
const C = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache'), OUT = path.join(C, 'ssprem'); fs.mkdirSync(OUT, { recursive: true });
const TICK = ['AAPL', 'AMD', 'AMZN', 'AVGO', 'GOOGL', 'JPM', 'META', 'MSFT', 'NVDA', 'TSLA'], SPLIT = { NVDA: ['2024-06-10', 10], AVGO: ['2024-07-15', 10] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let LIMIT = false, calls = 0;
async function uw(p) { for (let k = 0; k < 5 && !LIMIT; k++) { await sleep(110); calls++; const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null);
  if (r?.status === 429) { const b = await r.text().catch(() => ''); if (b.includes('daily_request_limit_hit')) { LIMIT = true; console.error('UW daily limit'); return null; } await sleep(4000 * (k + 1)); continue; } if (r?.status === 404 || r?.status === 422) return { data: [], chains: [] }; if (!r?.ok) { await sleep(1500); continue; } return r.json().catch(() => null); } return null; }
const parse = (s) => { const m = s.match(/^(.+?)(\d{6})([CP])(\d{8})$/); return m ? { e: `20${m[2].slice(0, 2)}-${m[2].slice(2, 4)}-${m[2].slice(4, 6)}`, cp: m[3], k: +m[4] / 1000, id: s } : null; };
const wk = (d) => { const x = new Date(d + 'T12:00:00Z'), day = (x.getUTCDay() + 6) % 7; return new Date(x.getTime() - day * 864e5).toISOString().slice(0, 10); };
for (const T of TICK) { const f = path.join(OUT, `${T}.json`), out = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  const bars = JSON.parse(fs.readFileSync(path.join(C, 'uwgreeks', `${T}_ohlc.json`), 'utf8')).filter((b) => b.d >= '2023-11-10' && b.d <= '2026-10-15'), raw = (b) => (SPLIT[T] && b.d < SPLIT[T][0] ? b.c * SPLIT[T][1] : b.c);
  const entries = []; for (let i = 0; i < bars.length - 1; i++) { const d = bars[i].d, nx = bars[i + 1].d; if (wk(nx) !== wk(d)) entries.push([d, 'W']); const dow = new Date(nx + 'T12:00:00Z').getUTCDay(); if (dow === 1 || dow === 3 || dow === 5) entries.push([d, 'D', nx]); } /* expiries only on Mon/Wed/Fri */
  const chains = new Map();
  for (const [t0, kind, nx] of entries) { if (LIMIT) break; const key = `${t0}|${kind}`; if (key in out) continue; const S = raw(bars.find((b) => b.d === t0));
    let L = chains.get(t0); if (!L) { const ch = await uw(`/stock/${T}/option-chains?date=${t0}`); if (!ch) continue; L = (ch.data ?? []).map(parse).filter(Boolean); chains.set(t0, L); }
    const e = kind === 'W' ? [...new Set(L.map((x) => x.e))].filter((x) => { const g = (Date.parse(x) - Date.parse(t0)) / 864e5; return g >= 3 && g <= 9; }).sort()[0] : L.some((x) => x.e === nx) ? nx : null;
    if (!e) { out[key] = null; continue; } const ks = [...new Set(L.filter((x) => x.e === e).map((x) => x.k))].sort((a, b) => a - b); const near = (tgt) => ks.reduce((a, k) => (Math.abs(k - tgt) < Math.abs(a - tgt) ? k : a), ks[0]);
    const atm = near(S), w = kind === 'W' ? [0.03, 0.06] : [0.02, 0.04], want = { C: ['C', atm], P: ['P', atm], WC1: ['C', near(S * (1 + w[0]))], WP1: ['P', near(S * (1 - w[0]))], WC2: ['C', near(S * (1 + w[1]))], WP2: ['P', near(S * (1 - w[1]))] }, legs = {};
    for (const [tag, [cp, k]] of Object.entries(want)) { const id = L.find((x) => x.e === e && x.cp === cp && x.k === k)?.id; if (!id) continue; const h = await uw(`/option-contract/${id}/historic`); if (!h) break; const r = (h.chains ?? []).find((z) => z.date === t0); legs[tag] = r ? { k, bid: +r.nbbo_bid, ask: +r.nbbo_ask } : null; }
    if (LIMIT) break; out[key] = { e, S, legs }; if (Object.keys(out).length % 40 === 0) fs.writeFileSync(f, JSON.stringify(out)); }
  fs.writeFileSync(f, JSON.stringify(out)); console.error(`${T} done (${calls} calls)`); if (LIMIT) break; }
console.error(`run done ${calls}${LIMIT ? ' (UW limit — re-run after 8pm ET)' : ''}`);
