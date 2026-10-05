#!/usr/bin/env node
// Validate the three hypotheses that came out of shadow/movers_forensics.mjs (10 hand-picked movers) on ALL 294 universe stocks.
// Locked 2026-10-05 BEFORE running. Panel: 2025-11-03 → 2026-09-18 (needs 60 prior + 10 ahead), every 5th session per stock
// (reduces overlap of the 10-session outcomes). UW only (options-volume, iv-rank 1y, earnings) — no Skylit credits.
//   H1 direction  callput z ≥ +2 (call/put volume log-ratio vs own 60d) → long; z ≤ −2 → short.
//                 PASS = right ≥ board coin + 5pp on the same days, in BOTH halves (split at 2026-05-01)
//   H2 size       ivPrem z ≥ 2 (own IV ÷ 20d realized, vs own 60d) → BIG next 10 sessions (|r10| in the stock's top 5%)
//                 PASS = P(BIG | fired) ≥ 1.5 × base in BOTH halves
//   H3 size       earnings report inside the next 10 sessions → BIG.  Same bar.
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';
import { universe, loadDaily } from '../desk/common.mjs';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), UC = path.join(HERE, '..', '.cache', 'uw');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let last = 0;
async function uw(p) { for (let k = 0; k < 5; k++) { const w = 260 - (Date.now() - last); if (w > 0) await sleep(w); last = Date.now();
  const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
  if (r?.status === 429) { await sleep(5000 * (k + 1)); continue; } return r?.ok ? r.json().catch(() => null) : null; } return null; }
async function cached(kind, sym, fn) { const f = path.join(UC, kind, `${sym}.json`); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); const v = await fn(); if (v != null) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); } return v; }
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const z = (h, v) => { h = h.filter(Number.isFinite); if (h.length < 30 || !Number.isFinite(v)) return null; const s = sd(h); return s > 0 ? (v - mean(h)) / s : null; };

const U = universe(), rows = [], daily = new Map();
let n = 0;
for (const s of U) {
  const bars = loadDaily(s); if (bars.length < 150) continue; daily.set(s, bars);
  const ov = await cached('optvol', s, async () => (await uw(`/stock/${s}/options-volume?limit=500`))?.data ?? null) ?? [];
  const ivh = await cached('ivhist', s, async () => (await uw(`/stock/${s}/iv-rank?timespan=1y`))?.data ?? null) ?? [];
  const er = await cached('earnings', s, async () => (await uw(`/earnings/${s}`))?.data ?? null) ?? [];
  const cp = new Map(ov.filter((o) => +o.put_volume > 0 && +o.call_volume > 0).map((o) => [o.date, Math.log(+o.call_volume / +o.put_volume)])), iv = new Map(ivh.map((r) => [r.date, +r.volatility]));
  const ed = er.map((r) => r.report_date).filter(Boolean);
  const rv = (i) => { if (i < 21) return null; const r = []; for (let k = i - 19; k <= i; k++) r.push(Math.log(bars[k].c / bars[k - 1].c)); return sd(r) * Math.sqrt(252); };
  const prem = (i) => { const a = iv.get(bars[i].d), b = rv(i); return a != null && b ? a / b : null; };
  const idx = bars.map((b, i) => [b.d, i]).filter(([d]) => d >= '2025-11-03' && d <= '2026-09-18').map(([, i]) => i);
  const sample = []; for (const i of idx) { if (i + 10 >= bars.length || i < 70) continue;
    const hcp = []; for (let k = i - 60; k < i; k++) { const v = cp.get(bars[k].d); if (v != null) hcp.push(v); }
    const hp = []; for (let k = i - 60; k < i; k++) { const v = prem(k); if (v != null) hp.push(v); }
    sample.push({ s, d: bars[i].d, i, r10: bars[i + 10].c / bars[i].c - 1, cp: z(hcp, cp.get(bars[i].d)), prem: z(hp, prem(i)), earn: ed.some((e) => e > bars[i].d && e <= bars[i + 10].d) }); }
  const thr = sample.map((r) => Math.abs(r.r10)).sort((a, b) => a - b)[Math.floor(sample.length * 0.95)];
  sample.forEach((r, k) => { r.big = Math.abs(r.r10) >= thr; if (k % 5 === 0) rows.push(r); });
  if (++n % 50 === 0) console.error(`… ${n}/${U.length}`);
}
// board coin: majority sign of all universe stocks' r10 from each day
const maj = new Map(); for (const d of [...new Set(rows.map((r) => r.d))]) { let up = 0, dn = 0; for (const [, b] of daily) { const k = b.findIndex((x) => x.d === d); if (k < 0 || k + 10 >= b.length) continue; (b[k + 10].c > b[k].c ? up++ : dn++); } maj.set(d, up >= dn ? 1 : -1); }
fs.writeFileSync(path.join(HERE, 'journal', 'movers_validate.json'), JSON.stringify(rows));
const half = (r) => (r.d < '2026-05-01' ? 'H1' : 'H2'), pc = (x) => (x * 100).toFixed(1) + '%';
console.log(`VALIDATION on ${n} stocks · ${rows.length} stock-days (every 5th session, Nov 2025 → Sep 2026) · base BIG rate ${pc(rows.filter((r) => r.big).length / rows.length)}\n`);
console.log('H1 direction — extreme call/put volume ratio (z ≥ 2 → long, ≤ −2 → short) vs the board coin on the same days');
let h1 = true;
for (const H of ['H1', 'H2']) { const F = rows.filter((r) => half(r) === H && r.cp != null && Math.abs(r.cp) >= 2), right = F.filter((r) => Math.sign(r.r10) === Math.sign(r.cp)).length / F.length, coin = F.filter((r) => Math.sign(r.r10) === maj.get(r.d)).length / F.length;
  if (!(right >= coin + 0.05)) h1 = false; console.log(`  ${H === 'H1' ? 'Nov–Apr' : 'May–Sep'}: fired ${F.length} · right ${pc(right)} vs coin ${pc(coin)} (calls-heavy ${F.filter((r) => r.cp > 0).length} / puts-heavy ${F.filter((r) => r.cp < 0).length})`); }
console.log(`  → ${h1 ? 'PASS' : 'FAIL'}\n`);
for (const [name, f] of [['H2 size — implied vol rich vs realized (ivPrem z ≥ 2)', (r) => r.prem != null && r.prem >= 2], ['H3 size — earnings inside the next 10 sessions', (r) => r.earn]]) {
  console.log(name); let ok = true;
  for (const H of ['H1', 'H2']) { const A = rows.filter((r) => half(r) === H), F = A.filter(f), base = A.filter((r) => r.big).length / A.length, p = F.filter((r) => r.big).length / F.length;
    if (!(p >= 1.5 * base)) ok = false; console.log(`  ${H === 'H1' ? 'Nov–Apr' : 'May–Sep'}: fired ${F.length} · P(BIG) ${pc(p)} vs base ${pc(base)} → ${(p / base).toFixed(2)}×`); }
  console.log(`  → ${ok ? 'PASS' : 'FAIL'}\n`);
}
