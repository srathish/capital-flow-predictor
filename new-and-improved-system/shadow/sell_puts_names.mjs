#!/usr/bin/env node
// User question (2026-10-21): sell weekly puts on IREN / NBIS / CRWV. $200k split equally (one sleeve per name), cash-secured, compounding.
// Each Monday: the weekly put (expiry ≤ 7 days) at the largest strike ≤ 95% (and ≤ 90%) of the Monday close, sold at the Monday NBBO bid; settle at the expiry close.
import fs from 'node:fs';
import { UW_API_KEY } from '../feeds/env.js';
import { loadBars } from './earnings_fly_collect.mjs';
const C = new URL('../.cache/', import.meta.url), CA = new URL('putsell/', C); fs.mkdirSync(CA, { recursive: true });
const NAMES = (process.argv[2] ?? 'IREN,NBIS,CRWV').split(','), START = 200000, FEE = 0.65;
const uw = async (p, key) => { const f = new URL(key.replace(/[^\w.-]/g, '_') + '.json', CA); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  for (let k = 0; k < 4; k++) { await new Promise((r) => setTimeout(r, 120)); const r = await fetch('https://api.unusualwhales.com/api' + p, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null); if (r?.status === 404 || r?.status === 422) { fs.writeFileSync(f, 'null'); return null; } if (r?.ok) { const j = await r.json(); fs.writeFileSync(f, JSON.stringify(j)); return j; } await new Promise((x) => setTimeout(x, 2000)); } return null; };
const parse = (T, id) => { const m = id.match(new RegExp(`^${T}(\\d{6})([CP])(\\d{8})$`)); return m ? { exp: `20${m[1].slice(0, 2)}-${m[1].slice(2, 4)}-${m[1].slice(4, 6)}`, cp: m[2], K: +m[3] / 1000, id } : null; };
const out = {};
for (const T of NAMES) {
  const B = loadBars(T); const last = B.at(-1).d; const trades = [];
  for (let i = 1; i < B.length; i++) { const d = B[i].d; if (d < '2024-12-16') continue; const dow = new Date(d + 'T12:00:00Z').getUTCDay(), prevDow = new Date(B[i - 1].d + 'T12:00:00Z').getUTCDay();
    if (!(dow < prevDow || (Date.parse(d) - Date.parse(B[i - 1].d)) / 864e5 >= 3)) continue; // first trading day of the week
    const S = B[i].c, ch = await uw(`/stock/${T}/option-chains?date=${d}`, `chain_${T}_${d}`); const puts = (ch?.data ?? []).map((x) => parse(T, x)).filter((x) => x && x.cp === 'P');
    const exp = [...new Set(puts.map((x) => x.exp))].filter((e) => e > d && (Date.parse(e) - Date.parse(d)) / 864e5 <= 7).sort()[0]; if (!exp || exp > last) continue;
    const Ks = puts.filter((x) => x.exp === exp).sort((a, b) => b.K - a.K), wkRet = B[i - 1].c / (B.filter((b) => b.d <= new Date(Date.parse(d) - 7 * 864e5).toISOString().slice(0, 10)).at(-1)?.c ?? B[i - 1].c) - 1;
    const settle = B.filter((b) => b.d <= exp).at(-1);
    const row = { d, exp, S, Se: settle.c, wkRet };
    for (const [tag, f] of [['p5', 0.95], ['p10', 0.9]]) { const c = Ks.find((x) => x.K <= S * f); if (!c) continue; const h = await uw(`/option-contract/${c.id}/historic`, `h_${c.id}`); const q = (h?.chains ?? []).find((r) => r.date === d); if (q && +q.nbbo_bid > 0) row[tag] = { K: c.K, bid: +q.nbbo_bid }; }
    trades.push(row); }
  out[T] = trades; console.log(T, 'weeks', trades.length, trades[0]?.d, '→', trades.at(-1)?.d);
}
fs.writeFileSync(new URL('./results_sell_puts_names.json', import.meta.url), JSON.stringify(out));
const sim = (rows, tag, sel) => { let eq = START / NAMES.length, pk = eq, mdd = 0, worst = 0, n = 0, wins = 0, asg = 0, prem = 0; const e0 = eq;
  for (const r of rows) { const o = r[tag]; if (!o || !sel(r)) continue; const q = Math.floor(eq / (o.K * 100)); if (q < 1) continue; const loss = Math.max(0, o.K - r.Se), p = q * 100 * (o.bid - loss) - q * FEE; prem += q * 100 * o.bid;
    worst = Math.min(worst, p / eq); eq += p; n++; if (p > 0) wins++; if (loss > 0) asg++; pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1); }
  return { eq, ret: eq / e0 - 1, mdd, worst, n, wins, asg, prem }; };
const f$ = (v) => '$' + Math.round(v).toLocaleString();
console.log(`\n$${START.toLocaleString()} split ${NAMES.length} ways (${f$(START / NAMES.length)} per name), cash-secured weekly puts sold at the Monday bid, held to expiry, $${FEE}/contract`);
let tot = { p5: 0, p10: 0, p5d: 0, hold: 0 };
for (const T of NAMES) { const rows = out[T]; if (!rows.length) continue; const a = sim(rows, 'p5', () => true), b = sim(rows, 'p10', () => true), c = sim(rows, 'p5', (r) => r.wkRet < 0), h = rows.at(-1).Se / rows[0].S - 1;
  tot.p5 += a.eq; tot.p10 += b.eq; tot.p5d += c.eq; tot.hold += START / NAMES.length * (1 + h);
  console.log(`\n${T} (${rows[0].d} → ${rows.at(-1).exp}, ${rows.length} weeks; stock ${rows[0].S.toFixed(2)} → ${rows.at(-1).Se.toFixed(2)})`);
  for (const [lab, x] of [['5% OTM every week', a], ['10% OTM every week', b], ['5% OTM only after a down week', c]]) console.log(`  ${lab.padEnd(32)} ${f$(START / NAMES.length)} → ${f$(x.eq)} (${(x.ret * 100).toFixed(0)}%) | premium collected ${f$(x.prem)} | ${x.n} trades, ${(x.wins / x.n * 100).toFixed(0)}% win, ${x.asg} finished in the money | worst week ${(x.worst * 100).toFixed(0)}% | max drawdown ${(x.mdd * 100).toFixed(0)}%`);
  console.log(`  ${'buy and hold the stock'.padEnd(32)} ${f$(START / NAMES.length)} → ${f$(START / NAMES.length * (1 + h))} (${(h * 100).toFixed(0)}%)`); }
console.log(`\nTOTAL $200k: 5% every week ${f$(tot.p5)} · 10% every week ${f$(tot.p10)} · 5% after down weeks ${f$(tot.p5d)} · buy-and-hold ${f$(tot.hold)}`);
