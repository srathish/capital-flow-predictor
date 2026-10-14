#!/usr/bin/env node
// Iron-fly structure + sizing study (shadow/DESIGN_iron_fly.md). Single run; --smoke prints counts only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wingStrikes } from './iron_fly_collect.mjs';

const SH = path.dirname(fileURLToPath(import.meta.url)), NIS = path.join(SH, '..'), C = path.join(NIS, '.cache'), OUT = path.join(SH, 'results_iron_fly');
const SMOKE = process.argv.includes('--smoke');
if (fs.existsSync(path.join(OUT, 'summary.md')) && !process.argv.includes('--force') && !SMOKE) { console.error('already run'); process.exit(1); }
const BUILD_END = '2025-03-31', HOLD_START = '2025-04-01', WS = [0.005, 0.01, 0.015, 0.02], RISK = [0.01, 0.02, 0.03];
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const CB = Object.fromEntries(['VIX1D', 'VIX9D'].map((x) => [x, JSON.parse(fs.readFileSync(path.join(C, 'cboe', `${x}.json`), 'utf8'))]));
/* features and filter: copied from real_straddle.mjs so filter days match the frozen ones */
function bal1(s, S, p) { let A = 0, N = 0; for (const r of s) { const g = r[1] + r[2]; if (Math.abs(r[0] / S - 1) <= p) { A += Math.abs(g); N += g; } } return A > 0 ? N / A : NaN; }
const rows = [], miss = { T1: 0, T2: 0 };
for (const T of ['SPY', 'QQQ']) { const bars = JSON.parse(fs.readFileSync(path.join(C, 'uwgreeks', `${T}_ohlc.json`), 'utf8')), bi = new Map(bars.map((b, i) => [b.d, i]));
  const GR = new Map(fs.readFileSync(path.join(C, 'uwgreeks', `${T}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return [j.d, j.s]; }));
  const b1 = (i) => { const s = GR.get(bars[i].d); return s ? bal1(s, bars[i].c, 0.01) : NaN; };
  const dir = path.join(C, 'straddle', T);
  for (const fn of fs.readdirSync(dir).sort()) { const S = JSON.parse(fs.readFileSync(path.join(dir, fn), 'utf8')), i = bi.get(S.d); if (i == null || i < 70) continue; const p = bars[i - 1];
    const wf = path.join(C, 'straddle_wings', T, fn), WG = fs.existsSync(wf) ? JSON.parse(fs.readFileSync(wf, 'utf8')) : null;
    let ma20 = 0; for (let q = i - 20; q < i; q++) ma20 += bars[q].c / 20;
    const v1 = CB.VIX1D[p.d]?.c, v9 = CB.VIX9D[p.d]?.c, f = { A01: b1(i - 1), up: +(p.c > ma20), ev: v1 && v9 ? Math.log(v1 / v9) : NaN };
    const fly = (k, K, px, prem, wingCost) => { const pay = Math.abs(S.close - K), o = { T, d: S.d, k, f, prem, pnl: prem - pay, r: (prem - pay) / prem, w: {} };
      for (const s0 of wingStrikes(px)) { const q = wingCost(s0); if (!(q?.c > 0)) { o.w[s0.w] = null; continue; } const c = q.c, s = { C: q.kc, P: q.kp }, credit = prem - c, wpay = Math.max(0, S.close - s.C) + Math.max(0, s.P - S.close), risk = Math.max(s.C - K, K - s.P) - credit;
        o.w[s0.w] = risk > 0 ? { credit, pnl: credit - pay + wpay, risk, ror: (credit - pay + wpay) / risk, paid: wpay > 0 } : null; } return o; };
    const cr = S.t1?.call?.find((r) => r.date === p.d), pr = S.t1?.put?.find((r) => r.date === p.d);
    if (cr && pr && cr.bid > 0 && pr.bid > 0) { const o = fly('T1', S.t1.strike, S.prevClose, cr.bid + pr.bid, (s) => { const a = WG?.t1?.['C' + s.C], b = WG?.t1?.['P' + s.P]; return a && b && a.ask > 0 && b.ask > 0 ? { c: a.ask + b.ask, kc: a.strike ?? s.C, kp: b.strike ?? s.P } : null; }); if (WS.some((w) => !o.w[w])) miss.T1++; rows.push(o); }
    const pick = (a) => (a ?? []).find((r) => r.m >= 574 && r.m <= 579), c2 = pick(S.t2?.call), p2 = pick(S.t2?.put);
    if (c2 && p2 && c2.c > 0.02 && p2.c > 0.02) { const o = fly('T2', S.t2.strike, S.t2.px935, c2.c + p2.c - 0.02, (s) => { const a = pick(WG?.t2?.['C' + s.C]), b = pick(WG?.t2?.['P' + s.P]); return a && b && a.c > 0 && b.c > 0 ? { c: a.c + b.c + 0.02, kc: WG.t2k?.['C' + s.C] ?? s.C, kp: WG.t2k?.['P' + s.P] ?? s.P } : null; }); if (WS.some((w) => !o.w[w])) miss.T2++; rows.push(o); } } }
const th = {}; for (const T of ['SPY', 'QQQ']) { const b = rows.filter((x) => x.T === T && x.k === 'T1' && x.d <= BUILD_END), q = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
  th[T] = { a01: q(b.map((x) => x.f.A01), 2 / 3), ev: q(b.map((x) => x.f.ev), 0.5) }; }
for (const x of rows) { x.F1 = Number.isFinite(x.f.A01) && Number.isFinite(x.f.ev) ? +(x.f.A01 >= th[x.T].a01 && x.f.up === 1 && x.f.ev < th[x.T].ev) : NaN; x.F2 = Number.isFinite(x.f.A01) ? +(x.f.A01 >= th[x.T].a01) : NaN; }
const allW = (x) => WS.every((w) => x.w[w]);
if (SMOKE) { console.log(JSON.stringify({ th, miss, n: { T1: rows.filter((x) => x.k === 'T1').length, T2: rows.filter((x) => x.k === 'T2').length, T1allW: rows.filter((x) => x.k === 'T1' && allW(x)).length, T2allW: rows.filter((x) => x.k === 'T2' && allW(x)).length } })); process.exit(0); }
// ---- choose w (locked rule) ----
let basis = 'F1', pool = rows.filter((x) => x.k === 'T1' && x.d <= BUILD_END && x.F1 === 1 && allW(x)); if (pool.length < 30) { basis = 'F2'; pool = rows.filter((x) => x.k === 'T1' && x.d <= BUILD_END && x.F2 === 1 && allW(x)); }
const score = WS.map((w) => ({ w, m: mean(pool.map((x) => x.w[w].ror)) })); let best = score[0]; for (const s of score.slice(1)) if (s.m > best.m + 0.01 || (Math.abs(s.m - best.m) <= 0.01 && s.w > best.w)) best = s;
/* the tie rule compares against the current best in width order, so a wider wing within 0.01 replaces a narrower one */
const CH = best.w;
// ---- tables ----
const fx = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—'), pc = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '—');
const SETS = [['F1 days', (x) => x.F1 === 1], ['F2 days', (x) => x.F2 === 1], ['other days (not F1)', (x) => x.F1 === 0], ['all days', () => true]];
const PER = [['build', (d) => d <= BUILD_END], ['holdout', (d) => d >= HOLD_START]];
function row(k, per, set, w) { const a = rows.filter((x) => x.k === k && per[1](x.d) && set[1](x) && allW(x)); if (!a.length) return null; const v = a.map((x) => (w ? x.w[w] : null));
  if (!w) return `| ${k} | ${per[0]} | ${set[0]} | straddle | ${a.length} | ${fx(mean(a.map((x) => x.pnl)), 2)} | — (${pc(mean(a.map((x) => x.r)))} of premium) | ${pc(a.filter((x) => x.pnl > 0).length / a.length)} | ${fx(Math.min(...a.map((x) => x.pnl)), 2)} | — | — |`;
  return `| ${k} | ${per[0]} | ${set[0]} | ±${(w * 100).toFixed(1)}%${w === CH ? ' ★' : ''} | ${a.length} | ${fx(mean(v.map((y) => y.pnl)), 2)} | ${pc(mean(v.map((y) => y.ror)))} | ${pc(v.filter((y) => y.pnl > 0).length / v.length)} | ${fx(Math.min(...v.map((y) => y.pnl)), 2)} | ${pc(Math.min(...v.map((y) => y.ror)))} | ${pc(v.filter((y) => y.paid).length / v.length)} |`; }
// ---- sizing simulation ----
function sim(k, per, set, w, rk) { const a = rows.filter((x) => x.k === k && per[1](x.d)), days = [...new Set(a.map((x) => x.d))].sort(); if (!days.length) return null; const by = new Map(); for (const x of a) if (set[1](x) && (w ? x.w[w] : true)) (by.get(x.d) ?? by.set(x.d, []).get(x.d)).push(x);
  let A = 1, pk = 1, mdd = 0, dur = 0, ldur = 0, worst = 0, n = 0; const eq = [];
  for (const d of days) { const t = by.get(d) ?? []; const g = t.reduce((s, x) => s + rk * (w ? x.w[w].ror : x.r), 0); n += t.length; worst = Math.min(worst, g); A *= 1 + g; eq.push(A); if (A > pk) { pk = A; dur = 0; } else { dur++; ldur = Math.max(ldur, dur); } mdd = Math.min(mdd, A / pk - 1); }
  let w20 = 0; for (let i = 0; i < eq.length; i++) { const b = i >= 20 ? eq[i - 20] : 1; w20 = Math.min(w20, eq[i] / b - 1); }
  return { n, A, cagr: A ** (252 / days.length) - 1, worst, w20, mdd, ldur }; }
const L = ['# Iron-fly structure + sizing — results', `\nRun ${new Date().toISOString()} · design shadow/DESIGN_iron_fly.md · SPY + QQQ · T1 = 1-day (sold at the prior close), T2 = 0DTE (sold 09:35)\n`,
  `Rows with any wing price missing: T1 ${miss.T1}, T2 ${miss.T2} (dropped from every table so all structures are compared on the same days).\n`,
  `## Wing width chosen by the locked rule: **±${(CH * 100).toFixed(1)}%**`, `Basis: T1 build days, ${basis}, n = ${pool.length}. Mean return on max risk by width: ${score.map((s) => `±${(s.w * 100).toFixed(1)}% ${pc(s.m)}`).join(' · ')}\n`,
  '## Per-trade results (one fly = 1 share per leg; ★ = chosen width)\n', '| trade | period | days | structure | n | mean $ | mean return on max risk | win | worst $ | worst return on risk | wing paid |', '|---|---|---|---|---|---|---|---|---|---|---|'];
for (const k of ['T1', 'T2']) for (const per of PER) for (const set of SETS) { const r0 = row(k, per, set, null); if (!r0) continue; L.push(r0); for (const w of WS) L.push(row(k, per, set, w)); }
L.push('\n## Sizing: account path (max risk = X% of the account per fly; SPY and QQQ sized separately; chosen width)\n', '| trade | period | days traded | structure | risk per fly | trades | final account | annual growth | worst day | worst 20 days | max drawdown | longest drawdown (days) |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const k of ['T1', 'T2']) for (const per of PER) for (const set of [SETS[0], SETS[1], SETS[3]]) { for (const rk of RISK) { const s = sim(k, per, set, CH, rk); if (s) L.push(`| ${k} | ${per[0]} | ${set[0]} | fly ±${(CH * 100).toFixed(1)}% | ${rk * 100}% | ${s.n} | ${s.A.toFixed(3)} | ${pc(s.cagr)} | ${pc(s.worst)} | ${pc(s.w20)} | ${pc(s.mdd)} | ${s.ldur} |`); }
  const s = sim(k, per, set, null, 0.01); if (s) L.push(`| ${k} | ${per[0]} | ${set[0]} | naked straddle (undefined risk) | premium 1% | ${s.n} | ${s.A.toFixed(3)} | ${pc(s.cagr)} | ${pc(s.worst)} | ${pc(s.w20)} | ${pc(s.mdd)} | ${s.ldur} |`); }
L.push('\nNotes: the naked straddle row sizes premium at 1% of the account, so a 10× premium loss costs 10% in a day — the fly caps that. No commissions beyond the stated spreads; settlement at intrinsic on the close.');
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'summary.md'), L.join('\n') + '\n'); fs.writeFileSync(path.join(OUT, 'choice.json'), JSON.stringify({ w: CH, basis, n: pool.length, score, th }, null, 1)); console.log(L.join('\n'));
