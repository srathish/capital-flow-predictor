#!/usr/bin/env node
// Node graph (DESIGN_graph.md, locked 0144a94b) — learn lead-lag connections → forecast next-quarter revenue acceleration →
// buy & hold. Walk-forward: connections re-learned every January from data filed before it; test months 2019-01 → 2026-03.
//   node --max-old-space-size=12000 world/graph_model.mjs           (outside nodes = the locked FRED list)
//   node --max-old-space-size=12000 world/graph_model.mjs --extra   (+ rates, dollar, oil, BTC, freight, retail sales — needs an
//                                                                     amendment committed before running)
// Runs once per mode (refuses if the report exists). 0 Skylit credits.
import fs from 'node:fs';
import path from 'node:path';
import { sicToBea, OUTSIDE_BEA, tradeBea } from './sic_bea.mjs';
import { cleanBars, inBad } from './prices_clean.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), G = path.join(C, 'graph'), RES = path.join(ROOT, 'world', 'results_graph');
const RIDGE = process.argv.includes('--ridge'), SMOKE = process.argv.includes('--smoke'), TAG = RIDGE ? 'graph_ridge' : 'graph'; // --smoke: bug check on 2018 (training years), writes nothing
if (!SMOKE && fs.existsSync(path.join(RES, TAG + '.txt')) && !process.argv.includes('--force')) { console.error('already run: ' + TAG); process.exit(1); }
const rd = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const TOP = 20, KEEP = 60, HUBS = 300, MAXC = 10, LAGS = [1, 2, 3, 4], COST = 0.001, DRAWS = SMOKE ? 2 : 200;

// ---------- quarters ----------
const qk = (s) => +s.slice(0, 4) * 4 + (+s.slice(5) - 1), qEnd = (k) => new Date(Date.UTC(Math.floor(k / 4), (k % 4) * 3 + 3, 0)).toISOString().slice(0, 10);
const clip = (x) => Math.max(-1, Math.min(3, x));

// ---------- company nodes ----------
const panel = rd(path.join(G, 'panel.json'));
const CO = new Map(); // t → { rev,gm,capex,inv,rpo: Map k→{v,f} ; g, acc, cxg, ivg, rpg : Map k→{v,f} }
for (const [t, rows] of Object.entries(panel)) { const R = new Map(Object.entries(rows).map(([k, r]) => [qk(k), r]));
  const yoy = (fld, ff) => { const m = new Map(); for (const [k, r] of R) { const p = R.get(k - 4); if (r[fld] > 0 && p?.[fld] > 0) m.set(k, { v: clip(r[fld] / p[fld] - 1), f: [r.f, p.f, r[ff] ?? r.f, p[ff] ?? p.f].sort().at(-1) }); } return m; };
  const g = yoy('rev', 'f'), acc = new Map(); for (const [k, x] of g) { const p = g.get(k - 1); if (p) acc.set(k, { v: x.v - p.v, f: [x.f, p.f].sort().at(-1) }); }
  CO.set(t, { R, g, acc, cxg: yoy('capex', 'fcx'), ivg: yoy('inv', 'finv'), rpg: yoy('rpo', 'frpo') }); }

// ---------- root node: hyperscaler capex ----------
const HYP = ['MSFT', 'GOOGL', 'AMZN', 'META', 'ORCL'], root = new Map();
{ const ks = new Set(HYP.flatMap((t) => [...(CO.get(t)?.R.keys() ?? [])]));
  for (const k of ks) { let a = 0, b = 0, f = '', ok = true; for (const t of HYP) { const r = CO.get(t)?.R, x = r?.get(k), p = r?.get(k - 4); if (!(x?.capex > 0 && p?.capex > 0)) { ok = false; break; } a += x.capex; b += p.capex; f = [f, x.fcx ?? x.f, x.f, p.fcx ?? p.f, p.f].sort().at(-1); }
    if (ok) root.set(k, { v: clip(a / b - 1), f }); } }

// ---------- outside nodes (FRED) ----------
const fred = rd(path.join(G, 'fred.json')), OUT = new Map(); // amendment 2b: monthly series carry first-release YoY (ALFRED); daily prices are unrevised
const qOf = (m) => qk(`${m.slice(0, 4)}Q${Math.floor((+m.slice(5, 7) - 1) / 3) + 1}`);
const fromMonthly = (yoy) => { const qv = new Map(); for (const o of yoy) { const a = qv.get(qOf(o.m)) ?? []; a.push(o); qv.set(qOf(o.m), a); }
  const m = new Map(); for (const [k, a] of qv) if (a.length === 3) m.set(k, { v: clip(mean(a.map((o) => o.g))), f: a.map((o) => o.avail).sort().at(-1) }); return m; };
for (const [id, s] of Object.entries(fred)) {
  if (s.kind === 'monthly') { OUT.set('fred:' + id, fromMonthly(s.yoy.map((o) => ({ ...o, g: s.level ? o.g / 100 : o.g })))); continue; }
  const qv = new Map(); for (const o of s.obs) { const k = qOf(o.d); const a = qv.get(k) ?? []; a.push(o.v); qv.set(k, a); }
  const m = new Map(); for (const [k, a] of qv) { const p = qv.get(k - 4); if (!p) continue; const x = mean(a), y = mean(p);
    const v = s.level ? (x - y) / 100 : y > 0 ? clip(x / y - 1) : null; if (v != null) m.set(k, { v, f: addD(qEnd(k), 1) }); }
  OUT.set('fred:' + id, m); }
