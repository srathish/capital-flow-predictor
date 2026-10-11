#!/usr/bin/env node
// ideas200 part B — long ATM options (straddle / call / put) on weekly top-10 picks per big-mover signal vs 10 random
// controls, real UW prices (buy at the closing ask on the rebalance day, sell at the closing bid h trading days later,
// or on the expiry day if sooner). DESIGN_ideas200.md part B. node shadow/ideas200_partB.mjs [--smoke]
import fs from 'node:fs';
import path from 'node:path';
import { isTradingDay } from '../world/prices_clean.mjs';
import { monthlyExpiry, occ, atmStrike } from './bigmover_collect.mjs';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), D = path.join(SH, '..', '.cache', 'bigmover'), OUT = path.join(SH, 'results_ideas200'), SMOKE = process.argv.includes('--smoke');
if (!SMOKE && fs.existsSync(path.join(OUT, 'partB.md')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const IDEAS = JSON.parse(fs.readFileSync(path.join(SH, 'ideas200.json'), 'utf8')).ideas.filter((x) => x.part === 'B');
const BUILD_END = '2025-06-30', HOLD_START = '2025-07-01', mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const addTD = (d, n) => { let t = d, k = 0; while (k < n) { t = new Date(Date.parse(t + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10); if (isTradingDay(t)) k++; } return t; };
const cache = new Map(), load = (id) => { if (!cache.has(id)) { const f = path.join(D, 'contracts', `${id}.json`); cache.set(id, fs.existsSync(f) ? new Map(JSON.parse(fs.readFileSync(f, 'utf8')).map((r) => [r.d, r])) : null); } return cache.get(id); };
const rowOn = (m, d, side) => { for (let k = 0; k < 4; k++) { const r = m.get(d); if (r && r[side] > 0) return r; d = addTD(d, 1); } return null; };
const weeks = JSON.parse(fs.readFileSync(path.join(D, 'picks.json'), 'utf8')), trades = []; let missing = 0;
for (const w of weeks) { const e = monthlyExpiry(w.d); if (!e) continue;
  for (const p of w.picks) { const k = atmStrike(p.raw, p.strikes), mc = load(occ(p.t, e, 'C', k)), mp = load(occ(p.t, e, 'P', k)); if (!mc || !mp) { missing++; continue; }
    const ec = mc.get(w.d), ep = mp.get(w.d); if (!(ec?.ask > 0) || !(ep?.ask > 0)) continue;
    for (const hold of [10, 20]) { let xd = addTD(w.d, hold); if (xd > e) xd = e; const xc = rowOn(mc, xd, 'bid') ?? (xd >= e ? { bid: 0 } : null), xp = rowOn(mp, xd, 'bid') ?? (xd >= e ? { bid: 0 } : null); if (!xc || !xp) continue;
      const res = { STRADDLE: (xc.bid + xp.bid - ec.ask - ep.ask) / (ec.ask + ep.ask), CALL: (xc.bid - ec.ask) / ec.ask, PUT: (xp.bid - ep.ask) / ep.ask };
      for (const tag of p.tags) trades.push({ d: w.d, exit: xd, t: p.t, tag, hold, ...res }); } } }
console.error(`trades ${trades.length}, picks without contract data ${missing}`);
if (SMOKE) { console.log(JSON.stringify({ trades: trades.length, missing, weeks: new Set(trades.map((x) => x.d)).size })); process.exit(0); }
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const st = (a, key) => { const v = a.map((x) => x[key]).filter(Number.isFinite); if (v.length < 30) return { n: v.length, m: NaN, se: NaN }; const m = mean(v), by = new Map(); for (const x of a) if (Number.isFinite(x[key])) by.set(x.d, (by.get(x.d) ?? 0) + (x[key] - m)); const G = by.size; return { n: v.length, m, med: med(v), win: v.filter((y) => y > 0).length / v.length, se: Math.sqrt(([...by.values()].reduce((s, y) => s + y * y, 0) * G) / Math.max(1, G - 1)) / v.length }; };
const res = IDEAS.map((idea) => { const key = idea.structure === 'straddle' ? 'STRADDLE' : idea.structure, sel = (x) => x.hold === idea.hold;
  const per = (tag, s) => st(trades.filter((x) => x.tag === tag && sel(x) && s(x)), key), B = (x) => x.exit <= BUILD_END, H = (x) => x.d >= HOLD_START;
  const pb = per(idea.sig, B), cb = per('CONTROL', B), ph = per(idea.sig, H), ch = per('CONTROL', H), dt = (ph.m - ch.m) / Math.sqrt(ph.se ** 2 + ch.se ** 2), dtb = (pb.m - cb.m) / Math.sqrt(pb.se ** 2 + cb.se ** 2);
  return { ...idea, pb, cb, ph, ch, dt, dtb, p: Number.isFinite(dt) ? 1 - Phi(dt) : 1 }; });
const o = res.map((r, i) => [r.p, i]).sort((a, b) => a[0] - b[0]); let kmax = -1; o.forEach(([p], r) => { if (p <= ((r + 1) / o.length) * 0.10) kmax = r; }); const pass = new Set(o.slice(0, kmax + 1).map(([, i]) => i));
res.forEach((r, i) => { r.ok = pass.has(i) && r.ph.m > 0 && r.dt >= 1.65; });
const fx = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—'), pc = (x) => (Number.isFinite(x) ? fx(x * 100, 1) + '%' : '—');
const L = ['# Ideas200 — Part B: long options on predicted big movers (real UW prices)', `\nRun ${new Date().toISOString()} · 60 ideas · ${trades.length} trade rows · buy at the ask, sell at the bid\n`,
  `**Validated (holdout BH within B on picks − control, picks profitable, diff t ≥ 1.65): ${res.filter((r) => r.ok).map((r) => r.id).join(', ') || 'none'}**\n`,
  '| idea | build: picks mean (n) / control | holdout: picks mean, median, win (n) | holdout control mean | diff t (build / holdout) | pass |', '|---|---|---|---|---|---|',
  ...res.slice().sort((a, b) => (b.dt || -9) - (a.dt || -9)).map((r) => `| ${r.id} | ${pc(r.pb.m)} (${r.pb.n}) / ${pc(r.cb.m)} | **${pc(r.ph.m)}**, ${pc(r.ph.med)}, ${Number.isFinite(r.ph.win) ? (r.ph.win * 100).toFixed(0) + '%' : '—'} (${r.ph.n}) | ${pc(r.ch.m)} | ${fx(r.dtb, 2)} / ${fx(r.dt, 2)} | ${r.ok ? 'yes' : ''} |`)];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'partB.md'), L.join('\n') + '\n'); console.log(L.slice(0, 4).join('\n'));
