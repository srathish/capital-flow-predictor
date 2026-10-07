#!/usr/bin/env node
// Money list v6 (DESIGN_v6.md, locked 2dcf1ac8): base = bottleneck version C + selling rule C1, as a 20-slot daily-simulated
// portfolio; add-ons R1–R3 (risk), V1–V2 (valuation), S1 (weekly speed), G1 (guidance) chosen on 2012–2018 (data truncated),
// checked on 2019–2022, combined and reported through 2026-09 with slippage + taxes.  node --max-old-space-size=16000 world/portfolio_v6.mjs
import fs from 'node:fs';
import path from 'node:path';
import { TAGS } from './facts_collect.mjs';
import { universeV2 } from './universe_prices.mjs';
import { cleanBars, gapsOf, blockedAt, crosses, isTradingDay } from './prices_clean.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), RES = path.join(ROOT, 'world', 'results_v6');
const SMOKE = process.argv.includes('--smoke'); // --smoke: base + two add-ons on build years only, writes nothing
if (!SMOKE && fs.existsSync(path.join(RES, 'v6.txt')) && !process.argv.includes('--force')) { console.error('already run — see world/results_v6/v6.txt'); process.exit(1); }
const rd = (f, d = null) => { try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d; } catch { return d; } };
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10), days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const SLOTS = 20, COST = 0.0005;

// ---------- data ----------
function series(facts, tags) { const q = new Map(), ann = new Map();
  for (const tag of tags) for (const x of facts?.[tag] ?? []) { const dur = days(x.s, x.e), tgt = dur >= 80 && dur <= 100 ? q : dur >= 350 && dur <= 380 ? ann : null; if (!tgt) continue;
    const cur = tgt.get(x.e); if (cur && (cur.tag !== tag ? true : cur.f <= x.f)) continue; tgt.set(x.e, { v: x.v, f: x.f, s: x.s, tag }); }
  for (const [e, a] of ann) { if ([...q.keys()].some((k) => Math.abs(days(k, e)) <= 5)) continue; const inside = [...q.entries()].filter(([k, x]) => days(a.s, x.s) >= -5 && days(k, e) >= 0); if (inside.length !== 3) continue;
    q.set(e, { v: a.v - inside.reduce((s, [, x]) => s + x.v, 0), f: [a.f, ...inside.map(([, x]) => x.f)].sort().at(-1) }); }
  return q; }
