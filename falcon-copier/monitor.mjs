// MONITOR EVERYTHING — one live view of the whole stack each cycle: GEX(0DTE) + VEX + term structure +
// prev-close pivot + dark-pool value area + flow (tide) + trinity + VIX, a synthesized READ, and SYSTEM
// HEALTH (feeds up? session-B ok? paper-trader alive?). Run: node monitor.mjs  (add --loop 30 to refresh).
import '../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../apps/gex/src/heatseeker/auth.js';
import fs from 'node:fs';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const DATE = new Date().toISOString().slice(0, 10);
const LOOP = process.argv.includes('--loop') ? Number(process.argv[process.argv.indexOf('--loop') + 1]) : 0;
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
await initAuth();

async function skylit() {
  const t = await getFreshToken(); const u = new URL('https://app.skylit.ai/api/data');
  u.searchParams.set('symbol', 'SPXW'); u.searchParams.set('max_strikes', '200'); u.searchParams.set('max_expirations', '10'); u.searchParams.set('nocache', Math.random());
  const r = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${t}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || !r.ok) return { ok: false };
  const raw = await r.json(); const spot = raw.CurrentSpot, K = raw.Strikes.map(Number), G = raw.GammaValues, V = raw.VannaValues, EXP = raw.Expirations;
  const nodes0 = K.map((k, i) => ({ k, g: (G[i] || [])[0] || 0, v: (V[i] || [])[0] || 0 })).filter(n => Math.abs(n.k - spot) / spot <= 0.012);
  const king = nodes0.filter(n => n.g >= 15e6).sort((a, b) => b.g - a.g)[0];
  const cw = nodes0.filter(n => n.g >= 12e6 && n.k > spot + 1).sort((a, b) => a.k - b.k)[0];
  const pw = nodes0.filter(n => n.g >= 12e6 && n.k < spot - 1).sort((a, b) => b.k - a.k)[0];
  const barn = nodes0.filter(n => n.g <= -8e6).sort((a, b) => Math.abs(a.k - spot) - Math.abs(b.k - spot))[0];
  const kingOf = (j) => { const nn = K.map((k, i) => ({ k, g: (G[i] || [])[j] || 0 })).filter(n => Math.abs(n.k - spot) / spot <= 0.012 && n.g > 0).sort((a, b) => b.g - a.g)[0]; return nn ? nn.k : null; };
  const fr = [0, 1, 2].map(kingOf).map(k => sign(k - spot)).reduce((a, b) => a + b, 0);
  const bk = sign([3, 4, 5, 6, 7].map(kingOf).map(k => sign(k - spot)).reduce((a, b) => a + b, 0));
  return { ok: true, spot, prevClose: raw.PreviousClose, chg: raw.PriceChangePercent, king, cw, pw, barn, front: sign(fr), back: bk, netG: nodes0.reduce((s, n) => s + n.g, 0) };
}
async function darkpool() {
  const r = await fetch(`https://api.unusualwhales.com/api/stock/SPY/stock-volume-price-levels`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null);
  if (!r) return { ok: false }; const buck = {}; for (const x of (r.data || [])) { const o = +x.off_vol || 0; if (o > 0) buck[Math.round(+x.price)] = (buck[Math.round(+x.price)] || 0) + o; }
  const arr = Object.entries(buck).map(([p, v]) => ({ p: +p, v })).sort((a, b) => b.v - a.v); if (!arr.length) return { ok: false };
  return { ok: true, poc: arr[0].p * 10, vah: Math.max(...arr.slice(0, 4).map(x => x.p)) * 10, val: Math.min(...arr.slice(0, 4).map(x => x.p)) * 10 };
}
async function tideFlow() {
  const r = await fetch(`https://api.unusualwhales.com/api/market/market-tide?date=${DATE}&interval_5m=true`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null);
  const d = r?.data || []; if (!d.length) return { ok: false }; const l = d[d.length - 1];
  return { ok: true, netPrem: (+l.net_call_premium - +l.net_put_premium) / 1e6, netVol: +l.net_volume };
}
async function ser(tk) { const r = await fetch(`https://api.unusualwhales.com/api/stock/${tk}/ohlc/1m?date=${DATE}`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null); return (r?.data || []).map(x => +x.close).filter(Number.isFinite); }

