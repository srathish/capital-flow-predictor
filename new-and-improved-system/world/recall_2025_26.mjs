#!/usr/bin/env node
// Recall study: of the biggest US movers of 2025 and 2026 (YTD), how many did the bottleneck list flag, how early, and what do the misses have in common.
// cooled' measures (breadth in the top 60 + industry median revenue acceleration).  node --max-old-space-size=14000 world/exits_theme.mjs
import fs from 'node:fs';
import path from 'node:path';
import { TAGS } from './facts_collect.mjs';
import { universeV2 } from './universe_prices.mjs';
import { cleanBars, inBad } from './prices_clean.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache');
const rd = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10), days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const POOL60 = 60;
const SICD = new Map(); for (const f of fs.readdirSync(path.join(C, 'edgar', 'sic'))) { const j = rd(path.join(C, 'edgar', 'sic', f)); if (j?.sic) SICD.set(f.replace('.json', ''), j.desc ?? '?'); }
// ---------- data (same point-in-time construction as model_v5d) ----------
function series(facts, tags) { const q = new Map(), ann = new Map();
  for (const tag of tags) for (const x of facts?.[tag] ?? []) { const dur = days(x.s, x.e), tgt = dur >= 80 && dur <= 100 ? q : dur >= 350 && dur <= 380 ? ann : null; if (!tgt) continue;
    const cur = tgt.get(x.e); if (cur && (cur.tag !== tag ? true : cur.f <= x.f)) continue; tgt.set(x.e, { v: x.v, f: x.f, s: x.s, tag }); }
  for (const [e, a] of ann) { if ([...q.keys()].some((k) => Math.abs(days(k, e)) <= 5)) continue; const inside = [...q.entries()].filter(([k, x]) => days(a.s, x.s) >= -5 && days(k, e) >= 0); if (inside.length !== 3) continue;
    q.set(e, { v: a.v - inside.reduce((s, [, x]) => s + x.v, 0), f: [a.f, ...inside.map(([, x]) => x.f)].sort().at(-1) }); }
  return q; }
const SIC3 = new Map(); for (const f of fs.readdirSync(path.join(C, 'edgar', 'sic'))) { const j = rd(path.join(C, 'edgar', 'sic', f)); if (j?.sic) SIC3.set(f.replace('.json', ''), String(j.sic).padStart(4, '0').slice(0, 3)); }
const RAWQ = new Map();
for (const t of universeV2(1e9).map((x) => x.t)) { const F = rd(path.join(C, 'edgar', 'facts', `${t}.json`), null); if (!F?.rev) continue; const rev = series(F.rev, TAGS.rev), gp = series(F.gp, TAGS.gp), cost = series(F.cost, TAGS.cost), rows = [];
  for (const [e, r] of rev) { let g = null, f = r.f; const a = gp.get(e), c = cost.get(e); if (a) { g = a.v / r.v; f = [f, a.f].sort().at(-1); } else if (c) { g = (r.v - c.v) / r.v; f = [f, c.f].sort().at(-1); } rows.push({ e, rev: r.v, gm: g, f }); }
  RAWQ.set(t, rows.sort((x, y) => x.e.localeCompare(y.e))); }
function load(cut) { const P = new Map(), Q = new Map();
  for (const t of RAWQ.keys()) { const cb = cleanBars(t); let b = cb.bars; if (cut) b = b.filter((x) => x.d <= cut);
    if (b.length > 70) P.set(t, { d: b.map((x) => x.d), c: b.map((x) => x.c), v: b.map((x) => x.v || 0), bad: cb.bad }); Q.set(t, cut ? RAWQ.get(t).filter((x) => x.f <= cut) : RAWQ.get(t)); }
  let cal = rd(path.join(C, 'wdaily_hist', 'SPY_full.json')).filter((x) => !cut || x.d <= cut); return { P, Q, cal: cal.map((x) => x.d), spy: new Map(cal.map((x) => [x.d, x.c])) }; }
