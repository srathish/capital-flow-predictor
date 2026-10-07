#!/usr/bin/env node
// Selling-rules study (DESIGN_exits.md, locked c5fce899). Daily portfolio simulation of the bottleneck list with 44 hold/stop
// combinations; the rule is chosen mechanically on 2012–2018 (data truncated at 2018-12-31), checked on 2019–2022, reported
// on 2023–2026.  node --max-old-space-size=14000 world/exits_study.mjs   (runs once; --force overrides)
import fs from 'node:fs';
import path from 'node:path';
import { TAGS } from './facts_collect.mjs';
import { universeV2 } from './universe_prices.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), RES = path.join(ROOT, 'world', 'results_exits');
if (fs.existsSync(path.join(RES, 'exits.txt')) && !process.argv.includes('--force')) { console.error('already run — see world/results_exits/exits.txt'); process.exit(1); }
const rd = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10), days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const SLOTS = 20, COST = 0.0005, POOL60 = 60;

// ---------- data (same point-in-time construction as model_v5d) ----------
function series(facts, tags) { const q = new Map(), ann = new Map();
  for (const tag of tags) for (const x of facts?.[tag] ?? []) { const dur = days(x.s, x.e), tgt = dur >= 80 && dur <= 100 ? q : dur >= 350 && dur <= 380 ? ann : null; if (!tgt) continue;
    const cur = tgt.get(x.e); if (cur && (cur.tag !== tag ? true : cur.f <= x.f)) continue; tgt.set(x.e, { v: x.v, f: x.f, s: x.s, tag }); }
  for (const [e, a] of ann) { if ([...q.keys()].some((k) => Math.abs(days(k, e)) <= 5)) continue; const inside = [...q.entries()].filter(([k, x]) => days(a.s, x.s) >= -5 && days(k, e) >= 0); if (inside.length !== 3) continue;
    q.set(e, { v: a.v - inside.reduce((s, [, x]) => s + x.v, 0), f: [a.f, ...inside.map(([, x]) => x.f)].sort().at(-1) }); }
  return q; }
const RAWQ = new Map();
for (const t of universeV2(1e9).map((x) => x.t)) { const F = rd(path.join(C, 'edgar', 'facts', `${t}.json`), null); if (!F?.rev) continue; const rev = series(F.rev, TAGS.rev), gp = series(F.gp, TAGS.gp), cost = series(F.cost, TAGS.cost), rows = [];
  for (const [e, r] of rev) { let g = null, f = r.f; const a = gp.get(e), c = cost.get(e); if (a) { g = a.v / r.v; f = [f, a.f].sort().at(-1); } else if (c) { g = (r.v - c.v) / r.v; f = [f, c.f].sort().at(-1); } rows.push({ e, rev: r.v, gm: g, f }); }
  RAWQ.set(t, rows.sort((x, y) => x.e.localeCompare(y.e))); }
function load(cut) { const P = new Map(), Q = new Map();
  for (const t of RAWQ.keys()) { let b = [...rd(path.join(C, 'wdaily_hist', `${t}.json`), []), ...rd(path.join(C, 'wdaily', `${t}.json`), [])]; if (cut) b = b.filter((x) => x.d <= cut);
    if (b.length > 70) P.set(t, { d: b.map((x) => x.d), c: b.map((x) => x.c), v: b.map((x) => x.v || 0) }); Q.set(t, cut ? RAWQ.get(t).filter((x) => x.f <= cut) : RAWQ.get(t)); }
  let cal = rd(path.join(C, 'wdaily_hist', 'SPY_full.json')).filter((x) => !cut || x.d <= cut); return { P, Q, cal: cal.map((x) => x.d), spy: new Map(cal.map((x) => [x.d, x.c])) }; }