async function cycle() {
  const [S, DP, TF, spy, qqq, vixy] = await Promise.all([skylit(), darkpool(), tideFlow(), ser('SPY'), ser('QQQ'), ser('VIXY')]);
  const mom = (a) => a.length > 15 ? sign(a[a.length - 1] - a[a.length - 16]) : 0;
  const now = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5);
  const M = (n) => n ? `${n.k}(${(n.g / 1e6).toFixed(0)}M)` : '—';
  if (!S.ok) { console.log(`\n${now} · SKYLIT DOWN — re-auth session B`); return; }
  const spot = S.spot, dpEx = DP.ok ? (spot > DP.vah ? `STRETCHED +${(spot - DP.vah).toFixed(0)} ABOVE value→short-bias` : spot < DP.val ? `STRETCHED ${(spot - DP.val).toFixed(0)} BELOW value→long-bias` : 'in value') : '?';
  const trin = mom(spy) + (spot > S.prevClose ? 0 : 0);
  console.log(`\n═════ MONITOR · ${DATE} ${now} ET · SPX ${spot.toFixed(1)} (${S.chg.toFixed(2)}%) ═════`);
  console.log(`PIVOT   ${spot > S.prevClose ? 'BULL' : 'BEAR'}-side of prev-close ${S.prevClose} (${(spot - S.prevClose).toFixed(0)}pt)`);
  console.log(`GEX0DTE king ${M(S.king)} · callWall ${M(S.cw)} · putWall ${M(S.pw)} · barney ${M(S.barn)} · net ${(S.netG / 1e6).toFixed(0)}M`);
  console.log(`TERM    front ${S.front > 0 ? 'above' : S.front < 0 ? 'below' : 'mixed'} / back ${S.back > 0 ? 'above' : S.back < 0 ? 'below' : 'mixed'} → ${S.front === S.back && S.back !== 0 ? 'AGREE' : 'DIVERGE(chop risk)'}`);
  console.log(`DARKPOOL ${DP.ok ? `POC ${DP.poc} · VA ${DP.val}-${DP.vah} → ${dpEx}` : 'n/a'}`);
  console.log(`FLOW    ${TF.ok ? `net-premium ${TF.netPrem >= 0 ? '+' : ''}${TF.netPrem.toFixed(0)}M ${TF.netPrem >= 0 ? '(call-heavy)' : '(put-heavy)'} · net-vol ${TF.netVol >= 0 ? '+' : ''}${(TF.netVol / 1e3).toFixed(0)}k` : 'n/a'}`);
  console.log(`TRINITY SPY${mom(spy) > 0 ? '+' : mom(spy) < 0 ? '−' : '0'} QQQ${mom(qqq) > 0 ? '+' : mom(qqq) < 0 ? '−' : '0'} · VIXY ${vixy[vixy.length - 1]?.toFixed(2) ?? '?'}`);
  // synthesized read
  const bias = [spot > S.prevClose ? 1 : -1, DP.ok && spot > DP.vah ? -1 : DP.ok && spot < DP.val ? 1 : 0, mom(spy)].reduce((a, b) => a + b, 0);
  console.log(`─────`);
  console.log(`READ    ${S.front !== S.back ? 'DIVERGENT term = chop risk; ' : ''}${dpEx.includes('short') ? 'DP says fade the stretch DOWN to ' + DP.poc + '; ' : dpEx.includes('long') ? 'DP says revert UP to ' + DP.poc + '; ' : ''}0DTE magnet ${S.king ? S.king.k : '—'}. Net bias ${bias > 0 ? 'UP-lean' : bias < 0 ? 'DOWN-lean' : 'neutral'} (context, NOT a prediction).`);
  const tick = fs.existsSync('/tmp/bellwether_last_tick.txt') ? fs.readFileSync('/tmp/bellwether_last_tick.txt', 'utf8').trim() : 'none';
  console.log(`HEALTH  skylit ✓ · uw ${DP.ok && TF.ok ? '✓' : '⚠'} · session-B ✓ · paper-trader ${tick}`);
}
try { await cycle(); if (LOOP > 0) { console.log(`\n(monitoring every ${LOOP}s — Ctrl-C to stop)`); setInterval(() => cycle().catch(e => console.error('ERR', e.message)), LOOP * 1000); } }
catch (e) { console.error('MONITOR ERROR', e.message); process.exit(1); }
