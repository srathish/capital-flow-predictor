#!/usr/bin/env node
// Does the dealer gamma regime predict the size of the day's range? (shadow/DESIGN_gamma_range.md)
//   node shadow/gamma_range.mjs [--smoke]     (runs once; --force only for logged audit fixes)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), NIS = path.join(SH, '..'), REPO = path.join(NIS, '..');
const OUT = path.join(SH, 'results_gamma_range'), SMOKE = process.argv.includes('--smoke');
if (!SMOKE && fs.existsSync(path.join(OUT, 'summary.md')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const WF = path.join(REPO, 'apps/gex/research/exit-study/walkforward/cache');

// ---- VIX (FRED VIXCLS, cached) ----
const VF = path.join(NIS, '.cache', 'vix_fred.json');
if (!fs.existsSync(VF)) { await import('../feeds/env.js');
  const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=VIXCLS&observation_start=2025-01-01&file_type=json&api_key=${process.env.FRED_API_KEY}`);
  const j = await r.json(); fs.writeFileSync(VF, JSON.stringify(Object.fromEntries((j.observations ?? []).filter((o) => o.value !== '.').map((o) => [o.date, +o.value])))); }
const VIX = JSON.parse(fs.readFileSync(VF, 'utf8'));

// ---- linear algebra ----
const solve = (A, b) => { const n = A.length, M = A.map((r, i) => [...r, b[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]];
  for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } return M.map((r, i) => r[n] / r[i]); };
const inv = (A) => A.map((_, i) => solve(A, A.map((__, k) => (k === i ? 1 : 0)))).reduce((acc, col, i) => { col.forEach((v, r) => { (acc[r] ??= [])[i] = v; }); return acc; }, []);
// OLS with Driscoll–Kraay / Newey–West SEs: rows {y, x:[...], t: date}
function ols(rows, names, lag = 5) {
  const k = names.length, XtX = Array.from({ length: k }, () => Array(k).fill(0)), Xty = Array(k).fill(0);
  for (const r of rows) for (let a = 0; a < k; a++) { Xty[a] += r.x[a] * r.y; for (let b = 0; b < k; b++) XtX[a][b] += r.x[a] * r.x[b]; }
  const beta = solve(XtX, Xty), Ai = inv(XtX), dates = [...new Set(rows.map((r) => r.t))].sort(), h = new Map(dates.map((d) => [d, Array(k).fill(0)]));
  let ssr = 0, ym = rows.reduce((s, r) => s + r.y, 0) / rows.length, sst = 0;
  for (const r of rows) { const e = r.y - r.x.reduce((s, v, a) => s + v * beta[a], 0); ssr += e * e; sst += (r.y - ym) ** 2; const v = h.get(r.t); for (let a = 0; a < k; a++) v[a] += r.x[a] * e; }
  const H = dates.map((d) => h.get(d)), S = Array.from({ length: k }, () => Array(k).fill(0));
  for (let L = 0; L <= lag; L++) { const w = L === 0 ? 1 : 1 - L / (lag + 1); for (let t = L; t < H.length; t++) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) { const v = H[t][a] * H[t - L][b]; S[a][b] += w * (L === 0 ? v : v + H[t - L][a] * H[t][b]) * (L === 0 ? 1 : 1); } }
  // S above double-adds the symmetric lag terms correctly: L>0 term = w (h_t h_{t-L}' + h_{t-L} h_t')
  const V = Ai.map((r) => names.map((_, b) => r.reduce((s, v, c) => s + v * S[c].reduce((q, w2, d2) => q + w2 * Ai[d2][b], 0), 0)));
  return Object.fromEntries(names.map((n, a) => [n, { b: beta[a], se: Math.sqrt(V[a][a]), t: beta[a] / Math.sqrt(V[a][a]) }]).concat([['_r2', 1 - ssr / sst], ['_n', rows.length]]));
}

// ---- build daily panel ----
function panel(sym) {
  const O = JSON.parse(fs.readFileSync(path.join(WF, `${sym}_ohlc.json`), 'utf8')), days = Object.keys(O).sort(), out = [];
  const rp = (i) => (O[days[i]].high - O[days[i]].low) / O[days[i - 1]].close;
  for (let i = 21; i < days.length; i++) {
    const d = days[i], dp = days[i - 1], gf = path.join(WF, `${sym}_gex_${dp}.json`); if (!fs.existsSync(gf) || VIX[dp] == null) continue;
    const g = JSON.parse(fs.readFileSync(gf, 'utf8')).filter((x) => Number.isFinite(+x.gex) && Number.isFinite(+x.k)); if (!g.length) continue;
    const net = g.reduce((s, x) => s + +x.gex, 0), abs = g.reduce((s, x) => s + Math.abs(+x.gex), 0); if (!(abs > 0)) continue;
    const c1 = O[dp].close, loc = g.filter((x) => Math.abs(+x.k - c1) / c1 <= 0.02), ln = loc.reduce((s, x) => s + +x.gex, 0), la = loc.reduce((s, x) => s + Math.abs(+x.gex), 0);
    let m20 = 0; for (let q = i - 20; q < i; q++) m20 += rp(q); m20 /= 20;
    const rng = rp(i), o = O[d]; if (![rng, m20, rp(i - 1)].every(Number.isFinite)) continue;
    out.push({ sym, d, y: Math.log(rng), B: net / abs, neg: net < 0 ? 1 : 0, Bloc: la > 0 ? ln / la : NaN, prev: Math.log(rp(i - 1)), m20: Math.log(m20), vix: Math.log(VIX[dp]),
      rel: rng / m20, trend: (o.high - o.low) > 0 ? Math.abs(o.close - o.open) / (o.high - o.low) : 0 });
  }
  return out;
}
const P = { SPY: panel('SPY'), QQQ: panel('QQQ') }; // IWM dropped: cached IWM OHLC has close only (amendment 1)
if (SMOKE) { console.log(JSON.stringify({ n: Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.length])), first: P.SPY[0]?.d, last: P.SPY.at(-1)?.d, negDays: Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.filter((r) => r.neg).length])), vixN: Object.keys(VIX).length })); }
if (SMOKE) process.exit(0);

const CTRL = ['prev', 'm20', 'vix'];
const rowsOf = (arr, pred, { fe = true, ctrl = true, y = 'y' } = {}) => { const syms = [...new Set(arr.map((r) => r.sym))];
  return arr.map((r) => ({ t: r.d, y: r[y], x: [1, ...(fe ? syms.slice(1).map((s) => (r.sym === s ? 1 : 0)) : []), r[pred], ...(ctrl ? CTRL.map((c) => r[c]) : [])] })); };
const namesOf = (arr, pred, { fe = true, ctrl = true } = {}) => { const syms = [...new Set(arr.map((r) => r.sym))]; return ['const', ...(fe ? syms.slice(1).map((s) => `fe_${s}`) : []), pred, ...(ctrl ? CTRL : [])]; };
const fit = (arr, pred, opt = {}) => ols(rowsOf(arr, pred, opt), namesOf(arr, pred, opt));

const pooled = [...P.SPY, ...P.QQQ];
const main = fit(pooled, 'B'), spy = fit(P.SPY, 'B'), qqq = fit(P.QQQ, 'B');
const h1 = fit(pooled.filter((r) => r.d < '2026-01-01'), 'B'), h2 = fit(pooled.filter((r) => r.d >= '2026-01-01'), 'B');
const pass = main.B.b < 0 && main.B.t <= -2 && spy.B.b < 0 && qqq.B.b < 0 && h1.B.b < 0 && h2.B.b < 0;

// ---- Skylit intraday secondary ----
const ARCH = path.join(REPO, 'apps/gex/data/skylit-archive/intraday'), UND = path.join(REPO, 'apps/gex/research/exit-study/cache_underlying');
const sky = [];
for (const sym of ['SPY', 'QQQ']) { const O = JSON.parse(fs.readFileSync(path.join(WF, `${sym}_ohlc.json`), 'utf8')), days = Object.keys(O).sort();
  for (const d of fs.existsSync(ARCH) ? fs.readdirSync(ARCH).sort() : []) {
    const gf = path.join(ARCH, d, `${sym}.jsonl.gz`), bf = path.join(UND, `${sym}_${d}.json`), i = days.indexOf(d); if (!fs.existsSync(gf) || !fs.existsSync(bf) || i < 21) continue;
    const boards = zlib.gunzipSync(fs.readFileSync(gf)).toString('utf8').trim().split('\n').map((l) => JSON.parse(l)); if (new Set(boards.map((b) => b.spot)).size <= 1) continue;
    const bd = boards.find((b) => b.requestedTs.startsWith(`${d}T13:35`)); if (!bd) continue;
    const g = (bd.strikes ?? []).filter((k) => Number.isFinite(k.gamma)), net = g.reduce((s, k) => s + k.gamma, 0), abs = g.reduce((s, k) => s + Math.abs(k.gamma), 0); if (!(abs > 0)) continue;
    const j = JSON.parse(fs.readFileSync(bf, 'utf8')), a = Array.isArray(j) ? j : j.data ?? [], start = Date.parse(`${d}T13:35:00Z`);
    const bars = a.filter((x) => x.market_time === 'r' && Date.parse(x.start_time) >= start); if (bars.length < 300) continue;
    const hi = Math.max(...bars.map((x) => +x.high)), lo = Math.min(...bars.map((x) => +x.low)), dp = days[i - 1]; if (VIX[dp] == null) continue;
    const rp = (q) => (O[days[q]].high - O[days[q]].low) / O[days[q - 1]].close; let m20 = 0; for (let q = i - 20; q < i; q++) m20 += rp(q); m20 /= 20;
    sky.push({ sym, d, y: Math.log((hi - lo) / O[dp].close), B: net / abs, prev: Math.log(rp(i - 1)), m20: Math.log(m20), vix: Math.log(VIX[dp]) }); } }


// ---- report ----
const f = (c) => `${c.b >= 0 ? '+' : ''}${c.b.toFixed(3)} (t ${c.t.toFixed(2)})`;
const L = ['# Does the dealer gamma regime predict the size of the day? — results', `\nRun ${new Date().toISOString()} · design shadow/DESIGN_gamma_range.md · UW daily gamma (prior day) → next-day range\n`,
  `Days: SPY ${P.SPY.length}, QQQ ${P.QQQ.length} (${P.SPY[0]?.d} → ${P.SPY.at(-1)?.d}). Negative-net-gamma days: SPY ${P.SPY.filter((r) => r.neg).length}, QQQ ${P.QQQ.filter((r) => r.neg).length}.\n`,
  '## Primary: coefficient on gamma balance B (with controls: prior-day range, 20-day range, VIX)\n', '| sample | B coefficient (t) | n | R² |', '|---|---|---|---|',
  `| **SPY + QQQ pooled** | **${f(main.B)}** | ${main._n} | ${main._r2.toFixed(3)} |`, `| SPY | ${f(spy.B)} | ${spy._n} | ${spy._r2.toFixed(3)} |`, `| QQQ | ${f(qqq.B)} | ${qqq._n} | ${qqq._r2.toFixed(3)} |`,
  `| pooled 2025-07 → 2025-12 | ${f(h1.B)} | ${h1._n} | ${h1._r2.toFixed(3)} |`, `| pooled 2026-01 → 2026-07 | ${f(h2.B)} | ${h2._n} | ${h2._r2.toFixed(3)} |`,
  `\n## Verdict: **${pass ? 'PASS' : 'FAIL'}** (needs pooled B < 0 with t ≤ −2, and B < 0 for SPY, QQQ and both halves)\n`,
  `Controls in the pooled model: prior-day ${f(main.prev)}, 20-day ${f(main.m20)}, VIX ${f(main.vix)}.`];
const ctrlOnly = ols(pooled.map((r) => ({ t: r.d, y: r.y, x: [1, r.sym === 'QQQ' ? 1 : 0, ...CTRL.map((c) => r[c])] })), ['const', 'fe', ...CTRL]);
const noCtrl = fit(pooled, 'B', { ctrl: false });
L.push('\n## Secondary (not used for the verdict)\n', '| check | result |', '|---|---|',
  `| B with NO controls (pooled) | ${f(noCtrl.B)}, R² ${noCtrl._r2.toFixed(3)} |`, `| R² controls only → controls + B | ${ctrlOnly._r2.toFixed(3)} → ${main._r2.toFixed(3)} |`,
  `| sign dummy (net gamma < 0), pooled with controls | ${f(fit(pooled, 'neg').neg)} |`, `| local balance (strikes within ±2%), pooled with controls | ${f(fit(pooled.filter((r) => Number.isFinite(r.Bloc)), 'Bloc').Bloc)} |`,
  `| "short gamma trends": |close−open|/range on B, pooled with controls | ${f(fit(pooled, 'B', { y: 'trend' }).B)} |`);
const terc = (arr) => { const s = [...arr].sort((a, b) => a.B - b.B), n = s.length, m = (a) => a.reduce((q, r) => q + r.rel, 0) / a.length; return [m(s.slice(0, Math.floor(n / 3))), m(s.slice(Math.floor(n / 3), Math.floor((2 * n) / 3))), m(s.slice(Math.floor((2 * n) / 3)))]; };
for (const [k, arr] of [['SPY', P.SPY], ['QQQ', P.QQQ]]) { const t = terc(arr); L.push(`| ${k}: day range ÷ 20-day average, lowest / middle / highest third of B | ${t.map((x) => x.toFixed(2)).join(' / ')} |`); }
if (sky.length > 30) { const s = ols(sky.map((r) => ({ t: r.d, y: r.y, x: [1, r.sym === 'QQQ' ? 1 : 0, r.B, ...CTRL.map((c) => r[c])] })), ['const', 'fe', 'B', ...CTRL]);
  L.push(`| Skylit 0DTE 09:35 balance → 09:35–16:00 range, pooled with controls (${s._n} symbol-days) | ${f(s.B)} |`); }
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'summary.md'), L.join('\n') + '\n'); fs.writeFileSync(path.join(OUT, 'panel.json'), JSON.stringify({ P, sky })); console.log(L.join('\n'));