const idx = (p, d) => { let lo = 0, hi = p.d.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (p.d[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };

// ---------- month-end ranking (core score + hard rule) ----------
function monthData(D, M) { const { P, Q } = D;
  const elig = [...P.keys()].filter((t) => { const p = P.get(t), j = idx(p, M); if (j < 64 || p.d[j] < addD(M, -7)) return false; let dv = 0; for (let k = j - 49; k <= j; k++) dv += p.c[k] * p.v[k]; return p.c[j] >= 5 && dv / 50 >= 2e7; });
  const feat = (t) => { const rows = (Q.get(t) ?? []).filter((x) => x.f <= M), q0 = rows.at(-1); if (!q0 || days(q0.e, M) > 200 || q0.rev < 25e6) return null;
    const find = (ref, lo, hi) => ref && rows.filter((x) => { const d = days(x.e, ref.e); return d >= lo && d <= hi; }).at(-1);
    const q1 = find(q0, 80, 100), q4 = find(q0, 345, 385), q5 = find(q1, 345, 385); if (!q1 || !q4 || !q5 || !(q4.rev > 0 && q5.rev > 0) || q0.gm == null || q4.gm == null) return null;
    const g0 = q0.rev / q4.rev - 1, g1 = q1.rev / q5.rev - 1; return { g0, g1, accel: g0 - g1, dGM: q0.gm - q4.gm, gm: q0.gm, gm4: q4.gm, f0: q0.f }; };
  const F = elig.map((t) => [t, feat(t)]).filter(([, f]) => f), rk = ['g0', 'accel', 'dGM'].map((k) => { const s = F.map(([, f]) => f[k]).sort((a, b) => a - b); return (v) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } return lo / (s.length - 1 || 1); }; });
  const order = F.filter(([, f]) => f.gm4 >= 0).map(([t, f]) => ({ t, s: (rk[0](f.g0) + rk[1](f.accel) + rk[2](f.dGM)) / 3 })).sort((a, b) => b.s - a.s).map((x) => x.t);
  return { M, elig, order, rank: new Map(order.map((t, i) => [t, i])), feat: new Map(F) }; }
const calMonthEnds = (a, b) => { const o = []; for (let y = +a.slice(0, 4), m = +a.slice(5, 7); `${y}-${String(m).padStart(2, '0')}` <= b; m === 12 ? (y++, m = 1) : m++) o.push(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)); return o; };
function prepare(D, a, b) { const ME = calMonthEnds(a, b), months = new Map(); for (const M of ME) months.set(M, monthData(D, M));
  const tdEnd = new Map(); for (const M of ME) { let last = null; for (const d of D.cal) { if (d > M) break; last = d; } if (last) tdEnd.set(last, M); }
  const bench = []; for (let i = 0; i < ME.length - 1; i++) { const m = months.get(ME[i]), n = ME[i + 1], v = [];
    for (const t of m.elig) { const p = D.P.get(t), i0 = idx(p, ME[i]), i1 = idx(p, n); if (i0 >= 0 && i1 > i0 && p.d[i1] >= addD(n, -7)) v.push(p.c[i1] / p.c[i0] - 1); } v.sort((x, y) => x - y); bench.push({ M: n, r: v.length ? v[v.length >> 1] : 0 }); }
  return { ME, months, tdEnd, bench }; }

// ---------- the simulator ----------
const COMBOS = []; for (const W of ['W0', 'W1', 'W2', 'W3']) for (const L of ['none', 'L1-20', 'L1-30', 'L1-40', 'L2-1.5', 'L2-2', 'L2-3', 'L3a', 'L3b', 'L4', 'L5']) COMBOS.push({ W, L });
const label = (c) => `${c.W}+${c.L}`;
const NAMEW = { W0: 'sell at 6 months', W1: 'hold while top-60', W2: 'sell at 12 months', W3: 'no time limit' }, NAMEL = { none: 'no stop', 'L1-20': 'trail 20%', 'L1-30': 'trail 30%', 'L1-40': 'trail 40%', 'L2-1.5': 'vol-trail 1.5×', 'L2-2': 'vol-trail 2×', 'L2-3': 'vol-trail 3×', L3a: 'below 50-day', L3b: 'below 200-day', L4: 'numbers turn', L5: 'time stop 3m' };
function sim(D, PR, cfg, start, end) { const days_ = D.cal.filter((d) => d >= start && d <= end); let cash = 1, pos = [], pend = [], eq = 1; const curve = [], trades = [];
  const close = (t, d) => { const p = D.P.get(t), j = idx(p, d); return j >= 0 ? { c: p.c[j], j, p } : null; };
  const mo = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  for (let i = 0; i < days_.length; i++) { const d = days_[i];
    for (const x of pos.filter((q) => q.sell)) { const k = close(x.t, d); cash += x.u * k.c * (1 - COST); trades.push({ t: x.t, in: x.d0, out: d, r: k.c / x.px - 1, why: x.sell, px: x.px, exitPx: k.c }); }
    pos = pos.filter((q) => !q.sell);
    for (const t of pend) { const k = close(t, d); if (!k || k.p.d[k.j] < addD(d, -7)) continue; const amt = Math.min(eq / SLOTS, cash); if (amt <= 0) break; cash -= amt;
      const lr = []; for (let j = Math.max(1, k.j - 59); j <= k.j; j++) lr.push(Math.log(k.p.c[j] / k.p.c[j - 1])); pos.push({ t, u: (amt * (1 - COST)) / k.c, px: k.c, d0: d, peak: k.c, vol: sd(lr) * Math.sqrt(21), n: 0 }); }
    pend = []; eq = cash; for (const x of pos) { const k = close(x.t, d); x.last = k.c; eq += x.u * k.c; x.peak = Math.max(x.peak, k.c); x.n++;
      const L = cfg.L, dd = 1 - k.c / x.peak; let why = null;
      if (L.startsWith('L1') && dd >= +L.split('-')[1] / 100) why = L; if (L.startsWith('L2') && dd >= +L.split('-')[1] * x.vol) why = L;
      if (L === 'L3a' || L === 'L3b') { const w = L === 'L3a' ? 50 : 200; if (k.j >= w) { let s = 0; for (let j = k.j - w + 1; j <= k.j; j++) s += k.p.c[j]; if (k.c < s / w) why = L; } }
      if (L === 'L5' && x.n === 63 && k.c < x.px) why = L; if (why) x.sell = why; }
    curve.push({ d, eq });
    const M = PR.tdEnd.get(d); if (M && i < days_.length - 1) { const m = PR.months.get(M);
      for (const x of pos) { if (x.sell) continue; const held = mo(x.d0, M);
        if ((cfg.W === 'W0' && held >= 6) || (cfg.W === 'W2' && held >= 12) || (cfg.W === 'W3' && held >= 24) || (cfg.W === 'W1' && !((m.rank.get(x.t) ?? 1e9) < POOL60))) x.sell = cfg.W;
        if (!x.sell && cfg.L === 'L4') { const f = m.feat.get(x.t); if (f && f.f0 > x.d0 && f.g0 < f.g1 && f.gm < f.gm4) x.sell = 'L4'; } }
      const keep = pos.filter((q) => !q.sell).length, held = new Set(pos.map((q) => q.t)); pend = m.order.filter((t) => !held.has(t)).slice(0, Math.max(0, SLOTS - keep)); } }
  const dEnd = days_.at(-1); for (const x of pos) { const k = close(x.t, dEnd); trades.push({ t: x.t, in: x.d0, out: dEnd, r: k.c / x.px - 1, why: 'end', px: x.px, exitPx: k.c }); }
  return { curve, trades }; }