for (const [id, s] of Object.entries(rd(path.join(G, 'extra.json'), {}))) { const by = new Map(s.obs.map((o) => [o.m, o])), yoy = []; // WSTS, C30 data centers, bitcoin network
  for (const o of s.obs) { const p = by.get(`${+o.m.slice(0, 4) - 1}${o.m.slice(4)}`); if (p && p.v > 0) yoy.push({ m: o.m, g: o.v / p.v - 1, avail: o.avail }); } OUT.set(id, fromMonthly(yoy)); }
const TRADE = new Map(); for (const [id, s] of Object.entries(rd(path.join(C, 'trade', 'trade.json'), {})?.series ?? {})) { if (!/^(imports|exports):(\d{4}|TOTAL)(:[A-Z]{2})?$/.test(id)) continue; const bea = tradeBea('trade:' + id); if (!bea.length) continue; // amendments 2c + 2e (70 core series)
  const by = new Map(s.obs.map((o) => [o.m, o])), yoy = []; for (const o of s.obs) { const p = by.get(`${+o.m.slice(0, 4) - 1}${o.m.slice(4)}`); if (p && p.v > 0 && o.v > 0) yoy.push({ m: o.m, g: o.v / p.v - 1, avail: o.avail }); }
  const q = fromMonthly(yoy); if (q.size >= 16) { OUT.set('trade:' + id, q); TRADE.set('trade:' + id, bea); } }
// Taiwan monthly revenue by industry (amendment 2): quarterly YoY of matched-company revenue, public the 10th after quarter end
const TWBEA = (k) => /semicon|半導體/i.test(k) ? ['334'] : /computer|電腦/i.test(k) ? ['334'] : /optoelec|光電/i.test(k) ? ['334'] : /communic|通信/i.test(k) ? ['334', '513'] : /electronic (parts|comp)|電子零組件/i.test(k) ? ['334'] : /electronic|電子/i.test(k) ? ['334']
  : /information service|資訊服務/i.test(k) ? ['5415', '514'] : /electric (machin|appl)|電機/i.test(k) ? ['335', '333'] : /cable|電器電纜/i.test(k) ? ['335', '331'] : /plastic|塑膠/i.test(k) ? ['326', '325'] : /chemic|化學/i.test(k) ? ['325'] : /steel|鋼鐵/i.test(k) ? ['331']
  : /auto|汽車/i.test(k) ? ['3361MV'] : /shipping|航運/i.test(k) ? ['483', '481'] : /oil|gas|electric|油電燃氣/i.test(k) ? ['324', '22'] : /bio|生技/i.test(k) ? ['325'] : /bellwether|ai/i.test(k) ? ['334', '335', '5415', '514'] : [];
const TWN = new Map();
{ const tw = rd(path.join(C, 'tw', 'industry_index.json'), {}); const flat = [];
  for (const [k, v] of Object.entries(tw.industries ?? {})) flat.push([k, v]); // amendment 2d: industries + one combined AI-bellwether node
  { const agg = {}; for (const ser of Object.values(tw.bellwethers ?? {})) for (const [m, o] of Object.entries(ser)) { if (!(o?.rev > 0) || o.yoy == null || o.yoy <= -1) continue; const a = (agg[m] ??= { rev: 0, prev: 0 }); a.rev += o.rev; a.prev += o.rev / (1 + o.yoy); }
    flat.push(['ai_bellwethers', Object.fromEntries(Object.entries(agg).filter(([, a]) => a.prev > 0).map(([m, a]) => [m, { rev: a.rev, yoy: a.rev / a.prev - 1 }]))]); }
  for (const [k, mon] of flat) { const bea = TWBEA(k); if (!bea.length) continue; const qv = new Map();
    for (const [m, o] of Object.entries(mon)) { if (m < '2014-01' || !(o?.rev > 0) || o.yoy == null || !Number.isFinite(o.yoy)) continue; const kk = qk(`${m.slice(0, 4)}Q${Math.floor((+m.slice(5, 7) - 1) / 3) + 1}`); const a = qv.get(kk) ?? []; a.push(o); qv.set(kk, a); }
    const q = new Map(); for (const [kk, a] of qv) { if (a.length < 3) continue; const cur = a.reduce((s2, o) => s2 + o.rev, 0), prev = a.reduce((s2, o) => s2 + o.rev / (1 + o.yoy), 0); if (prev > 0) q.set(kk, { v: clip(cur / prev - 1), f: addD(qEnd(kk), 10) }); }
    if (q.size >= 16) { OUT.set('tw:' + k, q); TWN.set('tw:' + k, bea); } } }

