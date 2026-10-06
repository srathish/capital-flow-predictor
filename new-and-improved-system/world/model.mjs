#!/usr/bin/env node
// WORLD MODEL engine — implements world/DESIGN.md v1.1 exactly. 0 Skylit credits (cached EDGAR + UW data only).
//   node world/model.mjs            → DEVELOPMENT period only (month-ends 2023-01 → 2024-12)
//   node world/model.mjs --holdout  → the single pre-registered HOLDOUT run (2025-01 → 2026-03). Run once.
//   node world/model.mjs --live     → today's top 20 (logged to world/live/<date>.json for forward scoring)
import fs from 'node:fs';
import path from 'node:path';
import { worldUniverse } from './collect.mjs';
import { CONCEPTS } from './edgar_exposure.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache');
const MODE = process.argv.includes('--holdout') ? 'holdout' : process.argv.includes('--live') ? 'live' : 'dev';
const DRAWS = 10000, TOP = 20, FWD_DAYS = 182;
const rd = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10);
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// ---------- load ----------
const U = worldUniverse();
const P = new Map(); // ticker → {d[], c[], v[]}
for (const { t } of U) {
  let b = rd(path.join(C, 'wdaily', `${t}.json`), []);
  if (!b.length) b = rd(path.join(C, 'daily', `${t}.json`), []).map((x) => ({ d: ymd(x.t), o: x.o, h: x.h, l: x.l, c: x.c, v: x.v }));
  if (b.length > 70) P.set(t, { d: b.map((x) => x.d), c: b.map((x) => x.c), v: b.map((x) => x.v || 0) });
}
const T = [...P.keys()], N = T.length, idx = new Map(T.map((t, i) => [t, i]));
const at = (t, d) => { const p = P.get(t); let lo = 0, hi = p.d.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (p.d[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const META = new Map(T.map((t) => [t, rd(path.join(C, 'edgar', 'meta', `${t}.json`), null)]));
const EXPO = [...rd(path.join(C, 'edgar', 'exposure.json'), []), ...rd(path.join(C, 'edgar', 'exposure_add.json'), [])].filter((r) => idx.has(r.t));
const CONS = rd(path.join(C, 'edgar', 'constraints.json'), []).filter((r) => idx.has(r.t));
const LINKS = rd(path.join(C, 'edgar', 'links.json'), []).filter((r) => idx.has(r.from) && idx.has(r.to));
const EARN = new Map(T.map((t) => [t, (rd(path.join(C, 'uw', 'earnings', `${t}.json`), []) || []).filter((e) => e.actual_eps != null && e.street_mean_est != null && e.report_date)]));
const AN = new Map(T.map((t) => [t, rd(path.join(C, 'uw', 'analyst', `${t}.json`), []) || []]));
const SA = rd(path.join(C, 'edgar', 'sa_13f.json'), []);
const CI = new Map(CONCEPTS.map((c, i) => [c, i])), NC = CONCEPTS.length;
const BIG = [...new Set(LINKS.map((r) => r.to))], BI = new Map(BIG.map((t, i) => [t, i])), NB = BIG.length;
console.error(`universe ${N} with prices · exposure rows ${EXPO.length} · constraint rows ${CONS.length} · link rows ${LINKS.length} · big nodes ${NB} · mode ${MODE}`);

// ---------- per-date features ----------
const zs = (arr) => { const v = arr.filter(Number.isFinite); if (v.length < 10) return arr.map(() => null); const m = v.reduce((a, x) => a + x, 0) / v.length, s = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)) || 1; return arr.map((x) => (Number.isFinite(x) ? Math.max(-3, Math.min(3, (x - m) / s)) : null)); };
// eligible = price ≥ $5, 50-day dollar volume ≥ $20M, operating company (SEC industry code; ETFs/funds have none)
function eligible(d) { const e = new Uint8Array(N); for (let i = 0; i < N; i++) { const p = P.get(T[i]), j = at(T[i], d); if (j < 64) continue; const px = p.c[j]; let dv = 0; for (let k = Math.max(0, j - 49); k <= j; k++) dv += p.c[k] * p.v[k]; dv /= Math.min(50, j + 1); if (px >= 5 && dv >= 2e7 && META.get(T[i])?.sic) e[i] = 1; } return e; }
const ret = (t, a, b) => { const i = at(t, a), j = at(t, b); return i >= 0 && j > i ? P.get(t).c[j] / P.get(t).c[i] - 1 : null; };
function shocks(d, E) { // DESIGN §2: mean of available z(surprise, revisions, mom1, mom3)
  const sur = new Array(N).fill(null), rev = new Array(N).fill(null), m1 = new Array(N).fill(null), m3 = new Array(N).fill(null);
  for (let i = 0; i < N; i++) { if (!E[i]) continue; const t = T[i];
    const e = EARN.get(t).filter((x) => (x.report_date < d || (x.report_date === d && x.report_time === 'premarket')) && x.report_date > addD(d, -120)).sort((a, b) => b.report_date.localeCompare(a.report_date))[0];
    if (e) { const j = at(t, e.report_date); if (j >= 0) sur[i] = (+e.actual_eps - +e.street_mean_est) / P.get(t).c[j]; }
    const prev = {}; let up = 0, dn = 0; for (const a of [...AN.get(t)].sort((x, y) => x.ts.localeCompare(y.ts))) { const dd = a.ts.slice(0, 10); if (dd > d) break; const pt = prev[a.firm]; if (dd > addD(d, -60) && a.target && pt) { if (a.target > pt) up++; else if (a.target < pt) dn++; } if (a.target) prev[a.firm] = a.target; }
    rev[i] = up - dn; m1[i] = ret(t, addD(d, -30), d); m3[i] = ret(t, addD(d, -91), d); }
  const Z = [zs(sur), zs(rev), zs(m1), zs(m3)], z = new Float64Array(N);
  for (let i = 0; i < N; i++) { const v = Z.map((a) => a[i]).filter((x) => x != null); z[i] = E[i] && v.length ? v.reduce((a, x) => a + x, 0) / v.length : 0; }
  return z;
}
function filingsCount(t, a, b) { const m = META.get(t); if (!m) return null; return m.filings.filter((f) => f.d > a && f.d <= b && ['10-K', '10-Q', '8-K', '20-F', '6-K', '40-F'].includes(f.f)).length; }
function exposure(d, E) { // DESIGN §1: share of filings in the trailing year mentioning the concept, × concept specificity (idf)
  const a = addD(d, -365), X = new Float64Array(N * NC), cnt = new Map();
  for (const r of EXPO) { if (r.d <= a || r.d > d) continue; const k = `${r.t}|${r.c}`; cnt.set(k, (cnt.get(k) ?? 0) + 1); }
  const tot = new Float64Array(N); for (let i = 0; i < N; i++) tot[i] = filingsCount(T[i], a, d) ?? 0;
  for (const [k, n] of cnt) { const [t, c] = k.split('|'), i = idx.get(t), j = CI.get(c); if (i == null || j == null || !E[i]) continue; X[i * NC + j] = Math.min(1, n / Math.max(tot[i] || n, 1)); }
  const ne = E.reduce((a, x) => a + x, 0);
  for (let j = 0; j < NC; j++) { let has = 0; for (let i = 0; i < N; i++) if (X[i * NC + j] > 0) has++; const idf = Math.log(ne / (1 + has)); for (let i = 0; i < N; i++) X[i * NC + j] *= Math.max(0, idf); }
  return X;
}
function links(d, E) { const a = addD(d, -365), L = new Float64Array(N * NB), cnt = new Map();
  for (const r of LINKS) { if (r.d <= a || r.d > d) continue; const k = `${r.from}|${r.to}`; cnt.set(k, (cnt.get(k) ?? 0) + 1); }
  for (const [k, n] of cnt) { const [f, t] = k.split('|'), i = idx.get(f), j = BI.get(t); if (i == null || j == null || !E[i]) continue; const tot = filingsCount(f, a, d) || n; L[i * NB + j] = Math.min(1, n / tot); }
  return L; }
function bottleneck(d, E) { const a = addD(d, -365), cnt = new Float64Array(N); for (const r of CONS) { if (r.d <= a || r.d > d) continue; cnt[idx.get(r.t)]++; }
  const share = Array.from({ length: N }, (_, i) => (E[i] ? cnt[i] / Math.max(1, filingsCount(T[i], a, d) || cnt[i] || 1) : null));
  const v = share.filter((x) => x != null).sort((x, y) => x - y); return share.map((x) => (x == null ? 0 : v.findIndex((y) => y >= x) / Math.max(1, v.length - 1))); }

// ---------- Monte Carlo propagation (DESIGN §3) ----------
let seed = 20261005; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function simulate(d, E) {
  const X = exposure(d, E), L = links(d, E), lagD = [d, addD(d, -91), addD(d, -182)];
  const G = [], H = [], Bc = new Float64Array(NC);
  for (let i = 0; i < N; i++) for (let j = 0; j < NC; j++) Bc[j] += X[i * NC + j];
  for (const ld of lagD) { const Elag = eligible(ld), z = shocks(ld, Elag), A = new Float64Array(NC);
    for (let i = 0; i < N; i++) for (let j = 0; j < NC; j++) A[j] += X[i * NC + j] * z[i];
    const g = new Float64Array(N * NC); for (let i = 0; i < N; i++) for (let j = 0; j < NC; j++) { const e = X[i * NC + j]; if (!e) continue; const den = Bc[j] - e; g[i * NC + j] = den > 1e-9 ? e * (A[j] - e * z[i]) / den : 0; } // leave-one-out
    const zb = new Float64Array(NB); for (const [t, j] of BI) { const i = idx.get(t); zb[j] = i != null ? z[i] : 0; }
    const h = new Float64Array(N * NB); for (let i = 0; i < N; i++) for (let j = 0; j < NB; j++) h[i * NB + j] = L[i * NB + j] * zb[j];
    G.push(g); H.push(h); }
  const hits = new Float64Array(N), mean = new Float64Array(N), w = new Float64Array(NC), u = new Float64Array(NB), I = new Float64Array(N), S2 = new Float64Array(NC);
  for (let k = 0; k < DRAWS; k++) {
    for (let j = 0; j < NC; j++) w[j] = Math.exp(0.5 * gauss()); for (let j = 0; j < NB; j++) u[j] = Math.exp(0.5 * gauss());
    const lag = Math.min(2, Math.floor(rnd() * 3)), g = G[lag], h = H[lag], damp = 0.2 + 0.4 * rnd();
    S2.fill(0);
    for (let i = 0; i < N; i++) { if (!E[i]) { I[i] = 0; continue; } let s = 0; const o = i * NC; for (let j = 0; j < NC; j++) s += g[o + j] * w[j]; const ob = i * NB; for (let j = 0; j < NB; j++) s += h[ob + j] * u[j]; I[i] = s; for (let j = 0; j < NC; j++) S2[j] += X[o + j] * s; }
    for (let j = 0; j < NC; j++) S2[j] = Bc[j] > 0 ? S2[j] / Bc[j] : 0;
    let m = 0, n = 0; for (let i = 0; i < N; i++) { if (!E[i]) continue; let s2 = 0; const o = i * NC; for (let j = 0; j < NC; j++) s2 += X[o + j] * w[j] * S2[j]; I[i] += damp * s2; m += I[i]; n++; }
    m /= n; let v = 0; for (let i = 0; i < N; i++) if (E[i]) v += (I[i] - m) ** 2; const sd = Math.sqrt(v / (n - 1)) || 1;
    for (let i = 0; i < N; i++) if (E[i]) { mean[i] += I[i]; if (I[i] > m + sd) hits[i]++; }
  }
  const drivers = (i) => { const g = G[0], o = i * NC; return CONCEPTS.map((c, j) => [c, g[o + j]]).sort((a, b) => b[1] - a[1]).slice(0, 3).filter((x) => x[1] > 0).map((x) => x[0]); };
  return { p: Array.from(hits, (x) => x / DRAWS), mean: Array.from(mean, (x) => x / DRAWS), drivers };
}

// ---------- baselines + scoring ----------
const THEMES = { aiCompute: 'NVDA AMD AVGO MRVL ARM', memory: 'MU SNDK WDC STX', semiEquip: 'AMAT LRCX ASML KLAC TER', foundry: 'TSM INTC GFS', optical: 'ANET CIEN COHR LITE CRDO AAOI GLW', servers: 'DELL SMCI HPE', neocloud: 'CRWV NBIS IREN APLD CORZ WULF CIFR', power: 'CEG VST NRG GEV', nuclear: 'OKLO SMR CCJ NNE LEU UEC', aiSoftware: 'PLTR NOW CRM SNOW DDOG', cyber: 'PANW CRWD ZS NET FTNT OKTA', crypto: 'COIN MSTR HOOD', miners: 'MARA RIOT CLSK HUT', space: 'RKLB ASTS LUNR PL', quantum: 'IONQ RGTI QBTS', ev: 'TSLA RIVN LCID', banks: 'JPM BAC WFC C GS MS', oil: 'XOM CVX COP OXY HAL', pharma: 'LLY NVO MRK JNJ', consumer: 'WMT COST TGT HD' };
const norm = (s) => s.toUpperCase().replace(/[.,]/g, '').replace(/\b(INC|CORP|CORPORATION|LTD|PLC|HOLDINGS?|CO|CLASS [A-Z]|COM|NEW|LIMITED|GROUP|TECHNOLOGIES|TECHNOLOGY|MFG|MINING)\b/g, '').replace(/\s+/g, ' ').trim();
const nameIdx = U.map((x) => ({ t: x.t, n: norm(x.name ?? '') }));
const saTicker = (h) => h.ticker && idx.has(h.ticker) ? h.ticker : nameIdx.find((x) => x.n && (x.n === norm(h.name) || norm(h.name).startsWith(x.n) || x.n.startsWith(norm(h.name))))?.t ?? null;
function month(d) {
  const E = eligible(d), fwdEnd = addD(d, FWD_DAYS), live = MODE === 'live';
  const fwd = new Array(N).fill(null); if (!live) for (let i = 0; i < N; i++) if (E[i]) { const p = P.get(T[i]), j = at(T[i], d) + 1, k = at(T[i], fwdEnd); fwd[i] = j > 0 && j < p.c.length && k > j ? p.c[k] / p.c[j] - 1 : null; } // entry = NEXT session's close (tradable)
  const fv = fwd.filter((x) => x != null).sort((a, b) => a - b), med = fv.length ? fv[fv.length >> 1] : 0;
  const ex = (i) => (fwd[i] == null ? null : fwd[i] - med), avg = (ids) => { const v = ids.map(ex).filter((x) => x != null); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };
  const sim = simulate(d, E), z = shocks(d, E), bott = bottleneck(d, E);
  const r3 = T.map((t, i) => (E[i] ? ret(t, addD(d, -91), d) : null)), sorted3 = r3.filter((x) => x != null).sort((a, b) => a - b);
  const pct3 = r3.map((x) => (x == null ? 1 : sorted3.findIndex((y) => y >= x) / Math.max(1, sorted3.length - 1)));
  const elig = T.map((_, i) => i).filter((i) => E[i]);
  const s10 = elig.map((i) => [i, sim.p[i] * (1 - pct3[i])]), s11 = elig.map((i) => [i, sim.p[i] * (1 - pct3[i]) * (1 + bott[i])]);
  const top = (arr) => [...arr].sort((a, b) => b[1] - a[1]).slice(0, TOP).map((x) => x[0]);
  const m10 = top(s10), m11 = top(s11);
  // baselines
  const r121 = elig.map((i) => [i, ret(T[i], addD(d, -365), addD(d, -30))]).filter((x) => x[1] != null), bMom = top(r121);
  const bShock = top(elig.map((i) => [i, z[i]]));
  const pool = elig.map((i) => r3[i]).filter((x) => x != null); let hotMembers = [];
  for (const v of Object.values(THEMES)) { const mem = v.split(' ').filter((t) => idx.has(t) && E[idx.get(t)]); if (mem.length < 3) continue; const r = mem.reduce((a, t) => a + r3[idx.get(t)], 0) / mem.length; let below = 0; for (let k = 0; k < 2000; k++) { let s = 0; for (let j = 0; j < mem.length; j++) s += pool[Math.floor(rnd() * pool.length)]; if (s / mem.length < r) below++; } if (below / 2000 >= 0.95) hotMembers.push(...mem.map((t) => idx.get(t))); }
  const bTheme = top(hotMembers.map((i) => [i, r3[i]]));
  const q = [...SA].filter((x) => x.filed <= d).at(-1); const bSA = q ? [...new Set(q.holdings.filter((h) => !h.putCall).map(saTicker).filter((t) => t && E[idx.get(t)]).map((t) => idx.get(t)))] : [];
  const sic2 = (i) => (META.get(T[i])?.sic ?? '').slice(0, 2); const bySic = {}; for (const i of elig) (bySic[sic2(i)] ??= []).push(i);
  let rnds = []; for (let k = 0; k < 1000; k++) { const pick = m10.map((i) => { const g = bySic[sic2(i)] ?? elig; return g[Math.floor(rnd() * g.length)]; }); const a = avg(pick); if (a != null) rnds.push(a); }
  // IC (Spearman) score vs forward
  const ic = (pairs) => { const pr = pairs.filter(([i]) => fwd[i] != null); if (pr.length < 30) return null; const rk = (a) => { const o = a.map((v, k) => [v, k]).sort((x, y) => x[0] - y[0]), r = Array(a.length); o.forEach(([, k], n) => (r[k] = n)); return r; }; const a = rk(pr.map((x) => x[1])), b = rk(pr.map(([i]) => fwd[i])), n = pr.length, mm = (n - 1) / 2; let num = 0, da = 0, db = 0; for (let k = 0; k < n; k++) { num += (a[k] - mm) * (b[k] - mm); da += (a[k] - mm) ** 2; db += (b[k] - mm) ** 2; } return num / Math.sqrt(da * db); };
  const pick = (ids) => ids.map((i) => ({ t: T[i], ex: ex(i), drivers: sim.drivers(i), p: +sim.p[i].toFixed(3), pct3: +pct3[i].toFixed(2), bott: +bott[i].toFixed(2) }));
  return { d, eligible: elig.length, model10: avg(m10), model11: avg(m11), mom: avg(bMom), shock: avg(bShock), theme: avg(bTheme), sa: avg(bSA), saN: bSA.length, random: rnds.length ? rnds.reduce((a, x) => a + x, 0) / rnds.length : null,
    ic10: ic(s10), ic11: ic(s11), picks10: pick(m10), picks11: pick(m11) };
}

// ---------- run ----------
const monthEnds = (a, b) => { const out = []; let [y, m] = a.split('-').map(Number); for (;;) { const d = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); if (d > b) break; out.push(d); m++; if (m > 12) { m = 1; y++; } } return out; };
const lastTD = (d) => { const p = P.get('SPY') ?? P.get(T[0]); let j = at(P.has('SPY') ? 'SPY' : T[0], d); return p.d[j]; };
const OUTD = path.join(ROOT, 'world', 'results'); fs.mkdirSync(OUTD, { recursive: true });
if (MODE === 'live') {
  const d = lastTD(new Date().toISOString().slice(0, 10)), r = month(d), f = path.join(ROOT, 'world', 'live', `${d}.json`);
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(r, null, 1));
  console.log(`# World model — top ${TOP} as of ${d} (v1.1, bottleneck-weighted). Score 6 months later.\n`);
  for (const p of r.picks11) console.log(`- ${p.t.padEnd(5)} hit-prob ${p.p} · 3m-move pct ${p.pct3} · bottleneck ${p.bott} · drivers: ${p.drivers.join(', ')}`);
} else {
  const ARG = (k) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : null; };
  const [a, b] = ARG('from') ? [ARG('from'), ARG('to')] : MODE === 'holdout' ? ['2025-01-01', '2026-03-31'] : ['2023-01-01', '2024-12-31']; // --from/--to = recent months for the live conviction list
  if (!ARG('from') && MODE === 'holdout' && fs.existsSync(path.join(OUTD, 'holdout.json')) && !process.argv.includes('--i-know')) { console.error('HOLDOUT already run once — refusing (DESIGN §6). Read world/results/holdout.json.'); process.exit(1); }
  const rows = []; for (const me of monthEnds(a, b)) { const d = lastTD(me); const t0 = Date.now(); const r = month(d); rows.push(r); console.error(`${d} elig ${r.eligible} · model ${fmt(r.model11)} / ${fmt(r.model10)} · mom ${fmt(r.mom)} · shock ${fmt(r.shock)} · theme ${fmt(r.theme)} · SA ${fmt(r.sa)} (${r.saN}) · rnd ${fmt(r.random)} · IC ${r.ic11?.toFixed(3)} · ${((Date.now() - t0) / 1000).toFixed(0)}s`); }
  fs.writeFileSync(path.join(OUTD, ARG('from') ? `range_${a}_${b}.json` : `${MODE}.json`), JSON.stringify(rows, null, 1));
  const st = (k) => { const v = rows.map((r) => r[k]).filter((x) => x != null); const m = v.reduce((a, x) => a + x, 0) / v.length, s = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, v.length - 1)); return { m, t: m / (s / Math.sqrt(v.length)), n: v.length }; };
  console.log(`\n=== WORLD MODEL · ${MODE.toUpperCase()} ${a} → ${b} · ${rows.length} month-ends · top-${TOP} 6-month excess vs universe median ===`);
  for (const [k, name] of [['model11', 'MODEL v1.1 (bottleneck)'], ['model10', 'MODEL v1.0'], ['mom', 'momentum 12-1'], ['shock', 'shock only (no graph)'], ['theme', 'hot theme'], ['sa', 'copy Situational Awareness 13F'], ['random', 'random same-sector']]) { const s = st(k); console.log(`  ${name.padEnd(32)} ${fmt(s.m).padStart(8)}  (t ${Number.isFinite(s.t) ? s.t.toFixed(2) : '-'}, n ${s.n})`); }
  for (const k of ['ic11', 'ic10']) { const s = st(k); console.log(`  IC ${k === 'ic11' ? 'v1.1' : 'v1.0'} mean ${s.m.toFixed(3)} (t ${s.t.toFixed(2)})`); }
  if (MODE === 'holdout') { const m = st('model11').m, m0 = st('model10').m, bases = ['mom', 'shock', 'theme', 'sa', 'random'].map((k) => st(k).m).filter(Number.isFinite);
    const sym = {}; for (const r of rows) for (const p of r.picks11) if (p.ex != null) { (sym[p.t] ??= []).push(p.ex); }
    const w = Object.values(sym).filter((v) => v.reduce((a, x) => a + x, 0) > 0).length, l = Object.values(sym).length - w;
    for (const [nm, mm, ick] of [['v1.1', m, 'ic11'], ['v1.0', m0, 'ic10']]) { const pass = bases.every((x) => mm > x) && st(ick).m > 0 && st(ick).t >= 2 && w > l; console.log(`  VERDICT ${nm}: ${pass ? 'PASS' : 'FAIL'} (beats all baselines: ${bases.every((x) => mm > x)}, IC t ≥ 2: ${st(ick).t >= 2}, symbols W/L ${w}/${l})`); } }
}
function fmt(x) { return x == null || !Number.isFinite(x) ? '-' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%'; }
