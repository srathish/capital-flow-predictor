// formula_test.mjs — which combination of UW's call/put gex+vanna best reproduces Skylit's surface?
// Finds the sign/weighting convention behind Skylit's "calculation on top" (or proves there isn't a simple one).
import { loadEnvKeysFrom, resolveFromRoot, fetchJson } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
import { GexProvider } from '../providers/gex-skylit.mjs';
const KEY = process.env.UNUSUAL_WHALES_API_KEY;
const TICKERS = (process.argv.slice(2).length ? process.argv.slice(2) : ['SPY', 'GOOGL', 'AMD', 'IREN', 'TSLA']).map((t) => t.toUpperCase());
const gex = new GexProvider();
const corr = (a, b) => { const n = a.length; if (n < 3) return NaN; const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; } return num / Math.sqrt(da * db || 1); };

const gexF = { 'c+p': (r) => r.cg + r.pg, 'c-p': (r) => r.cg - r.pg, '-(c+p)': (r) => -(r.cg + r.pg), 'p-c': (r) => r.pg - r.cg };
const vexF = { 'c+p': (r) => r.cv + r.pv, 'c-p': (r) => r.cv - r.pv, '-(c+p)': (r) => -(r.cv + r.pv), 'p-c': (r) => r.pv - r.cv };

for (const T of TICKERS) {
  const sk = await gex.getProfile(T).catch(() => null);
  if (!sk) { console.log(`${T}: no Skylit`); continue; }
  const spot = sk.spot;
  const skMap = new Map(sk.strikes.map((s) => [s.strike, { gex: s.gexAgg, vex: s.vexAgg }]));
  const uwj = await fetchJson(`https://api.unusualwhales.com/api/stock/${T}/greek-exposure/strike`, { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' } });
  const uwMap = new Map(((uwj && (uwj.data || uwj.result)) || []).map((r) => [+r.strike, { cg: +r.call_gex || 0, pg: +r.put_gex || 0, cv: +r.call_vanna || 0, pv: +r.put_vanna || 0 }]));
  const ks = [...skMap.keys()].filter((k) => uwMap.has(k) && Math.abs(k - spot) / spot <= 0.1).sort((a, b) => a - b);
  const sg = ks.map((k) => skMap.get(k).gex), sv = ks.map((k) => skMap.get(k).vex);
  const bestG = Object.entries(gexF).map(([n, f]) => [n, corr(sg, ks.map((k) => f(uwMap.get(k))))]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const bestV = Object.entries(vexF).map(([n, f]) => [n, corr(sv, ks.map((k) => f(uwMap.get(k))))]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  console.log(`\n${T} (${ks.length} strikes ±10%)`);
  console.log(`  GEX best: ${bestG.slice(0, 2).map(([n, c]) => `${n}=${c.toFixed(2)}`).join('  ')}   (all: ${bestG.map(([n, c]) => `${n} ${c.toFixed(2)}`).join(', ')})`);
  console.log(`  VEX best: ${bestV.slice(0, 2).map(([n, c]) => `${n}=${c.toFixed(2)}`).join('  ')}   (all: ${bestV.map(([n, c]) => `${n} ${c.toFixed(2)}`).join(', ')})`);
}
