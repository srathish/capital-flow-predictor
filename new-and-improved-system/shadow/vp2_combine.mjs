#!/usr/bin/env node
// Vol program 2 combiner: BH q = 0.10 across the 29 registered hypotheses (one-sided holdout p, predicted sign) → summary.md
import fs from 'node:fs';
import path from 'node:path';
import { OUT, Phi } from './vp2_common.mjs';
const J = (p) => JSON.parse(fs.readFileSync(path.join(OUT, `${p}.json`), 'utf8')), parts = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F'].map((p) => [p, J(p)]));
const H = Object.entries(parts).flatMap(([p, j]) => j.H.map((x) => ({ part: p, ...x })));
if (H.length !== 29) throw new Error(`expected 29 hypotheses, got ${H.length}`);
H.forEach((x) => { x.p = Number.isFinite(x.hold?.t) ? 1 - Phi(x.hold.t) : 1; });
const o = H.map((x, i) => [x.p, i]).sort((a, b) => a[0] - b[0]); let kmax = -1; o.forEach(([p], r) => { if (p <= ((r + 1) / o.length) * 0.10) kmax = r; }); const pass = new Set(o.slice(0, kmax + 1).map(([, i]) => i));
H.forEach((x, i) => { x.validated = pass.has(i) && x.hold.b > 0; });
const LAB = { A1: 'T1 sale spans a weekend/holiday', A2: 'T1 vs term-structure contango (−ln VIX/VIX3M)', A3: 'T1 vs variance premium (VIX1D vs 5-day realized)', A4: 'T1 on CPI days', A5: 'T1 on FOMC days (predicted WORSE; sign flipped)', A6: 'T1 on monthly OPEX days', A7: '0DTE short call leg minus short put leg',
  B1: 'T1 vs implied ÷ our range forecast', B2: '0DTE vs implied ÷ our range forecast', C1: '0DTE sold 10:30, gamma days, mean > 0', C2: '0DTE sold 12:00, gamma days, mean > 0', C3: '0DTE sold 14:00, gamma days, mean > 0', C4: '0DTE 10:30, gamma days vs others', C5: '0DTE 12:00, gamma days vs others', C6: '0DTE 14:00, gamma days vs others',
  D1: 'IWM straddle, gamma days vs others', D2: 'DIA straddle, gamma days vs others', D3: 'IWM ±1% fly, gamma days vs others', D4: 'DIA ±1% fly, gamma days vs others',
  E1: 'sell quiet stocks (low vanna) vs random, 20d', E2: 'sell quiet stocks (S55 low) vs random, 20d', E3: 'sell quiet stocks (low realized vol) vs random, 20d', E4: 'sell quiet stocks (S53 low) vs random, 20d', E5: 'sell quiet stocks (combined) vs random, 20d', E6: 'sell quiet stocks (combined) vs random, 10d', E7: 'sell random stock straddles, 20d, > 0', E8: 'sell quiet stocks (combined), 20d, > 0',
  F1: 'intraday momentum: last 30 min follows the day', F2: 'intraday momentum stronger when dealers short gamma' };
const f = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—'), pc = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '—');
const extra = (x, s) => { if (!s) return ''; const bits = []; if (s.n1 != null) bits.push(`on ${s.n1}: ${pc(s.mOn)} vs off ${pc(s.mOff)}`); if (s.picks) bits.push(`picks ${pc(s.picks.m)}${s.control ? ' vs control ' + pc(s.control.m) : ''}`); if (s.usd != null) bits.push(`$${f(s.usd, 2)}/straddle, win ${pc(s.win)}`); if (s.call != null) bits.push(`call ${pc(s.call)} put ${pc(s.put)}`); return bits.length ? ' · ' + bits.join(' · ') : ''; };
const cell = (x, s) => (s ? `${f(s.b)} (t ${f(s.t, 2)}, n ${s.n})${extra(x, s)}` : '—');
const L = ['# Volatility program 2 — results', `\nRun ${new Date().toISOString()} · design shadow/DESIGN_vol_program2.md · BH q = 0.10 across 29 (one-sided, holdout)\n`, `**Validated: ${H.filter((x) => x.validated).map((x) => x.id).join(', ') || 'none'}**\n`,
  '| id | idea | build | holdout | p | validated |', '|---|---|---|---|---|---|', ...H.map((x) => `| ${x.id} | ${LAB[x.id]} | ${cell(x, x.build)} | **${cell(x, x.hold)}** | ${x.p.toFixed(4)} | ${x.validated ? 'yes' : 'no'} |`),
  '\nEffects are standardized coefficients on P&L ÷ premium (continuous features: per 1 sd), dummy coefficients (event / gamma days), mean differences (E, A7, C1–C3) or bp-per-bp slopes (F).',
  `\nPart E: ${parts.E.missing} pick-weeks without contract data, ${parts.E.expired} trades skipped at expiry without a quote. Part D counts: ${JSON.stringify(parts.D.cnt)}.`];
fs.writeFileSync(path.join(OUT, 'summary.md'), L.join('\n') + '\n'); console.log(L.join('\n'));
