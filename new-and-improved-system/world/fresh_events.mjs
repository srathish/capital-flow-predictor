#!/usr/bin/env node
// Fresh-filing event study (DESIGN_fresh.md) — E1 initial 13D · E2 8-K 1.01 without 2.03 · E3 guidance raise · E3− guidance cut.
// Entry = close of the first session strictly AFTER the filing date. Excess vs the universe median, 5/20/60/126 sessions. Controls =
// same stocks, 5 random non-event dates each. PASS per type: 60-session excess > control in both halves AND event−control t ≥ 2.
import fs from 'node:fs';
import path from 'node:path';
import { worldUniverse } from './collect.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache');
const rd = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d), ymd = (t) => new Date((t + 43200) * 1000).toISOString().slice(0, 10);
const P = new Map(); for (const { t } of worldUniverse()) { let b = rd(path.join(C, 'wdaily', `${t}.json`), []); if (!b.length) b = (rd(path.join(C, 'daily', `${t}.json`), []) || []).map((x) => ({ d: ymd(x.t), c: x.c, v: x.v })); if (b.length > 120) P.set(t, { d: b.map((x) => x.d), c: b.map((x) => x.c) }); }
const firstAfter = (t, d) => { const p = P.get(t); let lo = 0, hi = p.d.length; while (lo < hi) { const m = (lo + hi) >> 1; if (p.d[m] <= d) lo = m + 1; else hi = m; } return lo < p.d.length ? lo : -1; };
const H = [5, 20, 60, 126];
// universe median forward return by (entry date, horizon) — computed with each stock's own session offsets from the same entry date
const medC = new Map(); function med(d, h) { const k = `${d}|${h}`; if (medC.has(k)) return medC.get(k); const v = [];
  for (const [t, p] of P) { const i = firstAfter(t, addD(d, -1)); if (i < 0 || p.d[i] !== d || i + h >= p.c.length) continue; v.push(p.c[i + h] / p.c[i] - 1); }
  v.sort((a, b) => a - b); const m = v.length > 100 ? v[v.length >> 1] : null; medC.set(k, m); return m; }
