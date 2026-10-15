#!/usr/bin/env node
// Vol program 2 part B — implied move vs our build-fit range forecast (shadow/DESIGN_vol_program2.md).
import fs from 'node:fs';
import path from 'node:path';
import { OUT, loadRows, winsor, regTest, ols, T1_BUILD_END, T1_HOLD_START, T2_BUILD_END, T2_HOLD_START } from './vp2_common.mjs';
const SMOKE = process.argv.includes('--smoke'); if (!SMOKE && fs.existsSync(path.join(OUT, 'B.json')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const rows = [], models = {};
for (const T of ['SPY', 'QQQ']) { const { rows: R } = loadRows(T); const X = (x) => [1, Math.log(x.f.ivx), x.f.A01, Math.log(x.f.rng5)], ok = (x) => X(x).every(Number.isFinite) && x.f.range > 0;
  const fit = R.filter((x) => x.k === 'T1' && x.d <= T1_BUILD_END && ok(x)); const m = ols(fit.map((x) => ({ t: x.d, y: Math.log(x.f.range), x: X(x) }))).beta; models[T] = { beta: m, n: fit.length };
  for (const x of R) if (X(x).every(Number.isFinite)) { x.edge = Math.log(x.prem / x.px) - X(x).reduce((s, v, i) => s + v * m[i], 0); rows.push(x); } }
winsor(rows);
if (SMOKE) { console.log(JSON.stringify({ models: Object.fromEntries(Object.entries(models).map(([k, v]) => [k, v.n])), T1: rows.filter((x) => x.k === 'T1').length, T2: rows.filter((x) => x.k === 'T2').length })); process.exit(0); }
const f = (x) => x.edge, sel = (k, a, b) => rows.filter((x) => x.k === k && x.d >= a && x.d <= b);
const H = [{ id: 'B1', build: regTest(sel('T1', '0', T1_BUILD_END), f), hold: regTest(sel('T1', T1_HOLD_START, '9'), f) }, { id: 'B2', build: regTest(sel('T2', '0', T2_BUILD_END), f), hold: regTest(sel('T2', T2_HOLD_START, '9'), f) }];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'B.json'), JSON.stringify({ run: new Date().toISOString(), models, H }, null, 1)); console.error('B done');