const RAWQ = new Map(), SIC3 = new Map(), SHR = new Map();
for (const t of universeV2(1e9).map((x) => x.t)) { const F = rd(path.join(C, 'edgar', 'facts', `${t}.json`), null); if (!F?.rev) continue; const rev = series(F.rev, TAGS.rev), gp = series(F.gp, TAGS.gp), cost = series(F.cost, TAGS.cost), rows = [];
  for (const [e, r] of rev) { let g = null, f = r.f; const a = gp.get(e), c = cost.get(e); if (a) { g = a.v / r.v; f = [f, a.f].sort().at(-1); } else if (c) { g = (r.v - c.v) / r.v; f = [f, c.f].sort().at(-1); } rows.push({ e, rev: r.v, gm: g, f }); }
  RAWQ.set(t, rows.sort((x, y) => x.e.localeCompare(y.e))); const s = rd(path.join(C, 'edgar', 'sic', `${t}.json`)); if (s?.sic) SIC3.set(t, String(s.sic).padStart(4, '0').slice(0, 3));
  const H = rd(path.join(C, 'edgar', 'facts3', `${t}.json`), {}); const a = []; for (const tag of ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding']) for (const x of H.sh?.[tag] ?? []) a.push({ d: x.f, v: x.v }); if (a.length) SHR.set(t, a.sort((x, y) => x.d.localeCompare(y.d))); }
const GUID = new Map(); { const g = rd(path.join(C, 'edgar', 'guidance_hist.json'), null); if (g) for (const r of g) { if (!r.t || !r.d) continue; const a = GUID.get(r.t) ?? []; a.push({ d: r.d, dir: r.dir }); GUID.set(r.t, a); } }
const HAVE_GUID = GUID.size > 0;
function load(cut) { const P = new Map();
  for (const t of RAWQ.keys()) { const cb = cleanBars(t); let b = cb.bars; if (cut) b = b.filter((x) => x.d <= cut); if (b.length > 70) P.set(t, { d: b.map((x) => x.d), c: b.map((x) => x.c), v: b.map((x) => x.v || 0), bad: cut ? cb.bad.filter((w) => w.at <= cut) : cb.bad, gaps: gapsOf(b) }); }
  const spy = rd(path.join(C, 'wdaily_hist', 'SPY_full.json'), []).filter((x) => isTradingDay(x.d)); const sp = cut ? spy.filter((x) => x.d <= cut) : spy;
  return { P, cal: sp.map((x) => x.d), spy: sp }; }
const idx = (p, d) => { let lo = 0, hi = p.d.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (p.d[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const ser = (a, d) => { let lo = 0, hi = a.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].d <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r >= 0 ? a[r] : null; };

// ---------- ranking at a date ----------
const RC = new Map();
function rankAt(D, M) { const key = (D.cut ?? 'full') + M; if (RC.has(key)) return RC.get(key); const { P } = D;
  const elig = [...P.keys()].filter((t) => { const p = P.get(t), j = idx(p, M); if (j < 64 || p.d[j] < addD(M, -7) || blockedAt(p.bad, p.gaps, M)) return false; let dv = 0; for (let k = j - 49; k <= j; k++) dv += p.c[k] * p.v[k]; return p.c[j] >= 5 && dv / 50 >= 2e7; });
  const F = [];
  for (const t of elig) { const rows = RAWQ.get(t).filter((x) => x.f <= M), q0 = rows.at(-1); if (!q0 || days(q0.e, M) > 200 || q0.rev < 25e6) continue;
    const find = (ref, lo, hi) => ref && rows.filter((x) => { const d = days(x.e, ref.e); return d >= lo && d <= hi; }).at(-1);
    const q1 = find(q0, 80, 100), q4 = find(q0, 345, 385), q5 = find(q1, 345, 385); if (!q1 || !q4 || !q5 || !(q4.rev > 0 && q5.rev > 0) || q0.gm == null || q4.gm == null) continue;
    const g0 = q0.rev / q4.rev - 1, g1 = q1.rev / q5.rev - 1, ttm = rows.filter((x) => days(x.e, q0.e) >= 0 && days(x.e, q0.e) < 300).slice(-4); F.push({ t, g0, accel: g0 - g1, dGM: q0.gm - q4.gm, gm4: q4.gm, ttm: ttm.length === 4 ? ttm.reduce((s, x) => s + x.rev, 0) : null }); }
  const rk = ['g0', 'accel', 'dGM'].map((k) => { const s = F.map((f) => f[k]).sort((a, b) => a - b); return (v) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } return lo / (s.length - 1 || 1); }; });
  for (const f of F) { f.s = (rk[0](f.g0) + rk[1](f.accel) + rk[2](f.dGM)) / 3; const p = P.get(f.t), j = idx(p, M); const c = (k) => p.c[Math.max(0, k)]; let ma = 0; for (let k = Math.max(0, j - 199); k <= j; k++) ma += p.c[k];
    f.mom = j >= 252 ? c(j - 21) / c(j - 252) - 1 : null; f.a200 = p.c[j] > ma / Math.min(200, j + 1); f.r6 = c(j) / c(j - 126) - 1; const lr = []; for (let k = Math.max(1, j - 59); k <= j; k++) lr.push(Math.log(p.c[k] / p.c[k - 1])); f.vol = sd(lr) || 0.02;
    let dv = 0; for (let k = j - 49; k <= j; k++) dv += p.c[k] * p.v[k]; f.dv = dv / 50; const sh = ser(SHR.get(f.t) ?? [], M); f.ps = sh && f.ttm > 0 ? (sh.v * p.c[j]) / f.ttm : null; }
  const hard = F.filter((f) => f.gm4 >= 0).sort((a, b) => b.s - a.s), rankA = new Map(hard.map((f, i) => [f.t, i]));
  const C = hard.filter((f) => f.mom != null && f.mom > 0 && f.a200); const ps = C.map((f) => f.ps).filter((x) => x != null).sort((a, b) => a - b), ps90 = ps.length ? ps[Math.floor(ps.length * 0.9)] : Infinity;
  const out = { M, C, rankA, byT: new Map(F.map((f) => [f.t, f])), ps90 }; RC.set(key, out); return out; }

// ---------- simulator ----------
function sim(D, cfg, start, end) { const days_ = D.cal.filter((d) => d >= start && d <= end); let cash = 1, pos = [], pend = [], eq = 1; const curve = [], trades = [];
  const close = (t, d) => { const p = D.P.get(t), j = idx(p, d); return j >= 0 ? { c: p.c[j], j, p } : null; }, mo = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  const spyAbove = (d) => { const j = D.spy.findLastIndex((x) => x.d <= d); if (j < 199) return true; let s = 0; for (let k = j - 199; k <= j; k++) s += D.spy[k].c; return D.spy[j].c > s / 200; };
  const isReb = new Set(); for (let i = 0; i < days_.length - 1; i++) { const d = days_[i], n = days_[i + 1]; if (cfg.weekly ? new Date(n + 'T12:00:00Z').getUTCDay() < new Date(d + 'T12:00:00Z').getUTCDay() || days(d, n) > 3 : n.slice(0, 7) !== d.slice(0, 7)) isReb.add(d); }
  const slip = (t, R) => (cfg.slip && (R?.byT.get(t)?.dv ?? 1e9) < 1e8 ? 0.002 : 0);
  for (let i = 0; i < days_.length; i++) { const d = days_[i];
    for (const x of pos.filter((q) => q.sell)) { const k = close(x.t, d), px = x.sell === 'data' ? x.dataPx : k.c; cash += x.u * px * (1 - COST - x.slip); trades.push({ t: x.t, in: x.d0, out: d, r: px / x.px - 1, gain: x.u * (px - x.px), why: x.sell }); }
    pos = pos.filter((q) => !q.sell);
    for (const b of pend) { const k = close(b.t, d); if (!k || k.p.d[k.j] < addD(d, -7)) continue; const amt = Math.min((eq / SLOTS) * b.w, cash); if (amt <= 0) break; cash -= amt; pos.push({ t: b.t, u: (amt * (1 - COST - b.slip)) / k.c, px: k.c, d0: d, n: 0, slip: b.slip }); }
    pend = []; eq = cash;
    for (const x of pos) { const k = close(x.t, d); if (!x.sell && crosses(k.p.bad, k.p.gaps, addD(d, -1), d)) { x.sell = 'data'; x.dataPx = x.prevC ?? x.px; } if (x.sell === 'data') { eq += x.u * x.dataPx; continue; }
      x.prevC = k.c; eq += x.u * k.c; x.n++; if (x.n === 63 && k.c < x.px) x.sell = 'L5'; }
    curve.push({ d, eq });
    if (isReb.has(d) && i < days_.length - 1) { const R = rankAt(D, d), above = cfg.brake ? spyAbove(d) : true;
      for (const x of pos) { if (x.sell) continue; if (!((R.rankA.get(x.t) ?? 1e9) < 60) || mo(x.d0, d) >= 24) x.sell = 'W1'; }
      if (cfg.brake === 'b' && !above) { const live = pos.filter((q) => !q.sell).sort((a, b) => (R.byT.get(a.t)?.s ?? 0) - (R.byT.get(b.t)?.s ?? 0)); for (const x of live.slice(0, Math.floor(live.length / 2))) x.sell = 'brake'; }
      if (above || !cfg.brake) { const keep = pos.filter((q) => !q.sell), held = new Set(pos.map((q) => q.t)), ind = new Map(); for (const x of keep) { const s = SIC3.get(x.t); if (s) ind.set(s, (ind.get(s) ?? 0) + 1); }
        let cand = R.C.filter((f) => !held.has(f.t));
        if (cfg.runup) cand = cand.filter((f) => f.r6 <= cfg.runup);
        if (cfg.ps) cand = cand.filter((f) => f.ps == null || f.ps < R.ps90);
        if (cfg.guid) { const g = (t) => (GUID.get(t) ?? []).filter((x) => x.d <= d && x.d > addD(d, -120)); cand = cand.filter((f) => !g(f.t).some((x) => x.dir === 'cut')); cand.sort((a, b) => (g(b.t).some((x) => x.dir === 'raise') ? 1 : 0) - (g(a.t).some((x) => x.dir === 'raise') ? 1 : 0)); }
        const picks = []; for (const f of cand) { if (keep.length + picks.length >= SLOTS) break; const s = SIC3.get(f.t); if (cfg.cap && s && (ind.get(s) ?? 0) >= cfg.cap) continue; if (s) ind.set(s, (ind.get(s) ?? 0) + 1); picks.push(f); }
        const medVol = picks.length ? [...picks.map((f) => f.vol)].sort((a, b) => a - b)[picks.length >> 1] : 1;
        pend = picks.map((f) => ({ t: f.t, w: cfg.vol ? Math.max(0.5, Math.min(2, medVol / f.vol)) : 1, slip: slip(f.t, R) })); } } }
  const dEnd = days_.at(-1); for (const x of pos) { const k = close(x.t, dEnd); trades.push({ t: x.t, in: x.d0, out: dEnd, r: k.c / x.px - 1, gain: x.u * (k.c - x.px), why: 'end' }); }
  return { curve, trades }; }
function stats(D, run, a, b, tax = false) { const c = run.curve.filter((x) => x.d >= a && x.d <= b); if (c.length < 20) return null; const yrs = days(c[0].d, c.at(-1).d) / 365.25; let end = c.at(-1).eq / c[0].eq;
  if (tax) { const byY = new Map(); for (const t of run.trades.filter((x) => x.out >= a && x.out <= b)) { const y = t.out.slice(0, 4), lt = days(t.in, t.out) >= 365, o = byY.get(y) ?? { st: 0, lt: 0 }; o[lt ? 'lt' : 'st'] += t.gain; byY.set(y, o); }
    let taxPaid = 0; for (const o of byY.values()) { const st = Math.max(0, o.st + Math.min(0, o.lt)), lt = Math.max(0, o.lt + Math.min(0, o.st)); taxPaid += st * 0.37 + lt * 0.2; } end = (c.at(-1).eq - taxPaid) / c[0].eq; }
  const cagr = end ** (1 / yrs) - 1, sp = D.spy, sa = ser(sp, c[0].d)?.c, sb = ser(sp, c.at(-1).d)?.c, spy = sa && sb ? (sb / sa) ** (1 / yrs) - 1 : null;
  let pk = 0, mdd = 0; for (const x of c) { pk = Math.max(pk, x.eq); mdd = Math.max(mdd, 1 - x.eq / pk); }
  const me = c.filter((x, i) => i === c.length - 1 || c[i + 1].d.slice(0, 7) !== x.d.slice(0, 7)), mr = me.slice(1).map((x, i) => x.eq / me[i].eq - 1);
  return { cagr, spy, ex: spy == null ? null : cagr - spy, mdd, sh: mr.length > 2 ? (mean(mr) / (sd(mr) || 1)) * Math.sqrt(12) : null, n: run.trades.filter((x) => x.in >= a && x.in <= b).length }; }

// ---------- 1. choose on 2012–2018 ----------
const pc = (x) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);
const DB = load('2018-12-31'); DB.cut = '2018'; const DF = load(null); DF.cut = null;
const ADDONS = [['R1 industry cap', [{ cap: 3 }, { cap: 4 }]], ['R2 volatility sizing', [{ vol: true }]], ['R3 market brake', [{ brake: 'a' }, { brake: 'b' }]], ['V1 run-up cap', [{ runup: 1.5 }, { runup: 3 }]],
  ['V2 price-to-sales cap', [{ ps: true }]], ['S1 weekly speed', [{ weekly: true }]], ...(HAVE_GUID ? [['G1 guidance', [{ guid: true }]]] : [])];
const run = (D, cfg, a, b) => sim(D, cfg, a, b);
if (SMOKE) { for (const cfg of [{}, { cap: 4 }, { vol: true }, { brake: 'a' }, { weekly: true }]) { const t0 = Date.now(), s0 = stats(DB, run(DB, cfg, '2012-01-01', '2018-12-31'), '2012-01-01', '2018-12-31'); console.log(JSON.stringify(cfg), pc(s0.cagr), 'dd', pc(-s0.mdd), 'sh', s0.sh.toFixed(2), 'trades', s0.n, `${((Date.now() - t0) / 1000).toFixed(0)}s`); } process.exit(0); }
const baseB = stats(DB, run(DB, {}, '2012-01-01', '2018-12-31'), '2012-01-01', '2018-12-31'), baseC = stats(DF, run(DF, {}, '2019-01-01', '2022-12-31'), '2019-01-01', '2022-12-31');
const L = ['# Money list v6 — risk, valuation, speed, guidance (DESIGN_v6.md)\n', `Base = bottleneck C + selling rule C1. Build 2012–18: ${pc(baseB.cagr)}/yr (SPY ${pc(baseB.spy)}), worst drop ${pc(-baseB.mdd)}, Sharpe ${baseB.sh.toFixed(2)} · Check 2019–22: ${pc(baseC.cagr)}/yr (SPY ${pc(baseC.spy)}), worst drop ${pc(-baseC.mdd)}, Sharpe ${baseC.sh.toFixed(2)}\n`,
  '| add-on | setting | build: yearly / vs SPY / worst drop / Sharpe | passes build? | check 2019–22: yearly / worst drop / Sharpe | adopted? |', '|---|---|---|---|---|---|'];
const adopted = {};
for (const [name, settings] of ADDONS) { const res = settings.map((cfg) => ({ cfg, b: stats(DB, run(DB, cfg, '2012-01-01', '2018-12-31'), '2012-01-01', '2018-12-31') })); const best = res.sort((x, y) => y.b.sh - x.b.sh)[0];
  const okB = best.b.sh > baseB.sh && best.b.ex >= baseB.ex - 0.01 && best.b.mdd <= baseB.mdd; let chk = null, okC = false;
  if (okB) { chk = stats(DF, run(DF, best.cfg, '2019-01-01', '2022-12-31'), '2019-01-01', '2022-12-31'); okC = chk.sh >= baseC.sh && chk.ex >= baseC.ex - 0.01; }
  if (okB && okC) Object.assign(adopted, best.cfg); console.error(`${name} ${JSON.stringify(best.cfg)} build ${pc(best.b.cagr)} sh ${best.b.sh.toFixed(2)} dd ${pc(-best.b.mdd)} → ${okB ? (okC ? 'ADOPT' : 'fails check') : 'fails build'}`);
  L.push(`| ${name} | ${JSON.stringify(best.cfg)} | ${pc(best.b.cagr)} / ${pc(best.b.ex)} / ${pc(-best.b.mdd)} / ${best.b.sh.toFixed(2)} | ${okB ? '✓' : '✗'} | ${chk ? `${pc(chk.cagr)} / ${pc(-chk.mdd)} / ${chk.sh.toFixed(2)}` : '—'} | ${okB && okC ? '**yes**' : 'no'} |`); }
if (!HAVE_GUID) L.push('| G1 guidance | — | guidance history not available yet → not tested | | | |');
// ---------- 2. combined, all periods, with frictions ----------
L.push(`\n## Adopted together: ${Object.keys(adopted).length ? JSON.stringify(adopted) : 'none (base stays)'}\n`, '| period | base: yearly / worst drop / Sharpe | v6: yearly / worst drop / Sharpe | v6 with slippage | v6 with slippage + taxes | SPY |', '|---|---|---|---|---|---|');
for (const [n, a, b, D] of [['2012–2018 (build)', '2012-01-01', '2018-12-31', DB], ['2019–2022 (check)', '2019-01-01', '2022-12-31', DF], ['2023–2026-09 (partly seen)', '2023-01-01', '2026-10-02', DF]]) {
  const s0 = stats(D, run(D, {}, a, b), a, b), r1 = run(D, adopted, a, b), s1 = stats(D, r1, a, b), r2 = run(D, { ...adopted, slip: true }, a, b), s2 = stats(D, r2, a, b), s3 = stats(D, r2, a, b, true);
  L.push(`| ${n} | ${pc(s0.cagr)} / ${pc(-s0.mdd)} / ${s0.sh.toFixed(2)} | **${pc(s1.cagr)}** / ${pc(-s1.mdd)} / ${s1.sh.toFixed(2)} | ${pc(s2.cagr)} | ${pc(s3.cagr)} | ${pc(s1.spy)} |`); }
L.push('\nSurvivorship: delisted companies are missing from the data, so every number above is a best case.');
const txt = L.join('\n'); console.log(txt); fs.mkdirSync(RES, { recursive: true }); fs.writeFileSync(path.join(RES, 'v6.txt'), txt + '\n'); fs.writeFileSync(path.join(RES, 'v6.json'), JSON.stringify({ adopted, haveGuidance: HAVE_GUID }, null, 1));
