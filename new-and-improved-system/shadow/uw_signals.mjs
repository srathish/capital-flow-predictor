#!/usr/bin/env node
// UNUSUAL WHALES non-flow signals for STEP 1 (finding the stock). Locked 2026-10-04 BEFORE running.
// Universe = the 294 desk stocks (.cache/daily). UW history cached in .cache/uw/ (UW quota only — no Skylit credits).
// Each event enters at the OPEN of the first session after it became public; score = sign × (stock − β·SPY) to the close
// 5 / 20 / 60 sessions later (β from the prior 60 sessions). One event per stock per signal per 20 sessions.
//   INS_BUY_CLUSTER  ≥2 different insiders open-market BUY (Form 4 code P) within 30 days, ≥ $100k total → long   (public = filing date)
//   INS_BUY_100K     any single open-market insider buy ≥ $100k → long
//   INS_SELL_CLUSTER ≥3 different insiders SELL (code S, not 10b5-1 plans) within 30 days, ≥ $5M → short
//   AN_UPGRADE / AN_DOWNGRADE  analyst rating change → long / short (before 09:30 ET → same-day open, else next open)
//   AN_PT_RAISE15    a firm raises its price target ≥15% vs its own previous target on the stock → long
//   SI_SQUEEZE       short interest ≥15% of float AND close > EMA50 AND 20d return > 0 → long (published ≈8 sessions after
//                    the settlement date → enters 9 sessions after it)
//   SI_HIGH_DOWN     short interest ≥15% of float AND close < EMA50 → short
// ✓ = 20-session result > 0 in BOTH halves (split at the median event date) AND overall t ≥ 2.
//   node shadow/uw_signals.mjs
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';
import { universe, loadDaily } from '../desk/common.mjs';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), C = path.join(HERE, '..', '.cache', 'uw');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let last = 0;
async function uw(p) {
  for (let k = 0; k < 5; k++) {
    const w = 260 - (Date.now() - last); if (w > 0) await sleep(w); last = Date.now();
    const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
    if (r?.status === 429) { await sleep(5000 * (k + 1)); continue; }
    if (!r?.ok) return null; return r.json().catch(() => null);
  }
  return null;
}
async function cached(kind, sym, fetcher) {
  const f = path.join(C, kind, `${sym}.json`); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fetcher(); if (v == null) return null; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); return v;
}
const insider = (s) => cached('insider', s, async () => { const out = []; for (let p = 0; p < 6; p++) { const j = await uw(`/insider/transactions?ticker_symbol=${s}&limit=500&page=${p}`); if (!j) return p ? out : null; const d = j.data ?? []; out.push(...d.filter((r) => ['P', 'S'].includes(r.transaction_code)).map((r) => ({ d: r.transaction_date, f: r.filing_date, code: r.transaction_code, who: r.owner_name, sh: Math.abs(r.amount), px: +r.price, plan: r.is_10b5_1 }))); if (d.length < 500 || d.at(-1).transaction_date < '2023-01-01') break; } return out; });
const analysts = (s) => cached('analyst', s, async () => { const j = await uw(`/screener/analysts?ticker=${s}&limit=500`); return j ? (j.data ?? []).map((r) => ({ ts: r.timestamp, action: r.action, target: r.target != null ? +r.target : null, firm: r.firm, rec: r.recommendation })) : null; });
const shorts = (s) => cached('si', s, async () => { const j = await uw(`/shorts/${s}/interest-float/v2`); return j ? (j.data ?? []).map((r) => ({ d: r.market_date, si: +r.si_float })) : null; });

const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10);
const spy = loadDaily('SPY'), sIx = new Map(spy.map((b, i) => [b.d, i]));
const ema = (xs, n) => { const k = 2 / (n + 1); let e = xs[0]; for (const x of xs.slice(1)) e = x * k + e * (1 - k); return e; };
function fwd(bars, i0, n) {
  const si = sIx.get(bars[i0].d); if (si == null || i0 + n - 1 >= bars.length || si + n - 1 >= spy.length || i0 < 61) return null;
  const xs = [], ys = []; for (let k = i0 - 60; k < i0; k++) { const a = sIx.get(bars[k].d), p = sIx.get(bars[k - 1].d); if (a == null || p == null) continue; xs.push(spy[a].c / spy[p].c - 1); ys.push(bars[k].c / bars[k - 1].c - 1); }
  const mx = xs.reduce((a, x) => a + x, 0) / xs.length, my = ys.reduce((a, x) => a + x, 0) / ys.length;
  const beta = xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1;
  return (bars[i0 + n - 1].c / bars[i0].o - 1) - beta * (spy[si + n - 1].c / spy[si].o - 1);
}

