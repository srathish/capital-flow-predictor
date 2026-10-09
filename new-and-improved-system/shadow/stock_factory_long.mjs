#!/usr/bin/env node
// Stock-finding factory, LONG horizon (shadow/DESIGN_stock_factory.md): 70 features × 4 outcomes, monthly cross-sections,
// build 2012–2019, holdout 2020–2026. Cached data only (SEC XBRL first-filed, prices, insiders, guidance, filing concepts).
//   node --max-old-space-size=16000 shadow/stock_factory_long.mjs [--smoke]   (runs once; --force only for logged audit fixes)
import fs from 'node:fs';
import path from 'node:path';
import { TAGS } from '../world/facts_collect.mjs';
import { TAGS2 } from '../world/facts2_collect.mjs';
import { universeV2 } from '../world/universe_prices.mjs';
import { cleanBars, gapsOf, blockedAt, crosses } from '../world/prices_clean.mjs';
import { sharesAdjusted } from './split_shares.mjs';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), NIS = path.join(SH, '..'), C = path.join(NIS, '.cache');
const OUT = path.join(SH, 'results_stock_factory'), SMOKE = process.argv.includes('--smoke');
if (!SMOKE && fs.existsSync(path.join(OUT, 'long_summary.md')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const REG = JSON.parse(fs.readFileSync(path.join(SH, 'stock_registry.json'), 'utf8')).hypotheses.filter((h) => h.horizon === 'long' && h.feature !== 'L57'); // amendment 1: L57 dropped (spin-offs can never be eligible within a year)
const rd = (f, d = null) => { try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d; } catch { return d; } };
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10), days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const sdv = (a) => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const log = (s) => console.error(`${new Date().toISOString().slice(11, 19)} ${s}`);
const FUNDS = new Set(['6221', '6722', '6726']);
const AMBIG = new Set(['deposition', 'server', 'foundry', 'accelerator', 'oil', 'natural gas', 'digital assets', 'subscription', 'grid', 'wind', 'solar', 'construction', 'interest rate', 'advertising', 'travel', 'restaurant', 'housing', 'consumer spending', 'credit card', 'mortgage', 'steel', 'copper', 'automotive', 'tariff', 'freight', 'shipping', 'wafer', 'rack', 'inference', 'transformer']);
const GROUPS = { GLD: ['1040'], SLV: ['1040', '1090'], CPER: ['1000', '3330', '3331'], URA: ['1090', '1094'], USO: ['1311', '1381', '1389', '2911'], UNG: ['1311', '4922', '4923', '4924'], LIT: ['2819'], BDRY: ['4400', '4412', '4424'] };

// ---------- static data ----------
const U = universeV2(1e9);
const SIC = new Map(); for (const f of fs.readdirSync(path.join(C, 'edgar', 'sic'))) { const j = rd(path.join(C, 'edgar', 'sic', f)); if (j?.sic) SIC.set(f.replace('.json', ''), String(j.sic).padStart(4, '0')); }
function series(facts, tags) { const q = new Map(), ann = new Map(); // quarterly (80–100 d) first-filed, Q4 = annual − 3 quarters
  for (const tag of tags) for (const x of facts?.[tag] ?? []) { if (!x.s) continue; const dur = days(x.s, x.e), tgt = dur >= 80 && dur <= 100 ? q : dur >= 350 && dur <= 380 ? ann : null; if (!tgt) continue;
    const cur = tgt.get(x.e); if (cur && cur.f <= x.f) continue; tgt.set(x.e, { v: x.v, f: x.f, s: x.s, tag }); } // amendment 1: earliest-filed across tags (ASC 606 restatements no longer replace originals)
  for (const [e, a] of ann) { if ([...q.keys()].some((k) => Math.abs(days(k, e)) <= 5)) continue; const inside = [...q.entries()].filter(([k, x]) => days(a.s, x.s) >= -5 && days(k, e) >= 0); if (inside.length !== 3) continue;
    q.set(e, { v: a.v - inside.reduce((s, [, x]) => s + x.v, 0), f: [a.f, ...inside.map(([, x]) => x.f)].sort().at(-1) }); }
  return [...q].map(([e, x]) => ({ e, v: x.v, f: x.f })).sort((a, b) => a.e.localeCompare(b.e)); }
