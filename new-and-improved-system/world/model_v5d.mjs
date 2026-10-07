#!/usr/bin/env node
// Bottleneck model version D (DESIGN_v5d.md, locked 0b594c8e): filters chosen MECHANICALLY on data ≤ 2024-12-31 only
// (prices and filings physically truncated before selection), then frozen and run once on 2025-01 → 2026-03.
//   node --max-old-space-size=12000 world/model_v5d.mjs     (refuses to re-run once the report exists; --force overrides)
import fs from 'node:fs';
import path from 'node:path';
import { TAGS } from './facts_collect.mjs';
import { universeV2 } from './universe_prices.mjs';
import { cleanBars, inBad } from './prices_clean.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), RES = path.join(ROOT, 'world', 'results_v5');
if (fs.existsSync(path.join(RES, 'v5d.txt')) && !process.argv.includes('--force')) { console.error('version D already run — see world/results_v5/v5d.txt'); process.exit(1); }
const rd = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10), days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const CUT = '2024-12-31', POOL = 60, TOP = 20, FWD = 182, DRAWS = 200;

// ---------- point-in-time data, optionally truncated at `cut` (selection never sees anything after 2024-12-31) ----------
function series(facts, tags) { const q = new Map(), ann = new Map();
  for (const tag of tags) for (const x of facts?.[tag] ?? []) { const dur = days(x.s, x.e), tgt = dur >= 80 && dur <= 100 ? q : dur >= 350 && dur <= 380 ? ann : null; if (!tgt) continue;
    const cur = tgt.get(x.e); if (cur && (cur.tag !== tag ? true : cur.f <= x.f)) continue; tgt.set(x.e, { v: x.v, f: x.f, s: x.s, tag }); }
  for (const [e, a] of ann) { if ([...q.keys()].some((k) => Math.abs(days(k, e)) <= 5)) continue; const inside = [...q.entries()].filter(([k, x]) => days(a.s, x.s) >= -5 && days(k, e) >= 0); if (inside.length !== 3) continue;
    q.set(e, { v: a.v - inside.reduce((s, [, x]) => s + x.v, 0), f: [a.f, ...inside.map(([, x]) => x.f)].sort().at(-1) }); }
  return q; }
const U = universeV2(1e9).map((x) => x.t), RAWQ = new Map();
for (const t of U) { const F = rd(path.join(C, 'edgar', 'facts', `${t}.json`), null); if (!F?.rev) continue; const rev = series(F.rev, TAGS.rev), gp = series(F.gp, TAGS.gp), cost = series(F.cost, TAGS.cost), rows = [];
  for (const [e, r] of rev) { let g = null, f = r.f; const a = gp.get(e), c = cost.get(e); if (a) { g = a.v / r.v; f = [f, a.f].sort().at(-1); } else if (c) { g = (r.v - c.v) / r.v; f = [f, c.f].sort().at(-1); } rows.push({ e, rev: r.v, gm: g, f }); }
  RAWQ.set(t, rows.sort((x, y) => x.e.localeCompare(y.e))); }
function load(cut) { const P = new Map(), Q = new Map();
  for (const t of RAWQ.keys()) { const cb = cleanBars(t); let b = cb.bars; if (cut) b = b.filter((x) => x.d <= cut);
    if (b.length > 70) P.set(t, { d: b.map((x) => x.d), c: b.map((x) => x.c), v: b.map((x) => x.v || 0), bad: cb.bad }); Q.set(t, cut ? RAWQ.get(t).filter((x) => x.f <= cut) : RAWQ.get(t)); }
  return { P, Q, cut }; }