const UNI = universe(), events = [];
let n = 0;
for (const s of UNI) {
  const bars = loadDaily(s); if (bars.length < 120) continue;
  const firstAfter = (d) => bars.findIndex((b) => b.d > d), onOrAfter = (d) => bars.findIndex((b) => b.d >= d);
  const lastBy = {}; const push = (sig, dir, i, meta) => { if (i < 0) return; if (lastBy[sig] != null && i - lastBy[sig] < 20) return; lastBy[sig] = i;
    const ev = { sig, s, d: bars[i].d, dir, ...meta }; for (const h of [5, 20, 60]) { const x = fwd(bars, i, h); ev[`x${h}`] = x == null ? null : dir * x; } events.push(ev); };
  // insiders
  const ins = (await insider(s)) ?? [];
  const buys = ins.filter((r) => r.code === 'P').sort((a, b) => a.f.localeCompare(b.f)), sells = ins.filter((r) => r.code === 'S' && !r.plan).sort((a, b) => a.f.localeCompare(b.f));
  for (const b of buys) {
    const win = buys.filter((x) => x.d <= b.d && x.d >= new Date(Date.parse(b.d) - 30 * 864e5).toISOString().slice(0, 10)), val = win.reduce((a, x) => a + x.sh * x.px, 0);
    if (new Set(win.map((x) => x.who)).size >= 2 && val >= 1e5) push('INS_BUY_CLUSTER', 1, firstAfter(b.f), { val: Math.round(val) });
    if (b.sh * b.px >= 1e5) push('INS_BUY_100K', 1, firstAfter(b.f), { val: Math.round(b.sh * b.px) });
  }
  for (const b of sells) {
    const win = sells.filter((x) => x.d <= b.d && x.d >= new Date(Date.parse(b.d) - 30 * 864e5).toISOString().slice(0, 10)), val = win.reduce((a, x) => a + x.sh * x.px, 0);
    if (new Set(win.map((x) => x.who)).size >= 3 && val >= 5e6) push('INS_SELL_CLUSTER', -1, firstAfter(b.f), { val: Math.round(val) });
  }
  // analysts
  const an = ((await analysts(s)) ?? []).sort((a, b) => a.ts.localeCompare(b.ts)), prevT = {};
  for (const a of an) {
    const d = a.ts.slice(0, 10), pre = a.ts.slice(11, 16) < '13:30', i = pre ? onOrAfter(d) : firstAfter(d);
    if (a.action === 'upgraded') push('AN_UPGRADE', 1, i, { firm: a.firm });
    if (a.action === 'downgraded') push('AN_DOWNGRADE', -1, i, { firm: a.firm });
    const pt = prevT[a.firm]; if (a.target && pt && a.target >= 1.15 * pt) push('AN_PT_RAISE15', 1, i, { firm: a.firm, from: pt, to: a.target });
    if (a.target) prevT[a.firm] = a.target;
  }
  // short interest
  for (const r of ((await shorts(s)) ?? []).sort((a, b) => a.d.localeCompare(b.d))) {
    if (!(r.si >= 0.15)) continue;
    const i0 = onOrAfter(r.d); if (i0 < 0) continue; const i = i0 + 9; if (i >= bars.length || i < 60) continue;
    const closes = bars.slice(0, i).map((b) => b.c), above = closes.at(-1) > ema(closes.slice(-150), 50), r20 = closes.at(-1) / closes.at(-21) - 1;
    if (above && r20 > 0) push('SI_SQUEEZE', 1, i, { si: +r.si.toFixed(3) });
    if (!above) push('SI_HIGH_DOWN', -1, i, { si: +r.si.toFixed(3) });
  }
  if (++n % 50 === 0) console.error(`… ${n}/${UNI.length} stocks`);
}
fs.writeFileSync(path.join(HERE, 'journal', 'uw_signals.json'), JSON.stringify(events));

const st = (v) => { v = v.filter((x) => x != null); if (v.length < 2) return { n: v.length, m: NaN, t: NaN }; const m = v.reduce((a, x) => a + x, 0) / v.length, sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)); return { n: v.length, m, t: m / (sd / Math.sqrt(v.length)), hit: v.filter((x) => x > 0).length / v.length }; };
const pc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '   -  ');
console.log(`UW signals · ${n} stocks · ${events.length} events · beta-adjusted, signed by the signal's direction\n`);
console.log(`${'signal'.padEnd(18)} ${'n'.padStart(5)}   5d            20d                      60d          | 20d by half`);
for (const sig of ['INS_BUY_CLUSTER', 'INS_BUY_100K', 'INS_SELL_CLUSTER', 'AN_UPGRADE', 'AN_DOWNGRADE', 'AN_PT_RAISE15', 'SI_SQUEEZE', 'SI_HIGH_DOWN']) {
  const E = events.filter((e) => e.sig === sig).sort((a, b) => a.d.localeCompare(b.d)); if (!E.length) { console.log(`  ${sig.padEnd(16)} no events`); continue; }
  const med = E[Math.floor(E.length / 2)].d, a = st(E.filter((e) => e.d < med).map((e) => e.x20)), b = st(E.filter((e) => e.d >= med).map((e) => e.x20));
  const s5 = st(E.map((e) => e.x5)), s20 = st(E.map((e) => e.x20)), s60 = st(E.map((e) => e.x60));
  const ok = a.m > 0 && b.m > 0 && s20.t >= 2;
  console.log(`${ok ? '✓' : ' '} ${sig.padEnd(16)} ${String(E.length).padStart(5)}   ${pc(s5.m)} (t ${s5.t.toFixed(1)})   ${pc(s20.m)} (t ${s20.t.toFixed(1)}, hit ${Math.round(s20.hit * 100)}%)   ${pc(s60.m)} (t ${s60.t.toFixed(1)}) | ${E[0].d}→${med}: ${pc(a.m)} n${a.n} · →${E.at(-1).d}: ${pc(b.m)} n${b.n}`);
}
