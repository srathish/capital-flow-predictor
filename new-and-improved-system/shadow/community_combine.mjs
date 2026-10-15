#!/usr/bin/env node
// Community batch combiner: Benjamini–Hochberg q = 0.10 across the 17 registered hypotheses (one-sided holdout p) → summary.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SH = path.dirname(fileURLToPath(import.meta.url)), R = path.join(SH, 'results_community'), J = (f) => JSON.parse(fs.readFileSync(path.join(R, f), 'utf8'));
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const P = J('P.json'), RR = J('R.json'), L = J('L.json'), E = J('E.json');
const H = [...P.H.map((x) => ({ part: 'P', ...x, est: x.hold.b })), ...RR.H.map((x) => ({ part: 'R', ...x, est: x.hold.b })), ...L.H.map((x) => ({ part: 'L', ...x, est: x.hold.m })), ...E.H.map((x) => ({ part: 'E', ...x, est: x.hold.m }))];
if (H.length !== 17) throw new Error(`expected 17 hypotheses, got ${H.length}`);
H.forEach((x) => { x.p = Number.isFinite(x.hold.t) ? 1 - Phi(x.hold.t) : 1; });
const o = H.map((x, i) => [x.p, i]).sort((a, b) => a[0] - b[0]); let kmax = -1; o.forEach(([p], r) => { if (p <= ((r + 1) / o.length) * 0.10) kmax = r; }); const pass = new Set(o.slice(0, kmax + 1).map(([, i]) => i));
H.forEach((x, i) => { x.validated = pass.has(i) && x.est > 0; });
const f = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—'), pc = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '—');
const lab = { P1: 'straddle, 2σ breach day', P2: '±1% fly, 2σ breach', P3: '±1/±2% condor, 2σ breach', P4: 'straddle, ATR+volume breach', P5: '±1% fly, ATR+volume breach', P6: '±1/±2% condor, ATR+volume breach', P7: 'straddle, 2σ breach beyond gamma', P8: 'straddle, ATR+volume breach beyond gamma',
  R1: 'P(6R | 3R) fast ≤20m vs >60m', R2: 'P(6R | 3R) ≤20m vs >20m', R3: 'SPY P(6R | 3R) QQQ-confirmed vs not', R4: 'QQQ P(6R | 3R) SPY-confirmed vs not', L1: 'lunch fade, all days', L2: 'lunch fade, |move| ≥ 0.25%', L3: 'lunch fade, |move| ≥ 0.5%', E1: 'ESB_q ratchet + 2.5U target', E2: 'ESB_q ratchet only' };
const desc = (x, s) => { if (x.part === 'P') return `effect ${f(s.b)} (t ${f(s.t, 2)}; breach days ${s.nb}/${s.n}; mean on ${pc(s.mOn)} vs off ${pc(s.mOff)})`; if (x.part === 'R') return `${pc(s.p1)} vs ${pc(s.p0)} (t ${f(s.t, 2)}; n ${s.n1}/${s.n0})`;
  if (x.part === 'L') return `${f(s.m * 100, 3)}% per trade (t ${f(s.t, 2)}, n ${s.n}, win ${pc(s.win)})`; return `${f(s.m)}R (t ${f(s.t, 2)}, n ${s.n}, win ${pc(s.win)}, PF ${f(s.pf, 2)})`; };
const out = ['# Community batch — results', `\nRun ${new Date().toISOString()} · design shadow/DESIGN_community_batch.md · BH q = 0.10 across 17 · holdout 2025-04-01 → 2026-10-02\n`,
  `**Validated: ${H.filter((x) => x.validated).map((x) => x.id).join(', ') || 'none'}**\n`, '| id | idea | build | holdout | holdout one-sided p | validated |', '|---|---|---|---|---|---|',
  ...H.map((x) => `| ${x.id} | ${lab[x.id]} | ${desc(x, x.build)} | **${desc(x, x.hold)}** | ${x.p.toFixed(4)} | ${x.validated ? 'yes' : 'no'} |`),
  '\n## Runner management, R per event (not registered)\n', '| period | events | always exit 3R | hold for 6R if fast | hold if confirmed | always hold for 6R |', '|---|---|---|---|---|---|',
  ...['build', 'hold'].map((k) => { const m = RR.mgmt[k]; return `| ${k} | ${m.n} | ${f(m.exit3)} | ${f(m.holdFast)} | ${f(m.holdConf)} | ${f(m.holdAll)} |`; }),
  `\nBase rates: build P(6R | 3R) ${pc(RR.base.build.p6given3)} (median ${RR.base.build.medianT3} min to 3R); holdout ${pc(RR.base.hold.p6given3)} (median ${RR.base.hold.medianT3} min).`,
  `\nLunch fade per symbol, holdout (L1): ${Object.entries(L.H[0].perT).map(([T, v]) => `${T} ${f(v.hold.m * 100, 3)}% (t ${f(v.hold.t, 2)})`).join(' · ')}; months positive ${L.monthsPositive}/${L.months}.`,
  `\nESB_q per symbol, holdout (E1): ${Object.entries(E.H[0].perT).map(([T, v]) => `${T} ${f(v.m)}R (t ${f(v.t, 2)}, n ${v.n})`).join(' · ')}.`,
  `\nPart P rows dropped for missing legs: straddle ${P.drop.S}, fly ${P.drop.F}, condor ${P.drop.K}.`];
fs.writeFileSync(path.join(R, 'summary.md'), out.join('\n') + '\n'); console.log(out.join('\n'));
