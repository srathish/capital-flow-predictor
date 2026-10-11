#!/usr/bin/env node
// Stock event factory engine (shadow/DESIGN_event_factory.md). Data via stock_data.mjs (the audited long-engine loaders).
//   node --max-old-space-size=16000 shadow/event_factory.mjs [--smoke]   (runs once; --force only for logged audit fixes)
import fs from 'node:fs';
import path from 'node:path';
import { C, addD, days, mean, log, SIC, FUND, INS, GUID, CONCEPT, memberAt, P, idx } from './stock_data.mjs';
import { blockedAt, crosses } from '../world/prices_clean.mjs';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), OUT = path.join(SH, 'results_event_factory'), SMOKE = process.argv.includes('--smoke');
if (!SMOKE && fs.existsSync(path.join(OUT, 'summary.md')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const REG = JSON.parse(fs.readFileSync(path.join(SH, 'event_registry.json'), 'utf8')).hypotheses;
const BUILD_END = '2019-12-31', HOLD_START = '2020-01-01', DATA_END = '2026-10-02', H = { A5: 5, A20: 20, A60: 60, MV60: 60 };

// ---------- calendar + month-end eligibility + equal-weight index ----------
const CAL = [...new Set([...P.values()].flatMap((p) => p.d))].filter((d) => d >= '2011-01-01' && d <= DATA_END).sort(), CI = new Map(CAL.map((d, i) => [d, i]));
const shAt = (t, d) => { let r = null; for (const x of FUND.get(t).sh) { if (x.d <= d) r = x; else break; } return r && days(r.d, d) <= 400 ? r.v : NaN; };
const monthEnds = [...new Map(CAL.map((d) => [d.slice(0, 7), d])).values()];
const ELIG = new Map(); // month-end → Set(t)  (market cap ≥ $500M, ≥ 252 bars, not quarantined)
for (const M of monthEnds) { const s = new Set(); for (const [t, p] of P) { const j = idx(p.d, M); if (j < 252 || p.d[j] < addD(M, -7) || blockedAt(p.bad, p.gaps, M)) continue; if (shAt(t, M) * p.c[j] >= 5e8) s.add(t); } ELIG.set(M, s); }
const eligAt = (d) => { let lo = 0, hi = monthEnds.length - 1, r = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (monthEnds[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return ELIG.get(monthEnds[r]) ?? new Set(); }; /* month-end ≤ d (binary search) */
// EW index of eligible stocks (prior month-end set), daily returns clipped ±50%
const IDX = new Float64Array(CAL.length).fill(1);
for (let i = 1; i < CAL.length; i++) { const d = CAL[i], s = eligAt(CAL[i - 1]), r = []; for (const t of s) { const p = P.get(t), a = idx(p.d, CAL[i - 1]), b = idx(p.d, d); if (a < 0 || b !== a + 1 || p.d[b] !== d) continue; r.push(Math.max(-0.5, Math.min(0.5, p.c[b] / p.c[a] - 1))); } IDX[i] = IDX[i - 1] * (1 + (r.length ? mean(r) : 0)); }
log(`calendar ${CAL.length} days, index built`);
const mvCut = new Map(); // entry day → 90th pct of 60-day returns of eligible stocks
function outcome(t, e) { // e = event day; entry = first calendar day after e
  const p = P.get(t), ie = CI.get(e) ?? CI.get(CAL[CAL.findIndex((d) => d > e) - 1]); if (ie == null || ie + 2 >= CAL.length) return null; /* amendment 1: per-horizon checks below */ const en = CAL[ie + 1], j0 = idx(p.d, en); if (j0 < 0 || p.d[j0] !== en) return null;
  const o = {}; for (const [k, h] of Object.entries(H)) { const ex = CAL[ie + 1 + h]; if (!ex || ex > DATA_END) { o[k] = NaN; continue; } const j1 = idx(p.d, ex); if (j1 <= j0 || p.d[j1] < addD(ex, -7) || crosses(p.bad, p.gaps, en, ex)) { o[k] = NaN; continue; }
    const r = p.c[j1] / p.c[j0] - 1; if (k === 'MV60') { if (!mvCut.has(en)) { const rs = []; for (const u of eligAt(e)) { const q = P.get(u), a = idx(q.d, en), b = idx(q.d, ex); if (a >= 0 && q.d[a] === en && b > a && !crosses(q.bad, q.gaps, en, ex)) rs.push(q.c[b] / q.c[a] - 1); } rs.sort((x, y) => x - y); mvCut.set(en, rs[Math.floor(0.9 * (rs.length - 1))]); }
      o[k] = (r >= mvCut.get(en) ? 1 : 0) - 0.1; } else o[k] = r - (IDX[ie + 1 + h] / IDX[ie + 1] - 1); }
  return { en, ...o }; }

// ---------- event detection ----------
const EV = new Map(REG.map((h) => [h.event, []]).filter((x, i, a) => a.findIndex((y) => y[0] === x[0]) === i)); // event id → [{t, e}]
const nextTD = (d) => { let lo = 0, hi = CAL.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (CAL[m] >= d) { r = m; hi = m - 1; } else lo = m + 1; } return r >= 0 ? CAL[r] : null; };
const LAST = new Map();
function push(id, t, e) { e = nextTD(e); if (!e || e < '2012-01-01') return; const p = P.get(t); if (!eligAt(e).has(t) || blockedAt(p.bad, p.gaps, e)) return; const a = EV.get(id), key = id + '|' + t, last = LAST.get(key);
  if (last && CI.get(e) - CI.get(last) < 60) return; LAST.set(key, e); a.push({ t, e }); }
import { SPY as SPYRAW } from './stock_data.mjs';
const SPYB = { c: SPYRAW.map((x) => x.c), d: SPYRAW.map((x) => x.d), idx(d) { let lo = 0, hi = this.d.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (this.d[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; } };
const RAWHI = new Map(); /* amendment 1: every 52-week-high day per stock (unthinned) for X01 */
const near = (arr, ref, lo, hi) => arr.filter((x) => { const k = days(x.e, ref.e); return k >= lo && k <= hi; }).at(-1);
let nT = 0;
for (const [t, p] of P) { const F = FUND.get(t); if (SMOKE && ++nT > 300) break;
  // SEC filing events (values filed by the quarter's filing date)
  for (const q0 of F.Q) { const f = q0.f, Q = F.Q.filter((x) => x.f <= f), q1 = near(Q, q0, 80, 100), q4 = near(Q, q0, 345, 385), q5 = q1 && near(Q, q1, 345, 385); if (!q4 || !(q4.rev > 0) || q0.rev < 25e6 || days(q0.e, f) > 120) continue; /* amendment 1: no old restated quarters */
    const g0 = q0.rev / q4.rev - 1, accel = q5?.rev > 0 ? g0 - (q1.rev / q5.rev - 1) : NaN, gmOK = q0.gm != null && q4.gm != null && q0.fg <= f && q4.fg <= f, dGM = gmOK ? q0.gm - q4.gm : NaN;
    if (g0 > 0.3) push('F01', t, f); if (accel > 0.1) push('F02', t, f); if (dGM > 0.03 && q4.gm >= 0) push('F03', t, f); if (g0 < 0) push('F04', t, f); if (dGM < -0.03) push('F05', t, f);
    if (Q.filter((x) => x.e < q0.e).every((x) => x.rev < q0.rev) && Q.filter((x) => x.e < q0.e).length >= 8 && g0 > 0.15) push('F08', t, f); if (g0 > 0.3 && accel > 0) push('F14', t, f);
    const at = (arr, ref) => arr.filter((x) => x.f <= f && Math.abs(days(x.e, ref.e)) <= 5).at(-1), prevQ = [q1, q1 && near(Q, q1, 80, 100)]; let qq = q0; const chain = []; for (let k = 0; k < 4; k++) { qq = qq && near(Q, qq, 80, 100); chain.push(qq); }
    const ni0 = at(F.ni, q0), op0 = at(F.op, q0); if (ni0?.v > 0 && chain.every((x) => x && at(F.ni, x)?.v < 0)) push('F06', t, f); if (op0?.v > 0 && chain.every((x) => x && at(F.op, x)?.v < 0)) push('F07', t, f);
    const ni4 = at(F.ni, q4); if (ni0 && ni4) { if (ni0.v / q0.rev - ni4.v / q4.rev < -0.05) push('F15', t, f); }
    const inst = (arr) => { const a = arr.filter((x) => x.f <= f && Math.abs(days(x.e, q0.e)) <= 5).at(-1), b = arr.filter((x) => x.f <= f && Math.abs(days(x.e, q4.e)) <= 5).at(-1); return a && b?.v > 0 ? a.v / b.v - 1 : NaN; };
    if (inst(F.rpo) > 0.3) push('F09', t, f); if (inst(F.inv) - g0 > 0.2) push('F10', t, f);
    const s0 = shAt(t, f), s1 = shAt(t, addD(f, -365)); const shr = s0 / s1; if (shr - 1 > 0.1 && ![1.5, 1.25, 4 / 3].some((q) => Math.abs(shr / q - 1) < 0.04)) push('F12', t, f); /* amendment 1: unadjusted 3:2 splits are not dilution */ if (s0 / s1 - 1 < -0.03) push('F13', t, f);
    void prevQ; }
  for (const a of F.capex) { const b = F.capex.filter((x) => x.f <= a.f && Math.abs(days(x.e, a.e) - 365) <= 20).at(-1); if (b?.v > 0 && a.v / b.v - 1 > 0.5) push('F11', t, a.f); }
  // insiders (Form 4 filing date)
  const ins = (INS.get(t) ?? []).sort((a, b) => a.f.localeCompare(b.f));
  for (let k = 0; k < ins.length; k++) { const x = ins[k], f = x.f; if (f < '2014-03-01') continue; const j = idx(p.d, f); if (j < 200) continue;
    if (f >= '2015-01-02' && !ins.some((y) => y.f < f && y.f > addD(f, -365))) push('I01', t, f);
    const own = new Set(ins.filter((y) => y.f <= f && y.f > addD(f, -30)).map((y) => y.o)), ownBefore = new Set(ins.filter((y) => y.f < f && y.f > addD(f, -30)).map((y) => y.o));
    const above = (() => { let m = 0; for (let q = j - 199; q <= j; q++) m += p.c[q] / 200; return p.c[j] > m; })();
    if (own.size >= 3 && ownBefore.size < 3) { push('I02', t, f); if (above) push('X02', t, f); }
    if (x.v > 1e6) push('I03', t, f); if (p.c[j] / p.c[Math.max(0, j - 63)] - 1 < -0.2) push('I04', t, f); if (above) push('I05', t, f); }
  // guidance (8-K date)
  const gd = (GUID.get(t) ?? []).sort((a, b) => a.d.localeCompare(b.d));
  for (const g of gd) { if (g.d < '2014-03-01') continue; if (g.dir === 'cut') { push('G02', t, g.d); continue; } push('G01', t, g.d);
    const si = SPYB.idx(g.d); if (si >= 20 && SPYB.c[si] / SPYB.c[si - 20] - 1 < 0) push('G03', t, g.d);
    if (g.d >= '2015-03-01' && gd.some((y) => y.dir === 'raise' && y.d < g.d && y.d > addD(g.d, -365))) push('G04', t, g.d); }
  // price / volume events (each bar, known at its close)
  const c = p.c, v = p.v; let lastHi = -1e9, ma50 = 0, ma200 = 0, below200run = 0, allHi = 0; const ma200s = new Float64Array(c.length).fill(NaN);
  for (let j = 0; j < c.length; j++) { ma50 += c[j] - (j >= 50 ? c[j - 50] : 0); ma200 += c[j] - (j >= 200 ? c[j - 200] : 0); if (j >= 199) ma200s[j] = ma200 / 200;
    if (j < 252) { allHi = Math.max(allHi, c[j]); continue; } const d = p.d[j]; if (d < '2012-01-01') { allHi = Math.max(allHi, c[j]); continue; }
    let hi = 0, lo = Infinity; for (let q = j - 251; q < j; q++) { hi = Math.max(hi, c[q]); lo = Math.min(lo, c[q]); } let av = 0; for (let q = j - 50; q < j; q++) av += v[q] / 50;
    const m50 = ma50 / 50, m200 = ma200 / 200, pm50 = (ma50 - c[j] + c[j - 50]) / 50, pm200 = (ma200 - c[j] + c[j - 200]) / 200;
    if (c[j] > hi) { (RAWHI.get(t) ?? RAWHI.set(t, []).get(t)).push(d); push('P01', t, d); if (j - lastHi > 126) push('P02', t, d); lastHi = j; }
    const gap = p.d.length && j > 0 ? NaN : NaN; void gap;
    if (c[j] < lo) push('P10', t, d); if (c[j] / c[j - 3] - 1 < -0.15) push('P05', t, d); if (pm50 <= pm200 && m50 > m200) push('P06', t, d);
    if (c[j] > m200) { if (below200run >= 126) push('P07', t, d); below200run = 0; } else below200run++;
    if (c[j] > c[j - 1] && v[j] > 5 * av) push('P08', t, d); if (c[j] > allHi && j >= 756) push('P09', t, d); allHi = Math.max(allHi, c[j]);
    if (c[j] / c[j - 1] - 1 > 0.1) push('P11', t, d); if (c[j] / c[j - 20] - 1 > 0.3) push('P12', t, d); }
}
log('events detected (gap events need opens — see below)');
// gap events need daily opens: wdaily bars carry o; reload opens for gap / X03 / X04 detection
const FILED = new Map(); for (const [t, F] of FUND) FILED.set(t, new Set(F.Q.map((q) => nextTD(q.f)).filter(Boolean)));
nT = 0;
for (const [t, p] of P) { if (SMOKE && ++nT > 300) break; /* amendment 1: opens from the same merged, adjusted bars as the closes (wdaily_hist + wdaily) */
  for (let j = 252; j < p.c.length; j++) { const d = p.d[j]; if (d < '2012-01-01' || !(p.o[j] > 0)) continue; let av = 0; for (let q = j - 50; q < j; q++) av += p.v[q] / 50;
    const gp = p.o[j] / p.c[j - 1] - 1; // open vs prior close (both on the same adjusted basis only if no split between; quarantine windows exclude split days)
    if (gp > 0.05 && p.v[j] > 3 * av) { push('P03', t, d); const fd = FILED.get(t); if (fd && (fd.has(d) || fd.has(CAL[CI.get(d) - 1]))) push('X04', t, d); }
    if (gp < -0.05 && p.v[j] > 3 * av) push('P04', t, d);
    if (gp > 0.03 && (GUID.get(t) ?? []).some((g) => g.dir === 'raise' && nextTD(g.d) === d)) push('X03', t, d); } }
// G03 (raise while SPY's 20-day return < 0) and X01 (F14 within 20 trading days of a 52-week high), T01, T02

for (const x of EV.get('F14')) { const hi = (RAWHI.get(x.t) ?? []).map((d) => nextTD(d)).filter((d) => d && Math.abs(CI.get(d) - CI.get(x.e)) <= 20).sort(); if (!hi.length) continue; const e = hi.find((d) => d >= x.e) ? (hi.some((d) => d <= x.e) ? x.e : hi.find((d) => d >= x.e)) : x.e; push('X01', x.t, e); }
const CONC_M = new Map(); /* month-end → concept 6-month returns (cached) */
// T01: first-ever concept mention while that concept's members are in the top quartile of 6-month returns (month-end before)
const FIRSTC = new Map(); for (const mp of CONCEPT.values()) for (const [t, ds] of mp) if (!FIRSTC.has(t) || ds[0] < FIRSTC.get(t)) FIRSTC.set(t, ds[0]);
for (const [cname, mp] of CONCEPT) for (const [t, ds] of mp) { if (!P.has(t)) continue; const d = ds[0]; if (d < '2014-03-01' || FIRSTC.get(t) > addD(d, -365)) continue; /* amendment 1: needs a year of concept history */ const M = monthEnds.filter((m) => m < d).at(-1); if (!M) continue;
  const r6 = (u) => { const q = P.get(u), a = idx(q.d, M), b = idx(q.d, addD(M, -182)); return a > 0 && b > 0 ? q.c[a] / q.c[b] - 1 : NaN; };
  if (!CONC_M.has(M)) { const concR = (name) => { const m = CONCEPT.get(name), mem = [...m].filter(([u, x]) => P.has(u) && memberAt(x, M)).map(([u]) => r6(u)).filter(Number.isFinite); return mem.length >= 6 ? mean(mem) : NaN; };
    const rs = new Map([...CONCEPT.keys()].map((n) => [n, concR(n)])), all = [...rs.values()].filter(Number.isFinite).sort((a, b) => a - b); CONC_M.set(M, { rs, q75: all[Math.floor(0.75 * (all.length - 1))] }); }
  const cm = CONC_M.get(M), mine = cm.rs.get(cname); if (Number.isFinite(mine) && mine >= cm.q75) push('T01', t, d); }
// T02: industry 3-month EW return turns positive after ≥ 6 negative month-ends → event for every eligible member at that month-end
{ const ind = new Map(); for (const [t] of P) { const s = SIC.get(t)?.slice(0, 3); if (s) (ind.get(s) ?? ind.set(s, []).get(s)).push(t); }
  for (const [s, ts] of ind) { let neg = 0; for (const M of monthEnds) { if (M < '2011-06-30') continue; const el = ts.filter((t) => ELIG.get(M)?.has(t)); if (el.length < 3) { neg = 0; continue; }
    const r3 = mean(el.map((t) => { const q = P.get(t), a = idx(q.d, M), b = idx(q.d, addD(M, -91)); return a > 0 && b > 0 ? q.c[a] / q.c[b] - 1 : 0; }));
    if (r3 > 0) { if (neg >= 6) for (const t of el) push('T02', t, M); neg = 0; } else neg++; } } }
log(`events: ${[...EV].map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
if (SMOKE) process.exit(0);

// ---------- outcomes + statistics ----------
const OUTC = new Map(); for (const [id, a] of EV) OUTC.set(id, a.map((x) => ({ ...x, ...(outcome(x.t, x.e) ?? {}) })).filter((x) => x.en));
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const pval = (t, sign) => (!Number.isFinite(t) ? 1 : sign === '+' ? 1 - Phi(t) : sign === '-' ? Phi(t) : 2 * (1 - Phi(Math.abs(t))));
const bh = (ps, q) => { const o = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]); let kmax = -1; o.forEach(([p], r) => { if (p <= ((r + 1) / o.length) * q) kmax = r; }); const keep = new Set(o.slice(0, kmax + 1).map(([, i]) => i)); return ps.map((_, i) => keep.has(i)); };
function stats(rows, k) { const a = rows.filter((x) => Number.isFinite(x[k])); if (a.length < 50) return { n: a.length, m: NaN, t: NaN }; const m = mean(a.map((x) => x[k])), by = new Map();
  for (const x of a) { const key = k === 'A5' ? x.en : k === 'A20' ? x.en.slice(0, 7) : x.en.slice(0, 4) + 'Q' + Math.ceil(+x.en.slice(5, 7) / 3); /* amendment 1: 60-day windows clustered by quarter */ by.set(key, (by.get(key) ?? 0) + (x[k] - m)); } const G = by.size, se = Math.sqrt(([...by.values()].reduce((s, v) => s + v * v, 0) * G) / Math.max(1, G - 1)) / a.length; return { n: a.length, m, t: se > 0 ? m / se : NaN }; }
const endOK = (x, k, lim) => { const ie = CI.get(x.en); return CAL[ie + H[k]] && CAL[ie + H[k]] <= lim; };
const S1 = REG.map((h) => { const rows = OUTC.get(h.event).filter((x) => x.e <= BUILD_END && endOK(x, h.outcome, BUILD_END)), s = stats(rows, h.outcome); return { ...h, b: s, p1: pval(s.t, h.sign) }; });
const k1 = bh(S1.map((h) => h.p1), 0.10); S1.forEach((h, i) => { h.stage1 = k1[i]; }); const surv = S1.filter((h) => h.stage1); log(`stage 1: ${surv.length} of ${S1.length}`);
for (const h of surv) { h.h = stats(OUTC.get(h.event).filter((x) => x.e >= HOLD_START), h.outcome); h.p2 = pval(h.h.t, h.b.m > 0 ? '+' : '-'); }
const k2 = bh(surv.map((h) => h.p2), 0.10); surv.forEach((h, i) => { h.passBH = k2[i] && Math.sign(h.h.m) === Math.sign(h.b.m); });
// own placebo: same entry dates, random eligible stocks
let sd = 999 >>> 0; const rnd = () => { sd = (sd + 0x6d2b79f5) | 0; let x = Math.imul(sd ^ (sd >>> 15), 1 | sd); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; /* amendment 1: mulberry32 */
const POOL = new Map(); const poolAt = (d) => { const s = eligAt(d); if (!POOL.has(s)) POOL.set(s, [...s]); return POOL.get(s); };
for (const h of surv.filter((x) => x.passBH)) { const real = OUTC.get(h.event).filter((x) => x.e >= HOLD_START), pm = [];
  for (let k = 0; k < 20; k++) { const rows = []; for (const x of real) { const pool = poolAt(x.e); const u = pool[Math.floor(rnd() * pool.length)]; const o = outcome(u, x.e); if (o) rows.push(o); } pm.push(mean(rows.filter((r) => Number.isFinite(r[h.outcome])).map((r) => r[h.outcome]))); }
  const s = Math.sign(h.b.m); h.placeboBeat = pm.filter((m) => s * h.h.m > s * m).length; }
surv.forEach((h) => { h.validated = !!h.passBH && h.placeboBeat >= 19; });
const val = surv.filter((h) => h.validated), fx = (x, d = 2) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—'), pc = (x) => (Number.isFinite(x) ? fx(x * 100, 2) + '%' : '—');
const L = ['# Stock event factory — results', `\nRun ${new Date().toISOString()} · design shadow/DESIGN_event_factory.md · ${S1.length} studies · build events to ${BUILD_END}, holdout from ${HOLD_START}\n`,
  `**Build BH q = 0.10: ${surv.length} of ${S1.length} pass. Holdout (BH across survivors, same sign, beat ≥ 19/20 random-stock placebos): ${val.length} validated.**\n`,
  '| study | event | outcome | predicted | build: n, mean (t) | holdout: n, mean (t) | placebos beaten | mechanism |', '|---|---|---|---|---|---|---|---|',
  ...val.sort((a, b) => a.outcome.localeCompare(b.outcome) || Math.abs(b.h.t) - Math.abs(a.h.t)).map((h) => `| ${h.id} | ${h.definition} | ${h.outcome} | ${h.sign} | ${h.b.n}, ${pc(h.b.m)} (${fx(h.b.t)}) | ${h.h.n}, **${pc(h.h.m)} (${fx(h.h.t)})** | ${h.placeboBeat}/20 | ${h.mechanism} |`),
  '\n## Passed the holdout but not the random-stock placebo\n', ...surv.filter((h) => h.passBH && !h.validated).map((h) => `- ${h.id} ${h.definition}: holdout ${pc(h.h.m)} (t ${fx(h.h.t)}), placebos ${h.placeboBeat}/20`),
  '\n## Passed build, failed holdout\n', ...surv.filter((h) => !h.passBH).map((h) => `- ${h.id} ${h.definition}: build ${pc(h.b.m)} (t ${fx(h.b.t)}) → holdout ${pc(h.h?.m)} (t ${fx(h.h?.t)})`),
  `\nEvent counts (all years): ${[...OUTC].map(([k, v]) => `${k} ${v.length}`).join(', ')}. MV60 values are (share of big movers − 10%).`];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'summary.md'), L.join('\n') + '\n'); fs.writeFileSync(path.join(OUT, 'all.json'), JSON.stringify(S1, null, 1)); console.log(L.join('\n'));