function annual(facts, tags) { const m = new Map(); for (const tag of tags) for (const x of facts?.[tag] ?? []) { if (!x.s) continue; const dur = days(x.s, x.e); if (dur < 350 || dur > 380) continue; const cur = m.get(x.e); if (cur && cur.f <= x.f) continue; m.set(x.e, { e: x.e, v: x.v, f: x.f }); } return [...m.values()].sort((a, b) => a.e.localeCompare(b.e)); }
function instant(facts, tags) { const m = new Map(); for (const tag of tags) for (const x of facts?.[tag] ?? []) { if (x.s) continue; const cur = m.get(x.e); if (cur && cur.f <= x.f) continue; m.set(x.e, { e: x.e, v: x.v, f: x.f }); } return [...m.values()].sort((a, b) => a.e.localeCompare(b.e)); }
const FUND = new Map();
for (const { t } of U) { const F = rd(path.join(C, 'edgar', 'facts', `${t}.json`)); if (!F?.rev) continue; const G = rd(path.join(C, 'edgar', 'facts2', `${t}.json`), {}), H = rd(path.join(C, 'edgar', 'facts3', `${t}.json`), {});
  const rev = series(F.rev, TAGS.rev), gp = new Map(series(F.gp, TAGS.gp).map((x) => [x.e, x])), cost = new Map(series(F.cost, TAGS.cost).map((x) => [x.e, x]));
  const Q = rev.map((r) => { const a = gp.get(r.e), c = cost.get(r.e); let gm = null, fg = r.f; if (a) { gm = a.v / r.v; fg = [r.f, a.f].sort().at(-1); } else if (c) { gm = (r.v - c.v) / r.v; fg = [r.f, c.f].sort().at(-1); } return { e: r.e, rev: r.v, f: r.f, gm, fg }; });
  FUND.set(t, { Q, op: series(G.opinc, TAGS2.opinc), ni: series(H.ni, ['NetIncomeLoss', 'ProfitLoss']), rnd: series(G.rnd, TAGS2.rnd), capex: annual(G.capex, TAGS2.capex),
    inv: instant(G.inv, TAGS2.inv), rpo: instant(G.rpo, TAGS2.rpo), defrev: instant(G.defrev, TAGS2.defrev), sh: sharesAdjusted(C, t)?.series ?? [] }); }
log(`fundamentals for ${FUND.size} companies`);
const INS = new Map(); for (const line of fs.readFileSync(path.join(C, 'insider_bulk', 'purchases.jsonl'), 'utf8').split('\n')) { if (!line) continue; const r = JSON.parse(line);
  if (!r.ticker || !r.filed || !r.tradeDate || r.tradeDate > r.filed) continue; (INS.get(r.ticker) ?? INS.set(r.ticker, []).get(r.ticker)).push({ f: r.filed, o: r.ownerCik ?? r.owner, v: Math.min(r.value ?? 0, 5e7) }); }
const GUID = new Map(); for (const g of rd(path.join(C, 'edgar', 'guidance_hist.json'), [])) (GUID.get(g.t) ?? GUID.set(g.t, []).get(g.t)).push(g);
const SPIN = rd(path.join(C, 'edgar', 'spinoffs.json'), {});
const CONCEPT = new Map(); for (const x of [...rd(path.join(C, 'edgar', 'exposure_hist.json'), []), ...rd(path.join(C, 'edgar', 'exposure.json'), [])]) { if (AMBIG.has(x.c) || !x.t || !x.c || !x.d || !/^10-[KQ]/.test(x.f ?? '')) continue; const a = CONCEPT.get(x.c) ?? CONCEPT.set(x.c, new Map()).get(x.c); (a.get(x.t) ?? a.set(x.t, []).get(x.t)).push(x.d); }
for (const mp of CONCEPT.values()) for (const a of mp.values()) a.sort();
const memberAt = (dates, M) => { const lo = addD(M, -730); for (let i = dates.length - 1; i >= 0; i--) { if (dates[i] <= M) return dates[i] >= lo; } return false; };
const COMM = Object.fromEntries(Object.keys(GROUPS).map((t) => [t, (rd(path.join(C, 'commodity', `${t}.json`), []) || []).filter((x) => x.c > 0)]));
const SPY = rd(path.join(C, 'wdaily_hist', 'SPY_full.json'), []), SPYI = new Map(SPY.map((x, i) => [x.d, i]));

// ---------- prices ----------
const P = new Map();
for (const { t } of U) { if (!FUND.has(t) || FUNDS.has(SIC.get(t))) continue; const cb = cleanBars(t); const b = cb.bars; if (b.length < 260) continue;
  P.set(t, { d: b.map((x) => x.d), c: Float64Array.from(b.map((x) => x.c)), v: Float64Array.from(b.map((x) => x.v || 0)), bad: cb.bad, gaps: gapsOf(b) }); }
