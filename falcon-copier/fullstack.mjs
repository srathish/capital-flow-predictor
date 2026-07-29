// EVERYTHING WE'RE USING — one snapshot of every live data source across SPX + SPY + QQQ.
// Skylit: GEX king(+side) / walls / barney / net-gamma / net-vanna / term-structure / prev-close pivot per
// instrument. UW: dark-pool value area, market tide, aggressive-flow lean. Plus the KING-SIDE TRINITY
// (are SPX/SPY/QQQ kings on the same side of their spot = aligned, or split = divergent).
import '../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../apps/gex/src/heatseeker/auth.js';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
await initAuth();
async function gex(sym) {
  const t = await getFreshToken(); const u = new URL('https://app.skylit.ai/api/data');
  u.searchParams.set('symbol', sym); u.searchParams.set('max_strikes', '200'); u.searchParams.set('max_expirations', '10'); u.searchParams.set('nocache', Math.random());
  const r = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${t}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || !r.ok) return null; const raw = await r.json(); const spot = raw.CurrentSpot, K = raw.Strikes.map(Number), G = raw.GammaValues, V = raw.VannaValues;
  const N = K.map((k, i) => ({ k, g: (G[i] || [])[0] || 0, v: (V[i] || [])[0] || 0 })).filter(n => Math.abs(n.k - spot) / spot <= 0.012);
  const king = N.filter(n => n.g > 0).sort((a, b) => b.g - a.g)[0];
  const cw = N.filter(n => n.g >= 12e6 && n.k > spot).sort((a, b) => a.k - b.k)[0], pw = N.filter(n => n.g >= 12e6 && n.k < spot).sort((a, b) => b.k - a.k)[0];
  const barn = N.filter(n => n.g <= -8e6).sort((a, b) => Math.abs(a.k - spot) - Math.abs(b.k - spot))[0];
  const kingOf = (j) => { const nn = K.map((k, i) => ({ k, g: (G[i] || [])[j] || 0 })).filter(n => Math.abs(n.k - spot) / spot <= 0.012 && n.g > 0).sort((a, b) => b.g - a.g)[0]; return nn ? sign(nn.k - spot) : 0; };
  const front = sign([0, 1, 2].map(kingOf).reduce((a, b) => a + b, 0)), back = sign([3, 4, 5, 6, 7].map(kingOf).reduce((a, b) => a + b, 0));
  return { spot, prevClose: raw.PreviousClose, king, cw, pw, barn, netG: N.reduce((s, n) => s + n.g, 0), netV: N.reduce((s, n) => s + n.v, 0), front, back };
}
const uw = async (p) => { const r = await fetch(`https://api.unusualwhales.com${p}`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null); return r; };
const [SPX, SPY, QQQ] = await Promise.all([gex('SPXW'), gex('SPY'), gex('QQQ')]);
// UW dark pool (SPY) + tide + SPX flow lean
const dpR = await uw('/api/stock/SPY/stock-volume-price-levels');
let poc = null; if (dpR) { const b = {}; for (const x of (dpR.data || [])) { const o = +x.off_vol || 0; if (o > 0) b[Math.round(+x.price)] = (b[Math.round(+x.price)] || 0) + o; } const a = Object.entries(b).sort((x, y) => y[1] - x[1]); if (a.length) poc = +a[0][0] * 10; }
const tideR = await uw(`/api/market/market-tide?date=${new Date().toISOString().slice(0, 10)}&interval_5m=true`); const tl = tideR?.data?.slice(-1)[0];
const flowR = await uw(`/api/option-trades?ticker_symbol=SPXW&min_premium=25000&limit=400&order=executed_at&order_direction=desc`);
let fb = 0, fbr = 0; for (const x of (flowR?.data || flowR?.result || [])) { const tg = x.tags || []; if (!tg.includes('ask_side')) continue; const pr = +x.premium || 0; if (tg.includes('bullish')) fb += pr; else if (tg.includes('bearish')) fbr += pr; }

const row = (name, S) => { if (!S) return `${name}: n/a`; const ks = sign(S.king.k - S.spot); return `${name} ${S.spot.toFixed(1)} | king ${S.king.k}(${(S.king.g / 1e6).toFixed(0)}M,${ks >= 0 ? 'ABOVE' : 'BELOW'}) | wall↑${S.cw?.k ?? '—'} ↓${S.pw?.k ?? '—'} | barney ${S.barn?.k ?? '—'} | netG ${(S.netG / 1e6).toFixed(0)}M netV ${(S.netV / 1e6).toFixed(0)} | term ${S.front === S.back && S.back ? 'agree' : 'diverge'} | pivot ${S.spot > S.prevClose ? 'BULL' : 'BEAR'}(${S.prevClose})`; };
console.log(`\n════════ EVERYTHING WE'RE USING · ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5)} ET ════════`);
console.log('[SKYLIT GEX/VEX — per instrument]');
console.log('  ' + row('SPX', SPX)); console.log('  ' + row('SPY', SPY)); console.log('  ' + row('QQQ', QQQ));
const ks = (S) => S ? sign(S.king.k - S.spot) : 0;
const sides = [ks(SPX), ks(SPY), ks(QQQ)];
console.log(`\n[KING-SIDE TRINITY] SPX ${ks(SPX) >= 0 ? '↑' : '↓'} · SPY ${ks(SPY) >= 0 ? '↑' : '↓'} · QQQ ${ks(QQQ) >= 0 ? '↑' : '↓'} → ${Math.abs(sides.reduce((a, b) => a + b, 0)) === 3 ? 'ALIGNED (all same side = strong pull)' : 'DIVERGENT (split = chop/one leading)'}`);
console.log(`\n[UW DARK POOL] SPY value-area POC → SPX ${poc ?? 'n/a'}`);
console.log(`[UW MARKET TIDE] net-premium ${tl ? ((+tl.net_call_premium - +tl.net_put_premium) / 1e6).toFixed(0) + 'M' : 'n/a'} · net-vol ${tl ? (tl.net_volume / 1e3).toFixed(0) + 'k' : 'n/a'}`);
console.log(`[UW AGGRESSIVE FLOW · SPX] bull $${(fb / 1e6).toFixed(1)}M vs bear $${(fbr / 1e6).toFixed(1)}M → lean ${fb - fbr >= 0 ? 'BULL' : 'BEAR'}`);
console.log(`\n[DATA SOURCES IN USE] ✓Skylit GEX(0DTE) ✓VEX ✓term-structure(10exp) ✓prev-close-pivot ✓SPY-GEX ✓QQQ-GEX ✓king-side-trinity ✓UW dark-pool ✓UW market-tide ✓UW aggressive-flow ✓UW option-marks(exec)`);
