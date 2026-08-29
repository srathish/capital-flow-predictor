// transform_fit.mjs — is there a TRANSFORM T(UW greeks) ≈ Skylit? Fit Skylit_gex ~ b1*call_gex + b2*put_gex
// (least squares, per-ticker-normalized) PER ticker and POOLED. If per-ticker R² is high but the coefficients
// differ wildly, there is no generalizable transform. If pooled R² is high with stable coeffs, there IS one.
import { loadEnvKeysFrom, resolveFromRoot, fetchJson } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
import { GexProvider } from '../providers/gex-skylit.mjs';
const KEY = process.env.UNUSUAL_WHALES_API_KEY;
const TICKERS = (process.argv.slice(2).length ? process.argv.slice(2) : ['SPY', 'AMD', 'GOOGL', 'TSLA', 'NVDA', 'IREN']).map((t) => t.toUpperCase());
const gexp = new GexProvider();

// solve 2x2 least squares  y ~ b1*x1 + b2*x2  (no intercept; data is centered-ish by normalization)
function fit2(x1, x2, y) {
  let s11 = 0, s22 = 0, s12 = 0, s1y = 0, s2y = 0, syy = 0;
  const n = y.length;
  for (let i = 0; i < n; i++) { s11 += x1[i] * x1[i]; s22 += x2[i] * x2[i]; s12 += x1[i] * x2[i]; s1y += x1[i] * y[i]; s2y += x2[i] * y[i]; syy += y[i] * y[i]; }
  const det = s11 * s22 - s12 * s12 || 1e-9;
  const b1 = (s22 * s1y - s12 * s2y) / det, b2 = (s11 * s2y - s12 * s1y) / det;
  let ssr = 0; for (let i = 0; i < n; i++) { const e = y[i] - b1 * x1[i] - b2 * x2[i]; ssr += e * e; }
  return { b1, b2, r2: 1 - ssr / (syy || 1) };
}

const pool = { cg: [], pg: [], y: [] };
console.log('per-ticker fit  Skylit_gex ~ b1·call_gex + b2·put_gex  (normalized per ticker)\n');
for (const T of TICKERS) {
  const sk = await gexp.getProfile(T).catch(() => null);
  const uwj = await fetchJson(`https://api.unusualwhales.com/api/stock/${T}/greek-exposure/strike`, { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' } });
  if (!sk || !uwj) { console.log(`${T}: skip`); continue; }
  const spot = sk.spot;
  const skM = new Map(sk.strikes.map((s) => [s.strike, s.gexAgg]));
  const uwM = new Map(((uwj.data || uwj.result) || []).map((r) => [+r.strike, { cg: +r.call_gex || 0, pg: +r.put_gex || 0 }]));
  const ks = [...skM.keys()].filter((k) => uwM.has(k) && Math.abs(k - spot) / spot <= 0.1).sort((a, b) => a - b);
  if (ks.length < 6) { console.log(`${T}: few strikes`); continue; }
  const nrm = (arr) => { const m = Math.max(...arr.map(Math.abs)) || 1; return arr.map((x) => x / m); };
  const y = nrm(ks.map((k) => skM.get(k))), cg = nrm(ks.map((k) => uwM.get(k).cg)), pg = nrm(ks.map((k) => uwM.get(k).pg));
  const f = fit2(cg, pg, y);
  console.log(`${T.padEnd(6)} b1=${f.b1.toFixed(2).padStart(6)}  b2=${f.b2.toFixed(2).padStart(6)}  R²=${f.r2.toFixed(2)}`);
  cg.forEach((_, i) => { pool.cg.push(cg[i]); pool.pg.push(pg[i]); pool.y.push(y[i]); });
}
const pf = fit2(pool.cg, pool.pg, pool.y);
console.log(`\nPOOLED (one transform for all)  b1=${pf.b1.toFixed(2)}  b2=${pf.b2.toFixed(2)}  R²=${pf.r2.toFixed(2)}   ← generalizable transform quality`);
