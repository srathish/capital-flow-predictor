#!/usr/bin/env node
// DESIGN_take_profit.md — take-profit ladders on cached real ATM monthly options (Ideas200 B contracts).
import fs from 'node:fs';
import path from 'node:path';
import { isTradingDay } from '../world/prices_clean.mjs';
import { monthlyExpiry, occ, atmStrike } from './bigmover_collect.mjs';
const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), D = path.join(SH, '..', '.cache', 'bigmover'), OUT = path.join(SH, 'results_take_profit');
if (fs.existsSync(path.join(OUT, 'summary.md')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const addTD = (d, n) => { let t = d, k = 0; while (k < n) { t = new Date(Date.parse(t + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10); if (isTradingDay(t)) k++; } return t; };
const cache = new Map(), load = (id) => { if (!cache.has(id)) { const f = path.join(D, 'contracts', `${id}.json`); cache.set(id, fs.existsSync(f) ? new Map(JSON.parse(fs.readFileSync(f, 'utf8')).map((r) => [r.d, r])) : null); } return cache.get(id); };
const weeks = JSON.parse(fs.readFileSync(path.join(D, 'picks.json'), 'utf8')), TAGS = ['S41', 'COMBO', 'S17', 'CONTROL'], trades = [];
for (const w of weeks) { const e = monthlyExpiry(w.d); if (!e) continue;
  for (const p of w.picks) { if (!p.tags.some((t) => TAGS.includes(t))) continue; const k = atmStrike(p.raw, p.strikes), mc = load(occ(p.t, e, 'C', k)), mp = load(occ(p.t, e, 'P', k)); if (!mc || !mp) continue; const ec = mc.get(w.d), ep = mp.get(w.d); if (!(ec?.ask > 0) || !(ep?.ask > 0)) continue;
    const path_ = []; let d = w.d; for (let i = 1; i <= 20; i++) { d = addTD(d, 1); if (d > e) break; const c = mc.get(d), q = mp.get(d); path_.push({ d, cb: c?.bid ?? null, pb: q?.bid ?? null }); }
    const last = (key) => { for (let i = path_.length - 1; i >= 0; i--) if (path_[i][key] != null) return path_[i][key]; return null; };
    const run = (struct, tp, stop) => { const cost = struct === 'call' ? ec.ask : struct === 'put' ? ep.ask : ec.ask + ep.ask; for (const s of path_) { const v = struct === 'call' ? s.cb : struct === 'put' ? s.pb : s.cb != null && s.pb != null ? s.cb + s.pb : null; if (v == null) continue; if (v >= cost * (1 + tp)) return { r: v / cost - 1, hit: 1 }; if (stop && v <= cost * 0.5) return { r: v / cost - 1, hit: 0 }; }
      const lc = last('cb') ?? 0, lp = last('pb') ?? 0, v = struct === 'call' ? lc : struct === 'put' ? lp : lc + lp; return { r: v / cost - 1, hit: 0 }; };
    for (const tag of p.tags.filter((t) => TAGS.includes(t))) for (const struct of ['call', 'put', 'straddle']) for (const tp of [0.2, 0.5]) for (const stop of [false, true]) trades.push({ d: w.d, exit: addTD(w.d, 20), tag, struct, tp, stop, ...run(struct, tp, stop) }); } }
const sel = (tag, struct, tp, stop, per) => trades.filter((x) => x.tag === tag && x.struct === struct && x.tp === tp && x.stop === stop && per(x));
const st = (a) => { if (a.length < 30) return { n: a.length, m: NaN, t: NaN }; const m = mean(a.map((x) => x.r)), by = new Map(); for (const x of a) by.set(x.d, (by.get(x.d) ?? 0) + x.r - m); const G = by.size, se = Math.sqrt([...by.values()].reduce((s, v) => s + v * v, 0) * G / Math.max(1, G - 1)) / a.length; const s = a.map((x) => x.r).sort((x, y) => x - y);
  const wk = new Map(); for (const x of a) (wk.get(x.d) ?? wk.set(x.d, []).get(x.d)).push(x.r); let acct = 1; for (const [, v] of [...wk].sort()) acct *= 1 + 0.05 * mean(v); return { n: a.length, m, t: m / se, win: mean(a.map((x) => x.hit)), med: s[s.length >> 1], worst: s[0], acct }; };
const B = (x) => x.exit <= '2025-06-30', Hd = (x) => x.d >= '2025-07-01';
const H = [...['call', 'put', 'straddle'].flatMap((s, i) => [0.2, 0.5].map((tp, j) => ({ id: `T${i * 2 + j + 1}`, label: `radar ${s}, take +${tp * 100}%`, f: (per) => st(sel('S41', s, tp, false, per)) }))),
  ...[0.2, 0.5].map((tp, j) => ({ id: `T${7 + j}`, label: `radar straddle, take +${tp * 100}%, stop −50%`, f: (per) => st(sel('S41', 'straddle', tp, true, per)) })),
  ...[0.2, 0.5].map((tp, j) => ({ id: `T${9 + j}`, label: `COMBO straddle, take +${tp * 100}%`, f: (per) => st(sel('COMBO', 'straddle', tp, false, per)) })),
  ...[0.2, 0.5].map((tp, j) => ({ id: `T${11 + j}`, label: `radar − random straddle, take +${tp * 100}%`, diff: true, f: (per) => { const a = st(sel('S41', 'straddle', tp, false, per)), c = st(sel('CONTROL', 'straddle', tp, false, per)); return { ...a, m: a.m - c.m, t: (a.m - c.m) / Math.sqrt((a.m / a.t) ** 2 + (c.m / c.t) ** 2), ctl: c.m }; } }))];
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
for (const h of H) { h.build = h.f(B); h.hold = h.f(Hd); h.p = Number.isFinite(h.hold.t) ? 1 - Phi(h.hold.t) : 1; }
const o = H.map((h, i) => [h.p, i]).sort((a, b) => a[0] - b[0]); let km = -1; o.forEach(([p], q) => { if (p <= ((q + 1) / o.length) * 0.1) km = q; }); const ps = new Set(o.slice(0, km + 1).map(([, i]) => i)); H.forEach((h, i) => (h.ok = ps.has(i) && h.hold.m > 0));
const pc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%' : '—'), f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const L = ['# Take-profit test — can we catch +20% / +50% option gains?', `\nRun ${new Date().toISOString()} · real ATM monthly options, buy at the ask, sell at the bid the first day it is up TP (else day 20)\n`, `**Validated (BH q = 0.10 across 12, holdout mean > 0): ${H.filter((h) => h.ok).map((h) => h.id).join(', ') || 'none'}**\n`,
  '| id | trade | build: mean/trade (t) · hit rate | holdout: mean/trade (t) · hit rate | holdout median / worst | 5%/week compounded (holdout) |', '|---|---|---|---|---|---|',
  ...H.map((h) => `| ${h.id} | ${h.label} | ${pc(h.build.m)} (${f2(h.build.t)}) · ${pc(h.build.win)} | **${pc(h.hold.m)} (${f2(h.hold.t)}) · ${pc(h.hold.win)}** | ${pc(h.hold.med)} / ${pc(h.hold.worst)} | ${h.diff ? '—' : Number.isFinite(h.hold.acct) ? (h.hold.acct * 100 - 100).toFixed(0) + '%' : '—'} |`)];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'summary.md'), L.join('\n') + '\n'); console.log(L.join('\n'));
