// MULTI-INSTRUMENT FUSED SCANNER (the entry brain) — evaluate SPX + SPY + QQQ each with ALL layers, score
// confluence, and surface the single best setup across the complex. Catches the 07-29 12:00 LONG (SPY
// support-bounce + bullish king-migration 734→742) that SPX-only missed. Logs what it WOULD fire; safe to
// run alongside the live SPXW trader. State (prev-king per instrument) in scan_multi_state.json.
import '../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../apps/gex/src/heatseeker/auth.js';
import fs from 'node:fs'; import path from 'node:path';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const STATE = path.join(process.cwd(), 'falcon-copier', 'scan_multi_state.json');
let st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { prevKing: {} };
await initAuth();

async function gex(sym) {
  const t = await getFreshToken(); const u = new URL('https://app.skylit.ai/api/data');
  u.searchParams.set('symbol', sym); u.searchParams.set('max_strikes', '200'); u.searchParams.set('max_expirations', '10'); u.searchParams.set('nocache', Math.random());
  const r = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${t}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || !r.ok) return null; const raw = await r.json(); const spot = raw.CurrentSpot, K = raw.Strikes.map(Number), G = raw.GammaValues, V = raw.VannaValues;
  const N = K.map((k, i) => ({ k, g: (G[i] || [])[0] || 0, v: (V[i] || [])[0] || 0 })).filter(n => Math.abs(n.k - spot) / spot <= 0.012);
  return { spot, prevClose: raw.PreviousClose, N };
}
async function flowLean(sym) {
  const r = await fetch(`https://api.unusualwhales.com/api/option-trades?ticker_symbol=${sym}&min_premium=25000&limit=400&order=executed_at&order_direction=desc`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null);
  let b = 0, be = 0; const cut = Date.now() - 20 * 60000;
  for (const x of (r?.data || r?.result || [])) { if (new Date(x.executed_at).getTime() < cut) continue; const tg = x.tags || []; if (!tg.includes('ask_side')) continue; const p = +x.premium || 0; if (tg.includes('bullish')) b += p; else if (tg.includes('bearish')) be += p; }
  return sign(b - be);
}
// SPY dark-pool value area (POC) once, for the DP-extension criterion (map per-instrument by ratio)
async function dpVAH() { const r = await fetch(`https://api.unusualwhales.com/api/stock/SPY/stock-volume-price-levels`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null); if (!r) return null; const bu = {}; for (const x of (r.data || [])) { const o = +x.off_vol || 0; if (o > 0) bu[Math.round(+x.price)] = (bu[Math.round(+x.price)] || 0) + o; } const a = Object.entries(bu).map(([p, v]) => ({ p: +p, v })).sort((x, y) => y.v - x.v).slice(0, 4); return a.length ? { poc: a[0].p, vah: Math.max(...a.map(x => x.p)), val: Math.min(...a.map(x => x.p)) } : null; }

const dp = await dpVAH();
const out = [];
for (const sym of ['SPXW', 'SPY', 'QQQ']) {
  const S = await gex(sym); if (!S) continue; const spot = S.spot;
  const fl = await flowLean(sym === 'SPXW' ? 'SPXW' : sym);
  const king = S.N.filter(n => n.g > 0).sort((a, b) => b.g - a.g)[0];
  const migDir = st.prevKing[sym] && Math.abs(king.k - st.prevKing[sym]) >= (sym === 'SPXW' ? 5 : 1) ? sign(king.k - st.prevKing[sym]) : 0;
  st.prevKing[sym] = king.k;
  // candidate: fade/bounce off nearest strong pika within range
  const STRONG = sym === 'SPXW' ? 15e6 : sym === 'SPY' ? 15e6 : 5e6, RANGE = sym === 'SPXW' ? 20 : 2;
  const pin = S.N.filter(n => n.g >= STRONG && Math.abs(n.k - spot) >= (sym === 'SPXW' ? 5 : 0.5) && Math.abs(n.k - spot) <= RANGE).sort((a, b) => Math.abs(a.k - spot) - Math.abs(b.k - spot))[0];
  if (!pin) { out.push({ sym, spot, note: `no near strong pika (king ${king.k} ${(king.g / 1e6).toFixed(0)}M ${sign(king.k - spot) > 0 ? 'above' : 'below'})` }); continue; }
  const dir = sign(pin.k - spot);   // bounce toward the pin
  const spyRatio = sym === 'SPY' ? 1 : null;
  const cr = [
    ['at-pin', true],
    ['strong-node', pin.g >= STRONG * 1.3],
    ['vanna+', pin.v > 0],
    ['king-mig-agree', migDir !== 0 && migDir === dir],           // the escalator (SPY 734→742 case)
    ['flow-agree', fl !== 0 && fl === dir],
    ['pivot-side', dir > 0 ? spot < S.prevClose : spot > S.prevClose],  // room toward the pivot
    ['dp-support', sym === 'SPY' && dp ? (dir > 0 ? Math.abs(spot - dp.val) <= 3 || Math.abs(spot - dp.poc) <= 3 : false) : false],
  ];
  const pass = cr.filter(x => x[1]).length;
  out.push({ sym, spot, dir, pin: pin.k, kingMig: migDir, flow: fl, pass, hits: cr.filter(x => x[1]).map(x => x[0]) });
}
fs.writeFileSync(STATE, JSON.stringify(st));
console.log(`\n═══ MULTI-INSTRUMENT SCAN · ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5)} ET ═══`);
for (const o of out) {
  if (o.note) { console.log(`  ${o.sym.padEnd(4)} ${o.spot.toFixed(1)} · ${o.note}`); continue; }
  console.log(`  ${o.sym.padEnd(4)} ${o.spot.toFixed(1)} · ${o.dir > 0 ? 'LONG' : 'SHORT'} @pin ${o.pin} · king-mig ${o.kingMig > 0 ? 'UP' : o.kingMig < 0 ? 'DN' : '—'} · flow ${o.flow > 0 ? 'bull' : o.flow < 0 ? 'bear' : '0'} · confluence ${o.pass}/7 [${o.hits.join('+')}]`);
}
const best = out.filter(o => o.pass != null).sort((a, b) => b.pass - a.pass)[0];
console.log(best && best.pass >= 4 ? `\n>>> BEST: ${best.sym} ${best.dir > 0 ? 'LONG' : 'SHORT'} @pin ${best.pin} (confluence ${best.pass}/7) — WOULD FIRE` : `\n>>> no setup ≥4/7 confluence across SPX/SPY/QQX — stand aside`);
