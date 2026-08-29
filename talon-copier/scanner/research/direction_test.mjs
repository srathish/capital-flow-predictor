// direction_test.mjs — "Can UW GEX/VEX at least tell us UP or DOWN next day?"
// Tests the magnet-pull family of directional claims: does spot drift TOWARD the big-gamma / big-vanna
// magnet over the next session? Uses UW historical greek-exposure/strike?date=D (map as-of D's close,
// no lookahead) to predict D+1 direction, checked against real OHLC.
//
// CRITICAL: a bull-tape sample makes "always predict up" look skillful. So the headline metric is
// BALANCED ACCURACY = (hit-rate on up-days + hit-rate on down-days)/2. 0.50 = no directional skill,
// no matter how high the raw hit-rate looks. We also print predUp% and the sample up-rate to expose drift.
import { loadEnvKeysFrom, resolveFromRoot, fetchJson } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);

const KEY = process.env.UNUSUAL_WHALES_API_KEY;
const H = { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' } };
const TICKERS = ['SPY', 'QQQ', 'IWM', 'NVDA', 'AAPL', 'TSLA', 'AMD', 'GOOGL', 'META', 'MSFT'];
const NDAYS = 35;      // trailing sessions to test per ticker
const WIN = 0.10;      // ±10% of spot window for the structure
const api = (p) => fetchJson(`https://api.unusualwhales.com/api/${p}`, H).catch(() => null);
const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

async function ohlc(T) {
  const j = await api(`stock/${T}/ohlc/1d?limit=70`);
  const a = Array.isArray(j) ? j : (j && j.data) || [];
  return a.map((r) => ({ date: String(r.date).slice(0, 10), open: +r.open, close: +r.close }))
    .filter((r) => isFinite(r.open) && isFinite(r.close)).sort((x, y) => x.date < y.date ? -1 : 1);
}
async function mapAsOf(T, date) {
  const j = await api(`stock/${T}/greek-exposure/strike?date=${date}`);
  const rows = (j && (j.data || j.result)) || [];
  return rows.map((r) => ({ k: +r.strike, g: (+r.call_gex || 0) + (+r.put_gex || 0), v: (+r.call_vanna || 0) + (+r.put_vanna || 0) })).filter((r) => isFinite(r.k));
}

// prediction rules: given the map (near-spot) + spot, return predicted next-day direction (+1/-1/0)
function predictions(map, spot) {
  const near = map.filter((r) => Math.abs(r.k - spot) / spot <= WIN);
  if (near.length < 4) return null;
  const posG = near.filter((r) => r.g > 0);
  const kingPos = posG.length ? posG.reduce((a, b) => Math.abs(b.g) > Math.abs(a.g) ? b : a) : null;   // biggest +gamma pin
  const kingAbs = near.reduce((a, b) => Math.abs(b.g) > Math.abs(a.g) ? b : a);                          // biggest |gamma|
  const magnetV = near.reduce((a, b) => Math.abs(b.v) > Math.abs(a.v) ? b : a);                          // biggest |vanna|
  const posSum = posG.reduce((a, r) => a + r.g, 0) || 1;
  const centerPos = posG.reduce((a, r) => a + r.k * r.g, 0) / posSum;                                    // +gamma mass center
  return {
    king_pull: kingPos ? sign(kingPos.k - spot) : 0,      // toward the +gamma pin
    absking_pull: sign(kingAbs.k - spot),                 // toward the biggest-gamma strike
    vanna_pull: sign(magnetV.k - spot),                   // toward the biggest-vanna magnet
    center_pull: posG.length ? sign(centerPos - spot) : 0, // toward the +gamma mass center
  };
}

const acc = {}; // rule -> {up:[correct on up-days], dn:[correct on dn-days], predUp, n}
const bump = (rule, pred, actual) => {
  if (!pred || !actual) return;
  const A = (acc[rule] ||= { upHit: 0, upN: 0, dnHit: 0, dnN: 0, predUp: 0, n: 0 });
  A.n++; if (pred > 0) A.predUp++;
  if (actual > 0) { A.upN++; if (pred === actual) A.upHit++; }
  else { A.dnN++; if (pred === actual) A.dnHit++; }
};

let baseUp = 0, baseN = 0;
for (const T of TICKERS) {
  const bars = await ohlc(T);
  if (bars.length < 6) { console.log(`${T}: no bars`); continue; }
  const idx = []; for (let i = bars.length - 2; i >= 1 && idx.length < NDAYS; i--) idx.push(i);
  idx.reverse();
  const maps = await Promise.all(idx.map((i) => mapAsOf(T, bars[i].date)));
  let used = 0;
  idx.forEach((i, j) => {
    const D = bars[i], N = bars[i + 1], P = bars[i - 1];
    const spot = D.close;
    const preds = predictions(maps[j], spot);
    if (!preds) return;
    const actCC = sign(N.close - D.close);       // close->close next day
    if (actCC === 0) return;
    used++; baseN++; if (actCC > 0) baseUp++;
    for (const [r, p] of Object.entries(preds)) bump(r, p, actCC);
    bump('momentum', sign(D.close - P.close), actCC);  // naive baseline: yesterday's direction
  });
  console.log(`${T.padEnd(6)} ${used} testable sessions`);
}

const bacc = (A) => ((A.upN ? A.upHit / A.upN : 0) + (A.dnN ? A.dnHit / A.dnN : 0)) / 2;
const z = (h, n) => (h - 0.5 * n) / Math.sqrt(0.25 * n); // normal approx for raw hitrate vs 0.5
console.log(`\n=== NEXT-DAY DIRECTION (${baseN} obs across ${TICKERS.length} names) · up-day base rate ${(baseUp / baseN * 100).toFixed(0)}% ===`);
console.log(`rule            n   predUp%  hit%   |  UPday-acc  DNday-acc  BALANCED-ACC   (0.50 = no skill)`);
for (const [r, A] of Object.entries(acc)) {
  const hit = A.upHit + A.dnHit, raw = hit / A.n, ba = bacc(A);
  const zz = z(hit, A.n);
  console.log(`${r.padEnd(14)} ${String(A.n).padStart(3)}  ${(A.predUp / A.n * 100).toFixed(0).padStart(4)}%  ${(raw * 100).toFixed(0).padStart(3)}%  |  ${(A.upHit / (A.upN || 1) * 100).toFixed(0).padStart(4)}%     ${(A.dnHit / (A.dnN || 1) * 100).toFixed(0).padStart(4)}%     ${(ba * 100).toFixed(1).padStart(5)}%${Math.abs(ba - 0.5) < 0.03 ? '  ← noise' : (ba > 0.53 ? '  ← edge?' : '')}`);
}
console.log(`\nBALANCED-ACC is the honest number (skill on up AND down days). Raw hit% rides the bull-tape drift.`);

import fs from 'node:fs';
const summary = Object.fromEntries(Object.entries(acc).map(([r, A]) => [r, { n: A.n, predUpPct: Math.round(A.predUp / A.n * 100), hitPct: Math.round((A.upHit + A.dnHit) / A.n * 100), upAcc: Math.round(A.upHit / (A.upN || 1) * 100), dnAcc: Math.round(A.dnHit / (A.dnN || 1) * 100), balAcc: +(bacc(A) * 100).toFixed(1) }]));
fs.writeFileSync('/private/tmp/claude-501/-Users-saiyeeshrathish-the-final-plan/a5088226-4255-42ad-8c1a-63d53449d7a5/scratchpad/direction_data.json', JSON.stringify({ generated: '2026-08-29', obs: baseN, tickers: TICKERS.length, upRate: Math.round(baseUp / baseN * 100), rules: summary }));
console.log('\nwrote direction_data.json');
