// level_map_test.mjs — "Does UW GEX/VEX help map LEVELS?"
// The comparison artifact showed UW & Skylit disagree on the SIGN of dealer gamma ~45% of the time.
// But level-mapping asks a different question: do they agree on WHERE the reaction levels sit
// (king = max|gamma|, the top walls, the biggest vanna magnet)? A level is a level regardless of
// whether one vendor calls it a pin (+) and the other a squeeze (−) — what you MAP is the location.
//
// So for each vendor we compare:
//   signed corr   — do the signed curves agree?           (already known: low, this is the 45%-flip story)
//   |mag| corr    — do the ABSOLUTE magnitudes agree?     (this is "same walls?" — location of the mass)
//   king agree    — same max-|gamma| strike (±1 grid)?    (the single most-hedged level)
//   wall overlap  — Jaccard of each vendor's top-5 |gamma| strikes
//   magnet agree  — same max-|vanna| strike (±1 grid)?
// Restricted to the tradeable window (±8% of spot). Both vendors, same shared strike grid.
import { loadEnvKeysFrom, resolveFromRoot, fetchJson } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
import { GexProvider } from '../providers/gex-skylit.mjs';

const KEY = process.env.UNUSUAL_WHALES_API_KEY;
const TICKERS = (process.argv.slice(2).length ? process.argv.slice(2)
  : ['SPY', 'QQQ', 'IWM', 'NVDA', 'AAPL', 'TSLA', 'AMD', 'GOOGL', 'META', 'AMZN', 'MSFT', 'NFLX', 'AVGO', 'IREN']).map((t) => t.toUpperCase());
const WIN = 0.08; // ±8% of spot = the tradeable level-mapping window
const gexp = new GexProvider();

