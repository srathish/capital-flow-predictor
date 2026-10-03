#!/usr/bin/env node
// EARNINGS: are there stocks whose options keep UNDER-pricing the earnings move? (option-buyer stock selection)
// Locked 2026-10-03 BEFORE running. Data: Skylit Tempest `tempest_events` record (≈8 past reports/stock: priced move vs actual
// move), 1 credit per 10 symbols, cached in .cache/earnings.json.
//   Straddle proxy per report = (|actual| − priced) / priced  (buying the priced move at the close before, held through the print).
//   Walk-forward: report k is predicted ONLY from that stock's reports before k (needs ≥3 prior).
//   Selectors: S1 "beat before" = prior median |actual|/priced ≥ 1 · S2 beat-share of prior ≥ 50% · S3 last report beat ·
//              S0 all (baseline — expected negative, implied moves are overpriced).
//   Halves: reports before 2025-07-01 vs after. ✓ = selector's avg straddle return > 0 in BOTH halves and n ≥ 15 each.
import fs from 'node:fs';
import path from 'node:path';
import { mcp } from '../feeds/skylit.js';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), F = path.join(HERE, '..', '.cache', 'earnings.json');
const ETF = new Set('ARKK DIA DRAM ETHA EWY FXI GDX GLD HYG IBIT IGV IVV IWM KRE KWEB QQQ SLV SMH SOXL SPY SQQQ TLT TQQQ USO UVXY XLB XLC XLE XLF XLI XLK XLP XLU XLV XLY GOOG'.split(' '));
const UNI = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'apps/gex/research/stock-gex/universe-structures.json'), 'utf8')).rows.map((r) => r.ticker).filter((t) => !ETF.has(t)).sort();
let cache = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, 'utf8')) : {};
const need = UNI.filter((s) => !(s in cache));
for (let i = 0; i < need.length; i += 10) {
  const batch = need.slice(i, i + 10);
  try { const r = await mcp('tempest_events', { symbols: batch.join(',') }); for (const x of r.data.symbols) cache[x.symbol] = x.events ?? null; for (const m of r.data.missing ?? []) cache[m] = null; }
  catch (e) { console.error('batch fail', batch.join(','), e.message.slice(0, 120)); }
}
fs.writeFileSync(F, JSON.stringify(cache));

const rows = [];
for (const [s, ev] of Object.entries(cache)) {
  const rep = (ev?.record?.reports ?? []).filter((r) => r.priced_pct > 0 && Number.isFinite(r.actual_pct)).sort((a, b) => a.date.localeCompare(b.date));
  for (let k = 3; k < rep.length; k++) {
    const prior = rep.slice(0, k).map((r) => Math.abs(r.actual_pct) / r.priced_pct), cur = rep[k];
    const med = [...prior].sort((a, b) => a - b)[Math.floor(prior.length / 2)];
    rows.push({ s, date: cur.date, half: cur.date < '2025-07-01' ? 'H1' : 'H2', ret: (Math.abs(cur.actual_pct) - cur.priced_pct) / cur.priced_pct, beat: Math.abs(cur.actual_pct) > cur.priced_pct,
      priorMed: med, priorShare: prior.filter((x) => x > 1).length / prior.length, lastBeat: prior.at(-1) > 1, priced: cur.priced_pct });
  }
}
const SEL = { 'S0 all reports': () => true, 'S1 prior median beat (≥1)': (r) => r.priorMed >= 1, 'S2 beat ≥50% of prior': (r) => r.priorShare >= 0.5, 'S3 last report beat': (r) => r.lastBeat,
  'S1 inverse (prior med < 0.6)': (r) => r.priorMed < 0.6 };
const st = (R) => { if (R.length < 2) return { n: R.length, m: NaN, s: `n=${R.length}` }; const v = R.map((r) => r.ret), m = v.reduce((a, x) => a + x, 0) / v.length, sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1));
  return { n: R.length, m, s: `n=${String(R.length).padStart(4)} beat ${String(Math.round(R.filter((r) => r.beat).length / R.length * 100)).padStart(3)}%  straddle avg ${(m * 100).toFixed(1).padStart(6)}%  t=${(m / (sd / Math.sqrt(v.length))).toFixed(1).padStart(5)}` }; };
console.log(`stocks with earnings history: ${Object.values(cache).filter((e) => e?.record?.reports?.length).length} · walk-forward reports: ${rows.length}\n`);
for (const [k, f] of Object.entries(SEL)) {
  const a = st(rows.filter((r) => r.half === 'H1' && f(r))), b = st(rows.filter((r) => r.half === 'H2' && f(r)));
  console.log(`${a.m > 0 && b.m > 0 && a.n >= 15 && b.n >= 15 ? '✓' : ' '} ${k.padEnd(30)} before Jul-25 ${a.s}\n  ${''.padEnd(30)} after  Jul-25 ${b.s}`);
}
// persistence: correlation of prior median ratio with next ratio
const x = rows.map((r) => r.priorMed), y = rows.map((r) => r.ret + 1), mx = x.reduce((a, v) => a + v, 0) / x.length, my = y.reduce((a, v) => a + v, 0) / y.length;
const corr = x.reduce((a, v, i) => a + (v - mx) * (y[i] - my), 0) / Math.sqrt(x.reduce((a, v) => a + (v - mx) ** 2, 0) * y.reduce((a, v) => a + (v - my) ** 2, 0));
console.log(`\npersistence: corr(prior median move/priced, next move/priced) = ${corr.toFixed(3)} over ${rows.length} reports`);
const up = Object.entries(cache).filter(([, e]) => e?.next_date && e.next_date >= '2026-10-05' && e.next_date <= '2026-11-06').map(([s, e]) => { const rep = e.record?.reports ?? []; const r = rep.map((q) => Math.abs(q.actual_pct) / q.priced_pct).sort((a, b) => a - b); return { s, d: e.next_date, med: r.length ? r[Math.floor(r.length / 2)] : null, share: r.length ? r.filter((q) => q > 1).length / r.length : null, implied: e.implied_move_pct }; }).filter((x) => x.med != null && x.med >= 1).sort((a, b) => a.d.localeCompare(b.d));
console.log(`\nreporting Oct 5 – Nov 6 whose past moves BEAT the priced move (median ≥1): ${up.map((x) => `${x.s} ${x.d.slice(5)} (med ${x.med.toFixed(2)}, implied ${x.implied}%)`).join(' · ') || 'none'}`);
fs.writeFileSync(path.join(HERE, 'journal', 'earnings_study.json'), JSON.stringify(rows));