function stats(D, PR, run, a, b) { const c = run.curve.filter((x) => x.d >= a && x.d <= b); if (c.length < 20) return null; const yrs = days(c[0].d, c.at(-1).d) / 365.25, cagr = (c.at(-1).eq / c[0].eq) ** (1 / yrs) - 1;
  const bm = PR.bench.filter((x) => x.M > a && x.M <= b), bcagr = bm.reduce((s, x) => s * (1 + x.r), 1) ** (12 / bm.length) - 1;
  let pk = 0, mdd = 0; for (const x of c) { pk = Math.max(pk, x.eq); mdd = Math.max(mdd, 1 - x.eq / pk); }
  const me = c.filter((x) => PR.tdEnd.has(x.d)), mr = me.slice(1).map((x, i) => x.eq / me[i].eq - 1), sh = mr.length > 2 ? (mean(mr) / (sd(mr) || 1)) * Math.sqrt(12) : null;
  const tr = run.trades.filter((x) => x.in >= a && x.in <= b), spy = D.spy, sa = spy.get(c[0].d), sb = spy.get(c.at(-1).d);
  const cap = [], lossTaken = []; for (const x of tr) { const p = D.P.get(x.t), j0 = idx(p, x.in); let mx = 0; for (let j = j0; j <= Math.min(p.c.length - 1, j0 + 252); j++) mx = Math.max(mx, p.c[j] / x.px - 1);
    const j6 = Math.min(p.c.length - 1, j0 + 126), bh6 = p.c[j6] / x.px - 1; if (mx >= 1) cap.push(Math.max(-1, x.r) / mx); if (bh6 <= -0.3) lossTaken.push(x.r); }
  return { cagr, bcagr, ex: cagr - bcagr, spy: sa && sb ? (sb / sa) ** (1 / yrs) - 1 : null, mdd, sh, n: tr.length, hold: tr.length ? mean(tr.map((x) => days(x.in, x.out))) : 0, cap: cap.length ? mean(cap) : null, nCap: cap.length, loss: lossTaken.length ? mean(lossTaken) : null, nLoss: lossTaken.length }; }

