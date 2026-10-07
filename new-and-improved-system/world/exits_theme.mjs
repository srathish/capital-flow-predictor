#!/usr/bin/env node
// Theme-aware selling rules (DESIGN_exits2.md, locked 63efb1b8). Same simulator as exits_study.mjs; adds industry 'theme hot /
// cooled' measures (breadth in the top 60 + industry median revenue acceleration).  node --max-old-space-size=14000 world/exits_theme.mjs
import fs from 'node:fs';
import path from 'node:path';
import { TAGS } from './facts_collect.mjs';
import { universeV2 } from './universe_prices.mjs';
import { cleanBars, inBad } from './prices_clean.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), RES = path.join(ROOT, 'world', 'results_exits');
if (fs.existsSync(path.join(RES, 'theme.txt')) && !process.argv.includes('--force')) { console.error('already run — see world/results_exits/theme.txt'); process.exit(1); }
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
const calMonthEnds = (a, b) => { const o = []; for (let y = +a.slice(0, 4), m = +a.slice(5, 7); `${y}-${String(m).padStart(2, '0')}` <= b; m === 12 ? (y++, m = 1) : m++) o.push(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)); return o; };
function prepare(D, a, b) { const ME = calMonthEnds(a, b), months = new Map(); for (const M of ME) months.set(M, monthData(D, M));
  const tdEnd = new Map(); for (const M of ME) { let last = null; for (const d of D.cal) { if (d > M) break; last = d; } if (last) tdEnd.set(last, M); }
  const bench = []; for (let i = 0; i < ME.length - 1; i++) { const m = months.get(ME[i]), n = ME[i + 1], v = [];
    for (const t of m.elig) { const p = D.P.get(t), i0 = idx(p, ME[i]), i1 = idx(p, n); if (i0 >= 0 && i1 > i0 && p.d[i1] >= addD(n, -7)) v.push(p.c[i1] / p.c[i0] - 1); } v.sort((x, y) => x - y); bench.push({ M: n, r: v.length ? v[v.length >> 1] : 0 }); }
  return { ME, months, tdEnd, bench }; }

