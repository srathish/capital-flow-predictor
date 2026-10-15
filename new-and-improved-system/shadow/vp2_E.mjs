#!/usr/bin/env node
// Vol program 2 part E — SELL ATM monthly straddles on predicted-quiet stocks vs random controls (shadow/DESIGN_vol_program2.md).
// Contract handling copied from ideas200_partB.mjs (audited), sides flipped: sell at the closing bid, buy back at the
// closing ask h trading days later (intrinsic on/after expiry).
import fs from 'node:fs';
import path from 'node:path';
import { isTradingDay } from '../world/prices_clean.mjs';
import { monthlyExpiry, occ, atmStrike } from './bigmover_collect.mjs';
import { OUT, mean, Phi } from './vp2_common.mjs';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), D = path.join(SH, '..', '.cache', 'bigmover'), SMOKE = process.argv.includes('--smoke');
if (!SMOKE && fs.existsSync(path.join(OUT, 'E.json')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const BUILD_END = '2025-06-30', HOLD_START = '2025-07-01';
const addTD = (d, n) => { let t = d, k = 0; while (k < n) { t = new Date(Date.parse(t + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10); if (isTradingDay(t)) k++; } return t; };
const cache = new Map(), load = (id) => { if (!cache.has(id)) { const f = path.join(D, 'contracts', `${id}.json`); cache.set(id, fs.existsSync(f) ? new Map(JSON.parse(fs.readFileSync(f, 'utf8')).map((r) => [r.d, r])) : null); } return cache.get(id); };
const rowOn = (m, d, side) => { for (let k = 0; k < 4; k++) { const r = m.get(d); if (r && r[side] > 0) return r; d = addTD(d, 1); } return null; };
// underlying close at expiry for intrinsic: daily closes from the stock's UW ohlc cache if present, else last mid
const weeks = JSON.parse(fs.readFileSync(path.join(D, 'picks_quiet.json'), 'utf8')), trades = []; let missing = 0, expired = 0;
for (const w of weeks) { const e = monthlyExpiry(w.d); if (!e) continue;
  for (const p of w.picks) { const k = atmStrike(p.raw, p.strikes), mc = load(occ(p.t, e, 'C', k)), mp = load(occ(p.t, e, 'P', k)); if (!mc || !mp) { missing++; continue; }
    const ec = mc.get(w.d), ep = mp.get(w.d); if (!(ec?.bid > 0) || !(ep?.bid > 0) || !(ec.ask > 0) || !(ep.ask > 0)) continue;
    for (const hold of [10, 20]) { let xd = addTD(w.d, hold); if (xd > e) xd = e; const xc = rowOn(mc, xd, 'ask'), xp = rowOn(mp, xd, 'ask'); if (!xc || !xp) { if (xd >= e) expired++; continue; }
      const prem = ec.bid + ep.bid, mid0 = (ec.bid + ec.ask + ep.bid + ep.ask) / 2, mid1 = (xc.bid + xc.ask + xp.bid + xp.ask) / 2;
      const r = (prem - xc.ask - xp.ask) / prem, rMid = (mid0 - mid1) / mid0;
      for (const tag of p.tags) trades.push({ d: w.d, exit: xd, t: p.t, tag, hold, r, rMid }); } } }
if (SMOKE) { console.log(JSON.stringify({ trades: trades.length, missing, expired, weeks: new Set(trades.map((x) => x.d)).size, tags: [...new Set(trades.map((x) => x.tag))] })); process.exit(0); }
const st = (a, key = 'r') => { const v = a.map((x) => x[key]).filter(Number.isFinite); if (v.length < 30) return { n: v.length, m: NaN, se: NaN }; const m = mean(v), by = new Map(); for (const x of a) if (Number.isFinite(x[key])) by.set(x.d, (by.get(x.d) ?? 0) + (x[key] - m)); const G = by.size;
  const s = [...v].sort((x, y) => x - y); return { n: v.length, m, med: s[s.length >> 1], win: v.filter((y) => y > 0).length / v.length, worst: s[0], blow: v.filter((y) => y < -1).length / v.length, se: Math.sqrt(([...by.values()].reduce((q, y) => q + y * y, 0) * G) / Math.max(1, G - 1)) / v.length }; };
const B = (x) => x.exit <= BUILD_END, Hd = (x) => x.d >= HOLD_START, sel = (tag, hold, per) => trades.filter((x) => x.tag === tag && x.hold === hold && per(x));
const diff = (tag, hold, per) => { const p = st(sel(tag, hold, per)), c = st(sel('CONTROL', hold, per)); return { n: p.n, b: p.m - c.m, t: (p.m - c.m) / Math.sqrt(p.se ** 2 + c.se ** 2), picks: p, control: c, picksMid: st(sel(tag, hold, per), 'rMid').m, controlMid: st(sel('CONTROL', hold, per), 'rMid').m }; };
const abs = (tag, hold, per) => { const p = st(sel(tag, hold, per)); return { n: p.n, b: p.m, t: p.m / p.se, picks: p, mid: st(sel(tag, hold, per), 'rMid').m }; };
const H = [...['Q17', 'Q55', 'Q41', 'Q53', 'QCOMBO'].map((g, i) => ({ id: `E${i + 1}`, tag: g, hold: 20, build: diff(g, 20, B), hold_: diff(g, 20, Hd) })), { id: 'E6', tag: 'QCOMBO', hold: 10, build: diff('QCOMBO', 10, B), hold_: diff('QCOMBO', 10, Hd) },
  { id: 'E7', tag: 'CONTROL', hold: 20, build: abs('CONTROL', 20, B), hold_: abs('CONTROL', 20, Hd) }, { id: 'E8', tag: 'QCOMBO', hold: 20, build: abs('QCOMBO', 20, B), hold_: abs('QCOMBO', 20, Hd) }].map(({ hold_, ...x }) => ({ ...x, hold: hold_, days: x.hold }));
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'E.json'), JSON.stringify({ run: new Date().toISOString(), missing, expired, H }, null, 1)); console.error('E done');