log(`prices for ${P.size} companies`);
const idx = (arr, d) => { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const lastBy = (arr, d, key = 'f') => { let r = null; for (const x of arr) { if (x[key] <= d) r = x; else if (key === 'f') continue; } return r; };

// ---------- month-ends ----------
const MONTHS = []; for (let y = 2011, m = 12; ; m === 12 ? (y++, m = 1) : m++) { const d = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); if (d > '2026-09-30') break; MONTHS.push(d); }
const HZ = { M1: 1, M3: 3, M6: 6, MV: 6 }, DATA_END = '2026-10-07';
const monthEndAfter = (M, h) => MONTHS[MONTHS.indexOf(M) + h] ?? (() => { const x = new Date(M + 'T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() + h + 1, 0); return x.toISOString().slice(0, 10); })();
const FEATS = [...new Set(REG.map((h) => h.feature))].sort(), FI = new Map(FEATS.map((f, i) => [f, i]));

// ---------- per-month panel ----------
function build(M) {
  const elig = [], base = new Map();
  // amendment 1: eligibility = market cap ≥ $500M at M (split-adjusted shares filed ≤ M × price). The $5 / $20M-volume
  // filters ran on split-adjusted prices, which excluded future splitters (NVDA, AVGO, TSLA …) in early years.
  for (const [t, p] of P) { const j = idx(p.d, M); if (j < 252 || p.d[j] < addD(M, -7) || blockedAt(p.bad, p.gaps, M)) continue;
    const sh = FUND.get(t).sh; let r = null; for (const x of sh) { if (x.d <= M) r = x; else break; } if (!r || days(r.d, M) > 400 || !(r.v * p.c[j] >= 5e8)) continue; elig.push(t); base.set(t, { j }); }
  // forward outcomes
  const fwd = {}; for (const [o, h] of Object.entries(HZ)) { if (o === 'MV') continue; const end = monthEndAfter(M, h); if (end > DATA_END) { fwd[o] = null; continue; } const r = new Map();
    for (const t of elig) { const p = P.get(t); if (crosses(p.bad, p.gaps, M, end)) continue; const j = base.get(t).j + 1, k = idx(p.d, end); if (j < p.c.length && k > j && p.d[k] >= addD(end, -10)) r.set(t, p.c[k] / p.c[j] - 1); }
    const mu = mean([...r.values()]); fwd[o] = new Map([...r].map(([t, x]) => [t, x - mu])); fwd[o + 'raw'] = r; }
  if (fwd.M6) { const v = [...fwd.M6raw.values()].sort((a, b) => a - b), cut = v[Math.floor(0.9 * (v.length - 1))]; fwd.MV = new Map([...fwd.M6raw].map(([t, x]) => [t, x >= cut ? 1 : 0])); } else fwd.MV = null;
  // per-stock raw features
  const R = new Map();
  for (const t of elig) { const p = P.get(t), { j } = base.get(t), c = p.c, F = FUND.get(t), f = new Float64Array(FEATS.length).fill(NaN), set = (k, v) => { if (FI.has(k)) f[FI.get(k)] = Number.isFinite(v) ? v : NaN; };
    // fundamentals
    const Q = F.Q.filter((x) => x.f <= M), q0 = Q.at(-1);
    const near = (ref, lo, hi, arr = Q) => ref && arr.filter((x) => { const d = days(x.e, ref.e); return d >= lo && d <= hi; }).at(-1);
    let g0 = NaN, accel = NaN, gm0 = NaN, gm4 = NaN, ttmRev = NaN, ttmNI = NaN, fresh = NaN, yoys = [];
    if (q0 && days(q0.e, M) <= 200 && q0.rev >= 25e6) {
      const q1 = near(q0, 80, 100), q4 = near(q0, 345, 385), q5 = near(q1, 345, 385), q8 = near(q0, 690, 770), q2 = near(q1, 80, 100), q3 = near(q2, 80, 100);
      if (q4?.rev > 0) g0 = q0.rev / q4.rev - 1; if (q5?.rev > 0 && Number.isFinite(g0)) accel = g0 - (q1.rev / q5.rev - 1);
      if (q0.gm != null && q0.fg <= M) gm0 = q0.gm; if (q4?.gm != null && q4.fg <= M) gm4 = q4.gm;
      if (q1 && q2 && q3) ttmRev = q0.rev + q1.rev + q2.rev + q3.rev; fresh = days(q0.f, M);
      let qq = q0; for (let k = 0; k < 6 && qq; k++) { const a = near(qq, 345, 385); if (a?.rev > 0) yoys.push(qq.rev / a.rev - 1); qq = near(qq, 80, 100); }
      set('L01', g0); set('L02', accel); set('L03', gm0); set('L04', gm0 - gm4); set('L06', q1?.rev > 0 ? q0.rev / q1.rev - 1 : NaN); set('L07', q8?.rev > 0 ? q0.rev / q8.rev - 1 : NaN);
      set('L08', yoys.length >= 4 ? -sdv(yoys) : NaN); set('L14', yoys.length >= 5 ? yoys[0] - mean(yoys.slice(1, 5)) : NaN); set('L15', Number.isFinite(gm4) ? +(gm4 < 0) : NaN); set('L16', Number.isFinite(gm4) ? +(gm4 < 0 && gm0 > gm4) : NaN);
      set('L58', fresh); set('L59', Number.isFinite(accel) ? +(fresh <= 30 && accel > 0) : NaN);
      const gms = []; qq = q0; for (let k = 0; k < 6 && qq; k++) { if (qq.gm != null && qq.fg <= M) gms.push(qq.gm); qq = near(qq, 80, 100); } set('L67', gms.length >= 4 ? -sdv(gms) : NaN);
      const at = (arr, ref) => arr.filter((x) => x.f <= M && Math.abs(days(x.e, ref.e)) <= 5).at(-1);
      const op0 = at(F.op, q0), op4 = q4 && at(F.op, q4), ni0 = at(F.ni, q0), ni4 = q4 && at(F.ni, q4);
      if (op0) { set('L09', op0.v / q0.rev); set('L70', +(op0.v > 0)); } if (op0 && op4 && q4?.rev > 0) { set('L10', op0.v / q0.rev - op4.v / q4.rev); set('L11', (op0.v - op4.v) / q4.rev); }
      if (ni0) set('L12', +(ni0.v > 0)); if (ni0 && ni4 && q4?.rev > 0) set('L13', ni0.v / q0.rev - ni4.v / q4.rev);
      const rq = [q0, q1, q2, q3].map((x) => x && at(F.rnd, x)); if (rq.every(Boolean) && ttmRev > 0) set('L22', rq.reduce((s, x) => s + x.v, 0) / ttmRev);
      const r0 = at(F.rnd, q0), r4 = q4 && at(F.rnd, q4); if (r0 && r4?.v > 0) set('L23', r0.v / r4.v - 1);
      const nq = [q0, q1, q2, q3].map((x) => x && at(F.ni, x)); ttmNI = nq.every(Boolean) ? nq.reduce((s, x) => s + x.v, 0) : NaN;
    }
    const capex = F.capex.filter((x) => x.f <= M), cx0 = capex.at(-1); if (cx0 && days(cx0.e, M) <= 450) { const cx1 = capex.filter((x) => Math.abs(days(x.e, cx0.e) - 365) <= 20).at(-1); if (cx1?.v > 0) set('L17', cx0.v / cx1.v - 1); if (ttmRev > 0) set('L18', cx0.v / ttmRev); }
    const yoyInst = (arr) => { const a = arr.filter((x) => x.f <= M), x0 = a.at(-1); if (!x0 || days(x0.e, M) > 200) return NaN; const x1 = a.filter((x) => Math.abs(days(x.e, x0.e) - 365) <= 20).at(-1); return x1?.v > 0 ? x0.v / x1.v - 1 : NaN; };
    set('L19', yoyInst(F.inv) - g0); set('L20', yoyInst(F.rpo)); set('L21', yoyInst(F.defrev));
    // shares / valuation (split-adjusted shares × adjusted price)
    const shAt = (d) => { let r = null; for (const x of F.sh) { if (x.d <= d) r = x; else break; } return r && days(r.d, d) <= 400 ? r.v : NaN; };
    const sh0 = shAt(M), sh1 = shAt(addD(M, -365)), mcap = sh0 * c[j];
    set('L24', Math.log(sh0 / sh1)); set('L25', Number.isFinite(sh0 / sh1) ? +(sh0 / sh1 < 0.98) : NaN);
    const ps = ttmRev > 0 ? mcap / ttmRev : NaN; set('L26', ps); set('L27', mcap > 0 ? ttmNI / mcap : NaN); set('L41', Math.log(mcap));
    // P/S and E/P a year ago (fundamentals and shares filed ≤ M − 365)
    { const M1 = addD(M, -365), Qy = F.Q.filter((x) => x.f <= M1), y0 = Qy.at(-1), j1 = idx(p.d, M1);
      if (y0 && j1 >= 0 && days(y0.e, M1) <= 200) { const n = (ref, lo, hi) => Qy.filter((x) => { const d = days(x.e, ref.e); return d >= lo && d <= hi; }).at(-1); const y1 = n(y0, 80, 100), y2 = y1 && n(y1, 80, 100), y3 = y2 && n(y2, 80, 100);
        if (y1 && y2 && y3) { const ttm1 = y0.rev + y1.rev + y2.rev + y3.rev, mc1 = shAt(M1) * p.c[j1]; set('L29', Math.log(ps / (mc1 / ttm1)));
          const at1 = (ref) => F.ni.filter((x) => x.f <= M1 && Math.abs(days(x.e, ref.e)) <= 5).at(-1), nn = [y0, y1, y2, y3].map(at1); if (nn.every(Boolean) && mc1 > 0 && mcap > 0) set('L69', ttmNI / mcap - nn.reduce((s, x) => s + x.v, 0) / mc1); } } }
    // price features
    let hi = 0, lo = Infinity, ma200 = 0, ma200b = 0, ma20 = 0; for (let k = j - 251; k <= j; k++) { hi = Math.max(hi, c[k]); lo = Math.min(lo, c[k]); } for (let k = j - 199; k <= j; k++) ma200 += c[k] / 200; for (let k = j - 262; k <= j - 63; k++) ma200b += c[k] / 200; for (let k = j - 19; k <= j; k++) ma20 += c[k] / 20;
    const lr = []; for (let k = j - 62; k <= j; k++) lr.push(Math.log(c[k] / c[k - 1])); let mx = -Infinity; for (let k = j - 20; k <= j; k++) mx = Math.max(mx, c[k] / c[k - 1] - 1);
    set('L30', c[j - 21] / c[j - 252] - 1); set('L31', c[j - 21] / c[j - 126] - 1); set('L32', c[j] / c[j - 21] - 1); set('L33', c[j] / hi); set('L34', +(c[j] > ma200)); set('L35', ma200 / ma200b - 1);
    set('L36', sdv(lr) * Math.sqrt(252)); set('L37', mx); set('L42', c[j] / c[j - 63] - 1); set('L44', c[j] / ma20 - 1); set('L68', c[j] / lo);
    { let a = 0, b = 0; for (let k = j - 62; k <= j; k++) a += c[k] * p.v[k]; for (let k = j - 251; k <= j; k++) b += c[k] * p.v[k]; set('L39', (a / 63) / (b / 252)); set('L40', mcap > 0 ? (a / 63) / mcap : NaN); }
    { const xs = [], ys = []; for (let k = j - 251; k <= j; k++) { const a = SPYI.get(p.d[k]), b = SPYI.get(p.d[k - 1]); if (a == null || b == null || a !== b + 1) continue; xs.push(Math.log(SPY[a].c / SPY[b].c)); ys.push(Math.log(c[k] / c[k - 1])); }
      if (xs.length > 200) { const mx2 = mean(xs), my = mean(ys); let cv = 0, vv = 0; for (let i = 0; i < xs.length; i++) { cv += (xs[i] - mx2) * (ys[i] - my); vv += (xs[i] - mx2) ** 2; } set('L38', cv / vv); } }
    // insiders / guidance / spin-off
    const ins = (INS.get(t) ?? []).filter((x) => x.f > addD(M, -90) && x.f <= M); set('L52', ins.length); set('L53', +(new Set(ins.map((x) => x.o)).size >= 3)); set('L54', mcap > 0 ? ins.reduce((s, x) => s + x.v, 0) / mcap : NaN);
    const gd = (GUID.get(t) ?? []).filter((x) => x.d > addD(M, -120) && x.d <= M); set('L55', +gd.some((x) => x.dir === 'raise')); set('L56', +gd.some((x) => x.dir === 'cut'));
    if (M < '2014-03-31') for (const k of ['L52', 'L53', 'L54', 'L55', 'L56']) set(k, NaN); // amendment 1: insider/guidance files start 2014
    R.set(t, { f, g0, accel, ps, gm0, mcap, sic3: SIC.get(t)?.slice(0, 3), sic2: SIC.get(t)?.slice(0, 2), sic4: SIC.get(t), r6: c[j] / c[j - 126] - 1, r3: c[j] / c[j - 63] - 1, above: c[j] > ma200, mom: c[j - 21] / c[j - 252] - 1, vol: sdv(lr) });
  }
  // cross-sectional features
  const all = [...R.entries()], F = (t, k, v) => { const x = R.get(t); if (FI.has(k)) x.f[FI.get(k)] = Number.isFinite(v) ? v : NaN; };
  const prank = (vals) => { const s = vals.filter(Number.isFinite).sort((a, b) => a - b); return (v) => { if (!Number.isFinite(v) || !s.length) return NaN; let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } return lo / Math.max(1, s.length - 1); }; };
  const v5ok = all.filter(([, x]) => Number.isFinite(x.g0) && Number.isFinite(x.accel) && Number.isFinite(x.f[FI.get('L04')]));
  const rg = prank(v5ok.map(([, x]) => x.g0)), ra = prank(v5ok.map(([, x]) => x.accel)), rm = prank(v5ok.map(([, x]) => x.f[FI.get('L04')]));
  const v5 = new Map(v5ok.map(([t, x]) => [t, (rg(x.g0) + ra(x.accel) + rm(x.f[FI.get('L04')])) / 3])), v5r = prank([...v5.values()]);
  const psMed = median(all.map(([, x]) => x.ps)), gmMed = median(all.map(([, x]) => x.gm0)), volMed = median(all.map(([, x]) => x.vol)), g0r = prank(all.map(([, x]) => x.g0));
  const ind = new Map(); for (const [t, x] of all) if (x.sic3) (ind.get(x.sic3) ?? ind.set(x.sic3, []).get(x.sic3)).push(t);
  const indR3 = new Map([...ind].filter(([, ts]) => ts.length >= 3).map(([s, ts]) => [s, mean(ts.map((t) => R.get(t).r3))])), indR3r = prank([...indR3.values()]);
  for (const [t, x] of all) { const v = v5.get(t); F(t, 'L05', v); F(t, 'L62', Number.isFinite(v) && Number.isFinite(x.mom) ? +(v5r(v) >= 0.8 && x.mom > 0 && x.above && x.f[FI.get('L15')] === 0) : NaN);
    const peers = (ind.get(x.sic3) ?? []).filter((u) => u !== t);
    if (peers.length >= 3) { F(t, 'L45', mean(peers.map((u) => R.get(u).r6))); F(t, 'L46', median(peers.map((u) => R.get(u).g0))); F(t, 'L47', mean(peers.map((u) => +R.get(u).above))); F(t, 'L43', x.mom - median(peers.map((u) => R.get(u).mom)));
      const pm = median(peers.map((u) => R.get(u).ps)); F(t, 'L28', Number.isFinite(pm) && pm > 0 ? x.ps / pm : NaN); }
    if (indR3.has(x.sic3)) F(t, 'L51', indR3r(indR3.get(x.sic3)));
    F(t, 'L63', Number.isFinite(x.gm0) && Number.isFinite(x.ps) ? +(x.gm0 > gmMed && x.ps < psMed) : NaN);
    F(t, 'L64', Number.isFinite(x.accel) && Number.isFinite(x.f[FI.get('L45')]) ? +(x.accel > 0 && x.f[FI.get('L45')] > 0) : NaN);
    F(t, 'L65', Number.isFinite(x.vol) ? +(x.vol < volMed && x.mom > 0) : NaN);
    F(t, 'L66', Number.isFinite(x.g0) && Number.isFinite(x.ps) ? +(g0r(x.g0) >= 0.7 && x.ps < psMed) : NaN);
    for (const [etf, s4s] of Object.entries(GROUPS)) if (s4s.includes(x.sic4)) { const b = COMM[etf], k = idx(b.map((y) => y.d), M), k12 = idx(b.map((y) => y.d), addD(M, -365)); if (k >= 199 && k12 >= 0) { let m2 = 0; for (let q = k - 199; q <= k; q++) m2 += b[q].c / 200; if (b[k].c / b[k12].c - 1 > 0 && b[k].c > m2) F(t, 'L61', 1); else if (!(x.f[FI.get('L61')] === 1)) F(t, 'L61', 0); } } /* amendment 1: any matching group */
    if (!Number.isFinite(x.f[FI.get('L61')])) F(t, 'L61', 0); }
  // concepts
  // amendment 1: concept features only for stocks with any 10-K/10-Q concept mention filed ≤ M (NaN otherwise); concept
  // returns exclude the stock itself; "new concept" needs an earlier mention history (first mention of ANY concept > 1 year before)
  const covered = new Map(); for (const mp of CONCEPT.values()) for (const [t, ds] of mp) if (ds[0] <= M && (!covered.has(t) || ds[0] < covered.get(t))) covered.set(t, ds[0]); // first concept mention ≤ M
  const conc = []; for (const [cname, mp] of CONCEPT) { const mem = []; for (const [t, ds] of mp) if (R.has(t) && memberAt(ds, M)) mem.push(t); if (mem.length >= 6) { const sum = mem.reduce((q, t) => q + R.get(t).r6, 0); conc.push({ cname, mem, sum, n: mem.length, r6: sum / mem.length }); } }
  const q75 = [...conc.map((x) => x.r6)].sort((a, b) => a - b)[Math.floor(0.75 * (conc.length - 1))];
  const byT = new Map(); for (const x of conc) for (const t of x.mem) (byT.get(t) ?? byT.set(t, []).get(t)).push(x);
  for (const [t, x] of all) { if (!covered.has(t)) { F(t, 'L48', NaN); F(t, 'L49', NaN); F(t, 'L50', NaN); continue; }
    const cs = byT.get(t) ?? [], ex = cs.map((c) => (c.sum - x.r6) / (c.n - 1)); F(t, 'L48', ex.length ? Math.max(...ex) : NaN); F(t, 'L49', ex.filter((r) => r >= q75).length);
    if (covered.get(t) > addD(M, -365)) { F(t, 'L50', NaN); continue; }
    let fresh = 0; for (const [, mp] of CONCEPT) { const ds = mp.get(t); if (ds && ds[0] <= M && ds[0] > addD(M, -182)) { fresh = 1; break; } } F(t, 'L50', fresh); }
  return { M, R, fwd, g0r };
}

// ---------- build all months ----------
const PANEL = []; let prevRank = new Map();
for (const M of SMOKE ? MONTHS.slice(0, 3).concat(MONTHS.slice(100, 102)) : MONTHS) { const m = build(M);
  // L60: revenue growth rank now − 3 months ago
  const r3ago = PANEL.find((x) => x.M === MONTHS[MONTHS.indexOf(M) - 3]);
  for (const [t, x] of m.R) { const now = m.g0r(x.g0), then = r3ago?.R.get(t)?.g0rank; x.g0rank = now; if (FI.has('L60')) x.f[FI.get('L60')] = Number.isFinite(now) && Number.isFinite(then) ? now - then : NaN; }
  PANEL.push(m); if (PANEL.length % 12 === 0) log(`month ${M}: ${m.R.size} eligible`); }
if (SMOKE) { const m = PANEL.at(-1); const cov = FEATS.map((k) => [k, +([...m.R.values()].filter((x) => Number.isFinite(x.f[FI.get(k)])).length / m.R.size).toFixed(2)]); console.log(JSON.stringify({ months: PANEL.length, eligible: PANEL.map((x) => x.R.size), coverage: Object.fromEntries(cov), fwd: Object.fromEntries(Object.entries(m.fwd).map(([k, v]) => [k, v ? v.size : null])) })); process.exit(0); }

// ---------- statistics ----------
const rankArr = (a) => { const o = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); for (let i = 0; i < o.length;) { let k = i; while (k + 1 < o.length && o[k + 1][0] === o[i][0]) k++; const avg = (i + k) / 2; for (let q = i; q <= k; q++) r[o[q][1]] = avg; i = k + 1; } return r; };
const corr = (x, y) => { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; for (let i = 0; i < x.length; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return b > 0 && c > 0 ? a / Math.sqrt(b * c) : NaN; };
const nwT = (s, lag) => { const n = s.length; if (n < 12) return NaN; const m = mean(s), e = s.map((x) => x - m); let v = e.reduce((q, x) => q + x * x, 0) / n; for (let L = 1; L <= lag; L++) { let g = 0; for (let t = L; t < n; t++) g += e[t] * e[t - L]; v += 2 * (1 - L / (lag + 1)) * g / n; } return m / Math.sqrt(v / n); };
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const pval = (t, sign) => (!Number.isFinite(t) ? 1 : sign === '+' ? 1 - Phi(t) : sign === '-' ? Phi(t) : 2 * (1 - Phi(Math.abs(t))));
const bh = (ps, q) => { const o = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]); let kmax = -1; o.forEach(([p], r) => { if (p <= ((r + 1) / o.length) * q) kmax = r; }); const keep = new Set(o.slice(0, kmax + 1).map(([, i]) => i)); return ps.map((_, i) => keep.has(i)); };
const inBuild = (m, o) => m.M >= '2012-01-01' && monthEndAfter(m.M, HZ[o]) <= '2019-12-31', inHold = (m, o) => m.M >= '2020-01-31' && m.fwd[o];
// IC series for a feature/outcome over months; perm = Map(t → t') (placebo), neutral = rank within SIC2, half = 'small'|'large'
function icSeries(fk, o, sel, { perm = null, neutral = false, half = null } = {}) { const fi = FI.get(fk), out = [], q5 = [];
  for (const m of PANEL) { if (!sel(m, o) || !m.fwd[o]) continue; const xs = [], ys = [], gs = [], sz = [];
    for (const [t, y] of m.fwd[o]) { const src = perm ? m.R.get(perm.get(t)) : m.R.get(t); if (!src || !m.R.has(t)) continue; const v = src.f[fi]; if (!Number.isFinite(v)) continue; xs.push(v); ys.push(y); gs.push(m.R.get(t).sic2 ?? '?'); sz.push(m.R.get(t).mcap); }
    if (xs.length < 50) continue;
    let X = rankArr(xs), Y = rankArr(ys);
    if (neutral) { const by = new Map(); X.forEach((r, i) => (by.get(gs[i]) ?? by.set(gs[i], []).get(gs[i])).push(i)); for (const ids of by.values()) { const mu = mean(ids.map((i) => X[i])); for (const i of ids) X[i] -= mu; } }
    if (half) { const md = median(sz), keep = sz.map((s) => (half === 'small' ? s <= md : s > md)); const xi = X.filter((_, i) => keep[i]), yi = Y.filter((_, i) => keep[i]); if (xi.length < 30) continue; X = rankArr(xi); Y = rankArr(yi); }
    const icv = corr(X, Y); if (!Number.isFinite(icv)) continue; out.push(icv); // amendment 1: skip months with no spread
    if (!perm && !neutral && !half) { const ord = xs.map((v, i) => [v, ys[i]]).sort((a, b) => a[0] - b[0]), n5 = Math.floor(ord.length / 5); q5.push(mean(ord.slice(-n5).map((z) => z[1])) - mean(ord.slice(0, n5).map((z) => z[1]))); } }
  return { ic: out, q5 }; }