// ---------- per-month candidate pool with filter flags ----------
function month(D, M) { const { P, Q } = D, at = (t, d) => { const p = P.get(t); let lo = 0, hi = p.d.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (p.d[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
  const elig = [...P.keys()].filter((t) => { const p = P.get(t), j = at(t, M); if (j < 64 || p.d[j] < addD(M, -7) || inBad(p.bad, M)) return false; let dv = 0; for (let k = j - 49; k <= j; k++) dv += p.c[k] * p.v[k]; return p.c[j] >= 5 && dv / 50 >= 2e7; });
  const fwd = (t) => { const p = P.get(t), j = at(t, M) + 1, k = at(t, addD(M, FWD)); return j > 0 && j < p.c.length && k > j && p.d[k] >= addD(M, FWD - 10) ? p.c[k] / p.c[j] - 1 : null; };
  const feat = (t) => { const rows = (Q.get(t) ?? []).filter((x) => x.f <= M), q0 = rows.at(-1); if (!q0 || days(q0.e, M) > 200 || q0.rev < 25e6) return null;
    const find = (ref, lo, hi) => ref && rows.filter((x) => { const d = days(x.e, ref.e); return d >= lo && d <= hi; }).at(-1);
    const q1 = find(q0, 80, 100), q4 = find(q0, 345, 385), q5 = find(q1, 345, 385); if (!q1 || !q4 || !q5 || !(q4.rev > 0 && q5.rev > 0) || q0.gm == null || q4.gm == null) return null;
    const q2 = find(q1, 80, 100), q6 = find(q2, 345, 385), g0 = q0.rev / q4.rev - 1, g1 = q1.rev / q5.rev - 1, g2 = q2 && q6?.rev > 0 ? q2.rev / q6.rev - 1 : null;
    return { g0, accel: g0 - g1, dGM: q0.gm - q4.gm, gm: q0.gm, gm4: q4.gm, g1, g2, rev: q0.rev }; };
  const F = elig.map((t) => [t, feat(t)]).filter(([, f]) => f), rk = ['g0', 'accel', 'dGM'].map((k) => { const s = F.map(([, f]) => f[k]).sort((a, b) => a - b); return (v) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } return lo / (s.length - 1 || 1); }; });
  const scored = F.map(([t, f]) => ({ t, f, score: (rk[0](f.g0) + rk[1](f.accel) + rk[2](f.dGM)) / 3 })).sort((a, b) => b.score - a.score);
  const px = (t) => { const p = P.get(t), j = at(t, M); const c = (k) => p.c[Math.max(0, k)]; let ma = 0; for (let k = j - 199; k <= j; k++) ma += c(k); let hi = 0; for (let k = Math.max(0, j - 251); k <= j; k++) hi = Math.max(hi, p.c[k]); let dv = 0; for (let k = j - 49; k <= j; k++) dv += p.c[k] * p.v[k];
    return { mom: j >= 252 ? c(j - 21) / c(j - 252) - 1 : null, a200: j >= 199 ? p.c[j] > ma / 200 : false, offHi: p.c[j] / hi - 1, r1m: c(j) / c(j - 21) - 1, dv: dv / 50 }; };
  const pool = scored.slice(0, POOL).map((x, i) => { const p = px(x.t), f = x.f; return { t: x.t, rank: i, score: x.score, g0: f.g0, gm: f.gm, gm4: f.gm4, ret: fwd(x.t),
    F: [p.mom != null && p.mom > 0, p.a200, p.offHi >= -0.25, f.gm4 >= 0, f.gm >= 0.3, f.g2 != null && f.g0 > f.g1 && f.g1 > f.g2, f.rev >= 2.5e8, f.g0 <= 1, p.r1m > 0, p.dv >= 1e8] }; });
  const all = elig.map((t) => [t, fwd(t)]), v = all.map(([, r]) => r).filter((r) => r != null).sort((a, b) => a - b);
  const momTop = elig.map((t) => [t, px(t).mom]).filter(([, m]) => m != null).sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([t]) => t), fwdMap = new Map(all);
  return { M, pool, med: v.length ? v[v.length >> 1] : null, momTop, fwdMap, eligRet: all.filter(([, r]) => r != null) }; }
const picks = (m, S) => m.pool.filter((x) => S.every((i) => x.F[i])).slice(0, TOP);
const excess = (m, S) => { const p = picks(m, S).filter((x) => x.ret != null); return p.length >= 5 && m.med != null ? mean(p.map((x) => x.ret)) - m.med : null; };
const me = (mo) => new Date(Date.UTC(+mo.slice(0, 4), +mo.slice(5, 7), 0)).toISOString().slice(0, 10);
const monthsBetween = (a, b) => { const o = []; for (let y = +a.slice(0, 4), m = +a.slice(5, 7); `${y}-${String(m).padStart(2, '0')}` <= b; m === 12 ? (y++, m = 1) : m++) o.push(`${y}-${String(m).padStart(2, '0')}`); return o; };
const avgEx = (ms, S) => { const v = ms.map((m) => excess(m, S)).filter((x) => x != null); return v.length ? mean(v) : -Infinity; };

// ---------- 1. SELECTION on data ≤ 2024-12-31 only ----------
const DB = load(CUT); console.error(`build data truncated at ${CUT}: ${DB.P.size} priced tickers`);
const build = monthsBetween('2012-01', '2024-06').map((mo) => month(DB, me(mo))), h1 = build.filter((m) => m.M < '2018-01-01'), h2 = build.filter((m) => m.M >= '2018-01-01');
const NAMES = ['F1 momentum > 0', 'F2 above 200-day', 'F3 within 25% of 52w high', 'F4 margin ≥ 0 a year ago', 'F5 margin ≥ 30%', 'F6 growth accelerating 2 qtrs', 'F7 revenue ≥ $250M/qtr', 'F8 growth ≤ 100%', 'F9 1-month return > 0', 'F10 $100M+/day volume'];
let S = [], cur = avgEx(build, S); const log = [`no filter: build ${(cur * 100).toFixed(2)}% (halves ${(avgEx(h1, S) * 100).toFixed(2)}% / ${(avgEx(h2, S) * 100).toFixed(2)}%)`];
while (S.length < 3) { let best = null;
  for (let i = 0; i < 10; i++) { if (S.includes(i)) continue; const T = [...S, i], a = avgEx(build, T), b1 = avgEx(h1, T), b2 = avgEx(h2, T);
    log.push(`  try +${NAMES[i]}: build ${(a * 100).toFixed(2)}% (halves ${(b1 * 100).toFixed(2)}% / ${(b2 * 100).toFixed(2)}%)`);
    if (a > cur && b1 > avgEx(h1, S) && b2 > avgEx(h2, S) && (!best || a > best.a)) best = { i, a }; }
  if (!best) { log.push('  → no filter improves both halves; stop'); break; } S = [...S, best.i]; cur = best.a; log.push(`→ add ${NAMES[best.i]} (build now ${(cur * 100).toFixed(2)}%)`); }