const pearson = (a, b) => { const n = a.length; if (n < 4) return NaN; const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let nu = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; nu += x * y; da += x * x; db += y * y; } return nu / Math.sqrt(da * db || 1); };
const topN = (ks, f, n) => [...ks].sort((a, b) => Math.abs(f(b)) - Math.abs(f(a))).slice(0, n);
const argmax = (ks, f) => topN(ks, f, 1)[0];
const jaccard = (A, B) => { const a = new Set(A), b = new Set(B); let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };
const uwSurface = async (T) => { const j = await fetchJson(`https://api.unusualwhales.com/api/stock/${T}/greek-exposure/strike`, { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' } }); return new Map(((j && (j.data || j.result)) || []).map((r) => [+r.strike, { g: (+r.call_gex || 0) + (+r.put_gex || 0), v: (+r.call_vanna || 0) + (+r.put_vanna || 0) }])); };

const rows = [];
for (const T of TICKERS) {
  const sk = await gexp.getProfile(T).catch(() => null);
  const uwM = await uwSurface(T).catch(() => null);
  if (!sk || !uwM || !uwM.size) { console.log(`${T.padEnd(6)} skip (no data)`); continue; }
  const spot = sk.spot;
  const skM = new Map(sk.strikes.map((s) => [s.strike, { g: s.gexAgg, v: s.vexAgg }]));
  const ks = [...skM.keys()].filter((k) => uwM.has(k) && Math.abs(k - spot) / spot <= WIN).sort((a, b) => a - b);
  if (ks.length < 6) { console.log(`${T.padEnd(6)} skip (few shared strikes: ${ks.length})`); continue; }

  const skG = (k) => skM.get(k).g, uwG = (k) => uwM.get(k).g, skV = (k) => skM.get(k).v, uwV = (k) => uwM.get(k).v;
  const signG = pearson(ks.map(skG), ks.map(uwG));
  const magG = pearson(ks.map((k) => Math.abs(skG(k))), ks.map((k) => Math.abs(uwG(k))));
  const signV = pearson(ks.map(skV), ks.map(uwV));
  const magV = pearson(ks.map((k) => Math.abs(skV(k))), ks.map((k) => Math.abs(uwV(k))));

  // king = strike of max |gamma|; agree if same strike or one grid-step apart
  const kSk = argmax(ks, skG), kUw = argmax(ks, uwG);
  const gridStep = ks.length > 1 ? Math.min(...ks.slice(1).map((k, i) => k - ks[i])) : 1;
  const kingAgree = Math.abs(kSk - kUw) <= gridStep * 1.01;
  // biggest vanna magnet
  const mSk = argmax(ks, skV), mUw = argmax(ks, uwV);
  const magnetAgree = Math.abs(mSk - mUw) <= gridStep * 1.01;
  // top-5 gamma-wall overlap (locations only, ignore sign)
  const wallOv = jaccard(topN(ks, skG, 5), topN(ks, uwG, 5));

  rows.push({ T, spot: +spot.toFixed(2), n: ks.length, signG, magG, signV, magV, kSk, kUw, kingAgree, mSk, mUw, magnetAgree, wallOv });
  console.log(`${T.padEnd(6)} n=${String(ks.length).padStart(2)} | γ sign ${signG.toFixed(2).padStart(5)}  |γ| ${magG.toFixed(2).padStart(5)} | vanna sign ${signV.toFixed(2).padStart(5)}  |v| ${magV.toFixed(2).padStart(5)} | king ${kingAgree ? 'YES' : 'no '} (${kSk}/${kUw}) | magnet ${magnetAgree ? 'YES' : 'no '} | wall∩ ${(wallOv * 100).toFixed(0)}%`);
}

const med = (xs) => { const a = xs.filter((x) => isFinite(x)).sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
const rate = (xs) => xs.filter(Boolean).length / xs.length;
console.log(`\n=== ACROSS ${rows.length} TICKERS (median unless noted) ===`);
console.log(`signed  gamma corr : ${med(rows.map((r) => r.signG)).toFixed(2)}   ← the "45% sign-flip" story: signed curves barely agree`);
console.log(`|magnitude| γ corr : ${med(rows.map((r) => r.magG)).toFixed(2)}   ← WHERE the walls are: agreement on hedging mass`);
console.log(`signed  vanna corr : ${med(rows.map((r) => r.signV)).toFixed(2)}`);
console.log(`|magnitude| v corr : ${med(rows.map((r) => r.magV)).toFixed(2)}`);
console.log(`king agree (±1 grid): ${(rate(rows.map((r) => r.kingAgree)) * 100).toFixed(0)}%   (${rows.filter((r) => r.kingAgree).length}/${rows.length} same max-|gamma| strike)`);
console.log(`vanna magnet agree  : ${(rate(rows.map((r) => r.magnetAgree)) * 100).toFixed(0)}%   (${rows.filter((r) => r.magnetAgree).length}/${rows.length})`);
console.log(`top-5 wall overlap  : ${(med(rows.map((r) => r.wallOv)) * 100).toFixed(0)}% (median Jaccard of top-5 |gamma| strikes)`);

// emit JSON for the artifact
import fs from 'node:fs';
const agg = {
  n: rows.length,
  signG: +med(rows.map((r) => r.signG)).toFixed(2), magG: +med(rows.map((r) => r.magG)).toFixed(2),
  signV: +med(rows.map((r) => r.signV)).toFixed(2), magV: +med(rows.map((r) => r.magV)).toFixed(2),
  kingRate: Math.round(rate(rows.map((r) => r.kingAgree)) * 100), kingN: rows.filter((r) => r.kingAgree).length,
  magnetRate: Math.round(rate(rows.map((r) => r.magnetAgree)) * 100),
  wallOv: Math.round(med(rows.map((r) => r.wallOv)) * 100),
};
const OUT = '/private/tmp/claude-501/-Users-saiyeeshrathish-the-final-plan/a5088226-4255-42ad-8c1a-63d53449d7a5/scratchpad/level_map_data.json';
fs.writeFileSync(OUT, JSON.stringify({ generated: '2026-08-29', window: '±8% of spot', rows: rows.map((r) => ({ T: r.T, n: r.n, magG: +r.magG.toFixed(2), signG: +r.signG.toFixed(2), magV: +r.magV.toFixed(2), kingAgree: r.kingAgree, wallOv: +(r.wallOv).toFixed(2) })), agg }));
console.log(`\nwrote ${OUT}`);
