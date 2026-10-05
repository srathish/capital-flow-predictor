#!/usr/bin/env node
// Literature variants of the insider-buy book. Locked 2026-10-05 BEFORE running. Chosen on TRAIN (2022–2024) ONLY; the single
// best variant (highest TRAIN hedged mean with ≥ 60 trades) is then checked ONCE on TEST (2025–2026). Same trade rules as
// insider_book.mjs (open after filing → close 20 sessions later, costs, β-hedge). UW only (re-pull with title + holdings), 0 Skylit.
//   V0 base        any open-market buy ≥ $100k
//   V1 officer     buyer is an officer (CEO / CFO / President / COO / Chief …), not only a director/10% owner
//   V2 big         purchase ≥ $500k
//   V3 conviction  purchase raises the insider's holdings ≥ 10% (shares_owned_after / before ≥ 1.10)
//   V4 opportunistic  the insider made no open-market purchase in the prior 365 days (non-routine; Cohen–Malloy–Pomorski)
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';
import { universe, loadDaily } from '../desk/common.mjs';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), C = path.join(HERE, '..', '.cache', 'uw', 'insider2');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let last = 0;
async function uw(p) { for (let k = 0; k < 5; k++) { const w = 260 - (Date.now() - last); if (w > 0) await sleep(w); last = Date.now();
  const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
  if (r?.status === 429) { await sleep(5000 * (k + 1)); continue; } return r?.ok ? r.json().catch(() => null) : null; } return null; }
async function buys(s) {
  const f = path.join(C, `${s}.json`); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const out = []; for (let p = 0; p < 6; p++) { const j = await uw(`/insider/transactions?ticker_symbol=${s}&transaction_codes[]=P&limit=500&page=${p}`); if (!j) break; const d = j.data ?? [];
    out.push(...d.filter((r) => r.transaction_code === 'P').map((r) => ({ d: r.transaction_date, f: r.filing_date, who: r.owner_name, sh: Math.abs(r.amount), px: +r.price, title: r.officer_title ?? '', officer: !!r.is_officer, dir: !!r.is_director, ten: !!r.is_ten_percent_owner, before: r.shares_owned_before, after: r.shares_owned_after })));
    if (d.length < 500) break; }
  fs.mkdirSync(C, { recursive: true }); fs.writeFileSync(f, JSON.stringify(out)); return out;
}
const spy = loadDaily('SPY'), sIx = new Map(spy.map((b, i) => [b.d, i]));
function trade(b, i0) { if (i0 < 61 || i0 + 19 >= b.length) return null; const si0 = sIx.get(b[i0].d); if (si0 == null || si0 + 19 >= spy.length) return null;
  const xs = [], ys = []; for (let k = i0 - 60; k < i0; k++) { const a = sIx.get(b[k].d), p = sIx.get(b[k - 1].d); if (a == null || p == null) continue; xs.push(spy[a].c / spy[p].c - 1); ys.push(b[k].c / b[k - 1].c - 1); }
  const mx = xs.reduce((a, x) => a + x, 0) / xs.length, my = ys.reduce((a, x) => a + x, 0) / ys.length, beta = Math.max(0, Math.min(3, xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1));
  const cost = b[i0].o < 20 ? 0.002 : 0.001, ret = b[i0 + 19].c / b[i0].o - 1, sr = spy[si0 + 19].c / spy[si0].o - 1; return { u: ret - cost, h: ret - beta * sr - cost }; }
const OFF = /chief|ceo|cfo|coo|president|officer|chairman|founder/i;
const V = { V0_base: () => true, V1_officer: (x) => x.officer || OFF.test(x.title), V2_big: (x) => x.sh * x.px >= 5e5, V3_conviction: (x) => x.before > 0 && x.after / x.before >= 1.1, V4_opportunistic: (x) => x.firstIn365 };
const rows = []; let n = 0;
for (const s of universe()) {
  const b = loadDaily(s); if (b.length < 150) continue; const B = (await buys(s)).sort((a, c) => a.f.localeCompare(c.f));
  for (const x of B) x.firstIn365 = !B.some((y) => y.who === x.who && y.d < x.d && y.d >= new Date(Date.parse(x.d) - 365 * 864e5).toISOString().slice(0, 10));
  const last = {};
  for (const x of B) { if (x.sh * x.px < 1e5 || !x.f) continue; const i0 = b.findIndex((y) => y.d > x.f); if (i0 < 0) continue;
    for (const [k, f] of Object.entries(V)) { if (!f(x)) continue; if (last[k] != null && i0 - last[k] < 20) continue; const t = trade(b, i0); if (!t) continue; last[k] = i0; rows.push({ v: k, s, d: b[i0].d, set: b[i0].d < '2025-01-01' ? 'TRAIN' : 'TEST', ...t }); } }
  if (++n % 50 === 0) console.error(`… ${n}`);
}
const st = (v) => { if (v.length < 2) return { n: v.length, m: NaN, t: NaN }; const m = v.reduce((a, x) => a + x, 0) / v.length, sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)), s = [...v].sort((a, b) => a - b); return { n: v.length, m, t: m / (sd / Math.sqrt(v.length)), med: s[s.length >> 1], win: v.filter((x) => x > 0).length / v.length }; };
const pc = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%';
console.log('INSIDER VARIANTS — TRAIN (2022–2024) only; the winner is checked once on TEST\n');
let best = null;
for (const k of Object.keys(V)) { const h = st(rows.filter((r) => r.v === k && r.set === 'TRAIN').map((r) => r.h)), u = st(rows.filter((r) => r.v === k && r.set === 'TRAIN').map((r) => r.u));
  console.log(`  ${k.padEnd(18)} n ${String(h.n).padStart(4)} · hedged ${pc(h.m)} (t ${h.t.toFixed(1)}, median ${pc(h.med)}, win ${Math.round(h.win * 100)}%) · unhedged ${pc(u.m)}`);
  if (k !== 'V0_base' && h.n >= 60 && (!best || h.m > best.m)) best = { k, m: h.m }; }
const T = st(rows.filter((r) => r.v === best.k && r.set === 'TEST').map((r) => r.h)), TU = st(rows.filter((r) => r.v === best.k && r.set === 'TEST').map((r) => r.u)), B0 = st(rows.filter((r) => r.v === 'V0_base' && r.set === 'TEST').map((r) => r.h));
console.log(`\nTRAIN winner: ${best.k} → TEST (2025–2026): hedged ${pc(T.m)} (t ${T.t.toFixed(1)}, n ${T.n}, median ${pc(T.med)}, win ${Math.round(T.win * 100)}%) · unhedged ${pc(TU.m)} · base on TEST ${pc(B0.m)} (t ${B0.t.toFixed(1)})`);
console.log(`VERDICT: ${T.m > 0 && T.t >= 2 && T.m > B0.m ? 'PASS — beats base out of sample' : 'FAIL'}`);
fs.writeFileSync(path.join(HERE, 'journal', 'insider_variants.json'), JSON.stringify(rows));