console.error(log.join('\n')); const FROZEN = [...S];

// ---------- 2. TEST once on 2025-01 → 2026-03 with full data (filters frozen) ----------
const DF = load(null), test = monthsBetween('2025-01', '2026-03').map((mo) => month(DF, me(mo))), later = monthsBetween('2026-04', '2026-09').map((mo) => month(DF, me(mo)));
const C3 = [0, 1, 3]; // version C = F1 + F2 + F4 (in-sample on 2025–26; shown for reference only)
let seed = 99; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const rows = test.map((m) => { const momR = m.momTop.map((t) => m.fwdMap.get(t)).filter((x) => x != null); return { M: m.M, D: excess(m, FROZEN), A: excess(m, []), C: excess(m, C3), mom: momR.length ? mean(momR) - m.med : null }; });
const randMeans = Array.from({ length: DRAWS }, () => mean(test.map((m) => { const s = new Set(); while (s.size < TOP && s.size < m.eligRet.length) s.add(Math.floor(rnd() * m.eligRet.length)); return mean([...s].map((i) => m.eligRet[i][1])) - m.med; }))).sort((a, b) => a - b);
const p95 = randMeans[Math.floor(DRAWS * 0.95)], col = (k) => rows.map((r) => r[k]).filter((x) => x != null), mD = mean(col('D')), pos = col('D').filter((x) => x > 0).length / col('D').length;
const pass = [mD > mean(col('mom')), mD > p95, pos >= 0.6];
const pc = (x) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);
const out = ['# Version D — designed blind to 2025–26, run once on 2025–2026\n', `**Filters chosen on data ≤ ${CUT} only:** ${FROZEN.length ? FROZEN.map((i) => NAMES[i]).join(' + ') : 'none'}\n`, '```', ...log, '```\n',
  '## 2025-01 → 2026-03 (graded: 6-month return minus the typical stock)\n', '| | mean | months positive |', '|---|---|---|',
  `| **Version D (blind)** | **${pc(mD)}** | ${col('D').filter((x) => x > 0).length}/${col('D').length} |`, `| Model A (blind, locked 2026-10-05) | ${pc(mean(col('A')))} | ${col('A').filter((x) => x > 0).length}/${col('A').length} |`,
  `| Version C (in-sample here — reference only) | ${pc(mean(col('C')))} | ${col('C').filter((x) => x > 0).length}/${col('C').length} |`, `| Momentum top 20 | ${pc(mean(col('mom')))} | ${col('mom').filter((x) => x > 0).length}/${col('mom').length} |`,
  `| Random 20, 95th pct of ${DRAWS} | ${pc(p95)} | |`, `\n**Pass:** beats momentum ${pass[0] ? 'PASS' : 'FAIL'} · beats random 95th ${pass[1] ? 'PASS' : 'FAIL'} · ≥60% months positive ${pass[2] ? 'PASS' : 'FAIL'} → **${pass.every(Boolean) ? 'PASS' : 'FAIL'}**\n`,
  '## What version D picked each month, and how each pick did (6-month return)\n'];
for (const m of [...test, ...later]) { const p = picks(m, FROZEN); out.push(`- **${m.M.slice(0, 7)}**${m.M > '2026-03-31' ? ' (not graded yet)' : ` · typical stock ${pc(m.med)}`}: ${p.map((x) => `${x.t}${x.ret != null ? ` ${pc(x.ret)}` : ''}`).join(', ')}`); }
const tally = new Map(); for (const m of test) for (const x of picks(m, FROZEN)) if (x.ret != null) { const o = tally.get(x.t) ?? { n: 0, r: [] }; o.n++; o.r.push(x.ret); tally.set(x.t, o); }
out.push('\n## Most-picked names in the graded months\n\n| Stock | Months picked | Avg 6-month return |\n|---|---|---|', ...[...tally].sort((a, b) => b[1].n - a[1].n || mean(b[1].r) - mean(a[1].r)).slice(0, 20).map(([t, o]) => `| ${t} | ${o.n} | ${pc(mean(o.r))} |`));
const txt = out.join('\n'); console.log(txt); fs.mkdirSync(RES, { recursive: true }); fs.writeFileSync(path.join(RES, 'v5d.txt'), txt + '\n');
fs.writeFileSync(path.join(RES, 'v5d.json'), JSON.stringify({ frozen: FROZEN.map((i) => NAMES[i]), log, rows, p95, pass, picks: [...test, ...later].map((m) => ({ M: m.M, med: m.med, picks: picks(m, FROZEN).map((x) => ({ t: x.t, ret: x.ret })) })) }, null, 1));
