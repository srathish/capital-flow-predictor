// MULTI-INSTRUMENT GEX (the last Falcon data layer) — pull SPX + SPY + QQQ gamma, map SPY/QQQ levels into
// SPX terms via the live ratio, and find: (a) CONFLUENCE levels (≥2 instruments' dominant pika at the same
// price = a much stronger wall), (b) SPX-THIN FALLBACK (when SPXW has no strong near pika, use SPY's — the
// 07-29 12:00 case where Falcon used SPY structure because "SPXW own structure unavailable").
import '../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../apps/gex/src/heatseeker/auth.js';
await initAuth();
async function gex(sym) {
  const t = await getFreshToken(); const u = new URL('https://app.skylit.ai/api/data');
  u.searchParams.set('symbol', sym); u.searchParams.set('max_strikes', '200'); u.searchParams.set('max_expirations', '10'); u.searchParams.set('nocache', Math.random());
  const r = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${t}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || !r.ok) return null; const raw = await r.json(); const spot = raw.CurrentSpot, K = raw.Strikes.map(Number), G = raw.GammaValues;
  const nodes = K.map((k, i) => ({ k, g: (G[i] || [])[0] || 0 })).filter(n => Math.abs(n.k - spot) / spot <= 0.015);
  const pikas = nodes.filter(n => n.g > 0).sort((a, b) => b.g - a.g).slice(0, 5);   // top-5 by own magnitude
  return { spot, pikas };
}
const [SPX, SPY, QQQ] = await Promise.all([gex('SPXW'), gex('SPY'), gex('QQQ')]);
if (!SPX) { console.log('SPXW failed'); process.exit(1); }
const rSPY = SPY ? SPX.spot / SPY.spot : 10, rQQQ = QQQ ? SPX.spot / QQQ.spot : 11;
const toSPX = (n, r) => ({ spx: Math.round(n.k * r), gM: (n.g / 1e6).toFixed(0), raw: n.k });
console.log(`=== MULTI-INSTRUMENT GEX (mapped to SPX terms) · SPX ${SPX.spot.toFixed(0)} ===`);
const spxL = SPX.pikas.map(n => ({ spx: n.k, gM: (n.g / 1e6).toFixed(0) }));
const spyL = (SPY?.pikas || []).map(n => toSPX(n, rSPY));
const qqqL = (QQQ?.pikas || []).map(n => toSPX(n, rQQQ));
console.log(`SPX pikas : ${spxL.map(x => `${x.spx}(${x.gM}M)`).join('  ')}`);
console.log(`SPY→SPX   : ${spyL.map(x => `${x.spx}(${x.gM}M)`).join('  ')}   [SPY×${rSPY.toFixed(2)}]`);
console.log(`QQQ→SPX   : ${qqqL.map(x => `${x.spx}(${x.gM}M)`).join('  ')}   [QQQ×${rQQQ.toFixed(2)}]`);
// CONFLUENCE: SPX level corroborated by SPY and/or QQQ within TOL
const TOL = 6;
console.log(`\nCONFLUENCE levels (±${TOL}pt agreement across instruments):`);
for (const s of spxL) {
  const spyHit = spyL.find(x => Math.abs(x.spx - s.spx) <= TOL), qqqHit = qqqL.find(x => Math.abs(x.spx - s.spx) <= TOL);
  const corr = [spyHit && 'SPY', qqqHit && 'QQQ'].filter(Boolean);
  if (corr.length) console.log(`  ${s.spx} — SPX(${s.gM}M) + ${corr.join(' + ')}${spyHit ? ` @${spyHit.spx}` : ''} → ${corr.length === 2 ? 'TRIPLE (strongest)' : 'DOUBLE'} confluence`);
}
// FALLBACK: SPX thin near spot? use SPY
const spxNear = spxL.filter(x => Math.abs(x.spx - SPX.spot) <= 20);
console.log(`\nSPX-THIN FALLBACK: ${spxNear.length ? `SPX has ${spxNear.length} strong pika(s) within 20pt — native structure OK` : `SPX has NO strong pika within 20pt → USE SPY: nearest SPY→SPX ${spyL.sort((a, b) => Math.abs(a.spx - SPX.spot) - Math.abs(b.spx - SPX.spot))[0]?.spx} (this is the 07-29 12:00 case)`}`);
