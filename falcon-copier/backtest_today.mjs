// BACKTEST TODAY — the multi-instrument, all-layers system replayed over today's (07-29) intraday data for
// SPX + SPY + QQQ. Pulls Skylit GEX snapshots (timestamp), today's flow tape (bucketed), DP value area;
// runs the fused confluence at each step; fires ≥THRESH; simulates forward on the snapshot spot-path.
// Produces a blotter per instrument. Usage: node backtest_today.mjs [YYYY-MM-DD]
import '../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../apps/gex/src/heatseeker/auth.js';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const DAY = process.argv[2] || '2026-07-29';
const THRESH = 4;
await initAuth();
// sample times ET 09:45..15:30 every 15 min -> UTC (EDT +4)
const times = []; for (let m = 9 * 60 + 45; m <= 15 * 60 + 30; m += 15) { const hh = String(Math.floor(m / 60)).padStart(2, '0'), mm = String(m % 60).padStart(2, '0'); times.push({ et: `${hh}:${mm}`, ts: `${DAY}T${String(Math.floor(m / 60) + 4).padStart(2, '0')}:${mm}:00.000Z` }); }

async function gex(sym, ts) {
  const t = await getFreshToken(); const u = new URL('https://app.skylit.ai/api/data');
  u.searchParams.set('symbol', sym); u.searchParams.set('max_strikes', '200'); u.searchParams.set('max_expirations', '10'); u.searchParams.set('nocache', Math.random()); u.searchParams.set('timestamp', ts);
  const r = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${t}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || !r.ok) return null; const raw = await r.json(); if (raw.CurrentSpot == null) return null;
  const spot = raw.CurrentSpot, K = raw.Strikes.map(Number), G = raw.GammaValues, V = raw.VannaValues;
  const N = K.map((k, i) => ({ k, g: (G[i] || [])[0] || 0, v: (V[i] || [])[0] || 0 })).filter(n => Math.abs(n.k - spot) / spot <= 0.012);
  return { spot, prevClose: raw.PreviousClose, N };
}
// flow tape per instrument, bucketed to 15-min windows -> lean
async function flowMap(sym) {
  const r = await fetch(`https://api.unusualwhales.com/api/option-trades?ticker_symbol=${sym}&min_premium=25000&limit=1000&newer_than=${DAY}T13:30:00Z`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null);
  const m = {}; for (const x of (r?.data || r?.result || [])) { const tg = x.tags || []; if (!tg.includes('ask_side')) continue; const d = new Date(x.executed_at); const bm = Math.floor((d.getUTCHours() * 60 + d.getUTCMinutes()) / 15) * 15; const p = +x.premium || 0; (m[bm] ||= 0); m[bm] += tg.includes('bullish') ? p : tg.includes('bearish') ? -p : 0; } return m;
}
const dpR = await fetch(`https://api.unusualwhales.com/api/stock/SPY/stock-volume-price-levels`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null);
let dp = null; if (dpR) { const b = {}; for (const x of (dpR.data || [])) { const o = +x.off_vol || 0; if (o > 0) b[Math.round(+x.price)] = (b[Math.round(+x.price)] || 0) + o; } const a = Object.entries(b).map(([p, v]) => ({ p: +p, v })).sort((x, y) => y.v - x.v).slice(0, 4); if (a.length) dp = { poc: a[0].p, vah: Math.max(...a.map(x => x.p)), val: Math.min(...a.map(x => x.p)) }; }

const INSTR = [{ sym: 'SPXW', strong: 15e6, range: 20, gap: 5 }, { sym: 'SPY', strong: 15e6, range: 3, gap: 0.5 }, { sym: 'QQQ', strong: 5e6, range: 3, gap: 0.5 }];
const blotter = [];
for (const I of INSTR) {
  const fmap = await flowMap(I.sym === 'SPXW' ? 'SPXW' : I.sym);
  const snaps = [];
  for (const T of times) { const g = await gex(I.sym, T.ts); if (g) snaps.push({ ...T, ...g }); await new Promise(r => setTimeout(r, 120)); }
  let prevKing = null, pos = null;
  for (let i = 0; i < snaps.length; i++) {
    const s = snaps[i], spot = s.spot;
    if (pos) { const tgtHit = pos.dir > 0 ? spot >= pos.target : spot <= pos.target, stopHit = pos.dir > 0 ? spot <= pos.stop : spot >= pos.stop, eod = i === snaps.length - 1;
      if (tgtHit || stopHit || eod) { const pnl = (spot - pos.entry) * pos.dir; blotter.push({ sym: I.sym, ...pos, exitET: s.et, exit: +spot.toFixed(1), pnl: +pnl.toFixed(1), why: tgtHit ? 'target' : stopHit ? 'stop' : 'eod' }); pos = null; } continue; }
    const king = s.N.filter(n => n.g > 0).sort((a, b) => b.g - a.g)[0]; if (!king) { prevKing = king?.k; continue; }
    const migDir = prevKing && Math.abs(king.k - prevKing) >= I.gap ? sign(king.k - prevKing) : 0; prevKing = king.k;
    const pin = s.N.filter(n => n.g >= I.strong && Math.abs(n.k - spot) >= I.gap && Math.abs(n.k - spot) <= I.range).sort((a, b) => Math.abs(a.k - spot) - Math.abs(b.k - spot))[0];
    if (!pin) continue;
    const dir = sign(pin.k - spot);
    const bm = (+s.ts.slice(11, 13)) * 60 + (+s.ts.slice(14, 16)); const fl = sign(fmap[Math.floor(bm / 15) * 15] || 0);
    const cr = [pin.g >= I.strong * 1.3, pin.v > 0, migDir !== 0 && migDir === dir, fl !== 0 && fl === dir, dir > 0 ? spot < s.prevClose : spot > s.prevClose, true];
    const pass = cr.filter(Boolean).length + 1;   // +1 for at-pin
    if (pass >= THRESH) pos = { entryET: s.et, dir, entry: +spot.toFixed(1), pin: pin.k, target: pin.k, stop: +(spot - dir * (I.sym === 'SPXW' ? 8 : 0.8)).toFixed(1), pass };
  }
}
console.log(`\n═══ BACKTEST ${DAY} · multi-instrument (SPX+SPY+QQQ) · all layers · confluence ≥${THRESH}/7 ═══`);
if (!blotter.length) console.log('  (no setups cleared the confluence bar today)');
for (const b of blotter) console.log(`  ${b.sym.padEnd(4)} ${b.entryET} ${b.dir > 0 ? 'LONG ' : 'SHORT'} @${b.entry} → ${b.exitET} @${b.exit}  ${b.pnl >= 0 ? '+' : ''}${b.pnl}pt (${b.why}) conf ${b.pass}/7`);
if (blotter.length) { const w = blotter.filter(b => b.pnl > 0).length; console.log(`\n  TOTAL: ${blotter.length} trades · ${w}/${blotter.length} win · ${blotter.reduce((a, c) => a + c.pnl, 0).toFixed(1)} pts (SPX-pt equiv; SPY/QQQ in own pts)`); }
