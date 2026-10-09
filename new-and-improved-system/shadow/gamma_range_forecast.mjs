#!/usr/bin/env node
// Next-session range forecast from the validated gamma-regime model (shadow/DESIGN_gamma_range.md, PASS 2026-10-09).
// Fits the same pooled model (y = ln(range/prev close) ~ B + prior-day range + 20-day range + ln VIX, symbol effect) on the
// frozen panel in results_gamma_range/panel.json, then applies it to the latest UW close data. Forecast only — no trading.
//   node shadow/gamma_range_forecast.mjs [YYYY-MM-DD of the last close]
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), NIS = path.join(SH, '..');
const { P } = JSON.parse(fs.readFileSync(path.join(SH, 'results_gamma_range', 'panel.json'), 'utf8'));
const uw = async (p) => { const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }); if (!r.ok) throw new Error(`${p} ${r.status}`); const j = await r.json(); return j.data ?? j; };
const solve = (A, b) => { const n = A.length, M = A.map((r, i) => [...r, b[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]];
  for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } return M.map((r, i) => r[n] / r[i]); };

// ---- fit on the frozen panel ----
const rows = [...P.SPY, ...P.QQQ], X = rows.map((r) => [1, r.sym === 'QQQ' ? 1 : 0, r.B, r.prev, r.m20, r.vix]), k = 6;
const XtX = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => X.reduce((s, x) => s + x[a] * x[b], 0))), Xty = Array.from({ length: k }, (_, a) => X.reduce((s, x, i) => s + x[a] * rows[i].y, 0));
const beta = solve(XtX, Xty), resid = rows.map((r, i) => r.y - X[i].reduce((s, v, a) => s + v * beta[a], 0)), sd = Math.sqrt(resid.reduce((s, e) => s + e * e, 0) / (rows.length - k));

// ---- latest data ----
const VF = path.join(NIS, '.cache', 'vix_fred.json');
{ const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=VIXCLS&observation_start=2025-01-01&file_type=json&api_key=${process.env.FRED_API_KEY}`);
  const j = await r.json(); if (j.observations) fs.writeFileSync(VF, JSON.stringify(Object.fromEntries(j.observations.filter((o) => o.value !== '.').map((o) => [o.date, +o.value])))); }
const VIXF = JSON.parse(fs.readFileSync(VF, 'utf8'));
const L = [];
for (const sym of ['SPY', 'QQQ']) {
  const bars = (await uw(`/stock/${sym}/ohlc/1d?timeframe=3M`)).map((r) => ({ d: r.date, o: +r.open, h: +r.high, l: +r.low, c: +r.close })).filter((b) => b.d && b.h > 0).sort((a, b) => a.d.localeCompare(b.d));
  const asOf = process.argv[2] ?? bars.at(-1).d, i = bars.findIndex((b) => b.d === asOf); if (i < 21) throw new Error(`no bar for ${asOf}`);
  const rp = (q) => (bars[q].h - bars[q].l) / bars[q - 1].c; let m20 = 0; for (let q = i - 19; q <= i; q++) m20 += rp(q); m20 /= 20;
  const g = (await uw(`/stock/${sym}/greek-exposure/strike?date=${asOf}`)).map((r) => ({ k: +r.strike, gex: +r.call_gex + +r.put_gex })).filter((r) => Number.isFinite(r.k) && Number.isFinite(r.gex));
  const net = g.reduce((s, x) => s + x.gex, 0), abs = g.reduce((s, x) => s + Math.abs(x.gex), 0), B = net / abs, c = bars[i].c;
  let vix = VIXF[asOf], vixSrc = 'FRED'; if (vix == null) { // Cboe's free daily file (same values as FRED, published sooner); UW needs a Cboe licence for VIX
    const t = await (await fetch('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv', { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
    const [m, d, y] = [asOf.slice(5, 7), asOf.slice(8, 10), asOf.slice(0, 4)], row = t.split('\n').find((l) => l.startsWith(`${m}/${d}/${y},`)); if (row) { vix = +row.split(',')[4]; vixSrc = 'Cboe'; } }
  if (vix == null) throw new Error(`no VIX close for ${asOf}`);
  const x = [1, sym === 'QQQ' ? 1 : 0, B, Math.log(rp(i)), Math.log(m20), Math.log(vix)], yhat = x.reduce((s, v, a) => s + v * beta[a], 0);
  const mid = Math.exp(yhat), lo = Math.exp(yhat - sd), hi = Math.exp(yhat + sd), pctB = P[sym].filter((r) => r.B <= B).length / P[sym].length;
  L.push({ sym, asOf, close: c, B, pctB, vix, vixSrc, m20, prev: rp(i), mid, lo, hi });
}
const pc = (x) => (x * 100).toFixed(2) + '%';
const out = [`# Next-session range forecast (gamma-regime model) — based on the ${L[0].asOf} close\n`, `Model fit on ${rows.length} symbol-days (2025-08-08 → 2026-07-10). Band = ±1 residual s.d. (≈ 68% of days). Size only — not direction.\n`,
  '| | close | gamma balance B (percentile in sample) | VIX | 20-day avg range | forecast range | ≈ 68% band | forecast in $ | forecast ÷ 20-day avg |', '|---|---|---|---|---|---|---|---|---|',
  ...L.map((r) => `| ${r.sym} | ${r.close.toFixed(2)} | ${r.B.toFixed(3)} (${(r.pctB * 100).toFixed(0)}th) | ${r.vix.toFixed(2)} (${r.vixSrc}) | ${pc(r.m20)} | **${pc(r.mid)}** | ${pc(r.lo)} – ${pc(r.hi)} | $${(r.mid * r.close).toFixed(2)} ($${(r.lo * r.close).toFixed(2)}–$${(r.hi * r.close).toFixed(2)}) | ${(r.mid / r.m20).toFixed(2)}× |`)];
fs.mkdirSync(path.join(SH, 'results_gamma_range', 'forecasts'), { recursive: true }); fs.writeFileSync(path.join(SH, 'results_gamma_range', 'forecasts', `${L[0].asOf}.md`), out.join('\n') + '\n');
console.log(out.join('\n'));
