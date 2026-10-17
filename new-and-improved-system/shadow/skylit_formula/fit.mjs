#!/usr/bin/env node
// Which public-input recipe reproduces Skylit's per-strike GEX? Skylit side: replay frames (finished gammaValues per strike × expiration).
// UW side (public API): per-contract open interest + IV (daily /historic) and per-minute ask-/bid-side volume (/intraday); Black-Scholes gamma.
// Fits Skylit value = Σ a_k · feature_k (no intercept) over strikes × expirations × times, and reports R² for nested recipes.
// Usage: node fit.mjs SPY:2026-03-13 SPY:2026-03-04 ...   (no Skylit API calls; UW responses cached in .cache/skylit_formula/)
import fs from 'node:fs';
import os from 'node:os';
import { UW_API_KEY } from '../../feeds/env.js';
const CACHE = new URL('../../.cache/skylit_formula/', import.meta.url); fs.mkdirSync(CACHE, { recursive: true });
const TIMES = [600, 690, 780, 870, 930];
const uw = async (u, key) => { const f = new URL(key + '.json', CACHE); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  for (let a = 0; a < 3; a++) { await new Promise((r) => setTimeout(r, 130)); const r = await fetch('https://api.unusualwhales.com/api' + u, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null); if (r?.ok) { const j = await r.json(); fs.writeFileSync(f, JSON.stringify(j)); return j; } await new Promise((x) => setTimeout(x, 1500)); } return null; };
const et = (iso) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso)); return +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value; };
const phi = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
const bsGamma = (S, K, T, v) => { const d1 = (Math.log(S / K) + 0.5 * v * v * T) / (v * Math.sqrt(T)); return phi(d1) / (S * v * Math.sqrt(T)); };
const occ = (T, exp, cp, K) => `${T}${exp.slice(2, 4)}${exp.slice(5, 7)}${exp.slice(8, 10)}${cp}${String(Math.round(K * 1000)).padStart(8, '0')}`;
// features per (strike, expiry, time): unit = gamma·100·S²·0.01 (dollar gamma per 1% move)
const FEAT = ['oiC', 'oiP', 'netAskC', 'netAskP', 'volC', 'volP', 'cumC', 'cumP'];
const rows = [], uwCmp = [];
for (const arg of process.argv.slice(2)) {
  const [T, d] = arg.split(':'); const J = JSON.parse(fs.readFileSync(`${os.homedir()}/gex-data-replay-reader/data/gex-replay-${d}.json`, 'utf8'));
  const frames = J.frames.map((f) => ({ m: et(f.timestamp), x: f.tickers?.[T] })).filter((f) => f.x?.strikes);
  const at = (m) => frames.find((f) => f.m === m);
  const f0 = at(TIMES[0]); if (!f0) { console.log(arg, 'no frame'); continue; }
  const exps = f0.x.expirations, S0 = f0.x.spotPrice, strikes = f0.x.strikes.filter((k) => Math.abs(k / S0 - 1) <= 0.02);
  console.log(arg, 'expirations', exps.join(' '), 'strikes', strikes.length);
  // UW inputs per contract
  const C = new Map();
  for (const exp of exps) for (const K of strikes) for (const cp of ['C', 'P']) {
    const id = occ(T, exp, cp, K);
    const h = await uw(`/option-contract/${id}/historic`, `hist_${id}`), hr = (h?.chains ?? []).find((r) => r.date === d);
    const it = await uw(`/option-contract/${id}/intraday?date=${d}`, `intra_${id}_${d}`);
    const mins = (it?.data ?? []).map((q) => ({ m: et(q.start_time), a: +q.volume_ask_side || 0, b: +q.volume_bid_side || 0, v: (+q.volume_ask_side || 0) + (+q.volume_bid_side || 0) + (+q.volume_mid_side || 0) + (+q.volume_no_side || 0), iv: (+q.iv_low + +q.iv_high) / 2 })).sort((x, y) => x.m - y.m);
    const cum = (h?.chains ?? []).filter((r) => r.date < d).reduce((s, r) => s + (+r.ask_volume || 0) - (+r.bid_volume || 0), 0);
    C.set(id, { oi: hr ? +hr.open_interest : 0, iv: hr ? +hr.implied_volatility : NaN, mins, cum });
  }
  // UW's own GEX for the same strikes (daily, open-interest based)
  for (const exp of exps) { const e = await uw(`/stock/${T}/greek-exposure/strike-expiry?date=${d}&expiry=${exp}`, `uwgex_${T}_${d}_${exp}`); for (const r of e?.data ?? []) uwCmp.push({ T, d, exp, K: +r.strike, uw: +r.call_gex + +r.put_gex }); }
  for (const m of TIMES) {
    const fr = at(m); if (!fr) continue; const S = fr.x.spotPrice;
    fr.x.strikes.forEach((K, si) => { if (!strikes.includes(K)) return;
      exps.forEach((exp, ei) => {
        const y = fr.x.gammaValues[si]?.[ei]; if (y == null) return;
        const Tyr = Math.max(1e-5, ((Date.parse(exp + 'T00:00:00Z') - Date.parse(d + 'T00:00:00Z')) / 864e5 + (960 - m) / 1440) / 365);
        const f = {};
        for (const cp of ['C', 'P']) { const c = C.get(occ(T, exp, cp, K)); if (!c) return;
          const upto = c.mins.filter((q) => q.m <= m - 1), lastIv = upto.filter((q) => q.iv > 0).at(-1)?.iv;
          const v = Math.min(3, Math.max(0.05, lastIv || c.iv || 0.2)), unit = bsGamma(S, K, Tyr, v) * 100 * S * S * 0.01;
          f['oi' + cp] = c.oi * unit; f['netAsk' + cp] = upto.reduce((s, q) => s + q.a - q.b, 0) * unit; f['vol' + cp] = upto.reduce((s, q) => s + q.v, 0) * unit; f['cum' + cp] = c.cum * unit; }
        rows.push({ T, d, m, K, exp, dte: Math.round((Date.parse(exp) - Date.parse(d)) / 864e5), y, f });
      }); });
  }
}
fs.writeFileSync(new URL('./rows.json', import.meta.url), JSON.stringify(rows));
// least squares (no intercept)
function fit(cols, sel = () => true) {
  const R = rows.filter(sel), sc = 1e8, X = R.map((r) => cols.map((c) => r.f[c] / sc)), y = R.map((r) => r.y / sc), k = cols.length;
  const A = Array.from({ length: k }, () => Array(k + 1).fill(0));
  X.forEach((x, n) => { for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j]; A[i][k] += x[i] * y[n]; } });
  for (let i = 0; i < k; i++) { let p = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r; [A[i], A[p]] = [A[p], A[i]]; for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c]; } }
  const b = A.map((r, i) => r[k] / r[i]), yh = X.map((x) => x.reduce((s, v, i) => s + v * b[i], 0)), my = y.reduce((s, v) => s + v, 0) / y.length;
  const ssr = y.reduce((s, v, i) => s + (v - yh[i]) ** 2, 0), sst = y.reduce((s, v) => s + (v - my) ** 2, 0), sst0 = y.reduce((s, v) => s + v * v, 0);
  return { n: R.length, b, r2: 1 - ssr / sst, r2u: 1 - ssr / sst0 };
}
const corr = (a, b) => { const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n; let x = 0, p = 0, q = 0; for (let i = 0; i < n; i++) { x += (a[i] - ma) * (b[i] - mb); p += (a[i] - ma) ** 2; q += (b[i] - mb) ** 2; } return x / Math.sqrt(p * q); };
const out = [];
const show = (lab, cols, sel) => { const r = fit(cols, sel); const s = `${lab.padEnd(58)} n ${r.n}  R² ${r.r2.toFixed(3)}  coefs ${cols.map((c, i) => c + ' ' + r.b[i].toFixed(3)).join(', ')}`; console.log(s); out.push(s); };
console.log('\n== All expirations ==');
show('M1 open interest, calls + / puts − (fixed weights)', ['oiC', 'oiP']);
show('M2 + today\'s buyer-minus-seller volume', ['oiC', 'oiP', 'netAskC', 'netAskP']);
show('M3 + today\'s total volume', ['oiC', 'oiP', 'volC', 'volP']);
show('M4 all six', FEAT.slice(0, 6));
show('M5 flow only: prior days + today, buyer minus seller', ['cumC', 'cumP', 'netAskC', 'netAskP']);
show('M6 everything', FEAT);
for (const [lab, sel] of [['0DTE only', (r) => r.dte === 0], ['later expirations', (r) => r.dte > 0]]) { console.log(`\n== ${lab} ==`); show('M1', ['oiC', 'oiP'], sel); show('M2', ['oiC', 'oiP', 'netAskC', 'netAskP'], sel); show('M3', ['oiC', 'oiP', 'volC', 'volP'], sel); show('M4', FEAT.slice(0, 6), sel); show('M5 flow only', ['cumC', 'cumP', 'netAskC', 'netAskP'], sel); show('M6', FEAT, sel); }
// fixed textbook recipe (no fitting): calls +, puts −, weight 1
const fx = rows.map((r) => r.f.oiC - r.f.oiP), sy = rows.map((r) => r.y);
console.log(`\nTextbook (calls +, puts −, open interest, no fitting): corr with Skylit ${corr(fx, sy).toFixed(3)}; sign agreement ${(rows.filter((r, i) => Math.sign(fx[i]) === Math.sign(r.y) && r.y !== 0).length / rows.filter((r) => r.y !== 0).length * 100).toFixed(0)}%`);
// Skylit (first time, summed over expirations) vs UW's own daily GEX
const sk = new Map(); for (const r of rows.filter((r) => r.m === TIMES[0])) sk.set(`${r.T}${r.d}${r.exp}${r.K}`, r.y);
const pr = uwCmp.map((u) => [u.uw, sk.get(`${u.T}${u.d}${u.exp}${u.K}`)]).filter((p) => p[1] != null);
console.log(`Skylit (10:00) vs UW's own greek-exposure GEX, same strike+expiry: n ${pr.length} corr ${corr(pr.map((p) => p[0]), pr.map((p) => p[1])).toFixed(3)} | |size| corr ${corr(pr.map((p) => Math.abs(p[0])), pr.map((p) => Math.abs(p[1]))).toFixed(3)} | sign agreement ${(pr.filter((p) => Math.sign(p[0]) === Math.sign(p[1])).length / pr.length * 100).toFixed(0)}%`);
// does Skylit move intraday more than open-interest-only gamma would (spot and time change only)?
const chg = []; const key = (r) => `${r.T}${r.d}${r.exp}${r.K}`, first = new Map(rows.filter((r) => r.m === TIMES[0]).map((r) => [key(r), r]));
for (const r of rows.filter((r) => r.m === TIMES.at(-1))) { const a = first.get(key(r)); if (a) chg.push({ dy: r.y - a.y, dOI: (r.f.oiC - r.f.oiP) - (a.f.oiC - a.f.oiP), dFlow: (r.f.netAskC + r.f.netAskP) - (a.f.netAskC + a.f.netAskP), dVol: (r.f.volC + r.f.volP) - (a.f.volC + a.f.volP) }); }
console.log(`Change 10:00→15:30 in Skylit vs: open-interest gamma change corr ${corr(chg.map((c) => c.dy), chg.map((c) => c.dOI)).toFixed(3)} | net buyer flow corr ${corr(chg.map((c) => c.dy), chg.map((c) => c.dFlow)).toFixed(3)} | total volume corr ${corr(chg.map((c) => c.dy), chg.map((c) => c.dVol)).toFixed(3)} (n ${chg.length})`);
fs.writeFileSync(new URL('./results.txt', import.meta.url), out.join('\n') + '\n');
// out-of-sample: fit the flow-only recipe on every other ticker-day, predict this one with those fixed weights
const DAYS = [...new Set(rows.map((r) => r.T + ':' + r.d))], M5 = ['cumC', 'cumP', 'netAskC', 'netAskP'];
if (DAYS.length > 1) { console.log('\n== Out of sample (weights fit on the OTHER days) ==');
  for (const D of DAYS) { const w = fit(M5, (r) => r.T + ':' + r.d !== D), te = rows.filter((r) => r.T + ':' + r.d === D);
    const yh = te.map((r) => M5.reduce((s, c, i) => s + r.f[c] / 1e8 * w.b[i], 0) * 1e8), y = te.map((r) => r.y), my = y.reduce((s, v) => s + v, 0) / y.length;
    const r2 = 1 - y.reduce((s, v, i) => s + (v - yh[i]) ** 2, 0) / y.reduce((s, v) => s + (v - my) ** 2, 0);
    const k0 = (sel) => { const t0 = te.filter(sel); if (!t0.length) return '—'; const byM = new Map(); for (const [i, r] of te.entries()) if (sel(r)) { const a = byM.get(r.m) ?? []; a.push([r.K, r.y, yh[i]]); byM.set(r.m, a); }
      let hit = 0, n = 0; for (const a of byM.values()) { const agg = new Map(); for (const [K, y1, y2] of a) { const g = agg.get(K) ?? [0, 0]; g[0] += y1; g[1] += y2; agg.set(K, g); } const ks = [...agg.entries()]; const ka = ks.reduce((p, q) => Math.abs(q[1][0]) > Math.abs(p[1][0]) ? q : p)[0], kb = ks.reduce((p, q) => Math.abs(q[1][1]) > Math.abs(p[1][1]) ? q : p)[0]; n++; if (ka === kb) hit++; } return `${hit}/${n}`; };
    console.log(`${D.padEnd(16)} R² ${r2.toFixed(3)} | corr ${corr(y, yh).toFixed(3)} | same king (summed over 5 expirations) at ${k0(() => true)} of the 5 times`); } }
