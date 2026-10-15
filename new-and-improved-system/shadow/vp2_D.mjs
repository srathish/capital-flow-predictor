#!/usr/bin/env node
// Vol program 2 part D — gamma-filtered T1 straddle and ±1% iron fly on IWM and DIA (shadow/DESIGN_vol_program2.md).
// Fly mechanics copied from iron_fly.mjs (audited): wings bought at the d−1 ask, actual strikes, max risk.
import fs from 'node:fs';
import path from 'node:path';
import { C, OUT, loadRows, winsor, regTest, T1_BUILD_END, T1_HOLD_START } from './vp2_common.mjs';
import { wingStrikes } from './iron_fly_collect.mjs';
const SMOKE = process.argv.includes('--smoke'); if (!SMOKE && fs.existsSync(path.join(OUT, 'D.json')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const res = {}, cnt = {};
for (const T of ['IWM', 'DIA']) { const { rows, th } = loadRows(T), t1 = rows.filter((x) => x.k === 'T1'); let nofly = 0;
  for (const x of t1) { const f = path.join(C, 'straddle_wings', T, `${x.d}.json`); if (!fs.existsSync(f)) { nofly++; continue; } const WG = JSON.parse(fs.readFileSync(f, 'utf8')), s = wingStrikes(x.px).find((q) => q.w === 0.01);
    const a = WG.t1?.['C' + s.C], b = WG.t1?.['P' + s.P]; if (!(a?.ask > 0 && b?.ask > 0)) { nofly++; continue; } const kc = a.strike ?? s.C, kp = b.strike ?? s.P, credit = x.prem - a.ask - b.ask, risk = Math.max(kc - x.strike, x.strike - kp) - credit;
    if (!(risk > 0)) { nofly++; continue; } x.fly = (credit - Math.abs(x.close - x.strike) + Math.max(0, x.close - kc) + Math.max(0, kp - x.close)) / risk; }
  winsor(t1); const fr = t1.filter((x) => Number.isFinite(x.fly)).map((x) => ({ ...x, r: x.fly, rw: undefined })); winsor(fr);
  cnt[T] = { t1: t1.length, fly: fr.length, nofly, th, F2: t1.filter((x) => x.f.F2 === 1).length };
  const per = (a, lo, hi) => a.filter((x) => x.d >= lo && x.d <= hi), F = (x) => x.f.F2;
  res[T] = { S: { build: regTest(per(t1, '0', T1_BUILD_END), F, { dummy: true }), hold: regTest(per(t1, T1_HOLD_START, '9'), F, { dummy: true }) }, F: { build: regTest(per(fr, '0', T1_BUILD_END), F, { dummy: true }), hold: regTest(per(fr, T1_HOLD_START, '9'), F, { dummy: true }) } }; }
if (SMOKE) { console.log(JSON.stringify(cnt)); process.exit(0); }
const H = [{ id: 'D1', ...res.IWM.S }, { id: 'D2', ...res.DIA.S }, { id: 'D3', ...res.IWM.F }, { id: 'D4', ...res.DIA.F }];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'D.json'), JSON.stringify({ run: new Date().toISOString(), cnt, H }, null, 1)); console.error('D done');