const LAG = { M1: 1, M3: 3, M6: 6, MV: 6 };
const S1 = REG.map((h) => { const { ic } = icSeries(h.feature, h.outcome, inBuild); const t = nwT(ic, LAG[h.outcome]); return { ...h, ic1: mean(ic), t1: t, n1: ic.length, p1: pval(t, h.sign) }; });
const k1 = bh(S1.map((h) => h.p1), 0.10); S1.forEach((h, i) => { h.stage1 = k1[i]; }); const surv = S1.filter((h) => h.stage1); log(`stage 1: ${surv.length} of ${S1.length}`);
for (const h of surv) { const { ic, q5 } = icSeries(h.feature, h.outcome, inHold); h.dir = h.ic1 > 0 ? '+' : '-'; h.ic2 = mean(ic); h.t2 = nwT(ic, LAG[h.outcome]); h.n2 = ic.length; h.p2 = pval(h.t2, h.dir); h.q5 = mean(q5); }
const k2 = bh(surv.map((h) => h.p2), 0.10); surv.forEach((h, i) => { h.passBH = k2[i] && Math.sign(h.ic2) === Math.sign(h.ic1); });
// own placebo: 20 fixed ticker permutations
const TICK = [...new Set(PANEL.flatMap((m) => [...m.R.keys()]))].sort();
let sd = 12345; const rnd = () => ((sd = (sd * 1103515245 + 12345) % 2147483648) / 2147483648);
const PERMS = Array.from({ length: 20 }, () => { const a = [...TICK]; for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [a[i], a[k]] = [a[k], a[i]]; } return new Map(TICK.map((t, i) => [t, a[i]])); });
for (const h of surv.filter((x) => x.passBH)) { const s = Math.sign(h.ic1), real = s * h.t2, pl = PERMS.map((pm) => s * nwT(icSeries(h.feature, h.outcome, inHold, { perm: pm }).ic, LAG[h.outcome])).filter(Number.isFinite);
  h.placeboBeat = pl.filter((x) => real > x).length; h.placeboN = pl.length; h.placeboMax = Math.max(...pl);
  h.tNeutral = nwT(icSeries(h.feature, h.outcome, inHold, { neutral: true }).ic, LAG[h.outcome]); h.tSmall = nwT(icSeries(h.feature, h.outcome, inHold, { half: 'small' }).ic, LAG[h.outcome]); h.tLarge = nwT(icSeries(h.feature, h.outcome, inHold, { half: 'large' }).ic, LAG[h.outcome]); }