function addD(d, n) { return new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
function measure(t, filed, sign) { const p = P.get(t), i = firstAfter(t, filed); if (i < 1) return null; const pre = (() => { let j = i - 1; while (j >= 0 && p.d[j] >= filed) j--; return j; })(); if (pre < 0) return null;
  const o = { t, d: p.d[i], filed, day0: sign * (p.c[i] / p.c[pre] - 1) }; for (const h of H) { if (i + h >= p.c.length) { o[`x${h}`] = null; continue; } const m = med(p.d[i], h); o[`x${h}`] = m == null ? null : sign * ((p.c[i + h] / p.c[i] - 1) - m); } return o; }
// ---- events ----
const G = rd(path.join(C, 'edgar', 'guidance.json'), []); // phrase lists identical to fresh_collect.mjs (importing it would re-run the collector)
const RAISE = ['raises full-year guidance', 'raises full year guidance', 'raising full-year guidance', 'raised full-year guidance', 'raises its full-year', 'raises guidance', 'raising guidance', 'raised guidance', 'raises outlook', 'raised its outlook', 'raising its outlook', 'increases full-year guidance', 'increased full-year guidance'];
const CUT = ['lowers full-year guidance', 'lowers guidance', 'lowering guidance', 'lowered guidance', 'lowers outlook', 'lowered its outlook', 'reduces full-year guidance', 'reduced full-year guidance', 'cuts guidance'];
const types = { E1_13D: [], E2_contract: [], E3_raise: [], 'E3-_cut': [] };
for (const t of P.keys()) { const F = rd(path.join(C, 'edgar', 'fresh', `${t}.json`), []) || [];
  for (const r of F) { if (r.d < '2022-01-01' || r.d > '2026-03-31') continue;
    if (r.form === 'SC 13D' || r.form === 'SCHEDULE 13D') types.E1_13D.push({ t, d: r.d });
    if (r.form === '8-K') { const it = (r.items || '').split(','); if (it.includes('1.01') && !it.includes('2.03')) types.E2_contract.push({ t, d: r.d }); } } }
for (const g of G) { if (!P.has(g.t) || g.d < '2022-01-01' || g.d > '2026-03-31') continue; if (RAISE.includes(g.c)) types.E3_raise.push({ t: g.t, d: g.d }); if (CUT.includes(g.c)) types['E3-_cut'].push({ t: g.t, d: g.d }); }
let seed = 99; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const st = (v) => { v = v.filter((x) => x != null && Number.isFinite(x)); if (v.length < 3) return { n: v.length, m: NaN, t: NaN }; const m = v.reduce((a, x) => a + x, 0) / v.length, s = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)); return { n: v.length, m, t: m / (s / Math.sqrt(v.length)) }; };
const pc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '-');
console.log('FRESH-FILING EVENT STUDY · entry = close of the first session after filing · excess vs universe median · 2022 → 2026-03\n');
const out = {};
for (const [k, raw] of Object.entries(types)) {
  const sign = k.startsWith('E3-') ? -1 : 1, by = new Map(); for (const e of raw.sort((a, b) => a.d.localeCompare(b.d))) { const a = by.get(e.t) ?? []; a.push(e.d); by.set(e.t, a); }
  const ev = [], ctl = [];
  for (const [t, ds] of by) { let lastI = -99; const p = P.get(t);
    for (const d of ds) { const i = firstAfter(t, d); if (i < 0 || i - lastI < 20) continue; lastI = i; const m = measure(t, d, sign); if (m) ev.push(m); }
    const evIdx = ds.map((d) => firstAfter(t, d)).filter((i) => i >= 0), cand = p.d.map((d, i) => i).filter((i) => p.d[i] >= '2022-01-03' && p.d[i] <= '2026-03-31' && evIdx.every((j) => Math.abs(j - i) > 20));
    for (let r = 0; r < 5 && cand.length; r++) { const i = cand[Math.floor(rnd() * cand.length)], m = measure(t, p.d[i - 1] ?? p.d[i], sign); if (m) ctl.push(m); } }
  const half = (x) => (x.d < '2024-01-01' ? 'H1' : 'H2'), line = [];
  for (const h of H) { const e = st(ev.map((x) => x[`x${h}`])), c = st(ctl.map((x) => x[`x${h}`])); line.push(`${h}d ${pc(e.m)} (ctl ${pc(c.m)})`); }
  const e60 = ev.map((x) => x.x60).filter((x) => x != null), c60 = ctl.map((x) => x.x60).filter((x) => x != null), E = st(e60), Cc = st(c60);
  const se = Math.sqrt(((e60.reduce((a, x) => a + (x - E.m) ** 2, 0)) / Math.max(1, e60.length - 1)) / e60.length + ((c60.reduce((a, x) => a + (x - Cc.m) ** 2, 0)) / Math.max(1, c60.length - 1)) / c60.length), tdiff = (E.m - Cc.m) / se;
  const halves = ['H1', 'H2'].map((h) => [st(ev.filter((x) => half(x) === h).map((x) => x.x60)).m, st(ctl.filter((x) => half(x) === h).map((x) => x.x60)).m]);
  const pass = halves.every(([a, b]) => a > b) && tdiff >= 2;
  console.log(`${pass ? '✓ PASS' : '  FAIL'} ${k.padEnd(12)} n ${String(ev.length).padStart(5)} · day-0 already ${pc(st(ev.map((x) => x.day0)).m)} · ${line.join(' · ')}`);
  console.log(`         60d event−control ${pc(E.m - Cc.m)} (t ${tdiff.toFixed(2)}) · 2022–23 ${pc(halves[0][0])} vs ${pc(halves[0][1])} · 2024–26 ${pc(halves[1][0])} vs ${pc(halves[1][1])}\n`);
  out[k] = { ev, ctl };
}
fs.writeFileSync(path.join(ROOT, 'world', 'results_v4', 'fresh_events.json'), JSON.stringify(out));
