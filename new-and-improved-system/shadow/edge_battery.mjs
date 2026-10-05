#!/usr/bin/env node
// EDGE BATTERY — five documented market anomalies, tested on our data with costs. Locked 2026-10-05 BEFORE running.
// UW + cached data only (run with SKYLIT_BUDGET=0). Each test: positive in BOTH halves, t ≥ 2, and survives Benjamini–Hochberg
// (q = 0.10) across the 5 tests.
//   T1 TURN OF MONTH  long SPY from the close of trading day −2 to the close of day +3 around each month end vs all other days.
//                     Cost 0.01% per round trip. SPY daily 2022–2026.
//   T2 OVERNIGHT      long SPY close → next open only, vs open → close. Cost 0.01% per day (two trades). SPY daily 2022–2026.
//   T3 INTRADAY MOMENTUM (Gao–Han–Li–Zhou 2018)  sign of SPY's prior close → 10:00 return → trade 15:30 → 15:59 that way.
//                     Cost 0.01% per trade. UW SPY 1-min 2023–2026.
//   T4 POST-EARNINGS DRIFT  surprise = (actual − estimate EPS) ÷ price; each calendar quarter, top 20% long / bottom 20% short;
//                     enter at the CLOSE of the first full session after the report (the jump excluded), hold 40 sessions,
//                     β-adjusted vs SPY, cost 0.10%. 294 universe stocks, reports 2022-03 → 2026-07.
//   T5 PRE-FOMC DRIFT long SPY from the prior close to 14:00 on FOMC announcement days vs the same window on all other days.
//                     UW SPY 1-min 2023–2026.
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';
import { universe, loadDaily } from '../desk/common.mjs';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), M1 = path.join(HERE, '..', '.cache', 'uw', 'spy1m');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function spy1m(d) {
  const f = path.join(M1, `${d}.json`); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  for (let k = 0; k < 4; k++) { await sleep(260);
    const r = await fetch(`https://api.unusualwhales.com/api/stock/SPY/ohlc/1m?date=${d}&limit=1000`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
    if (r?.status === 429) { await sleep(4000 * (k + 1)); continue; } const j = r?.ok ? await r.json().catch(() => null) : null; if (!j) return null;
    const bars = (j.data ?? []).map((b) => ({ t: Math.floor(Date.parse(b.start_time) / 1000), o: +b.open, h: +b.high, l: +b.low, c: +b.close, m: b.market_time })).sort((a, b) => a.t - b.t);
    fs.mkdirSync(M1, { recursive: true }); fs.writeFileSync(f, JSON.stringify(bars)); return bars; }
  return null;
}
const etHM = (t, d) => { const off = new Date(d + 'T12:00:00Z').getUTCMonth() >= 2 && new Date(d + 'T12:00:00Z').getUTCMonth() <= 10 ? 4 : 5; return new Date((t - off * 3600) * 1000).toISOString().slice(11, 16); }; // approx DST (Mar–Nov)
const st = (v) => { v = v.filter(Number.isFinite); const m = v.reduce((a, x) => a + x, 0) / v.length, sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)); return { n: v.length, m, sd, t: m / (sd / Math.sqrt(v.length)) }; };
const welch = (a, b) => { const A = st(a), B = st(b); return { diff: A.m - B.m, t: (A.m - B.m) / Math.sqrt(A.sd ** 2 / A.n + B.sd ** 2 / B.n), A, B }; };
const bp = (x) => (x >= 0 ? '+' : '') + (x * 1e4).toFixed(1) + 'bp';
const results = [];
const report = (name, halves, all, note) => { const ok = halves.every((h) => h > 0) && all.t >= 2; results.push({ name, t: all.t, halvesOk: halves.every((h) => h > 0), ok }); console.log(`${name}\n  ${note}\n  halves: ${halves.map(bp).join(' / ')} · t ${all.t.toFixed(2)} → ${ok ? 'passes t & halves' : 'fails'}\n`); };