const idx = (p, d) => { let lo = 0, hi = p.d.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (p.d[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };

// ---------- month-end ranking (core score + hard rule) ----------
function monthData(D, M) { const { P, Q } = D;
  const elig = [...P.keys()].filter((t) => { const p = P.get(t), j = idx(p, M); if (j < 64 || p.d[j] < addD(M, -7) || inBad(p.bad, M)) return false; let dv = 0; for (let k = j - 49; k <= j; k++) dv += p.c[k] * p.v[k]; return p.c[j] >= 5 && dv / 50 >= 2e7; });
  const feat = (t) => { const rows = (Q.get(t) ?? []).filter((x) => x.f <= M), q0 = rows.at(-1); if (!q0 || days(q0.e, M) > 200 || q0.rev < 25e6) return null;
    const find = (ref, lo, hi) => ref && rows.filter((x) => { const d = days(x.e, ref.e); return d >= lo && d <= hi; }).at(-1);
    const q1 = find(q0, 80, 100), q4 = find(q0, 345, 385), q5 = find(q1, 345, 385); if (!q1 || !q4 || !q5 || !(q4.rev > 0 && q5.rev > 0) || q0.gm == null || q4.gm == null) return null;
    const g0 = q0.rev / q4.rev - 1, g1 = q1.rev / q5.rev - 1; return { g0, g1, accel: g0 - g1, dGM: q0.gm - q4.gm, gm: q0.gm, gm4: q4.gm, f0: q0.f }; };
  const F = elig.map((t) => [t, feat(t)]).filter(([, f]) => f), rk = ['g0', 'accel', 'dGM'].map((k) => { const s = F.map(([, f]) => f[k]).sort((a, b) => a - b); return (v) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } return lo / (s.length - 1 || 1); }; });
  const order = F.filter(([, f]) => f.gm4 >= 0).map(([t, f]) => ({ t, s: (rk[0](f.g0) + rk[1](f.accel) + rk[2](f.dGM)) / 3 })).sort((a, b) => b.s - a.s).map((x) => x.t);
  const accBy = new Map(); for (const [t, f] of F) { const s = SIC3.get(t); if (!s) continue; const a = accBy.get(s) ?? []; a.push(f.accel); accBy.set(s, a); }
  const indAcc = new Map([...accBy].filter(([, a]) => a.length >= 3).map(([s, a]) => { a.sort((x, y) => x - y); return [s, a[a.length >> 1]]; }));
  const top = order.slice(0, POOL60), br = new Map(); for (const t of top) { const s = SIC3.get(t); if (s) br.set(s, (br.get(s) ?? 0) + 1); }
  const peers = (t) => { const s = SIC3.get(t); return s ? (br.get(s) ?? 0) - (top.includes(t) ? 1 : 0) : 0; };
  const hot = (t) => { const s = SIC3.get(t); return !!s && peers(t) >= 2 && (indAcc.get(s) ?? -1) > 0; }, cooled = (t) => { const s = SIC3.get(t); return !!s && peers(t) === 0 && (indAcc.get(s) ?? 1) < 0; };
  return { M, elig, order, rank: new Map(order.map((t, i) => [t, i])), feat: new Map(F), hot, cooled }; }

