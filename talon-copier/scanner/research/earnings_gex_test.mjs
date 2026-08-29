// earnings_gex_test.mjs — could UW's PRE-PRINT GEX/VEX have called this week's earnings moves?
// For each name: read the surface as-of the close BEFORE the print, derive a structural lean (regime =
// magnitude/amplify-suppress; vanna-magnet direction = crude directional lean), compare to the ACTUAL move.
import { loadEnvKeysFrom, resolveFromRoot, fetchJson } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
import { FlowProvider } from '../providers/flow-uw.mjs';
const KEY = process.env.UNUSUAL_WHALES_API_KEY;
const B = 'https://api.unusualwhales.com/api/';
const uw = (p) => fetchJson(B + p, { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' } }).catch(() => null);
const flow = new FlowProvider();

// this week's liquid earnings (ticker, YYYY-MM-DD, pre|post) + implied move %
const E = [
  ['NVDA', '2026-08-26', 'post'], ['CRM', '2026-08-26', 'post'], ['CRWD', '2026-08-26', 'post'],
  ['SNPS', '2026-08-26', 'post'], ['OKTA', '2026-08-26', 'post'], ['NTNX', '2026-08-26', 'post'],
  ['HPQ', '2026-08-26', 'post'], ['MRVL', '2026-08-27', 'post'], ['IREN', '2026-08-27', 'post'],
  ['WDAY', '2026-08-27', 'post'], ['AFRM', '2026-08-27', 'post'], ['RBRK', '2026-08-27', 'post'],
  ['INTU', '2026-08-25', 'post'], ['SMTC', '2026-08-25', 'post'], ['ZM', '2026-08-25', 'post'],
  ['S', '2026-08-27', 'post'], ['ANF', '2026-08-26', 'pre'], ['DG', '2026-08-27', 'pre'],
];

const rows = (j) => (Array.isArray(j) ? j : (j && (j.data || j.result))) || [];
const results = [];
for (const [T, d, when] of E) {
  const oh = await flow.getDailyOHLC(T, { limit: 30 }).catch(() => []);
  if (!oh.length) { console.log(`${T}: no ohlc`); continue; }
  const i = oh.findIndex((r) => r.date >= d);
  if (i < 1 || i >= oh.length) continue;
  // reaction + the date whose CLOSE precedes the print
  let react, preDate, spot;
  if (when === 'post') { if (!oh[i + 1]) continue; react = oh[i + 1].close / oh[i].close - 1; preDate = oh[i].date; spot = oh[i].close; }
  else { react = oh[i].close / oh[i - 1].close - 1; preDate = oh[i - 1].date; spot = oh[i - 1].close; }
  // implied move % for the print (from upcoming-earnings snapshot pulled earlier is stale; use 30d iv proxy from that day's row)
  const g = rows(await uw(`stock/${T}/greek-exposure/strike?date=${preDate}`));
  const near = g.map((r) => ({ k: +r.strike, gex: (+r.call_gex || 0) + (+r.put_gex || 0), vex: (+r.call_vanna || 0) + (+r.put_vanna || 0) }))
    .filter((n) => n.k > 0 && Math.abs(n.k - spot) / spot <= 0.12 && (n.gex || n.vex));
  if (near.length < 4) { console.log(`${T}: thin surface @ ${preDate}`); continue; }
  const totAbs = near.reduce((a, n) => a + Math.abs(n.gex), 0) || 1;
  const regime = near.reduce((a, n) => a + n.gex, 0) / totAbs;         // + suppress / − amplify
  const vmag = near.slice().sort((a, b) => Math.abs(b.vex) - Math.abs(a.vex))[0]; // biggest vanna magnet
  const vlean = vmag ? Math.sign(vmag.k - spot) : 0;                  // magnet above (+1 = bull) / below (−1 = bear)
  results.push({ T, preDate, spot, react, regime, vmagK: vmag ? vmag.k : null, vlean });
}

// scorecard
console.log(`\n${'TKR'.padEnd(6)} ${'preDate'.padEnd(11)} ${'move'.padStart(7)} ${'regime'.padStart(7)} ${'vanna-magnet'.padStart(13)} ${'dir-call'.padStart(9)} hit?`);
let dirHit = 0, dirN = 0;
const bigMove = [], smallMove = [];
for (const r of results) {
  const dirCall = r.vlean > 0 ? 'UP' : r.vlean < 0 ? 'DOWN' : '—';
  const actualDir = r.react > 0 ? 'UP' : 'DOWN';
  const hit = r.vlean !== 0 ? (dirCall === actualDir ? '✓' : '✗') : '·';
  if (r.vlean !== 0) { dirN++; if (dirCall === actualDir) dirHit++; }
  (Math.abs(r.regime) > 0.3 && r.regime < 0 ? bigMove : smallMove); // bucket by amplify
  console.log(`${r.T.padEnd(6)} ${r.preDate.padEnd(11)} ${(r.react * 100 >= 0 ? '+' : '') + (r.react * 100).toFixed(1) + '%'} ${(r.regime >= 0 ? '+' : '') + r.regime.toFixed(2)}      ${(r.vmagK + ' (' + (r.vlean > 0 ? 'abv' : 'blw') + ')').padStart(13)} ${dirCall.padStart(9)}  ${hit}`);
}
console.log(`\nDIRECTION (vanna-magnet vs actual): ${dirHit}/${dirN} = ${dirN ? (dirHit / dirN * 100).toFixed(0) : 0}%  (coin-flip = 50%)`);
// magnitude: does amplify regime (regime<0) move more than suppress?
const amp = results.filter((r) => r.regime < -0.1), sup = results.filter((r) => r.regime > 0.1);
const avgAbs = (a) => a.length ? (a.reduce((x, r) => x + Math.abs(r.react), 0) / a.length * 100).toFixed(1) : '—';
console.log(`MAGNITUDE  amplify(regime<−0.1) avg |move| ${avgAbs(amp)}% (n=${amp.length})  vs  suppress(>+0.1) ${avgAbs(sup)}% (n=${sup.length})`);
