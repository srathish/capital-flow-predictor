#!/usr/bin/env node
// Vol program 2 part C — 0DTE entry time (shadow/DESIGN_vol_program2.md). Sell the ATM 0DTE straddle at the first one-minute
// close in [t, t+5] − $0.01/leg, settle at intrinsic on d's close; F2 from vp2_common (build top third of A01).
import fs from 'node:fs';
import path from 'node:path';
import { C, OUT, loadRows, mean, regTest, T2_BUILD_END, T2_HOLD_START } from './vp2_common.mjs';
const SMOKE = process.argv.includes('--smoke'); if (!SMOKE && fs.existsSync(path.join(OUT, 'C.json')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const TIMES = [630, 720, 840], rows = [];
for (const T of ['SPY', 'QQQ']) { const { rows: R } = loadRows(T), F = new Map(); for (const x of R) if (!F.has(x.d)) F.set(x.d, x);
  const dir = path.join(C, 'straddle_times', T); if (!fs.existsSync(dir)) continue;
  for (const fn of fs.readdirSync(dir).sort()) { const S = JSON.parse(fs.readFileSync(path.join(dir, fn), 'utf8')), base = F.get(S.d); if (!base) continue;
    for (const tm of TIMES) { const L = S.legs?.[tm]; if (!L) continue; const c = L.C?.[0], p = L.P?.[0]; if (!(c?.c > 0.02 && p?.c > 0.02)) continue;
      const prem = c.c + p.c - 0.02, pnl = prem - Math.abs(base.close - L.strike); rows.push({ T, d: S.d, tm, f: base.f, k: 'T2', r: pnl / prem, pnl }); } } }
for (const tm of TIMES) { const a = rows.filter((x) => x.tm === tm).map((x) => x.r).sort((x, y) => x - y); if (!a.length) continue; const lo = a[Math.floor(0.01 * (a.length - 1))], hi = a[Math.floor(0.99 * (a.length - 1))]; for (const x of rows) if (x.tm === tm) x.rw = Math.min(hi, Math.max(lo, x.r)); }
if (SMOKE) { console.log(JSON.stringify(Object.fromEntries(TIMES.map((tm) => [tm, rows.filter((x) => x.tm === tm).length])))); process.exit(0); }
const mst = (a) => { if (a.length < 30) return { n: a.length, b: NaN, t: NaN }; const m = mean(a.map((x) => x.rw)), by = new Map(); for (const x of a) by.set(x.d, (by.get(x.d) ?? 0) + x.rw - m); const G = by.size, se = Math.sqrt([...by.values()].reduce((q, v) => q + v * v, 0) * G / Math.max(1, G - 1)) / a.length;
  return { n: a.length, b: m, t: m / se, raw: mean(a.map((x) => x.r)), usd: mean(a.map((x) => x.pnl)), win: a.filter((x) => x.r > 0).length / a.length }; };
const B = (x) => x.d <= T2_BUILD_END, Hd = (x) => x.d >= T2_HOLD_START, at = (tm, per) => rows.filter((x) => x.tm === tm && per(x));
const H = [...TIMES.map((tm, i) => ({ id: `C${i + 1}`, tm, build: mst(at(tm, B).filter((x) => x.f.F2 === 1)), hold: mst(at(tm, Hd).filter((x) => x.f.F2 === 1)) })),
  ...TIMES.map((tm, i) => ({ id: `C${i + 4}`, tm, build: regTest(at(tm, B), (x) => x.f.F2, { dummy: true }), hold: regTest(at(tm, Hd), (x) => x.f.F2, { dummy: true }) }))];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'C.json'), JSON.stringify({ run: new Date().toISOString(), H }, null, 1)); console.error('C done');
