#!/usr/bin/env node
// Vol program 2 part A — published timing effects on SPY/QQQ straddle selling (shadow/DESIGN_vol_program2.md).
import fs from 'node:fs';
import path from 'node:path';
import { OUT, loadRows, winsor, regTest, mean, T1_BUILD_END, T1_HOLD_START, T2_BUILD_END, T2_HOLD_START } from './vp2_common.mjs';
const SMOKE = process.argv.includes('--smoke'); if (!SMOKE && fs.existsSync(path.join(OUT, 'A.json')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const rows = [...loadRows('SPY').rows, ...loadRows('QQQ').rows]; winsor(rows);
const T1 = rows.filter((x) => x.k === 'T1'), T2 = rows.filter((x) => x.k === 'T2');
const t1b = T1.filter((x) => x.d <= T1_BUILD_END), t1h = T1.filter((x) => x.d >= T1_HOLD_START);
const feats = { A1: [(x) => x.f.gap, { dummy: true }], A2: [(x) => -Math.log(x.f.vix / x.f.vix3m), {}], A3: [(x) => (x.f.rv5 > 0 ? Math.log(x.f.vix1d / 100) - Math.log(x.f.rv5) : NaN), {}],
  A4: [(x) => x.f.cpi, { dummy: true }], A5: [(x) => x.f.fomc, { dummy: true, sign: -1 }], A6: [(x) => x.f.opex, { dummy: true }] };
if (SMOKE) { console.log(JSON.stringify({ T1: T1.length, T2: T2.length, build: t1b.length, hold: t1h.length, nonfinite: Object.fromEntries(Object.entries(feats).map(([k, [f]]) => [k, T1.filter((x) => !Number.isFinite(f(x))).length])) })); process.exit(0); }
const H = Object.entries(feats).map(([id, [f, o]]) => ({ id, build: regTest(t1b, f, o), hold: regTest(t1h, f, o) }));
// A7: paired call-leg minus put-leg return on T2, day-clustered; diff winsorized 1/99 over the full T2 sample
const dif = T2.map((x) => ({ d: x.d, v: x.rc - x.rp })).filter((x) => Number.isFinite(x.v)), s = dif.map((x) => x.v).sort((a, b) => a - b), lo = s[Math.floor(0.01 * (s.length - 1))], hi = s[Math.floor(0.99 * (s.length - 1))];
const dst = (a) => { if (a.length < 30) return { n: a.length, b: NaN, t: NaN }; const w = a.map((x) => ({ d: x.d, v: Math.min(hi, Math.max(lo, x.v)) })), m = mean(w.map((x) => x.v)), by = new Map(); for (const x of w) by.set(x.d, (by.get(x.d) ?? 0) + x.v - m); const G = by.size, se = Math.sqrt([...by.values()].reduce((q, v) => q + v * v, 0) * G / Math.max(1, G - 1)) / w.length; return { n: a.length, b: m, t: m / se, call: mean(T2.filter((x) => a.some((y) => y.d === x.d)).map((x) => x.rc)), put: mean(T2.filter((x) => a.some((y) => y.d === x.d)).map((x) => x.rp)) }; };
H.push({ id: 'A7', build: dst(dif.filter((x) => x.d <= T2_BUILD_END)), hold: dst(dif.filter((x) => x.d >= T2_HOLD_START)) });
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'A.json'), JSON.stringify({ run: new Date().toISOString(), H }, null, 1)); console.error('A done');