surv.forEach((h) => { h.validated = !!h.passBH && h.placeboBeat >= 19 && h.placeboN === 20; });
// beyond the strongest validated study of the same outcome: monthly regression of outcome rank on both feature ranks
const val = surv.filter((h) => h.validated);
for (const o of new Set(val.map((h) => h.outcome))) { const grp = val.filter((h) => h.outcome === o).sort((a, b) => Math.abs(b.t2) - Math.abs(a.t2)), top = grp[0];
  for (const h of grp.slice(1)) { const coefs = []; for (const m of PANEL) { if (!inHold(m, o)) continue; const rows = []; for (const [t, y] of m.fwd[o]) { const x = m.R.get(t); if (!x) continue; const a = x.f[FI.get(h.feature)], b = x.f[FI.get(top.feature)]; if (Number.isFinite(a) && Number.isFinite(b)) rows.push([a, b, y]); }
      if (rows.length < 50) continue; const A = rankArr(rows.map((r) => r[0])), B = rankArr(rows.map((r) => r[1])), Y = rankArr(rows.map((r) => r[2])), ma = mean(A), mb = mean(B), my = mean(Y);
      let saa = 0, sbb = 0, sab = 0, say = 0, sby = 0; for (let i = 0; i < A.length; i++) { const a = A[i] - ma, b = B[i] - mb, y = Y[i] - my; saa += a * a; sbb += b * b; sab += a * b; say += a * y; sby += b * y; }
      const det = saa * sbb - sab * sab; if (det > 0) coefs.push((sbb * say - sab * sby) / det); }
    h.beyondTop = top.feature; h.tBeyond = nwT(coefs, LAG[o]); } }

