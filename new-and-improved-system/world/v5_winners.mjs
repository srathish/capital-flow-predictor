#!/usr/bin/env node
// v5 exploratory (2023-03 → 2026-03 picks, SEEN data): what separated winning picks from losing ones, using only what was known
// at pick time. Findings are hypotheses — to be locked and tested on 2012–2022 (DESIGN_v5 addendum 2).
import fs from 'node:fs';
import path from 'node:path';
import { TAGS } from './facts_collect.mjs';
const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), RES = path.join(ROOT, 'world', 'results_v5');
const rd = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10), days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const B = new Map(); const bars = (t) => { if (!B.has(t)) B.set(t, rd(path.join(C, 'wdaily', `${t}.json`), [])); return B.get(t); };
const at = (b, d) => { let lo = 0, hi = b.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (b[m].d <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const fwd = (t, d) => { const b = bars(t), j = at(b, d) + 1, k = at(b, addD(d, 182)); return j > 0 && j < b.length && k > j && b[k].d >= addD(d, 172) ? b[k].c / b[j].c - 1 : null; };
function series(facts, tags) { const q = new Map(), ann = new Map();
  for (const tag of tags) for (const x of facts?.[tag] ?? []) { const dur = days(x.s, x.e), tgt = dur >= 80 && dur <= 100 ? q : dur >= 350 && dur <= 380 ? ann : null; if (!tgt) continue;
    const cur = tgt.get(x.e); if (cur && (cur.tag !== tag ? true : cur.f <= x.f)) continue; tgt.set(x.e, { v: x.v, f: x.f, s: x.s, tag }); }
  for (const [e, a] of ann) { if ([...q.keys()].some((k) => Math.abs(days(k, e)) <= 5)) continue; const inside = [...q.entries()].filter(([k, x]) => days(a.s, x.s) >= -5 && days(k, e) >= 0); if (inside.length !== 3) continue;
    q.set(e, { v: a.v - inside.reduce((s, [, x]) => s + x.v, 0), f: [a.f, ...inside.map(([, x]) => x.f)].sort().at(-1) }); } return q; }
const QC = new Map(); function rows(t) { if (QC.has(t)) return QC.get(t); const F = rd(path.join(C, 'edgar', 'facts', `${t}.json`), null), out = [];
  if (F?.rev) { const rev = series(F.rev, TAGS.rev), gp = series(F.gp, TAGS.gp), cost = series(F.cost, TAGS.cost);
    for (const [e, r] of rev) { let g = null, f = r.f; const a = gp.get(e), c = cost.get(e); if (a) { g = a.v / r.v; f = [f, a.f].sort().at(-1); } else if (c) { g = (r.v - c.v) / r.v; f = [f, c.f].sort().at(-1); } out.push({ e, rev: r.v, gm: g, f }); } }
  out.sort((x, y) => x.e.localeCompare(y.e)); QC.set(t, out); return out; }
function feat(t, M) { const R = rows(t).filter((x) => x.f <= M); const q0 = R.at(-1); if (!q0) return null; const find = (ref, lo, hi) => R.filter((x) => { const d = days(x.e, ref.e); return d >= lo && d <= hi; }).at(-1);
  const q1 = find(q0, 80, 100), q4 = find(q0, 345, 385), q5 = q1 && find(q1, 345, 385), q2 = q1 && find(q1, 80, 100), q6 = q2 && find(q2, 345, 385); if (!q4 || !q5) return null;
  const b = bars(t), j = at(b, M); const px = (k) => b[Math.max(0, k)]?.c; const hi52 = Math.max(...b.slice(Math.max(0, j - 251), j + 1).map((x) => x.h ?? x.c));
  const ma200 = b.slice(Math.max(0, j - 199), j + 1).reduce((s, x) => s + x.c, 0) / Math.min(200, j + 1); let dv = 0; for (let k = Math.max(0, j - 49); k <= j; k++) dv += b[k].c * b[k].v;
  return { g0: q0.rev / q4.rev - 1, g1: q1.rev / q5.rev - 1, g2: q2 && q6 ? q2.rev / q6.rev - 1 : null, gm: q0.gm, gm4: q4.gm, dGM: q0.gm - q4.gm, revQ: q0.rev, mom: j >= 252 ? px(j - 21) / px(j - 252) - 1 : null,
    r1m: px(j) / px(j - 21) - 1, r6m: px(j) / px(j - 126) - 1, offHigh: px(j) / hi52 - 1, vs200: px(j) / ma200 - 1, dollarVol: dv / Math.min(50, j + 1) }; }
const picks = [];
for (const tag of ['wide_dev', 'wide_holdout']) for (const r of rd(path.join(RES, `${tag}.json`), [])) { const xs = r.picksA.map((p) => ({ t: p.t, mo: r.mo, ret: fwd(p.t, r.M), f: feat(p.t, r.M) })).filter((x) => x.ret != null && x.f);
  const med = xs.reduce((s, x) => s + x.ret, 0) / xs.length - r.A; for (const x of xs) picks.push({ ...x, ex: x.ret - med }); }
const med = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((p, q) => p - q); return s[s.length >> 1]; };
const pc = (x) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`), money = (x) => (x >= 1e9 ? `$${(x / 1e9).toFixed(1)}B` : `$${(x / 1e6).toFixed(0)}M`);
const s = [...picks].sort((a, b) => b.ex - a.ex), q = Math.floor(s.length / 5), W = s.slice(0, q), L = s.slice(-q);
console.log(`# What separated winning picks from losing picks — v5, picks 2023-03 → 2026-03 (${picks.length} pick-months, SEEN data)\n`);
console.log('## Winners (top fifth) vs losers (bottom fifth): typical value at pick time\n\n| Known at pick time | Winners | Losers |\n|---|---|---|');
const F = [['gm', 'Gross margin (level)', pc], ['gm4', 'Gross margin a year earlier', pc], ['dGM', 'Margin change vs a year ago', pc], ['g0', 'Revenue growth YoY', pc], ['g1', 'Prior quarter growth', pc], ['g2', 'Growth two quarters back', pc], ['revQ', 'Quarterly revenue', money], ['mom', '12-month price momentum', pc], ['r6m', '6-month price change', pc], ['r1m', '1-month price change', pc], ['offHigh', 'Distance from 52-week high', pc], ['vs200', 'Price vs 200-day average', pc], ['dollarVol', 'Daily $ volume', money]];
for (const [k, n, f] of F) console.log(`| ${n} | ${f(med(W.map((x) => x.f[k])))} | ${f(med(L.map((x) => x.f[k])))} |`);
console.log('\n## Simple splits (all picks): average 6-month excess vs the typical stock, and share of picks beating it\n\n| Split | Group | Picks | Avg excess | Median excess | Beat typical |\n|---|---|---|---|---|---|');
const split = (name, groups) => { for (const [g, fn] of groups) { const a = picks.filter((x) => fn(x.f)); if (!a.length) continue; console.log(`| ${name} | ${g} | ${a.length} | ${pc(a.reduce((s, x) => s + x.ex, 0) / a.length)} | ${pc(med(a.map((x) => x.ex)))} | ${Math.round((a.filter((x) => x.ex > 0).length / a.length) * 100)}% |`); } };
split('Gross margin level', [['negative', (f) => f.gm < 0], ['0–30%', (f) => f.gm >= 0 && f.gm < 0.3], ['30–50%', (f) => f.gm >= 0.3 && f.gm < 0.5], ['50%+', (f) => f.gm >= 0.5]]);
split('Margin a year earlier', [['was negative', (f) => f.gm4 < 0], ['was positive', (f) => f.gm4 >= 0]]);
split('Growth streak', [['accelerating 2 qtrs in a row', (f) => f.g2 != null && f.g0 > f.g1 && f.g1 > f.g2], ['not', (f) => !(f.g2 != null && f.g0 > f.g1 && f.g1 > f.g2)]]);
split('Price trend', [['above 200-day & within 15% of high', (f) => f.vs200 > 0 && f.offHigh > -0.15], ['below 200-day', (f) => f.vs200 <= 0], ['other', (f) => f.vs200 > 0 && f.offHigh <= -0.15]]);
split('12-month momentum', [['positive', (f) => f.mom > 0], ['negative', (f) => f.mom != null && f.mom <= 0]]);
split('Quarterly revenue', [['< $250M', (f) => f.revQ < 2.5e8], ['$250M–$2B', (f) => f.revQ >= 2.5e8 && f.revQ < 2e9], ['$2B+', (f) => f.revQ >= 2e9]]);
split('Revenue growth', [['< 30%', (f) => f.g0 < 0.3], ['30–100%', (f) => f.g0 >= 0.3 && f.g0 < 1], ['100%+', (f) => f.g0 >= 1]]);
const tickers = (a) => [...new Set(a.map((x) => x.t))].slice(0, 14).join(' ');
console.log(`\nWinners include: ${tickers(W)}\nLosers include: ${tickers(L)}`);
