#!/usr/bin/env node
// Community batch part E — ESB_q (mtmtempo) scaled to SPY / QQQ (shadow/DESIGN_community_batch.md). 15-minute bars from
// RTH minutes (minute handling copied from vwap_node.mjs); fills, stops and targets on 1-minute bars.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SH = path.dirname(fileURLToPath(import.meta.url)), C = path.join(SH, '..', '.cache'), OUT = path.join(SH, 'results_community'), SMOKE = process.argv.includes('--smoke');
if (!SMOKE && fs.existsSync(path.join(OUT, 'E.json')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const START = '2023-11-09', BUILD_END = '2025-03-31', HOLD_START = '2025-04-01', MINU = 0.00065;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const offC = new Map(), etMin = (t, d) => { if (!offC.has(d)) { const h = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(d + 'T16:00:00Z')); offC.set(d, (h - 16) * 60); } return (((Math.floor(t / 60) + offC.get(d)) % 1440) + 1440) % 1440; };
function loadDay(T, d) { const f = path.join(C, 'uw', 'm1', T, `${d}.json`); if (!fs.existsSync(f)) return null; const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  let reg = raw.filter((b) => b.m === 'r').map((b) => ({ ...b, etm: etMin(b.t, d) })).filter((b) => b.etm >= 570 && b.etm < 960); if (reg.length < 200) return null;
  const filled = [reg[0]]; for (let i = 1; i < reg.length; i++) { for (let m = filled.at(-1).etm + 1; m < reg[i].etm; m++) { const c0 = filled.at(-1).c; filled.push({ t: filled.at(-1).t + 60, o: c0, h: c0, l: c0, c: c0, v: 0, etm: m }); } filled.push(reg[i]); }
  return filled.map((b, i, a) => { const ref = [b.o, b.c, a[i - 1]?.c, a[i + 1]?.c].filter(Number.isFinite); return { ...b, h: Math.min(b.h, Math.max(...ref) * 1.002), l: Math.max(b.l, Math.min(...ref) * 0.998) }; }); }
function run(T, policy) { let days = fs.readdirSync(path.join(C, 'uw', 'm1', T)).map((f) => f.slice(0, 10)).filter((d) => d >= START && d <= '2026-10-02'); if (SMOKE) days = days.slice(0, 120);
  const Q = [], trades = []; let atr = NaN, trs = 0, ema = NaN, nb = 0; const piv = []; let leg = null;
  for (const d of days) { const M = loadDay(T, d); if (!M) continue; const groups = new Map(); for (const b of M) { const g = Math.floor((b.etm - 570) / 15); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(b); }
    let pos = null;
    for (const [g, mins] of [...groups].sort((a, b) => a[0] - b[0])) { const prev = Q.at(-1);
      // ---- trading inside this 15-minute bar (uses only state from completed bars) ----
      for (const b of mins) {
        if (pos) { const stopHit = pos.dir > 0 ? b.l <= pos.stop : b.h >= pos.stop; if (stopHit) { const fill = pos.dir > 0 ? Math.min(pos.stop, b.o) : Math.max(pos.stop, b.o); trades.push({ ...pos, d, exit: fill, why: 'stop' }); pos = null; continue; }
          if (policy === 'E1' && (pos.dir > 0 ? b.h >= pos.tgt : b.l <= pos.tgt)) { const fill = pos.dir > 0 ? Math.max(pos.tgt, b.o) : Math.min(pos.tgt, b.o); trades.push({ ...pos, d, exit: fill, why: 'target' }); pos = null; continue; }
          pos.best = Math.max(pos.best, pos.dir * ((pos.dir > 0 ? b.h : b.l) - pos.zero)); if (b.etm >= 959) { trades.push({ ...pos, d, exit: b.c, why: 'time' }); pos = null; } continue; }
        if (!leg || leg.used || leg.conf >= Q.length || !prev || !Number.isFinite(ema) || nb < 60 || b.etm > 958) continue; /* leg confirmed at a completed bar; ≥ 60 bars of history */
        const dir = leg.one < leg.zero ? 1 : -1; if (dir > 0 ? !(prev.c > ema) : !(prev.c <= ema)) continue;
        if (dir > 0 ? b.h >= leg.zero : b.l <= leg.zero) { const entry = dir > 0 ? Math.max(leg.zero, b.o) : Math.min(leg.zero, b.o); leg.used = true;
          pos = { T, dir, entry, zero: leg.zero, stop: leg.one, init: leg.one, U: leg.U, tgt: leg.zero + dir * 2.5 * leg.U, best: 0, step: 0, t0: d + ' ' + b.etm }; } } /* ladder measured from zero, as the spec */
      // ---- complete the 15-minute bar: ratchet, indicators, pivots, legs ----
      const bar = { o: mins[0].o, h: Math.max(...mins.map((x) => x.h)), l: Math.min(...mins.map((x) => x.l)), c: mins.at(-1).c }; Q.push(bar); nb++;
      if (pos) { const steps = Math.floor(pos.best / (0.25 * pos.U) + 1e-9); if (steps >= 1 && steps > pos.step) { pos.step = steps; const ns = pos.zero + pos.dir * (steps - 1) * 0.25 * pos.U; pos.stop = pos.dir > 0 ? Math.max(pos.stop, ns) : Math.min(pos.stop, ns); } }
      if (prev) { const tr = Math.max(bar.h - bar.l, Math.abs(bar.h - prev.c), Math.abs(bar.l - prev.c)); if (Q.length <= 15) { trs += tr; if (Q.length === 15) atr = trs / 14; } else atr = (atr * 13 + tr) / 14; }
      ema = Number.isFinite(ema) ? ema + (2 / 51) * (bar.c - ema) : Q.length >= 50 ? mean(Q.slice(-50).map((x) => x.c)) : NaN;
      const p = Q.length - 6; if (p >= 5) { const P = Q[p], L5 = Q.slice(p - 5, p), R5 = Q.slice(p + 1, p + 6);
        for (const kind of ['H', 'L']) { const isP = kind === 'H' ? L5.every((x) => P.h > x.h) && R5.every((x) => P.h > x.h) : L5.every((x) => P.l < x.l) && R5.every((x) => P.l < x.l); if (!isP) continue;
          const px = kind === 'H' ? P.h : P.l, opp = [...piv].reverse().find((x) => x.kind !== kind);
          if (opp) { const U = Math.abs(px - opp.px); if (U >= atr && U >= MINU * bar.c) leg = { zero: opp.px, one: px, U, conf: Q.length - 1, used: false }; }
          piv.push({ kind, px, at: p }); } } }
    if (pos) { const b = M.at(-1); trades.push({ ...pos, d, exit: b.c, why: 'time' }); } }
  return trades.map((x) => { const risk = Math.abs(x.entry - x.init); return { ...x, R: (x.dir * (x.exit - x.entry) - 0.02) / risk }; }); }
function st(a) { const n = a.length; if (n < 30) return { n, m: NaN, t: NaN }; const m = mean(a.map((x) => x.R)), by = new Map(); for (const x of a) by.set(x.d, (by.get(x.d) ?? 0) + (x.R - m)); const G = by.size; const se = Math.sqrt(([...by.values()].reduce((s, v) => s + v * v, 0) * G) / Math.max(1, G - 1)) / n;
  return { n, m, t: m / se, win: a.filter((x) => x.R > 0).length / n, pf: a.filter((x) => x.R > 0).reduce((s, x) => s + x.R, 0) / -a.filter((x) => x.R < 0).reduce((s, x) => s + x.R, 0) }; }
const res = {}; for (const pol of ['E1', 'E2']) res[pol] = [...run('SPY', pol), ...run('QQQ', pol)];
if (SMOKE) { console.log(JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, a]) => [k, { n: a.length, why: a.reduce((o, x) => ((o[x.why] = (o[x.why] ?? 0) + 1), o), {}), first: a.slice(0, 2).map((x) => ({ t0: x.t0, d: x.d, dir: x.dir, entry: x.entry, init: x.init, exit: x.exit, why: x.why })) }])))); process.exit(0); }
const B = (x) => x.d <= BUILD_END, Hd = (x) => x.d >= HOLD_START;
const H = ['E1', 'E2'].map((id) => ({ id, build: st(res[id].filter(B)), hold: st(res[id].filter(Hd)), perT: Object.fromEntries(['SPY', 'QQQ'].map((T) => [T, st(res[id].filter((x) => x.T === T && Hd(x)))])) }));
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'E.json'), JSON.stringify({ run: new Date().toISOString(), H }, null, 1)); console.log(JSON.stringify(H.map((x) => [x.id, x.hold.m, x.hold.t, x.hold.n])));
