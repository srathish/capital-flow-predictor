// compare_single_expiry.mjs — Skylit vs UW on the SAME single expiry (apples-to-apples for the doctrine).
import { loadEnvKeysFrom, resolveFromRoot } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
import { GexProvider } from '../providers/gex-skylit.mjs';
import { GexProviderUW } from '../providers/gex-uw.mjs';

const EXP = process.env.EXP || '2026-09-18';
const TICKERS = (process.argv.slice(2).length ? process.argv.slice(2) : ['GOOGL', 'SPY', 'TSLA', 'AMD', 'NVDA']).map((t) => t.toUpperCase());
const corr = (a, b) => { const n = a.length; if (n < 3) return NaN; const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; } return num / Math.sqrt(da * db || 1); };
const skg = new GexProvider(), uwg = new GexProviderUW();

console.log(`Single-expiry comparison @ ${EXP}\n`);
for (const T of TICKERS) {
  const [sk, uw] = await Promise.all([skg.getProfile(T).catch(() => null), uwg.getProfile(T, { expiry: EXP }).catch(() => null)]);
  if (!sk || !uw) { console.log(`${T}: ${!sk ? 'no Skylit' : 'no UW'}`); continue; }
  const spot = sk.spot;
  const skMap = new Map(sk.strikes.map((s) => [s.strike, { g: s.perExpiry?.[EXP] || 0, v: s.perExpiryVanna?.[EXP] || 0 }]));
  const uwMap = new Map(uw.strikes.map((s) => [s.strike, { g: s.gexAgg, v: s.vexAgg }]));
  const near = (k, b = 0.1) => Math.abs(k - spot) / spot <= b;
  const ks = [...skMap.keys()].filter((k) => uwMap.has(k) && near(k) && (skMap.get(k).g || uwMap.get(k).g)).sort((a, b) => a - b);
  if (ks.length < 4) { console.log(`${T}: too few aligned strikes`); continue; }
  const S = ks.map((k) => skMap.get(k).g), U = ks.map((k) => uwMap.get(k).g), SV = ks.map((k) => skMap.get(k).v), UV = ks.map((k) => uwMap.get(k).v);
  const sign = ks.filter((_, i) => Math.sign(S[i]) === Math.sign(U[i])).length / ks.length;
  const king = (m) => { const e = [...m.entries()].filter(([k]) => near(k)); return e.length ? e.sort((a, b) => Math.abs(b[1].g) - Math.abs(a[1].g))[0][0] : '—'; };
  const netsign = (a) => (a.reduce((x, y) => x + y, 0) >= 0 ? '+' : '−');
  console.log(`${T.padEnd(6)} (${ks.length} strikes)  GEXcorr ${corr(S, U).toFixed(2)}  VEXcorr ${corr(SV, UV).toFixed(2)}  sign-agree ${(sign * 100).toFixed(0)}%  king Sk ${king(skMap)}/UW ${king(uwMap)} ${king(skMap) === king(uwMap) ? '✓' : '✗'}  net Sk${netsign(S)}/UW${netsign(U)}`);
}