const D = load(null), ME = []; for (let y = 2024, m = 7; `${y}-${String(m).padStart(2, '0')}` <= '2026-09'; m === 12 ? (y++, m = 1) : m++) ME.push(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10));
const MD = new Map(ME.map((M) => [M, monthData(D, M)]));
const px = (t, d) => { const p = D.P.get(t); const j = idx(p, d); return j >= 0 ? p.c[j] : null; };
function movers(a, b, n) { const elig = MD.get(a).elig; return elig.map((t) => { const p0 = px(t, a), p1 = px(t, b); return [t, p0 && p1 ? p1 / p0 - 1 : null]; }).filter(([, r]) => r != null).sort((x, y) => y[1] - x[1]).slice(0, n); }
const out = [];
for (const [yr, a, b] of [['2025', '2024-12-31', '2025-12-31'], ['2026 YTD', '2025-12-31', '2026-09-30']]) {
  const mv = movers(a, b, 50), rows = [];
  for (const [t, r] of mv) { const flags = ME.filter((M) => M >= addD(a, -183) && M <= b).map((M) => ({ M, rk: MD.get(M).rank.get(t), f: MD.get(M).feat.get(t) }));
    const first20 = flags.find((x) => x.rk != null && x.rk < 20), first60 = flags.find((x) => x.rk != null && x.rk < 60);
    const early = (x) => { if (!x) return null; const p0 = px(t, a), p1 = px(t, b), pm = px(t, x.M); return (pm / p0 - 1) / (p1 / p0 - 1); };
    const last = MD.get(b <= '2026-09-30' ? b : '2026-09-30'), f = [...flags].reverse().find((x) => x.f)?.f;
    const why = !first60 ? (!f ? (MD.get(a).elig.includes(t) && !flags.some((x) => x.f) ? 'no usable SEC revenue data (foreign filer / tiny or no revenue / missing gross margin)' : 'no usable SEC revenue data') : f.gm4 < 0 ? 'margin negative a year earlier (hard rule)' : 'numbers not top-60 (growth/margins not standout)') : '';
    rows.push({ t, r, first20: first20?.M, first60: first60?.M, e20: early(first20), e60: early(first60), why, ind: SICD.get(t) ?? '?', fw: first60 ? MD.get(first60.M).feat.get(t) : null }); }
  const c20 = rows.filter((x) => x.first20), c60 = rows.filter((x) => x.first60), earlyC = c60.filter((x) => x.e60 != null && x.e60 < 0.5);
  out.push(`## ${yr}: top 50 movers (median ${(rows.map((x) => x.r).sort((p, q) => p - q)[25] * 100).toFixed(0)}%)\n`,
    `- flagged in the **top 20** at some month-end (from 6 months before the year through its end): **${c20.length}/50**`,
    `- flagged in the **top 60**: **${c60.length}/50**; flagged before half the year's gain had happened: **${earlyC.length}/50**`,
    `- why the misses were missed: ${Object.entries(rows.filter((x) => !x.first60).reduce((o, x) => ((o[x.why] = (o[x.why] ?? 0) + 1), o), {})).map(([k, v]) => `${k} ${v}`).join(' · ')}\n`,
    '| stock | move | industry | first top-20 | first top-60 | move already done by then | why picked (at first top-60: revenue YoY · growth change · gross margin, vs a year ago) | miss reason |', '|---|---|---|---|---|---|---|---|',
    ...rows.map((x) => `| ${x.t} | +${(x.r * 100).toFixed(0)}% | ${x.ind.slice(0, 34)} | ${x.first20?.slice(0, 7) ?? '—'} | ${x.first60?.slice(0, 7) ?? '—'} | ${x.e60 == null ? '—' : `${(x.e60 * 100).toFixed(0)}%`} | ${x.fw ? `rev ${x.fw.g0 >= 0 ? '+' : ''}${(x.fw.g0 * 100).toFixed(0)}% · ${x.fw.accel >= 0 ? '+' : ''}${(x.fw.accel * 100).toFixed(0)} pts · GM ${(x.fw.gm * 100).toFixed(0)}% vs ${(x.fw.gm4 * 100).toFixed(0)}%` : '—'} | ${x.why} |`), ''); }
const txt = '# Recall: did the bottleneck list catch the big movers of 2025 and 2026?\n\n' + out.join('\n'); console.log(txt); fs.mkdirSync(path.join(ROOT, 'world', 'results_v5'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'world', 'results_v5', 'recall_2025_26.md'), txt + '\n');
