#!/usr/bin/env node
// Rank stocks by how sideways they traded in a PICK window, then check whether that persisted in the later TEST window.
// sideways score = mean 20-day efficiency ratio (|net move| / sum of |daily moves|) — low = choppy/range-bound; plus |net drift| over the window.
import fs from 'node:fs';
import { loadBars } from './earnings_fly_collect.mjs';
const C = new URL('../.cache/', import.meta.url);
const [P0, P1, T0, T1] = ['2025-01-02', '2025-09-30', '2025-10-01', '2026-10-02'];
const stat = (B, a, b) => { const x = B.filter((q) => q.d >= a && q.d <= b); if (x.length < 120) return null; const er = []; for (let i = 20; i < x.length; i += 5) { let s = 0; for (let j = i - 19; j <= i; j++) s += Math.abs(x[j].c - x[j - 1].c); er.push(Math.abs(x[i].c - x[i - 20].c) / s); }
  const r = []; for (let i = 1; i < x.length; i++) r.push(Math.log(x[i].c / x[i - 1].c)); const m = r.reduce((s, v) => s + v, 0) / r.length; const vol = Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / (r.length - 1) * 252);
  return { er: er.reduce((s, v) => s + v, 0) / er.length, drift: x.at(-1).c / x[0].c - 1, vol, px: x.at(-1).c, maxDD: (() => { let pk = 0, dd = 0; for (const q of x) { pk = Math.max(pk, q.c); dd = Math.min(dd, q.c / pk - 1); } return dd; })() }; };
const rows = [];
for (const f of fs.readdirSync(new URL('daily/', C))) { const T = f.replace('.json', ''); if (/^(SPY|QQQ|IWM|DIA|XL.|SMH|GLD|TLT|.*X)$/.test(T)) continue; const B = loadBars(T); if (!B) continue; const a = stat(B, P0, P1), b = stat(B, T0, T1); if (!a || !b || a.px < 20) continue; rows.push({ T, a, b }); }
// sideways = low efficiency + small drift + moderate vol (enough premium) + no deep drawdown
for (const r of rows) r.score = r.a.er + Math.abs(r.a.drift) * 0.5 + Math.max(0, -r.a.maxDD - 0.2);
rows.sort((x, y) => x.score - y.score);
const q = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length;
const top = rows.slice(0, 10), rest = rows.slice(10);
console.log('universe', rows.length, '| PICK window', P0, '→', P1, '| TEST window', T0, '→', T1);
console.log('\nTop 10 most sideways in the pick window:');
for (const r of top) console.log(`  ${r.T.padEnd(6)} pick: drift ${(r.a.drift * 100).toFixed(0)}%, trendiness ${r.a.er.toFixed(2)}, vol ${(r.a.vol * 100).toFixed(0)}%, worst DD ${(r.a.maxDD * 100).toFixed(0)}%  →  test: drift ${(r.b.drift * 100).toFixed(0)}%, trendiness ${r.b.er.toFixed(2)}, worst DD ${(r.b.maxDD * 100).toFixed(0)}%`);
console.log(`\nDid sideways persist? test-window |drift| top10 ${(q(top, (r) => Math.abs(r.b.drift)) * 100).toFixed(0)}% vs others ${(q(rest, (r) => Math.abs(r.b.drift)) * 100).toFixed(0)}% | trendiness ${q(top, (r) => r.b.er).toFixed(3)} vs ${q(rest, (r) => r.b.er).toFixed(3)} | worst DD ${(q(top, (r) => r.b.maxDD) * 100).toFixed(0)}% vs ${(q(rest, (r) => r.b.maxDD) * 100).toFixed(0)}%`);
fs.writeFileSync(new URL('./results_sideways_pick.json', import.meta.url), JSON.stringify({ top: top.map((r) => r.T), rows }));
