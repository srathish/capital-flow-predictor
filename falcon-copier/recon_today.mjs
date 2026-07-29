// WOULD WE HAVE GOTTEN FALCON'S PLAYS TODAY? Reconstruct our full-stack read at each Falcon pick time
// (Skylit snapshot via timestamp + DP value area + aggressive flow lean) and verdict: fire or miss, and why.
import '../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../apps/gex/src/heatseeker/auth.js';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
await initAuth();
const PLAYS = [
  { et: '12:00', ts: '2026-07-29T16:00:00Z', dir: 'long', falcon: 'LONG 7405C reversal off pika support · tgt 7363' },
  { et: '14:54', ts: '2026-07-29T18:54:00Z', dir: 'short', falcon: 'SHORT puts · top-ticked ~7446' },
];
const DP = { poc: 7400, vah: 7400, val: 7350 };   // today's SPY DP value area ×10 (POC 7400)

async function surf(ts) {
  const t = await getFreshToken(); const u = new URL('https://app.skylit.ai/api/data');
  u.searchParams.set('symbol', 'SPXW'); u.searchParams.set('max_strikes', '200'); u.searchParams.set('max_expirations', '10'); u.searchParams.set('nocache', Math.random()); u.searchParams.set('timestamp', ts);
  const r = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${t}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  const raw = await r.json(); const spot = raw.CurrentSpot, K = raw.Strikes.map(Number), G = raw.GammaValues;
  const nodes = K.map((k, i) => ({ k, g: (G[i] || [])[0] || 0 })).filter(n => Math.abs(n.k - spot) / spot <= 0.012);
  return { spot, nodes };
}
async function flow(ts) {
  const end = new Date(ts).getTime(), start = end - 20 * 60000;
  const r = await fetch(`https://api.unusualwhales.com/api/option-trades?ticker_symbol=SPXW&min_premium=25000&limit=500&older_than=${new Date(end + 3 * 60000).toISOString()}&newer_than=${new Date(start).toISOString()}`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null);
  const arr = r?.data || r?.result || []; let bull = 0, bear = 0;
  for (const x of arr) { const tg = x.tags || []; if (!tg.includes('ask_side')) continue; const p = +x.premium || 0; if (tg.includes('bullish')) bull += p; else if (tg.includes('bearish')) bear += p; }
  return { bull, bear, lean: bull - bear };
}

for (const P of PLAYS) {
  const s = await surf(P.ts); const f = await flow(P.ts); const spot = s.spot;
  const nearest = s.nodes.filter(n => n.g >= 12e6).sort((a, b) => Math.abs(a.k - spot) - Math.abs(b.k - spot))[0];
  const nearDist = nearest ? Math.abs(nearest.k - spot) : 999;
  const dpEx = spot > DP.vah ? `+${(spot - DP.vah).toFixed(0)} ABOVE value (short-bias)` : spot < DP.val ? `${(spot - DP.val).toFixed(0)} BELOW value (long-bias)` : 'in value';
  const flowDir = f.lean > 0 ? 'long' : 'short';
  console.log(`\n═══ FALCON ${P.et}: ${P.falcon} ═══`);
  console.log(`  our read: SPX ${spot.toFixed(1)} · nearest strong pika ${nearest ? `${nearest.k}(${(nearest.g / 1e6).toFixed(0)}M) ${nearDist.toFixed(0)}pt` : 'NONE'} · DP ${dpEx} · flow ${f.lean >= 0 ? 'BULL+' : 'BEAR'}$${(Math.abs(f.lean) / 1e6).toFixed(1)}M`);
  // signals for Falcon's direction
  const atPika = nearest && nearDist <= 5;                        // reversal/fade setup (price at a pika)
  const dpAgree = (P.dir === 'short' && spot > DP.vah) || (P.dir === 'long' && spot < DP.val);
  const flowAgree = flowDir === P.dir;
  const hits = [atPika && `at-pika(${nearest.k})`, dpAgree && 'DP-extension', flowAgree && 'flow-agrees'].filter(Boolean);
  const would = hits.length >= 1;
  console.log(`  signals FOR ${P.dir.toUpperCase()}: ${hits.length ? hits.join(' + ') : 'none'}`);
  console.log(`  VERDICT: ${would ? `✅ WOULD FIRE ${P.dir.toUpperCase()} (${hits.join('+')})` : `❌ WOULD MISS (no GEX pika ${atPika ? '' : 'nearby'}${!dpAgree ? ', DP not extended' : ''}${!flowAgree ? ', flow ' + flowDir : ''})`}`);
}
console.log(`\nGEX-only would catch the at-pika reversal; DP-extension + flow catch the top-tick short GEX misses. This is why the fused stack matters.`);
