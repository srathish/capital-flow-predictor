// verify_skylit.mjs — confirm the Skylit session is live after reauth (single SPY pull).
import { GexProvider } from '../providers/gex-skylit.mjs';
const gex = new GexProvider();
try {
  const st = await gex.authStatus();
  console.log('authStatus:', JSON.stringify(st));
  const p = await gex.getProfile('SPY');
  if (p && p.spot != null) {
    console.log(`✅ SPY LIVE — spot ${p.spot} · asof ${p.asofDate || p.asof} · ${p.expirations?.length} expirations · ${p.strikes?.length} strikes`);
  } else {
    console.log('⚠ SPY pull returned null (session stale, or empty response)');
  }
} catch (e) {
  console.log(`❌ ${e.message}${e.status ? ' (HTTP ' + e.status + ')' : ''}`);
}