// ---------- 1. choose on 2012–2018 (data truncated at 2018-12-31) ----------
const pc = (x, d = 1) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`);
const DB = load('2018-12-31'), PB = prepare(DB, '2011-12', '2018-12'); console.error(`build: ${DB.P.size} tickers, ${PB.ME.length} month-ends`);
const res = COMBOS.map((cfg) => { const r = sim(DB, PB, cfg, '2012-01-01', '2018-12-31'); return { cfg, all: stats(DB, PB, r, '2012-01-01', '2018-12-31'), h1: stats(DB, PB, r, '2012-01-01', '2015-12-31'), h2: stats(DB, PB, r, '2016-01-01', '2018-12-31') }; });
const base = res.find((x) => x.cfg.W === 'W0' && x.cfg.L === 'none');
for (const x of res) x.ok = x.all.mdd <= base.all.mdd + 0.05 && x.h1.ex > base.h1.ex && x.h2.ex > base.h2.ex;
const pick = res.filter((x) => x.ok && x !== base).sort((a, b) => b.all.ex - a.all.ex)[0] ?? base, FROZEN = pick.cfg; console.error(`chosen: ${label(FROZEN)}`);
// ---------- 2. check 2019–2022 and 3. final 2023–2026 (full data, rule frozen) ----------
const DF = load(null), PF = prepare(DF, '2018-12', '2026-09');
const period = (a, b) => { const r1 = sim(DF, PF, FROZEN, a, b), r0 = sim(DF, PF, base.cfg, a, b); return { chosen: stats(DF, PF, r1, a, b), base: stats(DF, PF, r0, a, b), trades: r1.trades }; };
const chk = period('2019-01-01', '2022-12-31'), fin = period('2023-01-01', '2026-10-02');
const passChk = chk.chosen.ex > chk.base.ex && chk.chosen.mdd <= chk.base.mdd + 0.05;
const row = (n, s) => `| ${n} | ${pc(s.cagr)} | ${pc(s.bcagr)} | **${pc(s.ex)}** | ${pc(-s.mdd, 0)} | ${s.sh?.toFixed(2) ?? '—'} | ${s.n} | ${s.hold.toFixed(0)}d | ${s.cap == null ? '—' : `${(s.cap * 100).toFixed(0)}% (${s.nCap})`} | ${s.loss == null ? '—' : `${pc(s.loss, 0)} (${s.nLoss})`} |`;
const H = '| rule | yearly return | typical stock | excess | worst drawdown | Sharpe | trades | avg hold | winner gain kept | loss taken on −30% picks |\n|---|---|---|---|---|---|---|---|---|---|';
const out = ['# Selling rules for the bottleneck system (DESIGN_exits.md)\n', `**Chosen on 2012–2018 only (data cut at 2018-12-31): ${NAMEW[FROZEN.W]} + ${NAMEL[FROZEN.L]}** (${label(FROZEN)})\n`,
  '## 1. Build period 2012–2018 — all 44 rules (✓ = drawdown OK and beats today\'s rule in both halves)\n', H.replace('| rule |', '| rule | ✓ |').replace('|---|', '|---|---|'),
  ...res.sort((a, b) => b.all.ex - a.all.ex).map((x) => row(`${NAMEW[x.cfg.W]} + ${NAMEL[x.cfg.L]}`, x.all).replace(/^\| /, `| ${x.ok ? '✓' : ''} | `)),
  `\n## 2. Check period 2019–2022 (never used for choosing) → **${passChk ? 'PASS' : 'FAIL'}**\n`, H, row(`**chosen: ${NAMEW[FROZEN.W]} + ${NAMEL[FROZEN.L]}**`, chk.chosen), row("today's rule (6 months, no stop)", chk.base),
  '\n## 3. Final period 2023 → 2026-09 (picks seen before, selling rules never tested here)\n', H, row(`**chosen: ${NAMEW[FROZEN.W]} + ${NAMEL[FROZEN.L]}**`, fin.chosen), row("today's rule (6 months, no stop)", fin.base),
  '\n## Biggest trades under the chosen rule, 2023–2026\n', ...fin.trades.sort((a, b) => b.r - a.r).slice(0, 12).map((x) => `- ${x.t}: bought ${x.in} → sold ${x.out} (${x.why}) ${pc(x.r, 0)}`),
  '\n## Worst trades under the chosen rule, 2023–2026\n', ...fin.trades.sort((a, b) => a.r - b.r).slice(0, 8).map((x) => `- ${x.t}: bought ${x.in} → sold ${x.out} (${x.why}) ${pc(x.r, 0)}`)];
const txt = out.join('\n'); console.log(txt); fs.mkdirSync(RES, { recursive: true }); fs.writeFileSync(path.join(RES, 'exits.txt'), txt + '\n');
fs.writeFileSync(path.join(RES, 'exits.json'), JSON.stringify({ chosen: FROZEN, build: res.map((x) => ({ rule: label(x.cfg), ok: x.ok, ...x.all, h1: x.h1.ex, h2: x.h2.ex })), check: chk.chosen, checkBase: chk.base, final: fin.chosen, finalBase: fin.base, passChk }, null, 1));