// ---------- prices / eligibility ----------
const P = new Map();
for (const t of CO.keys()) { const cb = cleanBars(t), b = cb.bars; if (b.length > 70) P.set(t, { d: b.map((x) => x.d), c: b.map((x) => x.c), v: b.map((x) => x.v || 0), bad: cb.bad }); }
const at = (t, d) => { const p = P.get(t); let lo = 0, hi = p.d.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (p.d[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const eligible = (t, d) => { const p = P.get(t); if (!p) return false; const j = at(t, d); if (j < 64 || p.d[j] < addD(d, -7) || inBad(p.bad, d)) return false; let dv = 0; for (let k = j - 49; k <= j; k++) dv += p.c[k] * p.v[k]; return p.c[j] >= 5 && dv / 50 >= 2e7; };
const mom = (t, d) => { const p = P.get(t), i = at(t, addD(d, -365)), j = at(t, addD(d, -30)); return i >= 0 && j > i ? p.c[j] / p.c[i] - 1 : null; };
const latestQ = (m, d) => { let best = null; for (const [k, x] of m) if (x.f <= d && (!best || k > best)) best = k; return best; };
const known = (m, k, d) => { const x = m?.get(k); return x && x.f <= d ? x.v : null; };
const hardRule = (t, d) => { const c = CO.get(t), kq = latestQ(c.acc, d); if (kq == null) return false; const r = c.R.get(kq - 4); return r?.gm != null && r.gm >= 0 && (r.fgm ?? r.f) <= d; };

// ---------- learning (Amendment 1: industry nodes, connections learned per industry) ----------
function corr(x, y) { const n = x.length; if (n < 3) return 0; const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; a += dx * dy; b += dx * dx; c += dy * dy; } return b && c ? a / Math.sqrt(b * c) : 0; }
const tstat = (r, n) => (n > 2 && Math.abs(r) < 1 ? (r * Math.sqrt(n - 2)) / Math.sqrt(1 - r * r) : 0);
const SIC = new Map(); for (const t of CO.keys()) { const j = rd(path.join(C, 'edgar', 'sic', `${t}.json`)); if (j?.sic) SIC.set(t, { s: String(j.sic).padStart(4, '0').slice(0, 3), desc: j.desc, bea: sicToBea(j.sic) }); }
const IND = new Map(); for (const [t, x] of SIC) { const a = IND.get(x.s) ?? []; a.push(t); IND.set(x.s, a); } for (const [k, a] of [...IND]) if (a.length < 5) IND.delete(k);
const indOf = (t) => (IND.has(SIC.get(t)?.s) ? SIC.get(t).s : null), indDesc = (s) => { const c = new Map(); for (const t of IND.get(s) ?? []) { const d = SIC.get(t).desc; c.set(d, (c.get(d) ?? 0) + 1); } return `SIC ${s}x: ${[...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '?'}`; };
const INDBEA = new Map([...IND].map(([s, a]) => [s, new Set(a.map((t) => SIC.get(t).bea).filter(Boolean))]));
// amendment 2: a driver may connect to a target industry only through a real BEA input-output link (table year = cut-off year − 2)
const USE = rd(path.join(C, 'bea', 'use_summary.json'), {}), allowC = new Map();
function allowed(name, s, cutYear) { const key = name + '|' + s + '|' + cutYear; if (allowC.has(key)) return allowC.get(key);
  const T = INDBEA.get(s) ?? new Set(), D = name.startsWith('ind:') ? INDBEA.get(name.slice(4)) ?? new Set() : new Set(OUTSIDE_BEA[name] ?? TWN.get(name) ?? TRADE.get(name) ?? []);
  let ok = D.has('ALL') || [...D].some((d) => T.has(d)); const U = USE[String(Math.min(+cutYear - 2, 2023))];
  if (!ok && U) for (const t of T) for (const d of D) { const out = U.use[t]?.[d] ?? 0, inp = U.use[d]?.[t] ?? 0; if ((U.rowTotal[t] && out / U.rowTotal[t] >= 0.02) || (U.inter[t] && inp / U.inter[t] >= 0.02)) ok = true; }
  allowC.set(key, ok); return ok; }
function indVal(s, k, d, field) { if (!IND.has(s)) return null; const v = []; for (const t of IND.get(s)) { const x = CO.get(t)[field].get(k); if (x && x.f <= d) v.push(x.v); } if (v.length < 3) return null; v.sort((a, b) => a - b); return v[v.length >> 1]; }
const OWN = [['own:capex', 'cxg'], ['own:inventory', 'ivg'], ['own:backlog', 'rpg']];
function nwT(x, y, lags = 4) { const n = x.length, mx = mean(x), my = mean(y), u = x.map((v) => v - mx); const sxx = u.reduce((a, v) => a + v * v, 0); if (!sxx) return 0; // Newey-West t of the OLS slope
  const b = u.reduce((a, v, i) => a + v * (y[i] - my), 0) / sxx, e = y.map((v, i) => v - my - b * u[i]), g = u.map((v, i) => v * e[i]); let S = g.reduce((a, v) => a + v * v, 0);
  for (let l = 1; l <= lags; l++) { let c = 0; for (let i = l; i < n; i++) c += g[i] * g[i - l]; S += 2 * (1 - l / (lags + 1)) * c; } return S > 0 ? b / (Math.sqrt(S) / sxx) : 0; }
function keepRule(xs, ys, deflate = 1) { const n = xs.length; if (n < 12) return null; const k1 = Math.floor((n * 2) / 3), r = corr(xs, ys), r1 = corr(xs.slice(0, k1), ys.slice(0, k1)), r2 = corr(xs.slice(k1), ys.slice(k1)), t = nwT(xs, ys) / deflate;
  return Math.abs(t) >= 3 && Math.sign(r1) === Math.sign(r) && Math.sign(r2) === Math.sign(r) && Math.abs(r2) >= 0.5 * Math.abs(r1) ? { r, t, n } : null; }
function learn(cut, placeboSeed = null) { // placeboSeed: circularly shift every driver series by 2–6 years (amendment 2 placebo)
  const ks = []; for (let k = qk('2010Q1'); qEnd(k) < cut; k++) ks.push(k); const cutYear = cut.slice(0, 4);
  let ps = placeboSeed ?? 0; const prnd = () => ((ps = (ps * 1103515245 + 12345) % 2147483648) / 2147483648);
  const shift = (m) => { if (placeboSeed == null || m.size < 8) return m; const keys = [...m.keys()].sort((a, b) => a - b), lo = keys[0], span = keys.at(-1) - lo + 1, off = 8 + Math.floor(prnd() * 17); return new Map([...m].map(([k, v]) => [lo + ((k - lo + off) % span), v])); };
  const ser = (m) => new Map([...m].filter(([, x]) => x.f < cut).map(([k, x]) => [k, x.v]));
  const pre = addD(cut, -1); // audit fix #5: strictly before the cut-off, like ser()
  const indG = new Map([...IND.keys()].map((s) => [s, new Map(ks.map((k) => [k, indVal(s, k, pre, 'g')]).filter(([, v]) => v != null))]));
  const indA = new Map([...IND.keys()].map((s) => [s, new Map(ks.map((k) => [k, indVal(s, k, pre, 'acc')]).filter(([, v]) => v != null))]));
  const drivers = [['root:hyperscaler_capex', shift(ser(root))], ...[...OUT].map(([k, m]) => [k, shift(ser(m))]), ...[...indG].map(([s, m]) => ['ind:' + s, shift(m)])];
  const Z = new Map(); for (const [name, m] of drivers) { const v = [...m.values()]; if (v.length < 8) continue; const mu = mean(v), sd = Math.sqrt(mean(v.map((x) => (x - mu) ** 2))) || 1; Z.set(name, { m, mu, sd }); }
  const model = new Map(); let nConn = 0;
  for (const [s, y] of indA) { const yk = [...y.keys()].sort((a, b) => a - b); if (yk.length < 16) continue; const cand = [];
    for (const [name, zz] of Z) { if (name === 'ind:' + s || !allowed(name, s, cutYear)) continue; for (const L of LAGS) { const xs = [], ys = []; for (const k of yk) { const v = zz.m.get(k - L); if (v != null) { xs.push(v); ys.push(y.get(k)); } }
      const kr = keepRule(xs, ys); if (kr) cand.push({ name, L, ...kr, mu: zz.mu, sd: zz.sd }); } }
    const conns = cand.sort((a, b) => Math.abs(b.t) - Math.abs(a.t)).slice(0, 5).map((x) => ({ name: x.name, L: x.L, w: x.r * (x.n / (x.n + 12)), mu: x.mu, sd: x.sd, t: x.t }));
    const own = []; for (const [name, fld] of OWN) { let best = null; for (const L of LAGS) { const S = [];
        for (const t of IND.get(s)) { const c = CO.get(t), xm = shift(ser(c[fld])); const v = [...xm.values()]; if (v.length < 8) continue; const mu = mean(v), sd = Math.sqrt(mean(v.map((q) => (q - mu) ** 2))) || 1;
          for (const [k, a] of c.acc) if (a.f < cut && xm.has(k - L)) S.push([k, (xm.get(k - L) - mu) / sd, a.v]); }
        S.sort((p, q) => p[0] - q[0]); const kr = keepRule(S.map((x) => x[1]), S.map((x) => x[2]), Math.sqrt(3)); if (kr && (!best || Math.abs(kr.t) > Math.abs(best.t))) best = { name, L, w: kr.r, t: kr.t }; }
      if (best) own.push(best); }
    if (conns.length || own.length) { model.set(s, { conns, own }); nConn += conns.length + own.length; } }
  return { model, nConn }; }
// ---------- amendment 3: ridge version (no link selection) ----------
function solve(A, b) { const n = b.length, M = A.map((r, i) => [...r, b[i]]); for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r; [M[i], M[p]] = [M[p], M[i]];
    const d = M[i][i] || 1e-12; for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / d; if (f) for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; } } return M.map((r, i) => r[n] / (r[i] || 1e-12)); }
