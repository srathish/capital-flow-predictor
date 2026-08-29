// compare_skylit_uw.mjs — feasibility test: does UW's greek-exposure surface match Skylit's?
// Aligns per-strike net GEX + net VEX near spot and reports correlation, sign-agreement, node match.
import { loadEnvKeysFrom, resolveFromRoot, fetchJson } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
import { GexProvider } from '../providers/gex-skylit.mjs';
const KEY = process.env.UNUSUAL_WHALES_API_KEY;
const T = (process.argv[2] || 'SPY').toUpperCase();

const gex = new GexProvider();
const sk = await gex.getProfile(T);
if (!sk) { console.log(`${T}: no Skylit surface`); process.exit(0); }
const spot = sk.spot;
const skMap = new Map(sk.strikes.map((s) => [s.strike, { gex: s.gexAgg, vex: s.vexAgg }]));

const uwj = await fetchJson(`https://api.unusualwhales.com/api/stock/${T}/greek-exposure/strike`, { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' } });
const uwMap = new Map(((uwj && (uwj.data || uwj.result)) || []).map((r) => [+r.strike, { gex: (+r.call_gex || 0) + (+r.put_gex || 0), vex: (+r.call_vanna || 0) + (+r.put_vanna || 0) }]));

const near = (k, band = 0.15) => Math.abs(k - spot) / spot <= band;
const strikes = [...skMap.keys()].filter((k) => uwMap.has(k) && near(k)).sort((a, b) => a - b);
const S = strikes.map((k) => skMap.get(k).gex), U = strikes.map((k) => uwMap.get(k).gex);
const SV = strikes.map((k) => skMap.get(k).vex), UV = strikes.map((k) => uwMap.get(k).vex);

const corr = (a, b) => { const n = a.length; if (!n) return NaN; const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; } return num / Math.sqrt(da * db || 1); };
const sum = (a) => a.reduce((x, y) => x + y, 0);
const signAgree = strikes.length ? strikes.filter((_, i) => Math.sign(S[i]) === Math.sign(U[i])).length / strikes.length : 0;
const king = (map) => { const e = [...map.entries()].filter(([k]) => near(k)); return e.length ? e.sort((a, b) => Math.abs(b[1].gex) - Math.abs(a[1].gex))[0][0] : '—'; };
const posBelow = (map) => { const e = [...map.entries()].filter(([k]) => k < spot && near(k) && map.get(k).gex > 0); return e.length ? e.sort((a, b) => b[1].gex - a[1].gex)[0][0] : '—'; };
const posAbove = (map) => { const e = [...map.entries()].filter(([k]) => k > spot && near(k) && map.get(k).gex > 0); return e.length ? e.sort((a, b) => b[1].gex - a[1].gex)[0][0] : '—'; };

console.log(`\n════ ${T}  spot ${spot}  ·  ${strikes.length} aligned strikes (±15%) ════`);
console.log(`GEX  corr ${corr(S, U).toFixed(3)}   sign-agree ${(signAgree * 100).toFixed(0)}%   net-sign Skylit ${sum(S) >= 0 ? '+' : '−'} / UW ${sum(U) >= 0 ? '+' : '−'}`);
console.log(`VEX  corr ${corr(SV, UV).toFixed(3)}`);
console.log(`KING   Skylit ${king(skMap)}  ·  UW ${king(uwMap)}   ${king(skMap) === king(uwMap) ? '✓' : '✗'}`);
console.log(`FLOOR  Skylit ${posBelow(skMap)}  ·  UW ${posBelow(uwMap)}   ${posBelow(skMap) === posBelow(uwMap) ? '✓' : '✗'}`);
console.log(`CEIL   Skylit ${posAbove(skMap)}  ·  UW ${posAbove(uwMap)}   ${posAbove(skMap) === posAbove(uwMap) ? '✓' : '✗'}`);
console.log(`\nstrike |   Skylit gex |      UW gex |  Skylit vex |     UW vex   (±4% of spot)`);
for (const k of strikes.filter((k) => near(k, 0.04))) console.log(`${String(k).padStart(6)} | ${skMap.get(k).gex.toFixed(0).padStart(12)} | ${uwMap.get(k).gex.toFixed(0).padStart(11)} | ${skMap.get(k).vex.toFixed(0).padStart(11)} | ${uwMap.get(k).vex.toFixed(0).padStart(10)}`);
