#!/usr/bin/env node
// User question (2026-10-21): the wheel on IREN / NBIS / CRWV. $200k split equally; each Monday: if in cash, sell a cash-secured weekly put at the largest
// strike ≤ (1−p)·S; if assigned, hold the shares and sell weekly covered calls at the smallest strike ≥ (1+c)·S until called away. Real Monday NBBO bids, expiry closes.
import fs from 'node:fs';
import { UW_API_KEY } from '../feeds/env.js';
import { loadBars } from './earnings_fly_collect.mjs';
const C = new URL('../.cache/', import.meta.url), CA = new URL('putsell/', C); fs.mkdirSync(CA, { recursive: true });
const NAMES = (process.argv[2] ?? 'IREN,NBIS,CRWV').split(','), START = 200000, FEE = 0.65, FROM = process.env.FROM ?? '2024-12-16';
const uw = async (p, key) => { const f = new URL(key.replace(/[^\w.-]/g, '_') + '.json', CA); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  for (let k = 0; k < 4; k++) { await new Promise((r) => setTimeout(r, 120)); const r = await fetch('https://api.unusualwhales.com/api' + p, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null); if (r?.status === 404 || r?.status === 422) { fs.writeFileSync(f, 'null'); return null; } if (r?.ok) { const j = await r.json(); fs.writeFileSync(f, JSON.stringify(j)); return j; } await new Promise((x) => setTimeout(x, 2000)); } return null; };
const parse = (T, id) => { const m = id.match(new RegExp(`^${T}(\\d{6})([CP])(\\d{8})$`)); return m ? { exp: `20${m[1].slice(0, 2)}-${m[1].slice(2, 4)}-${m[1].slice(4, 6)}`, cp: m[2], K: +m[3] / 1000, id } : null; };
async function weekly(T, d, S, last) {
  const ch = await uw(`/stock/${T}/option-chains?date=${d}`, `chain_${T}_${d}`); const all = (ch?.data ?? []).map((x) => parse(T, x)).filter(Boolean);
  const exp = [...new Set(all.map((x) => x.exp))].filter((e) => e > d && (Date.parse(e) - Date.parse(d)) / 864e5 <= 7).sort()[0]; if (!exp || exp > last) return null;
  const bid = async (c) => { if (!c) return null; const h = await uw(`/option-contract/${c.id}/historic`, `h_${c.id}`); const q = (h?.chains ?? []).find((r) => r.date === d); return q && +q.nbbo_bid > 0 ? { K: c.K, bid: +q.nbbo_bid } : null; };
  return { exp, all: all.filter((x) => x.exp === exp), bid };
}
async function wheel(T, p, c) {
  const B = loadBars(T), last = B.at(-1).d; let cash = START / NAMES.length, sh = 0; const e0 = cash; let pk = e0, mdd = 0, prem = 0, assigns = 0, calls = 0, first = null, lastS = null, lastD = null;
  for (let i = 1; i < B.length; i++) { const d = B[i].d; if (d < FROM) continue; const dow = new Date(d + 'T12:00:00Z').getUTCDay(), pd = new Date(B[i - 1].d + 'T12:00:00Z').getUTCDay(); if (!(dow < pd || (Date.parse(d) - Date.parse(B[i - 1].d)) / 864e5 >= 3)) continue;
    const S = B[i].c, w = await weekly(T, d, S, last); if (!w) continue; first ??= { d, S }; const Se = B.filter((b) => b.d <= w.exp).at(-1).c;
    if (sh === 0) { const o = await w.bid(w.all.filter((x) => x.cp === 'P' && x.K <= S * (1 - p)).sort((a, b) => b.K - a.K)[0]); if (o) { const q = Math.floor(cash / (o.K * 100)); if (q >= 1) { cash += q * 100 * o.bid - q * FEE; prem += q * 100 * o.bid; if (Se < o.K) { cash -= q * 100 * o.K; sh = q * 100; assigns++; } } } }
    else { const o = await w.bid(w.all.filter((x) => x.cp === 'C' && x.K >= S * (1 + c)).sort((a, b) => a.K - b.K)[0]); if (o) { const q = Math.floor(sh / 100); cash += q * 100 * o.bid - q * FEE; prem += q * 100 * o.bid; if (Se > o.K) { cash += sh * o.K; sh = 0; calls++; } } }
    const eq = cash + sh * Se; pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1); lastS = Se; lastD = w.exp; }
  const eq = cash + sh * lastS; return { T, eq, ret: eq / e0 - 1, mdd, prem, assigns, calls, holdingAtEnd: sh > 0, hold: e0 * (lastS / first.S), first, lastS, lastD };
}
const f$ = (v) => '$' + Math.round(v).toLocaleString();
for (const [p, c] of [[0.05, 0.05], [0.05, 0.10]]) {
  let tot = 0, hold = 0; console.log(`\nWheel: puts ${p * 100}% OTM, covered calls ${c * 100}% OTM (weekly, real Monday bids), ${f$(START / NAMES.length)} per name from ${FROM}`);
  for (const T of NAMES) { const r = await wheel(T, p, c); tot += r.eq; hold += r.hold;
    console.log(`  ${T.padEnd(5)} ${f$(START / NAMES.length)} → ${f$(r.eq)} (${(r.ret * 100).toFixed(0)}%) | premium ${f$(r.prem)} | assigned ${r.assigns}×, called away ${r.calls}×${r.holdingAtEnd ? ', holding shares at the end' : ''} | max drawdown ${(r.mdd * 100).toFixed(0)}% | buy-and-hold ${f$(r.hold)} (stock ${r.first.S.toFixed(2)} → ${r.lastS.toFixed(2)})`); }
  console.log(`  TOTAL $200k → wheel ${f$(tot)} vs buy-and-hold ${f$(hold)}`);
}