function ridgeFit(X, y, lam) { const n = X.length, p = X[0]?.length ?? 0, ym = mean(y), yc = y.map((v) => v - ym); if (!p) return { b: [], ym };
  if (p > n) { const K = X.map((a) => X.map((c) => a.reduce((s2, v, j) => s2 + v * c[j], 0))); for (let i = 0; i < n; i++) K[i][i] += lam; const al = solve(K, yc); return { b: Array.from({ length: p }, (_, j) => X.reduce((s2, r, i) => s2 + r[j] * al[i], 0)), ym }; }
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((s2, r) => s2 + r[i] * r[j], 0) + (i === j ? lam : 0))), c = Array.from({ length: p }, (_, j) => X.reduce((s2, r, i) => s2 + r[j] * yc[i], 0)); return { b: solve(A, c), ym }; }
const LAMS = [1, 3, 10, 30, 100, 300], dot = (b, x) => b.reduce((s2, v, j) => s2 + v * x[j], 0);
function ridgePick(X, y) { const n = X.length, k1 = Math.floor((n * 2) / 3); let best = LAMS[2], bm = Infinity;
  if (k1 >= 8 && n - k1 >= 4) for (const lam of LAMS) { const f = ridgeFit(X.slice(0, k1), y.slice(0, k1), lam); const mse = mean(X.slice(k1).map((x, i) => (f.ym + dot(f.b, x) - y[k1 + i]) ** 2)); if (mse < bm) { bm = mse; best = lam; } }
  return { ...ridgeFit(X, y, best), lam: best }; }
