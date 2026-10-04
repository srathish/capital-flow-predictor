#!/usr/bin/env node
// Robustness for the UW signals that passed (shadow/uw_signals.mjs): survivorship control (same stock, random dates),
// median / trimmed mean, without the top stocks, by year, by market cap. No new data — reads journal/uw_signals.json + .cache/daily.
import fs from 'node:fs';
import { loadDaily } from '../desk/common.mjs';
const E = JSON.parse(fs.readFileSync(new URL('./journal/uw_signals.json', import.meta.url)));
const spy = loadDaily('SPY'), sIx = new Map(spy.map((b, i) => [b.d, i]));
function fwd(bars, i0, n) { const si = sIx.get(bars[i0].d); if (si == null || i0 + n - 1 >= bars.length || si + n - 1 >= spy.length || i0 < 61) return null;
  const xs = [], ys = []; for (let k = i0 - 60; k < i0; k++) { const a = sIx.get(bars[k].d), p = sIx.get(bars[k - 1].d); if (a == null || p == null) continue; xs.push(spy[a].c / spy[p].c - 1); ys.push(bars[k].c / bars[k - 1].c - 1); }
  const mx = xs.reduce((a, x) => a + x, 0) / xs.length, my = ys.reduce((a, x) => a + x, 0) / ys.length; const beta = xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1;
  return (bars[i0 + n - 1].c / bars[i0].o - 1) - beta * (spy[si + n - 1].c / spy[si].o - 1); }
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const cache = new Map(); const bars = (s) => cache.get(s) ?? cache.set(s, loadDaily(s)).get(s);
const st = (v) => { v = v.filter((x) => x != null && Number.isFinite(x)); const m = v.reduce((a, x) => a + x, 0) / v.length, sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)), s = [...v].sort((a, b) => a - b), k = Math.floor(v.length * 0.025), tr = s.slice(k, s.length - k);
  return { n: v.length, m, t: m / (sd / Math.sqrt(v.length)), med: s[s.length >> 1], trim: tr.reduce((a, x) => a + x, 0) / tr.length }; };
const pc = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%';
for (const sig of ['INS_BUY_100K', 'INS_BUY_CLUSTER', 'SI_SQUEEZE', 'SI_HIGH_DOWN']) {
  const X = E.filter((e) => e.sig === sig && e.x20 != null);
  // control: same stock, 10 random dates within ±250 sessions of the event, same direction sign
  const diff = [], ctrl = [];
  for (const e of X) { const b = bars(e.s), i = b.findIndex((x) => x.d === e.d); const cs = []; for (let k = 0; k < 10; k++) { const j = Math.max(61, Math.min(b.length - 21, i + Math.round((rnd() * 2 - 1) * 250))); const r = fwd(b, j, 20); if (r != null) cs.push(e.dir * r); }
    if (cs.length) { const c = cs.reduce((a, x) => a + x, 0) / cs.length; ctrl.push(c); diff.push(e.x20 - c); } }
  const a = st(X.map((e) => e.x20)), c = st(ctrl), d = st(diff);
  const bySym = {}; for (const e of X) (bySym[e.s] ??= []).push(e.x20); const topS = Object.entries(bySym).map(([s, v]) => [s, v.reduce((x, y) => x + y, 0)]).sort((p, q) => q[1] - p[1]).slice(0, 5).map((x) => x[0]);
  const noTop = st(X.filter((e) => !topS.includes(e.s)).map((e) => e.x20));
  console.log(`\n== ${sig} (20d, signed) n=${a.n}`);
  console.log(`  event mean ${pc(a.m)} (t ${a.t.toFixed(1)}) · median ${pc(a.med)} · 2.5%-trimmed ${pc(a.trim)}`);
  console.log(`  same-stock random dates (control) ${pc(c.m)} · EVENT − CONTROL ${pc(d.m)} (t ${d.t.toFixed(1)}) · median diff ${pc(d.med)} · trimmed ${pc(d.trim)}`);
  console.log(`  without top-5 stocks (${topS.join(' ')}): ${pc(noTop.m)} (t ${noTop.t.toFixed(1)}) n=${noTop.n}`);
  const yrs = {}; for (const e of X) (yrs[e.d.slice(0, 4)] ??= []).push(e.x20); console.log('  by year: ' + Object.entries(yrs).sort().map(([y, v]) => { const s = st(v); return `${y} ${pc(s.m)} (med ${pc(s.med)}, n${s.n})`; }).join(' · '));
}