const spy = loadDaily('SPY');
// ---- T1 turn of month
{ const isTOMexit = new Set(), tomDays = new Set();
  const byMonth = {}; spy.forEach((b, i) => (byMonth[b.d.slice(0, 7)] ??= []).push(i));
  const months = Object.keys(byMonth).sort();
  for (let k = 0; k + 1 < months.length; k++) { const cur = byMonth[months[k]], nxt = byMonth[months[k + 1]]; const days = [cur.at(-1), ...nxt.slice(0, 3)]; days.forEach((i) => tomDays.add(i)); }
  const r = spy.map((b, i) => (i ? b.c / spy[i - 1].c - 1 : null));
  const tom = [], other = [], tradesByHalf = { a: [], b: [] };
  spy.forEach((b, i) => { if (!i) return; (tomDays.has(i) ? tom : other).push({ r: r[i], d: b.d }); });
  // strategy: one round trip per month, cost 0.01%
  const perMonth = {}; for (const x of tom) { const mk = x.d.slice(0, 7); (perMonth[mk] ??= []).push(x.r); }
  const trades = Object.entries(perMonth).map(([mk, v]) => ({ mk, r: v.reduce((a, y) => a * (1 + y), 1) - 1 - 0.0001 }));
  const w = welch(tom.map((x) => x.r), other.map((x) => x.r)), mid = '2024-01';
  const h1 = st(trades.filter((x) => x.mk < mid).map((x) => x.r)).m - 4 * st(other.filter((x) => x.d < mid).map((x) => x.r)).m, h2 = st(trades.filter((x) => x.mk >= mid).map((x) => x.r)).m - 4 * st(other.filter((x) => x.d >= mid).map((x) => x.r)).m;
  report('T1 TURN OF MONTH (SPY 2022–2026)', [h1, h2], { t: w.t }, `TOM day ${bp(w.A.m)} vs other day ${bp(w.B.m)} (n ${w.A.n}/${w.B.n}) · per-month TOM trade ${bp(st(trades.map((x) => x.r)).m)} net vs 4 normal days ${bp(4 * w.B.m)} · halves = TOM trade minus 4 normal days`); }
// ---- T2 overnight
{ const on = [], id = []; spy.forEach((b, i) => { if (!i) return; on.push({ r: b.o / spy[i - 1].c - 1 - 0.0001, d: b.d }); id.push({ r: b.c / b.o - 1, d: b.d }); });
  const s = st(on.map((x) => x.r)), mid = '2024-01-01';
  report('T2 OVERNIGHT DRIFT (SPY 2022–2026)', [st(on.filter((x) => x.d < mid).map((x) => x.r)).m, st(on.filter((x) => x.d >= mid).map((x) => x.r)).m], s,
    `overnight (net of 0.01%) ${bp(s.m)}/day (n ${s.n}) vs intraday ${bp(st(id.map((x) => x.r)).m)}/day · annualized overnight-only ≈ ${((Math.pow(1 + s.m, 252) - 1) * 100).toFixed(1)}%`); }