function learnRidge(cut, placeboSeed = null) {
  const ks = []; for (let k = qk('2010Q1'); qEnd(k) < cut; k++) ks.push(k); const cutYear = cut.slice(0, 4);
  let ps = placeboSeed ?? 0; const prnd = () => ((ps = (ps * 1103515245 + 12345) % 2147483648) / 2147483648);
  const shift = (m) => { if (placeboSeed == null || m.size < 8) return m; const keys = [...m.keys()].sort((a, b) => a - b), lo = keys[0], span = keys.at(-1) - lo + 1, off = 8 + Math.floor(prnd() * 17); return new Map([...m].map(([k, v]) => [lo + ((k - lo + off) % span), v])); };
  const ser = (m) => new Map([...m].filter(([, x]) => x.f < cut).map(([k, x]) => [k, x.v]));
  const pre = addD(cut, -1); // audit fix #5: strictly before the cut-off, like ser()
  const indG = new Map([...IND.keys()].map((s) => [s, new Map(ks.map((k) => [k, indVal(s, k, pre, 'g')]).filter(([, v]) => v != null))]));
  const indA = new Map([...IND.keys()].map((s) => [s, new Map(ks.map((k) => [k, indVal(s, k, pre, 'acc')]).filter(([, v]) => v != null))]));
  const drivers = [['root:hyperscaler_capex', shift(ser(root))], ...[...OUT].map(([k, m]) => [k, shift(ser(m))]), ...[...indG].map(([s, m]) => ['ind:' + s, shift(m)])];
  const Z = new Map(); for (const [name, m] of drivers) { const v = [...m.values()]; if (v.length < 8) continue; const mu = mean(v), sd = Math.sqrt(mean(v.map((x) => (x - mu) ** 2))) || 1; Z.set(name, { m, mu, sd }); }
  const model = new Map(); let nConn = 0;
  for (const [s, y] of indA) { const yk = [...y.keys()].sort((a, b) => a - b); if (yk.length < 16) continue;
    const feats = []; for (const [name, zz] of Z) if (name !== 'ind:' + s && allowed(name, s, cutYear)) for (const L of LAGS) feats.push({ name, L, mu: zz.mu, sd: zz.sd, m: zz.m });
    if (!feats.length) continue; const X = yk.map((k) => feats.map((f) => { const v = f.m.get(k - f.L); return v == null ? 0 : (v - f.mu) / f.sd; })), Y = yk.map((k) => y.get(k));
    const fit = ridgePick(X, Y); model.set(s, { feats: feats.map(({ name, L, mu, sd }) => ({ name, L, mu, sd })), b: fit.b, ym: fit.ym, lam: fit.lam }); nConn += feats.length; }
  const oX = [], oY = [], oK = []; // pooled own-company ridge
  for (const [t, c] of CO) { const st = OWN.map(([, fld]) => { const v = [...shift(ser(c[fld])).values()]; if (v.length < 8) return null; const mu = mean(v); return { mu, sd: Math.sqrt(mean(v.map((q) => (q - mu) ** 2))) || 1, m: shift(ser(c[fld])) }; });
    if (st.every((x) => !x)) continue; for (const [k, a] of c.acc) { if (a.f >= cut) continue; const x = []; for (const z of st) for (const L of LAGS) { const v = z?.m.get(k - L); x.push(v == null ? 0 : (v - z.mu) / z.sd); } if (x.some((v) => v !== 0)) { oX.push(x); oY.push(a.v); oK.push(k); } } }
  const ord = oK.map((k, i) => [k, i]).sort((p, q) => p[0] - q[0]).map(([, i]) => i), own = oX.length > 50 ? ridgePick(ord.map((i) => oX[i]), ord.map((i) => oY[i])) : null;
  return { model, own, nConn }; }
function forecastRidge(t, d, L, cache) { const s = indOf(t), m = L.model.get(s), c = CO.get(t), kq = latestQ(c.acc, d); if (kq == null || (!m && !L.own)) return null; const kt = kq + 1; let pred = 0;
  if (m) { const x = m.feats.map((f) => { const k = kt - f.L; let v; if (f.name.startsWith('ind:')) { const key = f.name + '|' + k; if (!cache.has(key)) cache.set(key, indVal(f.name.slice(4), k, d, 'g')); v = cache.get(key); } else v = known(f.name === 'root:hyperscaler_capex' ? root : OUT.get(f.name), k, d); return v == null ? 0 : (v - f.mu) / f.sd; }); pred += m.ym + dot(m.b, x); }
  if (L.own) { const x = []; for (const [, fld] of OWN) { const vals = [...c[fld].values()].filter((q) => q.f <= d).map((q) => q.v), mu = vals.length >= 8 ? mean(vals) : 0, sd = vals.length >= 8 ? Math.sqrt(mean(vals.map((q) => (q - mu) ** 2))) || 1 : 1;
      for (const Lg of LAGS) { const v = vals.length >= 8 ? known(c[fld], kt - Lg, d) : null; x.push(v == null ? 0 : (v - mu) / sd); } } pred += dot(L.own.b, x); }
  return { pred, kq, kt, persist: c.acc.get(kq).v, actual: c.acc.get(kt)?.v ?? null }; }
function forecast(t, d, mdl, cache) { const s = indOf(t), m = mdl.get(s); if (!m) return null; const c = CO.get(t), kq = latestQ(c.acc, d); if (kq == null) return null; const kt = kq + 1; let sum = 0, used = 0;
  for (const x of m.conns) { const k = kt - x.L; let v;
    if (x.name.startsWith('ind:')) { const key = x.name + '|' + k; if (!cache.has(key)) cache.set(key, indVal(x.name.slice(4), k, d, 'g')); v = cache.get(key); }
    else v = known(x.name === 'root:hyperscaler_capex' ? root : OUT.get(x.name), k, d);
    if (v == null) continue; sum += x.w * ((v - x.mu) / x.sd); used++; }
  for (const x of m.own) { const fld = OWN.find(([n]) => n === x.name)[1], vals = [...c[fld].values()].filter((q) => q.f <= d).map((q) => q.v), v = known(c[fld], kt - x.L, d); if (v == null || vals.length < 8) continue;
    const mu = mean(vals), sd = Math.sqrt(mean(vals.map((q) => (q - mu) ** 2))) || 1; sum += x.w * ((v - mu) / sd); used++; }
  return used ? { pred: sum, kq, kt, persist: c.acc.get(kq).v, actual: c.acc.get(kt)?.v ?? null } : null; }

