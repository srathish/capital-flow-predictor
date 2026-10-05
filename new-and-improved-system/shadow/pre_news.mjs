#!/usr/bin/env node
// "Was there informed buying BEFORE the news?" Locked 2026-10-05 BEFORE running. Cached UW data only (0 new calls, 0 Skylit).
// EVENTS  overnight gaps |open ÷ prior close − 1| ≥ 8% (news hit overnight), 294 desk-universe stocks, 2025-01-02 → 2026-09-30.
//         One event per stock per 20 sessions. Up-gaps and down-gaps kept separate.
// CONTROL the same stocks on 5 random non-event days each (no gap ≥ 4% within ±10 sessions).
// PRE-WINDOW features over sessions T−20…T−1 (and T−5…T−1), each vs that stock's own prior 60 sessions (z-score):
//   callZ   total call volume          askZ   ask-side share of call volume       premZ  net call − net put premium
//   putZ    total put volume           ins    open-market insider BUY (Form 4 P) filed in the 90 days before T
// Q1 ABNORMAL BEFORE NEWS? share of events with |z| ≥ 2 on any options feature in T−5…T−1 vs controls.
// Q2 DIRECTION? on up-gaps vs down-gaps: mean premZ / callZ / askZ before (should be higher before UP gaps); insider buys before UP.
// PASS (for each) = difference significant (z ≥ 2) in BOTH halves (2025 / 2026).
import fs from 'node:fs';
import path from 'node:path';
import { universe, loadDaily } from '../desk/common.mjs';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), UC = path.join(HERE, '..', '.cache', 'uw');
const rd = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
let seed = 77; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const rows = [];
for (const s of universe()) {
  const bars = loadDaily(s), ov = rd(path.join(UC, 'optvol', `${s}.json`)), ins = rd(path.join(UC, 'insider', `${s}.json`)) ?? [];
  if (!ov?.length || bars.length < 200) continue;
  const O = new Map(ov.map((o) => [o.date, o]));
  const feat = (i) => { const d = bars[i].d, o = O.get(d); if (!o) return null; const cv = +o.call_volume, pv = +o.put_volume;
    return { cv, pv, ask: cv > 0 ? +o.call_volume_ask_side / cv : null, prem: (+o.net_call_premium) - (+o.net_put_premium) }; };
  const pre = (i) => { // z of the T−5…T−1 and T−20…T−1 means vs the 60 sessions before T−20
    const base = [], w5 = [], w20 = []; for (let k = i - 80; k < i - 20; k++) { const f = k >= 0 ? feat(k) : null; if (f) base.push(f); }
    for (let k = i - 20; k < i; k++) { const f = feat(k); if (f) { w20.push(f); if (k >= i - 5) w5.push(f); } }
    if (base.length < 40 || w5.length < 3) return null;
    const z = (key, W) => { const b = base.map((f) => f[key]).filter(Number.isFinite), w = W.map((f) => f[key]).filter(Number.isFinite); if (b.length < 30 || !w.length) return null; const s0 = sd(b) / Math.sqrt(w.length); return s0 > 0 ? (mean(w) - mean(b)) / s0 : null; };
    return { callZ: z('cv', w5), putZ: z('pv', w5), askZ: z('ask', w5), premZ: z('prem', w5), callZ20: z('cv', w20), premZ20: z('prem', w20) }; };
  const insBuy = (d) => ins.some((t) => t.code === 'P' && t.f < d && t.f >= new Date(Date.parse(d) - 90 * 864e5).toISOString().slice(0, 10) && t.sh * t.px >= 5e4);
  let last = -99; const evIdx = [];
  for (let i = 81; i < bars.length; i++) { const d = bars[i].d; if (d < '2025-01-02' || d > '2026-09-30') continue; const g = bars[i].o / bars[i - 1].c - 1;
    if (Math.abs(g) >= 0.08 && i - last >= 20) { last = i; evIdx.push(i); const f = pre(i); if (f) rows.push({ s, d, type: 'event', dir: Math.sign(g), gap: g, ...f, ins: insBuy(d) }); } }
  const calm = (i) => { for (let k = Math.max(1, i - 10); k <= Math.min(bars.length - 1, i + 10); k++) if (Math.abs(bars[k].o / bars[k - 1].c - 1) >= 0.04) return false; return true; };
  const cand = bars.map((b, i) => i).filter((i) => i > 81 && bars[i].d >= '2025-01-02' && bars[i].d <= '2026-09-30' && calm(i));
  for (let k = 0; k < 5 && cand.length; k++) { const i = cand[Math.floor(rnd() * cand.length)], f = pre(i); if (f) rows.push({ s, d: bars[i].d, type: 'control', dir: 0, ...f, ins: insBuy(bars[i].d) }); }
}
fs.writeFileSync(path.join(HERE, 'journal', 'pre_news.json'), JSON.stringify(rows));
const pc = (x) => (x * 100).toFixed(1) + '%', half = (r) => (r.d < '2026-01-01' ? '2025' : '2026');
const ztest = (a, na, b, nb) => { const p = (a * na + b * nb) / (na + nb); return (a - b) / Math.sqrt(p * (1 - p) * (1 / na + 1 / nb)); };
const E = rows.filter((r) => r.type === 'event'), Cc = rows.filter((r) => r.type === 'control');
console.log(`PRE-NEWS INFORMED-BUYING TEST · ${E.length} overnight gaps ≥8% (${E.filter((r) => r.dir > 0).length} up / ${E.filter((r) => r.dir < 0).length} down) · ${Cc.length} control days · 294 stocks, 2025–2026\n`);
console.log('Q1 — abnormal options activity in the 5 sessions BEFORE the gap (|z| ≥ 2 on call vol, put vol, ask share or net premium)');
const abn = (r) => ['callZ', 'putZ', 'askZ', 'premZ'].some((k) => r[k] != null && Math.abs(r[k]) >= 2);
let q1 = true;
for (const h of ['2025', '2026']) { const e = E.filter((r) => half(r) === h), c = Cc.filter((r) => half(r) === h), pe = e.filter(abn).length / e.length, pcn = c.filter(abn).length / c.length, z = ztest(pe, e.length, pcn, c.length);
  if (!(z >= 2)) q1 = false; console.log(`  ${h}: before news ${pc(pe)} (n ${e.length}) vs ordinary days ${pc(pcn)} (n ${c.length}) · z ${z.toFixed(1)}`); }
