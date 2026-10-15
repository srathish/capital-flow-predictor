#!/usr/bin/env node
// Community batch part R — runner management (shadow/DESIGN_community_batch.md). Signal + minute handling copied from
// vwap_node.mjs (audited). Writes results_community/R.json; --smoke prints counts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SH = path.dirname(fileURLToPath(import.meta.url)), C = path.join(SH, '..', '.cache'), OUT = path.join(SH, 'results_community'), SMOKE = process.argv.includes('--smoke');
if (!SMOKE && fs.existsSync(path.join(OUT, 'R.json')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const START = '2023-11-09', BUILD_END = '2025-03-31', HOLD_START = '2025-04-01', COST = 0.01;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const offC = new Map(), etMin = (t, d) => { if (!offC.has(d)) { const h = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(d + 'T16:00:00Z')); offC.set(d, (h - 16) * 60); } return (((Math.floor(t / 60) + offC.get(d)) % 1440) + 1440) % 1440; };
function loadDay(T, d) { const f = path.join(C, 'uw', 'm1', T, `${d}.json`); if (!fs.existsSync(f)) return null; const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  let reg = raw.filter((b) => b.m === 'r').map((b) => ({ ...b, etm: etMin(b.t, d) })).filter((b) => b.etm >= 570 && b.etm < 960); if (reg.length < 200) return null;
  const filled = [reg[0]]; for (let i = 1; i < reg.length; i++) { for (let m = filled.at(-1).etm + 1; m < reg[i].etm; m++) { const c0 = filled.at(-1).c; filled.push({ t: filled.at(-1).t + 60, o: c0, h: c0, l: c0, c: c0, v: 0, etm: m }); } filled.push(reg[i]); }
  return filled.map((b, i, a) => { const ref = [b.o, b.c, a[i - 1]?.c, a[i + 1]?.c].filter(Number.isFinite); return { ...b, h: Math.min(b.h, Math.max(...ref) * 1.002), l: Math.max(b.l, Math.min(...ref) * 0.998) }; }); }
function signals(B, k) { const vw = new Float64Array(B.length), sg = new Float64Array(B.length); let sv = 0, spv = 0, sp2 = 0; for (let j = 0; j < B.length; j++) { const tp = (B[j].h + B[j].l + B[j].c) / 3, v = B[j].v || 0; sv += v; spv += v * tp; sp2 += v * tp * tp; vw[j] = sv > 0 ? spv / sv : NaN; sg[j] = sv > 0 ? Math.sqrt(Math.max(0, sp2 / sv - vw[j] * vw[j])) : NaN; }
  const band = (side, j) => vw[j] + side * k * sg[j], out = [];
  for (const side of [1, -1]) { let j = 1; while (j < B.length) { const b = B[j], lv = band(side, j - 1); if (B[j].etm < 585 || B[j].etm > 930 || !Number.isFinite(lv)) { j++; continue; }
      const touched = side > 0 ? B[j - 1].c < lv && b.h >= lv : B[j - 1].c > lv && b.l <= lv; if (!touched) { j++; continue; }
      let ext = side > 0 ? b.h : b.l, hit = null; for (let q = j; q < Math.min(B.length, j + 6) && B[q].etm <= 930; q++) { ext = side > 0 ? Math.max(ext, B[q].h) : Math.min(ext, B[q].l); const lq = band(side, q - 1); if (side > 0 ? B[q].c < lq : B[q].c > lq) { hit = q; break; } }
      if (hit != null) { out.push({ i: hit, dir: -side, entry: B[hit].c, stop: side > 0 ? ext * 1.0003 : ext * 0.9997 }); break; } j++; } } /* one per band-side-day: the first rejection */
  return out; }
function path3(B, s) { const R = Math.abs(s.entry - s.stop), t3p = s.entry + s.dir * 3 * R, t6p = s.entry + s.dir * 6 * R; let j3 = null, r6 = false, stopped = false, exitR = null;
  for (let j = s.i + 1; j < B.length && B[j].etm < 955; j++) { const b = B[j]; if (s.dir > 0 ? b.l <= s.stop : b.h >= s.stop) { stopped = true; break; }
    if (j3 == null && (s.dir > 0 ? b.h >= t3p : b.l <= t3p)) j3 = j; if (j3 != null && (s.dir > 0 ? b.h >= t6p : b.l <= t6p)) { r6 = true; break; } }
  let k = B.length - 1; while (k > s.i && B[k].etm >= 955) k--; const eodR = (s.dir * (B[k].c - s.entry)) / R;
  return { R, j3, t3: j3 != null ? B[j3].etm - B[s.i].etm : null, r6, stopped, eodR, cost: (2 * COST) / R }; }
const ev = [];
const spyDays = fs.readdirSync(path.join(C, 'uw', 'm1', 'SPY')).map((f) => f.slice(0, 10)).filter((d) => d >= START && d <= '2026-10-02');
let days = spyDays.sort(); if (SMOKE) days = days.slice(0, 80);
for (const d of days) { const D = { SPY: loadDay('SPY', d), QQQ: loadDay('QQQ', d) }; if (!D.SPY || !D.QQQ) continue; const idx = { SPY: new Map(D.SPY.map((b, i) => [b.etm, i])), QQQ: new Map(D.QQQ.map((b, i) => [b.etm, i])) };
  for (const [T, O] of [['SPY', 'QQQ'], ['QQQ', 'SPY']]) for (const k of [1, 2]) for (const s of signals(D[T], k)) { const p = path3(D[T], s); let conf = null;
    if (p.j3 != null) { const B = D[T], jc = p.j3 - 1, m0 = B[s.i].etm, m3 = B[jc].etm, o0 = idx[O].get(m0), o3 = idx[O].get(m3); /* amendment 2: closes of the minute BEFORE the 3R minute */
      if (jc > s.i && o0 != null && o3 != null) { const own = s.dir * (B[jc].c / B[s.i].c - 1), oth = s.dir * (D[O][o3].c / D[O][o0].c - 1); conf = +(oth >= own); } }
    ev.push({ d, T, k, dir: s.dir, ...p, conf }); } }
if (SMOKE) { const r3 = ev.filter((x) => x.j3 != null); console.log(JSON.stringify({ events: ev.length, reach3: r3.length, reach6: r3.filter((x) => x.r6).length, fast: r3.filter((x) => x.t3 <= 20).length, slow60: r3.filter((x) => x.t3 > 60).length, conf: r3.filter((x) => x.conf === 1).length })); process.exit(0); }
// difference in proportions, day-clustered (OLS of y on [1, g], cluster-robust by day)
function dprop(a, g) { const A = a.filter((x) => g(x) != null); const y = A.map((x) => +x.r6), G = A.map((x) => g(x)); const n1 = G.filter((v) => v === 1).length, n0 = G.filter((v) => v === 0).length; if (n1 < 10 || n0 < 10) return { n1, n0, b: NaN, t: NaN };
  const p1 = mean(y.filter((_, i) => G[i] === 1)), p0 = mean(y.filter((_, i) => G[i] === 0)), b = p1 - p0, by = new Map();
  A.forEach((x, i) => { const e = y[i] - (G[i] ? p1 : p0), u = by.get(x.d) ?? [0, 0]; u[0] += G[i] ? e / n1 : 0; u[1] += G[i] ? 0 : e / n0; by.set(x.d, u); });
  let v = 0; for (const [a1, a0] of by.values()) v += (a1 - a0) ** 2; const Gc = by.size; v *= Gc / Math.max(1, Gc - 1); return { n1, n0, p1, p0, b, t: b / Math.sqrt(v) }; }
const B = (x) => x.d <= BUILD_END, Hd = (x) => x.d >= HOLD_START, r3 = ev.filter((x) => x.j3 != null);
const gR1 = (x) => (x.t3 <= 20 ? 1 : x.t3 > 60 ? 0 : null), gR2 = (x) => +(x.t3 <= 20), gC = (x) => x.conf;
const H = [['R1', gR1, () => true], ['R2', gR2, () => true], ['R3', gC, (x) => x.T === 'SPY'], ['R4', gC, (x) => x.T === 'QQQ']].map(([id, g, f]) => ({ id, build: dprop(r3.filter((x) => B(x) && f(x)), g), hold: dprop(r3.filter((x) => Hd(x) && f(x)), g) }));
// unregistered: management rules on all events (R per trade)
const rule = (x, hold) => { if (x.j3 == null) return (x.stopped ? -1 : x.eodR) - x.cost; if (!hold(x)) return 3 - x.cost; return (x.r6 ? 6 : x.stopped ? -1 : x.eodR) - x.cost; };
const mg = (per) => { const a = ev.filter(per); return { n: a.length, exit3: mean(a.map((x) => rule(x, () => false))), holdFast: mean(a.map((x) => rule(x, (y) => y.t3 <= 20))), holdConf: mean(a.map((x) => rule(x, (y) => y.conf === 1))), holdAll: mean(a.map((x) => rule(x, () => true))) }; };
const base = (per) => { const a = ev.filter(per), q = a.filter((x) => x.j3 != null); return { events: a.length, reach3: q.length, p6given3: mean(q.map((x) => +x.r6)), medianT3: q.map((x) => x.t3).sort((u, v) => u - v)[q.length >> 1] }; };
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'R.json'), JSON.stringify({ run: new Date().toISOString(), H, mgmt: { build: mg(B), hold: mg(Hd) }, base: { build: base(B), hold: base(Hd) } }, null, 1));
console.log(JSON.stringify(H.map((x) => [x.id, x.hold.p1, x.hold.p0, x.hold.t])));