// ---------- v5 score (for the comparison) from the same panel ----------
function v5score(ts, d) { const F = []; // audit fix #2: mirrors model_v5.mjs features() exactly (day windows, 200-day freshness, $25M, every value public ≤ d)
  const days = (x, y) => (Date.parse(y) - Date.parse(x)) / 864e5;
  for (const t of ts) { const rows = [...CO.get(t).R.values()].map((r) => ({ e: r.e, rev: r.rev, gm: r.gm ?? null, f: r.gm != null ? [r.f, r.fgm ?? r.f].sort().at(-1) : r.f })).filter((x) => x.f <= d).sort((x, y) => x.e.localeCompare(y.e));
    const q0 = rows.at(-1); if (!q0 || days(q0.e, d) > 200 || q0.rev < 25e6) continue; const find = (ref, lo, hi) => rows.filter((x) => { const dd = days(x.e, ref.e); return dd >= lo && dd <= hi; }).at(-1);
    const q1 = find(q0, 80, 100), q4 = find(q0, 345, 385); if (!q1 || !q4) continue; const q5 = find(q1, 345, 385); if (!q5 || !(q4.rev > 0 && q5.rev > 0) || q0.gm == null || q4.gm == null) continue;
    const g0 = q0.rev / q4.rev - 1; F.push([t, g0, g0 - (q1.rev / q5.rev - 1), q0.gm - q4.gm]); }
  const rk = [1, 2, 3].map((i) => { const s = F.map((x) => x[i]).sort((a, b) => a - b); return (v) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } return lo / (s.length - 1 || 1); }; });
  return new Map(F.map((x) => [x[0], (rk[0](x[1]) + rk[1](x[2]) + rk[2](x[3])) / 3])); }

// ---------- walk-forward ----------
const monthEnds = []; for (let y = 2019; y <= 2026; y++) for (let m = 1; m <= 12; m++) { const mo = `${y}-${String(m).padStart(2, '0')}`; if (mo <= '2026-03') monthEnds.push(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)); }
if (SMOKE) monthEnds.splice(0, monthEnds.length, '2018-06-30', '2018-07-31', '2018-08-31', '2018-09-30');
const spear = (a, b) => { const rk = (x) => { const o = x.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(x.length); for (let i = 0; i < o.length; ) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2; i = j + 1; } return r; }; return corr(rk(a), rk(b)); }; // audit fix #3: average ranks for ties
const learned = new Map(), months = [];
for (const M of monthEnds) { const Y = M.slice(0, 4); if (!learned.has(Y)) { const L = RIDGE ? learnRidge(`${Y}-01-01`) : learn(`${Y}-01-01`); learned.set(Y, L); console.error(`learned ${Y}: ${L.model.size} industries, ${L.nConn} connections`); }
  const LY = learned.get(Y), { model } = LY, elig = [...CO.keys()].filter((t) => eligible(t, M) && hardRule(t, M)), cache = new Map();
  const fc = new Map(); for (const t of elig) { const f = RIDGE ? forecastRidge(t, M, LY, cache) : forecast(t, M, model, cache); if (f) fc.set(t, f); }
  for (const [t, f] of fc) f.ind = indVal(indOf(t), f.kq, M, 'acc');
  const ev = [...fc.values()].filter((f) => f.actual != null), evI = ev.filter((f) => f.ind != null), ic = ev.length > 30 ? spear(ev.map((f) => f.pred), ev.map((f) => f.actual)) : null, icP = ev.length > 30 ? spear(ev.map((f) => f.persist), ev.map((f) => f.actual)) : null;
  const icI = evI.length > 30 ? spear(evI.map((f) => f.ind), evI.map((f) => f.actual)) : null, icGI = evI.length > 30 ? spear(evI.map((f) => f.pred), evI.map((f) => f.actual)) : null;
  const big = new Set(elig.filter((t) => { const p = P.get(t), j = at(t, M); let dv = 0; for (let k = j - 49; k <= j; k++) dv += p.c[k] * p.v[k]; return dv / 50 >= 1e8; }));
  const v5 = v5score(elig, M), mo = new Map(elig.map((t) => [t, mom(t, M)]).filter(([, v]) => v != null));
  months.push({ M, elig, fcKeys: [...fc.keys()], big, ranks: { graph: new Map([...fc].map(([t, f]) => [t, f.pred])), momentum: mo, v5 }, ic, icP, icI, icGI, nfc: fc.size });
  console.error(`${M} elig ${elig.length} · forecasts ${fc.size} · IC ${ic?.toFixed(3)} (persistence ${icP?.toFixed(3)})`); }