for (const k of ['callZ', 'putZ', 'askZ', 'premZ', 'callZ20', 'premZ20']) { const e = E.map((r) => r[k]).filter(Number.isFinite), c = Cc.map((r) => r[k]).filter(Number.isFinite); console.log(`    ${k.padEnd(8)} mean before news ${mean(e).toFixed(2)} vs ordinary ${mean(c).toFixed(2)}`); }
console.log(`  → Q1 ${q1 ? 'PASS' : 'FAIL'}\n`);
console.log('Q2 — does the pre-news activity point the RIGHT WAY? (UP gaps vs DOWN gaps)');
let q2 = true;
for (const k of ['premZ', 'callZ', 'askZ', 'premZ20']) { const parts = []; let ok = true;
  for (const h of ['2025', '2026']) { const u = E.filter((r) => half(r) === h && r.dir > 0).map((r) => r[k]).filter(Number.isFinite), d = E.filter((r) => half(r) === h && r.dir < 0).map((r) => r[k]).filter(Number.isFinite);
    const t = (mean(u) - mean(d)) / Math.sqrt(sd(u) ** 2 / u.length + sd(d) ** 2 / d.length); if (!(t >= 2)) ok = false; parts.push(`${h}: up ${mean(u).toFixed(2)} vs down ${mean(d).toFixed(2)} (t ${t.toFixed(1)})`); }
  console.log(`  ${ok ? '✓' : ' '} ${k.padEnd(8)} ${parts.join(' · ')}`); if (k === 'premZ' && !ok) q2 = false; }
for (const h of ['2025', '2026']) { const u = E.filter((r) => half(r) === h && r.dir > 0), d = E.filter((r) => half(r) === h && r.dir < 0), c = Cc.filter((r) => half(r) === h);
  console.log(`    insider buy in prior 90d: before UP gaps ${pc(u.filter((r) => r.ins).length / u.length)} · before DOWN ${pc(d.filter((r) => r.ins).length / d.length)} · ordinary ${pc(c.filter((r) => r.ins).length / c.length)} (${h})`); }
console.log(`  → Q2 (primary: net premium) ${q2 ? 'PASS' : 'FAIL'}`);
console.log('\nbiggest pre-news call buying (premZ, T−5…T−1) before UP gaps:'); for (const r of E.filter((x) => x.dir > 0 && x.premZ != null).sort((a, b) => b.premZ - a.premZ).slice(0, 10)) console.log(`  ${r.d} ${r.s.padEnd(5)} gap ${pc(r.gap)} · premZ ${r.premZ.toFixed(1)} · callZ ${r.callZ?.toFixed(1)} · ask ${r.askZ?.toFixed(1)}${r.ins ? ' · insider buy' : ''}`);