// ---------- report ----------
const fx = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—');
const byO = (o) => S1.filter((h) => h.outcome === o);
const L = ['# Stock-finding factory — LONG horizon results', `\nRun ${new Date().toISOString()} · design shadow/DESIGN_stock_factory.md · ${S1.length} studies · ${PANEL.length} month-ends · median ${median(PANEL.map((m) => m.R.size))} eligible stocks per month\n`,
  `**Build 2012–2019 (BH q = 0.10): ${surv.length} of ${S1.length} pass. Holdout 2020–2026 (BH across survivors, same sign, beat ≥ 19/20 own placebos): ${val.length} validated** (${val.filter((h) => h.seen).length} of them use a feature from an earlier design).\n`,
  '| outcome | studies | pass build | validated |', '|---|---|---|---|', ...['M1', 'M3', 'M6', 'MV'].map((o) => `| ${o} | ${byO(o).length} | ${byO(o).filter((h) => h.stage1).length} | ${byO(o).filter((h) => h.validated).length} |`),
  '\n## Validated studies (holdout)\n', '| study | feature | outcome | predicted | build IC (t) | holdout IC (t) | top − bottom fifth (holdout) | own placebos beaten | industry-neutral t | small / large t | beyond strongest (t) | mechanism |', '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...val.sort((a, b) => a.outcome.localeCompare(b.outcome) || Math.abs(b.t2) - Math.abs(a.t2)).map((h) => `| ${h.id}${h.seen ? ' (seen)' : ''} | ${h.definition} | ${h.outcome} | ${h.sign} | ${fx(h.ic1)} (${fx(h.t1, 2)}) | **${fx(h.ic2)} (${fx(h.t2, 2)})** | ${h.outcome === 'MV' ? fx(h.q5 * 100, 1) + ' pts' : fx(h.q5 * 100, 2) + '%'} | ${h.placeboBeat}/${h.placeboN} | ${fx(h.tNeutral, 2)} | ${fx(h.tSmall, 2)} / ${fx(h.tLarge, 2)} | ${h.beyondTop ? `${fx(h.tBeyond, 2)} beyond ${h.beyondTop}` : 'strongest'} | ${h.mechanism} |`),
  '\n## Passed the holdout test but not their own placebo\n', '| study | holdout t | placebos beaten | best placebo t |', '|---|---|---|---|', ...surv.filter((h) => h.passBH && !h.validated).map((h) => `| ${h.id} ${h.definition} | ${fx(h.t2, 2)} | ${h.placeboBeat}/${h.placeboN} | ${fx(h.placeboMax, 2)} |`),
  '\n## Passed build, failed holdout\n', '| study | build IC (t) | holdout IC (t) |', '|---|---|---|', ...surv.filter((h) => !h.passBH).map((h) => `| ${h.id} ${h.definition} | ${fx(h.ic1)} (${fx(h.t1, 2)}) | ${fx(h.ic2)} (${fx(h.t2, 2)}) |`),
  '\nIC = Spearman rank correlation between the feature and the outcome across stocks, averaged over month-ends. Top − bottom fifth = average outcome (excess return; for MV, share of big movers) of the highest-feature fifth minus the lowest fifth.'];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'long_all.json'), JSON.stringify(S1, null, 1)); fs.writeFileSync(path.join(OUT, 'long_summary.md'), L.join('\n') + '\n'); console.log(L.join('\n'));
