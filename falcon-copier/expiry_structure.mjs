// UNTAPPED SKYLIT DATA — GammaValues/VannaValues are [200 strikes]×[10 EXPIRATIONS]; we only used col0
// (0DTE) + the sum. This reads the FULL term structure: each expiry's King + net gamma, whether near/far
// expiries AGREE (aligned kings = strong level / clean move; scattered = chop), plus the PreviousClose pivot.
import '../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../apps/gex/src/heatseeker/auth.js';
await initAuth(); const t = await getFreshToken();
const u = new URL('https://app.skylit.ai/api/data');
u.searchParams.set('symbol', 'SPXW'); u.searchParams.set('max_strikes', '200'); u.searchParams.set('max_expirations', '10'); u.searchParams.set('nocache', Math.random());
const raw = await (await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${t}`, Accept: 'application/json' } })).json();
const spot = raw.CurrentSpot, prevClose = raw.PreviousClose;
const K = raw.Strikes.map(Number), G = raw.GammaValues, V = raw.VannaValues, EXP = raw.Expirations;
const band = (k) => Math.abs(k - spot) / spot <= 0.012;
const today = new Date(raw.LastUpdated);
const dte = (d) => Math.max(0, Math.round((new Date(d) - today) / 86400000));

console.log(`=== SPXW TERM STRUCTURE · spot ${spot.toFixed(1)} · prevClose ${prevClose} ===\n`);
console.log(`PREVIOUS-CLOSE PIVOT: spot is ${spot > prevClose ? 'ABOVE' : 'BELOW'} prior close (${(spot - prevClose).toFixed(1)}pt) → ${spot > prevClose ? 'bull-side of pivot' : 'bear-side of pivot'}\n`);
console.log(`exp# DTE  date         KING(gamma)         net-gamma   king vs spot`);
const kings = [];
for (let j = 0; j < EXP.length; j++) {
  const nodes = K.map((k, i) => ({ k, g: (G[i] || [])[j] || 0, v: (V[i] || [])[j] || 0 })).filter(n => band(n.k));
  const king = nodes.filter(n => n.g > 0).sort((a, b) => b.g - a.g)[0];
  const net = nodes.reduce((s, n) => s + n.g, 0);
  kings.push(king ? king.k : null);
  console.log(`${String(j).padStart(2)}  ${String(dte(EXP[j])).padStart(3)}  ${String(EXP[j]).slice(0, 10)}  ${king ? `${king.strike ?? king.k}(${(king.g / 1e6).toFixed(0)}M)`.padEnd(16) : '—'.padEnd(16)}  ${(net / 1e6).toFixed(0).padStart(6)}M    ${king ? (king.k >= spot ? '+' : '') + (king.k - spot).toFixed(0) : '—'}`);
}
// front-vs-back agreement: do the near expiries (0-2DTE) and back (weekly/monthly) point the same way vs spot?
const side = (k) => k == null ? 0 : Math.sign(k - spot);
const front = kings.slice(0, 3).map(side).reduce((a, b) => a + b, 0);
const back = kings.slice(3).map(side).filter(Boolean);
const backSide = Math.sign(back.reduce((a, b) => a + b, 0));
console.log(`\nFRONT (0-2DTE) kings ${front > 0 ? 'above' : front < 0 ? 'below' : 'mixed'} spot · BACK kings ${backSide > 0 ? 'above' : backSide < 0 ? 'below' : 'mixed'} spot`);
console.log(`=> ${Math.sign(front) === backSide && backSide !== 0 ? 'FRONT+BACK AGREE (clean structure, trade with confidence)' : 'FRONT/BACK DIVERGE (chop/whipsaw risk — veto or size down)'}`);
console.log(`\nThe near-expiry king is the intraday magnet; back-expiry kings are the swing anchors. Alignment = the doctrine §8 'cross-expiry agreement' — now from the real per-expiry data, not a 0DTE-vs-sum proxy.`);