// ---------- portfolios (buy top 20, hold while in top 60) ----------
const ret = (t, a, b) => { const p = P.get(t); if (!p) return null; const i = at(t, a) + 1, j = at(t, b) + 1; return i > 0 && j > i && j < p.c.length ? p.c[j] / p.c[i] - 1 : null; };
const medRet = months.slice(0, -1).map((m, i) => { const nxt = months[i + 1].M, v = m.elig.map((t) => ret(t, m.M, nxt)).filter((x) => x != null).sort((a, b) => a - b); return v[v.length >> 1] ?? 0; });
function run(rankOf, log = false, filt = null) { let hold = new Set(); const out = [], trades = [];
  for (let i = 0; i < months.length - 1; i++) { const m = months[i], r = rankOf(m, i); const order = [...r].filter(([t]) => !filt || filt(m, t)).sort((a, b) => b[1] - a[1]).map(([t]) => t), keep = new Set(order.slice(0, KEEP));
    const next = new Set([...hold].filter((t) => keep.has(t))); for (const t of order) { if (next.size >= TOP) break; next.add(t); }
    const bought = [...next].filter((t) => !hold.has(t)), sold = [...hold].filter((t) => !next.has(t));
    if (log) { for (const t of bought) trades.push({ M: m.M, t, side: 'buy' }); for (const t of sold) trades.push({ M: m.M, t, side: 'sell' }); }
    const rs = [...next].map((t) => ret(t, m.M, months[i + 1].M)).filter((x) => x != null), turn = (bought.length + sold.length) / Math.max(1, next.size);
    const pr = rs.length ? mean(rs) - COST * turn : 0; out.push({ M: m.M, r: pr, ex: pr - medRet[i], n: next.size, hold: [...next] }); hold = next; }
  return { out, trades }; }
const G1 = run((m) => m.ranks.graph, true), MO = run((m) => m.ranks.momentum), V5 = run((m) => m.ranks.v5);
const GB = run((m) => m.ranks.graph, false, (m, t) => m.big.has(t)), GS = run((m) => m.ranks.graph, false, (m, t) => !m.big.has(t)), MB = run((m) => m.ranks.momentum, false, (m, t) => m.big.has(t)), MS = run((m) => m.ranks.momentum, false, (m, t) => !m.big.has(t));
const REAL = learned.get(SMOKE ? '2018' : '2019')?.nConn ?? 0, PLAC = RIDGE ? [] : Array.from({ length: SMOKE ? 3 : 20 }, (_, i) => learn(SMOKE ? '2018-01-01' : '2019-01-01', 1000 + i).nConn), placMean = RIDGE ? 0 : mean(PLAC);
// ridge placebo (amendment 3): 20 models with every driver series circularly shifted, re-learned each January; mean IC over 2019–2022 test months
const testM = months.filter((m) => m.M <= (SMOKE ? '2018-12-31' : '2022-12-31')), PIC = [];
if (RIDGE) for (let r = 0; r < (SMOKE ? 2 : 20); r++) { const Ls = new Map(), ics2 = [];
  for (const m of testM) { const Y = m.M.slice(0, 4); if (!Ls.has(Y)) Ls.set(Y, learnRidge(`${Y}-01-01`, 5000 + r)); const cache = new Map(), ev = [];
    for (const t of m.fcKeys) { const f = forecastRidge(t, m.M, Ls.get(Y), cache); if (f?.actual != null) ev.push(f); } if (ev.length > 30) ics2.push(spear(ev.map((f) => f.pred), ev.map((f) => f.actual))); }
  PIC.push(mean(ics2)); console.error(`ridge placebo ${r}: IC ${PIC.at(-1).toFixed(3)}`); }
const pic95 = PIC.length ? [...PIC].sort((a, b) => a - b)[Math.min(PIC.length - 1, Math.floor(PIC.length * 0.95))] : null;
if (!RIDGE) console.error(`placebo connections: ${PLAC.join(' ')} (mean ${placMean.toFixed(1)}) vs real ${REAL}`);
let seed = 4242; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const RAND = Array.from({ length: DRAWS }, () => { const sc = new Map(); return run((m) => new Map(m.elig.map((t) => { if (!sc.has(t)) sc.set(t, rnd()); return [t, sc.get(t)]; }))); }).map((x) => mean(x.out.map((o) => o.ex))).sort((a, b) => a - b); // audit fix #1: persistent random score per ticker

// ---------- report ----------
const pc = (x, d = 1) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`), comp = (a) => a.reduce((s, x) => s * (1 + x), 1) - 1;
const ics = (from, to) => { const a = months.filter((m) => m.M >= from && m.M <= to && m.ic != null), b = a.filter((m) => m.icI != null); return { g: mean(a.map((m) => m.ic)), p: mean(a.map((m) => m.icP)), i: mean(b.map((m) => m.icI)), gi: mean(b.map((m) => m.icGI)), pos: a.filter((m) => m.ic > 0).length / a.length, n: a.length }; };
const A = ics('2019', '2026-12'), Bc = ics('2019', '2022-12-31'), exm = (R, from = '', to = '9') => mean(R.out.filter((o) => o.M >= from && o.M <= to).map((o) => o.ex));
const p95 = RAND[Math.floor(DRAWS * 0.95)];
const crit = [A.g > A.p && A.gi > A.i && A.pos >= 0.6 && Bc.g > Bc.p && Bc.gi > Bc.i && Bc.pos >= 0.6 && (RIDGE ? Bc.g > pic95 : REAL >= 2 * placMean), exm(G1) > exm(MO), exm(G1) > exm(V5), exm(G1) > p95];
const L = [`# Node graph (amendment 2: BEA-linked, Newey-West, placebo, ${OUT.size} outside nodes incl. ${TWN.size} Taiwan, ${TRADE.size} trade) · test months 2019-01 → 2026-03\n`,
  RIDGE ? `Ridge version (amendment 3). Placebo: 2019–2022 mean IC of ${PIC.length} timing-scrambled models — 95th pct ${pic95?.toFixed(3)} (all: ${PIC.map((x) => x.toFixed(3)).join(' ')}) vs real ${Bc.g.toFixed(3)} → ${Bc.g > pic95 ? 'beats placebo' : 'does NOT beat placebo'}\n`
    : `Placebo (2019 cut-off, ${PLAC.length} shuffles): ${placMean.toFixed(1)} connections on average vs ${REAL} real → ${REAL >= 2 * placMean ? 'real ≥ 2× placebo' : 'NOT ≥ 2× placebo'}\n`,
  `Learned connections per year: ${[...learned].map(([y, l]) => `${y} ${l.nConn} (${l.model.size} industries)`).join(' · ')}\n`,
  '## 1. Does it forecast growth? (rank correlation of predicted vs actual next-quarter revenue acceleration)\n',
  '| | graph IC | persistence IC | industry-baseline IC (graph IC on same names) | months graph IC > 0 |', '|---|---|---|---|---|',
  `| 2019–2026 | **${A.g.toFixed(3)}** | ${A.p.toFixed(3)} | ${A.i.toFixed(3)} (${A.gi.toFixed(3)}) | ${(A.pos * 100).toFixed(0)}% of ${A.n} |`, `| 2019–2022 (clean) | **${Bc.g.toFixed(3)}** | ${Bc.p.toFixed(3)} | ${Bc.i.toFixed(3)} (${Bc.gi.toFixed(3)}) | ${(Bc.pos * 100).toFixed(0)}% of ${Bc.n} |`,
  '\n## 2–4. Buy & hold (top 20, hold while in top 60): average monthly return minus the typical stock\n', '| | 2019–2026 | 2019–2022 (clean) | 2023–2026 |', '|---|---|---|---|'];
