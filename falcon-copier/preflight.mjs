// PREFLIGHT — verify we actually have access before "running" the system. Skylit is SESSION-based (session B)
// and expires; a dead session makes the trader silently stand aside all day. UW is an API key (rarely an issue).
// Prints a clear ✓/✗ for each and the fix command; exits 1 if Skylit is unreachable so run.sh can warn loudly.
import '../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../apps/gex/src/heatseeker/auth.js';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
let skOK = false, spot = null, skStatus = 'net/err';
try {
  await initAuth();
  const t = await getFreshToken();
  const u = new URL('https://app.skylit.ai/api/data');
  u.searchParams.set('symbol', 'SPXW'); u.searchParams.set('max_strikes', '1'); u.searchParams.set('max_expirations', '1'); u.searchParams.set('nocache', Math.random().toString());
  const r = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${t}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  skStatus = r.status;
  if (r.ok) { const j = await r.json().catch(() => null); spot = j?.CurrentSpot ?? null; skOK = spot != null; }
} catch (e) { skStatus = e.message?.slice(0, 40) || 'err'; }
let uwOK = false, uwStatus = 'net/err';
try {
  const r = await fetch('https://api.unusualwhales.com/api/stock/SPY/stock-volume-price-levels', { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(10000) });
  uwStatus = r.status; uwOK = !!KEY && r.status !== 401 && r.status !== 403;
} catch (e) { uwStatus = e.message?.slice(0, 40) || 'err'; }

console.log(`  Skylit (session B): ${skOK ? `✓ OK — SPX ${spot}` : `✗ FAIL (${skStatus})`}`);
console.log(`  Unusual Whales:     ${uwOK ? '✓ OK' : `✗ FAIL (${KEY ? uwStatus : 'no key'})`}`);
process.exit(skOK ? 0 : 1);   // nonzero → run.sh shows the re-login fix; UW is non-fatal (capture is the only UW-only job)