// ---------- the simulator ----------
const COMBOS = [{ W: 'W0', L: 'none' }, { W: 'W1', L: 'L5' }, { W: 'T1', L: 'none' }, { W: 'T1', L: 'L5' }, { W: 'T2', L: 'none' }, { W: 'T2', L: 'L5' }];
const label = (c) => `${c.W}+${c.L}`;
const NAMEW = { W0: 'sell at 6 months', W1: 'hold while top-60', T1: 'theme hold', T2: 'theme exit' }, NAMEL = { none: 'no stop', 'L1-20': 'trail 20%', 'L1-30': 'trail 30%', 'L1-40': 'trail 40%', 'L2-1.5': 'vol-trail 1.5×', 'L2-2': 'vol-trail 2×', 'L2-3': 'vol-trail 3×', L3a: 'below 50-day', L3b: 'below 200-day', L4: 'numbers turn', L5: 'time stop 3m' };
function sim(D, PR, cfg, start, end) { const days_ = D.cal.filter((d) => d >= start && d <= end); let cash = 1, pos = [], pend = [], eq = 1; const curve = [], trades = [];
  const close = (t, d) => { const p = D.P.get(t), j = idx(p, d); return j >= 0 ? { c: p.c[j], j, p } : null; };
  const mo = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  for (let i = 0; i < days_.length; i++) { const d = days_[i];
    for (const x of pos.filter((q) => q.sell)) { const k = close(x.t, d); cash += x.u * k.c * (1 - COST); trades.push({ t: x.t, in: x.d0, out: d, r: k.c / x.px - 1, why: x.sell, px: x.px, exitPx: k.c }); }
    pos = pos.filter((q) => !q.sell);
    for (const t of pend) { const k = close(t, d); if (!k || k.p.d[k.j] < addD(d, -7)) continue; const amt = Math.min(eq / SLOTS, cash); if (amt <= 0) break; cash -= amt;
      const lr = []; for (let j = Math.max(1, k.j - 59); j <= k.j; j++) lr.push(Math.log(k.p.c[j] / k.p.c[j - 1])); pos.push({ t, u: (amt * (1 - COST)) / k.c, px: k.c, d0: d, peak: k.c, vol: sd(lr) * Math.sqrt(21), n: 0 }); }
    pend = []; eq = cash; for (const x of pos) { const k = close(x.t, d); x.last = k.c; eq += x.u * k.c; x.peak = Math.max(x.peak, k.c); x.n++;
      const L = cfg.L, dd = 1 - k.c / x.peak; let why = null; if (inBad(k.p.bad, d)) { x.sell = 'data'; continue; } // quarantined price stretch ahead: exit before it
      if (L.startsWith('L1') && dd >= +L.split('-')[1] / 100) why = L; if (L.startsWith('L2') && dd >= +L.split('-')[1] * x.vol) why = L;
      if (L === 'L3a' || L === 'L3b') { const w = L === 'L3a' ? 50 : 200; if (k.j >= w) { let s = 0; for (let j = k.j - w + 1; j <= k.j; j++) s += k.p.c[j]; if (k.c < s / w) why = L; } }
      if (L === 'L5' && x.n === 63 && k.c < x.px) why = L; if (why) x.sell = why; }
    curve.push({ d, eq });
    const M = PR.tdEnd.get(d); if (M && i < days_.length - 1) { const m = PR.months.get(M);
      for (const x of pos) { if (x.sell) continue; const held = mo(x.d0, M);
        const inTop = (m.rank.get(x.t) ?? 1e9) < POOL60, cap = cfg.W !== 'W0' && held >= 24;
        if ((cfg.W === 'W0' && held >= 6) || cap || (cfg.W === 'W1' && !inTop) || (cfg.W === 'T1' && !inTop && !m.hot(x.t)) || (cfg.W === 'T2' && (!inTop || m.cooled(x.t)))) x.sell = cfg.W;
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
for (const x of res) x.ok = x.cfg.W.startsWith('T') && x.all.mdd <= base.all.mdd + 0.05 && x.h1.ex > base.h1.ex && x.h2.ex > base.h2.ex;
const pick = res.filter((x) => x.ok).sort((a, b) => b.all.ex - a.all.ex)[0] ?? null, FROZEN = pick?.cfg ?? null, C1 = { W: 'W1', L: 'L5' }; console.error(`chosen theme rule: ${FROZEN ? label(FROZEN) : 'none eligible'}`);
// ---------- 2. check 2019–2022 and 3. final 2023–2026 (full data, rule frozen) ----------
const DF = load(null), PF = prepare(DF, '2018-12', '2026-09');
const runP = (cfg, a, b) => { const r = sim(DF, PF, cfg, a, b); return { s: stats(DF, PF, r, a, b), trades: r.trades }; };
const cands = [...(FROZEN ? [['chosen theme rule: ' + NAMEW[FROZEN.W] + ' + ' + NAMEL[FROZEN.L], FROZEN]] : []), ['C1 (second look): hold while top-60 + time stop 3m', C1]];
const per = (a, b) => ({ base: runP(base.cfg, a, b), c: cands.map(([n, cfg]) => [n, runP(cfg, a, b)]) });
const chk = per('2019-01-01', '2022-12-31'), fin = per('2023-01-01', '2026-10-02');
const row = (n, s) => `| ${n} | ${pc(s.cagr)} | ${pc(s.bcagr)} | **${pc(s.ex)}** | ${pc(-s.mdd, 0)} | ${s.sh?.toFixed(2) ?? '—'} | ${s.n} | ${s.hold.toFixed(0)}d | ${s.cap == null ? '—' : `${(s.cap * 100).toFixed(0)}% (${s.nCap})`} | ${s.loss == null ? '—' : `${pc(s.loss, 0)} (${s.nLoss})`} |`;
const H = '| rule | yearly return | typical stock | excess | worst drawdown | Sharpe | trades | avg hold | winner gain kept | loss taken on −30% picks |\n|---|---|---|---|---|---|---|---|---|---|';
const verdict = (P) => P.c.map(([n, x]) => `${n}: ${x.s.ex > P.base.s.ex && x.s.mdd <= P.base.s.mdd + 0.05 ? 'PASS' : 'FAIL'}`).join(' · ');
const out = ['# Theme-aware selling rules (DESIGN_exits2.md)\n', `**Theme rule chosen on 2012–2018 only: ${FROZEN ? NAMEW[FROZEN.W] + ' + ' + NAMEL[FROZEN.L] : 'none was eligible'}**\n`,
  '## 1. Build period 2012–2018 (✓ = eligible theme rule; C1 shown for reference, its build numbers do not count)\n', H, ...res.map((x) => row(`${x.ok ? '✓ ' : ''}${NAMEW[x.cfg.W]} + ${NAMEL[x.cfg.L]} (halves ${pc(x.h1.ex)} / ${pc(x.h2.ex)})`, x.all)),
  `\n## 2. Check period 2019–2022 → ${verdict(chk)}\n`, H, row("today's rule (6 months)", chk.base.s), ...chk.c.map(([n, x]) => row(n, x.s)),
  '\n## 3. Final period 2023 → 2026-09\n', H, row("today's rule (6 months)", fin.base.s), ...fin.c.map(([n, x]) => row(n, x.s)),
  ...fin.c.flatMap(([n, x]) => [`\n### ${n}: biggest and worst trades 2023–2026\n`, ...x.trades.sort((a, b) => b.r - a.r).slice(0, 8).map((y) => `- ${y.t}: ${y.in} → ${y.out} (${y.why}) ${pc(y.r, 0)}`), '…', ...x.trades.sort((a, b) => a.r - b.r).slice(0, 5).map((y) => `- ${y.t}: ${y.in} → ${y.out} (${y.why}) ${pc(y.r, 0)}`)])];
const txt = out.join('\n'); console.log(txt); fs.mkdirSync(RES, { recursive: true }); fs.writeFileSync(path.join(RES, 'theme.txt'), txt + '\n');
fs.writeFileSync(path.join(RES, 'theme.json'), JSON.stringify({ chosen: FROZEN, build: res.map((x) => ({ rule: label(x.cfg), ok: x.ok, ...x.all, h1: x.h1.ex, h2: x.h2.ex })), check: { base: chk.base.s, cands: chk.c.map(([n, x]) => [n, x.s]) }, final: { base: fin.base.s, cands: fin.c.map(([n, x]) => [n, x.s]) } }, null, 1));