for (const [n, R] of [['**Node graph**', G1], ['Momentum', MO], ['v5 bottleneck (A)', V5]]) L.push(`| ${n} | ${pc(exm(R), 2)} | ${pc(exm(R, '', '2022-12-31'), 2)} | ${pc(exm(R, '2023'), 2)} |`);
L.push(`| Random, 95th pct of ${DRAWS} | ${pc(p95, 2)} | | |`);
L.push(`| Node graph, $100M+/day names only | ${pc(exm(GB), 2)} | ${pc(exm(GB, '', '2022-12-31'), 2)} | ${pc(exm(GB, '2023'), 2)} |`, `| Node graph, smaller names | ${pc(exm(GS), 2)} | ${pc(exm(GS, '', '2022-12-31'), 2)} | ${pc(exm(GS, '2023'), 2)} |`, `| Momentum, $100M+/day / smaller | ${pc(exm(MB), 2)} / ${pc(exm(MS), 2)} | | |`);
L.push(`\n**Pass:** forecasts growth ${crit[0] ? 'PASS' : 'FAIL'} · beats momentum ${crit[1] ? 'PASS' : 'FAIL'} · beats v5 ${crit[2] ? 'PASS' : 'FAIL'} · beats random ${crit[3] ? 'PASS' : 'FAIL'} → **${crit.every(Boolean) ? 'PASS' : crit[0] ? 'FAIL' : 'FAIL (connections not real; 2–4 not judged)'}**`);
L.push('\n## Year by year (compounded)\n\n| Year | Node graph | Momentum | v5 | Typical stock | Most-held names |\n|---|---|---|---|---|---|');
for (let y = 2019; y <= 2026; y++) { const f = (R) => R.out.filter((o) => o.M.startsWith(String(y))), cnt = new Map(); for (const o of f(G1)) for (const t of o.hold) cnt.set(t, (cnt.get(t) ?? 0) + 1);
  const med = medRet.filter((_, i) => months[i].M.startsWith(String(y)));
  L.push(`| ${y} | **${pc(comp(f(G1).map((o) => o.r)), 0)}** | ${pc(comp(f(MO).map((o) => o.r)), 0)} | ${pc(comp(f(V5).map((o) => o.r)), 0)} | ${pc(comp(med), 0)} | ${[...cnt].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t).join(', ')} |`); }
const yr = learned.get('2026') ?? [...learned.values()].at(-1), show = ['MU', 'NVDA', 'VRT', 'LITE', 'CEG', 'WDC', 'AMD', 'BE'], nm = (n) => n.startsWith('ind:') ? indDesc(n.slice(4)) : n.replace('fred:', '').replace('root:', '');
L.push('\n## Learned connections, latest model (industry ← what it follows, lag in quarters, weight)\n');
for (const t of show) { const s = indOf(t), m = s && yr.model.get(s);
  const parts = !m ? null : RIDGE ? m.feats.map((f, j) => ({ name: f.name, L: f.L, w: m.b[j] })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 6) : [...m.conns, ...m.own];
  L.push(`- **${t}** (${indDesc(s)}) ← ${parts ? parts.map((x) => `${nm(x.name)} (${x.L}q, ${x.w >= 0 ? '+' : ''}${x.w.toFixed(RIDGE ? 3 : 2)})`).join(', ') : 'no connection passed'}`); }
const txt = L.join('\n'); console.log(txt); if (SMOKE) process.exit(0); fs.mkdirSync(RES, { recursive: true }); fs.writeFileSync(path.join(RES, TAG + '.txt'), txt + '\n');
fs.writeFileSync(path.join(RES, TAG + '.json'), JSON.stringify({ months: months.map((m) => ({ M: m.M, ic: m.ic, icP: m.icP, nfc: m.nfc })), graph: G1.out, trades: G1.trades, momentum: MO.out, v5: V5.out, rand95: p95, crit,
  connections: Object.fromEntries([...learned].map(([y, l]) => [y, Object.fromEntries([...l.model].map(([s, m]) => [s, RIDGE ? m.feats.map((f, j) => [f.name, f.L, +m.b[j].toFixed(4)]).sort((a, b) => Math.abs(b[2]) - Math.abs(a[2])).slice(0, 10) : [...m.conns, ...m.own].map((x) => [x.name, x.L, +x.w.toFixed(3)])]))])) }));
