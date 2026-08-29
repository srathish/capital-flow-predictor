// gather_compare_data.mjs — pull Skylit + UW GEX/VEX per shared strike (near spot) for the artifact.
import { loadEnvKeysFrom, resolveFromRoot, fetchJson } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
import { GexProvider } from '../providers/gex-skylit.mjs';
import fs from 'node:fs';
const KEY = process.env.UNUSUAL_WHALES_API_KEY;
const OUT = '/private/tmp/claude-501/-Users-saiyeeshrathish-the-final-plan/a5088226-4255-42ad-8c1a-63d53449d7a5/scratchpad/compare_data.json';
const TICKERS = ['SPY', 'GOOGL', 'AMD', 'TSLA', 'NVDA', 'IREN'];
const gexp = new GexProvider();
const corr = (a, b) => { const n = a.length; if (n < 3) return NaN; const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let nu = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; nu += x * y; da += x * x; db += y * y; } return nu / Math.sqrt(da * db || 1); };
const out = { generated: '2026-08-29', asof: '2026-08-28 close', tickers: [] };
let totFlip = 0, totN = 0;
for (const T of TICKERS) {
  const sk = await gexp.getProfile(T).catch(() => null);
  const uwj = await fetchJson(`https://api.unusualwhales.com/api/stock/${T}/greek-exposure/strike`, { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' } });
  if (!sk || !uwj) { console.log(`${T}: skip`); continue; }
  const spot = sk.spot;
  const skM = new Map(sk.strikes.map((s) => [s.strike, { g: s.gexAgg, v: s.vexAgg }]));
  const uwM = new Map(((uwj.data || uwj.result) || []).map((r) => [+r.strike, { g: (+r.call_gex || 0) + (+r.put_gex || 0), v: (+r.call_vanna || 0) + (+r.put_vanna || 0) }]));
  const ks = [...skM.keys()].filter((k) => uwM.has(k)).sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, 22).sort((a, b) => a - b);
  const mx = (f) => Math.max(...ks.map((k) => Math.abs(f(k)))) || 1;
  const mSkG = mx((k) => skM.get(k).g), mUwG = mx((k) => uwM.get(k).g), mSkV = mx((k) => skM.get(k).v), mUwV = mx((k) => uwM.get(k).v);
  const strikes = ks.map((k) => {
    const sg = skM.get(k).g, ug = uwM.get(k).g, sv = skM.get(k).v, uv = uwM.get(k).v;
    return { k, skGex: sg, uwGex: ug, skVex: sv, uwVex: uv, skGexN: sg / mSkG, uwGexN: ug / mUwG, skVexN: sv / mSkV, uwVexN: uv / mUwV, flip: Math.sign(sg) !== Math.sign(ug) };
  });
  const flips = strikes.filter((s) => s.flip).length;
  totFlip += flips; totN += strikes.length;
  out.tickers.push({ ticker: T, spot: +spot.toFixed(2), n: strikes.length, flips, gexCorr: +corr(strikes.map((s) => s.skGex), strikes.map((s) => s.uwGex)).toFixed(2), vexCorr: +corr(strikes.map((s) => s.skVex), strikes.map((s) => s.uwVex)).toFixed(2), strikes });
  console.log(`${T}: ${strikes.length} strikes, ${flips} sign-flips`);
}
out.headline = { totStrikes: totN, totFlips: totFlip, flipPct: Math.round(totFlip / totN * 100) };
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`\nwrote ${out.tickers.length} tickers · ${totFlip}/${totN} (${out.headline.flipPct}%) strikes disagree on sign → ${OUT}`);