// ---- T3 intraday momentum + T5 pre-FOMC (minute data)
const FOMC = new Set(['2023-02-01', '2023-03-22', '2023-05-03', '2023-06-14', '2023-07-26', '2023-09-20', '2023-11-01', '2023-12-13', '2024-01-31', '2024-03-20', '2024-05-01', '2024-06-12', '2024-07-31', '2024-09-18', '2024-11-07', '2024-12-18',
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10', '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16']);
{ const days = spy.map((b) => b.d).filter((d) => d >= '2023-01-03'); const mom = [], fomc = [], nonF = []; let prevClose = null, prevD = null, got = 0;
  for (const d of days) { const all = await spy1m(d); if (!all?.length) { prevClose = null; continue; } got++;
    const r = all.filter((b) => b.m === 'r'); if (r.length < 380) { prevClose = r.at(-1)?.c ?? null; continue; }
    const at = (hm) => { let x = null; for (const b of r) { if (etHM(b.t, d) <= hm) x = b; else break; } return x; };
    const p10 = at('09:59')?.c, p1530 = at('15:29')?.c, p1559 = at('15:59')?.c ?? r.at(-1).c, p14 = at('13:59')?.c;
    if (prevClose && p10 && p1530) { const s1 = Math.sign(p10 / prevClose - 1); if (s1) mom.push({ d, r: s1 * (p1559 / p1530 - 1) - 0.0001 }); }
    if (prevClose && p14) (FOMC.has(d) ? fomc : nonF).push({ d, r: p14 / prevClose - 1 });
    prevClose = r.at(-1).c; prevD = d; }
  const s = st(mom.map((x) => x.r)), mid = '2025-01-01';
  report('T3 INTRADAY MOMENTUM (SPY 2023–2026, last 30 min in the direction of the first 30 min)', [st(mom.filter((x) => x.d < mid).map((x) => x.r)).m, st(mom.filter((x) => x.d >= mid).map((x) => x.r)).m], s, `${got} minute-days · per trade net ${bp(s.m)} (n ${s.n}, win ${Math.round(mom.filter((x) => x.r > 0).length / mom.length * 100)}%)`);
  const w = welch(fomc.map((x) => x.r), nonF.map((x) => x.r));
  report('T5 PRE-FOMC DRIFT (SPY prior close → 14:00, 2023–2026)', [st(fomc.filter((x) => x.d < mid).map((x) => x.r)).m - st(nonF.filter((x) => x.d < mid).map((x) => x.r)).m, st(fomc.filter((x) => x.d >= mid).map((x) => x.r)).m - st(nonF.filter((x) => x.d >= mid).map((x) => x.r)).m], { t: w.t },
    `FOMC days ${bp(w.A.m)} (n ${w.A.n}) vs other days ${bp(w.B.m)} (n ${w.B.n}) · halves = FOMC minus other`); }
// ---- T4 post-earnings drift
{ const sIx = new Map(spy.map((b, i) => [b.d, i])), ev = [];
  for (const s of universe()) { const f = path.join(HERE, '..', '.cache', 'uw', 'earnings', `${s}.json`); if (!fs.existsSync(f)) continue; const b = loadDaily(s); if (b.length < 150) continue;
    for (const e of JSON.parse(fs.readFileSync(f, 'utf8'))) { if (e.actual_eps == null || e.street_mean_est == null || !e.report_date || e.report_date < '2022-03-01' || e.report_date > '2026-07-31') continue;
      const after = e.report_time === 'postmarket' ? 2 : 1; let i0 = b.findIndex((x) => x.d >= e.report_date); if (i0 < 61) continue; if (b[i0].d === e.report_date && e.report_time !== 'postmarket') i0 = i0; i0 += after - 1; // close of first full post-report session
      if (i0 + 40 >= b.length) continue; const si0 = sIx.get(b[i0].d); if (si0 == null || si0 + 40 >= spy.length) continue;
      const px = b[i0 - after].c, sue = (+e.actual_eps - +e.street_mean_est) / px;
      const xs = [], ys = []; for (let k = i0 - 60; k < i0; k++) { const a = sIx.get(b[k].d), p = sIx.get(b[k - 1].d); if (a == null || p == null) continue; xs.push(spy[a].c / spy[p].c - 1); ys.push(b[k].c / b[k - 1].c - 1); }
      const mx = xs.reduce((a, x) => a + x, 0) / xs.length, my = ys.reduce((a, x) => a + x, 0) / ys.length, beta = xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1;
      ev.push({ s, d: b[i0].d, q: e.report_date.slice(0, 4) + 'Q' + (Math.floor(+e.report_date.slice(5, 7) / 3.01) + 1), sue, x: (b[i0 + 40].c / b[i0].c - 1) - beta * (spy[si0 + 40].c / spy[si0].c - 1) }); } }
  const legs = []; for (const q of [...new Set(ev.map((e) => e.q))]) { const E = ev.filter((e) => e.q === q).sort((a, b) => a.sue - b.sue); if (E.length < 25) continue; const k = Math.floor(E.length * 0.2);
    for (const e of E.slice(-k)) legs.push({ d: e.d, r: e.x - 0.001 }); for (const e of E.slice(0, k)) legs.push({ d: e.d, r: -e.x - 0.001 }); }
  const s = st(legs.map((x) => x.r)), mid = '2024-03-01';
  report('T4 POST-EARNINGS DRIFT (294 stocks, top/bottom 20% surprise, 40 sessions, β-adj)', [st(legs.filter((x) => x.d < mid).map((x) => x.r)).m, st(legs.filter((x) => x.d >= mid).map((x) => x.r)).m], s, `${ev.length} reports → ${legs.length} legs · per leg net ${bp(s.m)} (long-surprise and short-surprise signed)`); }
// ---- Benjamini–Hochberg
const p = (t) => { const z = Math.abs(t), y = 1 / (1 + 0.2316419 * z), d = 0.3989423 * Math.exp(-z * z / 2); const q = d * y * (0.3193815 + y * (-0.3565638 + y * (1.781478 + y * (-1.821256 + y * 1.330274)))); return t > 0 ? q : 1 - q; }; // one-sided
const P = results.map((r) => ({ ...r, p: p(r.t) })).sort((a, b) => a.p - b.p); let cut = -1; P.forEach((r, i) => { if (r.p <= ((i + 1) / P.length) * 0.10) cut = i; });
console.log('SUMMARY (Benjamini–Hochberg q = 0.10 across the 5 tests):'); P.forEach((r, i) => console.log(`  ${r.name.split(' (')[0].padEnd(28)} one-sided p ${r.p.toFixed(4)} · halves ${r.halvesOk ? 'both +' : 'NOT both +'} → ${i <= cut && r.halvesOk ? 'EDGE ✓' : 'no'}`));
