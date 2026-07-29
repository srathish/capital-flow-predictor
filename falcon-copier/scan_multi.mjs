// MULTI-INSTRUMENT FUSED SCANNER (the entry brain) — the SAME validated engine as backtest_1min.mjs, but LIVE.
// Evaluates SPX + SPY + QQQ every run with ALL layers; builds two candidate types — PIKA (fade/bounce toward
// the nearest strong wall) and BARNEY (reject off a big negative-gamma node price has TAPPED and is now
// RETRACING from, the failed-reach confirmation) — scores 7-criteria confluence, and surfaces the single best
// setup across the complex. This is the FORWARD-TEST observer: it logs what it WOULD fire (no real orders).
// Reverse-engineered to catch BOTH 07-29 Falcon plays: 12:00 SPY support-bounce LONG + 14:54 SPXW barney top-tick
// SHORT. State (prev-king + rolling spot history per instrument, for the failed-reach) in scan_multi_state.json.
import '../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../apps/gex/src/heatseeker/auth.js';
import fs from 'node:fs'; import path from 'node:path';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const THRESH = 5;
const STATE = path.join(process.cwd(), 'falcon-copier', 'scan_multi_state.json');
let st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
st.prevKing ||= {}; st.spotHist ||= {};
await initAuth();

// same per-instrument params the 1-min backtest validated (strong-node floor, search range, min gap, stop, DP scale)
const INSTR = [
  { sym: 'SPXW', strong: 15e6, range: 20, gap: 5, stop: 8, dpMul: 10.05 },
  { sym: 'SPY', strong: 15e6, range: 3, gap: 0.5, stop: 0.8, dpMul: 1 },
  { sym: 'QQQ', strong: 5e6, range: 3, gap: 0.5, stop: 0.8, dpMul: 0 },
];

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
// SPY dark-pool value area (mapped per-instrument by dpMul) for the DP-extension criterion
async function dpVAH() { const r = await fetch(`https://api.unusualwhales.com/api/stock/SPY/stock-volume-price-levels`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null); if (!r) return null; const bu = {}; for (const x of (r.data || [])) { const o = +x.off_vol || 0; if (o > 0) bu[Math.round(+x.price)] = (bu[Math.round(+x.price)] || 0) + o; } const a = Object.entries(bu).map(([p, v]) => ({ p: +p, v })).sort((x, y) => y.v - x.v).slice(0, 4); return a.length ? { poc: a[0].p, vah: Math.max(...a.map(x => x.p)), val: Math.min(...a.map(x => x.p)) } : null; }

const dp = await dpVAH();
const out = [];
for (const I of INSTR) {
  const sym = I.sym;
  const S = await gex(sym); if (!S) continue; const spot = S.spot;
  const fl = await flowLean(sym === 'SPXW' ? 'SPXW' : sym);
  const king = S.N.filter(n => n.g > 0).sort((a, b) => b.g - a.g)[0];
  const migDir = king && st.prevKing[sym] && Math.abs(king.k - st.prevKing[sym]) >= I.gap ? sign(king.k - st.prevKing[sym]) : 0;
  if (king) st.prevKing[sym] = king.k;
  const hist = (st.spotHist[sym] || []).concat(spot).slice(-6); st.spotHist[sym] = hist;   // last ~6 reads for failed-reach
  const vah = dp && I.dpMul ? dp.vah * I.dpMul : null, val = dp && I.dpMul ? dp.val * I.dpMul : null;
  const cands = [];
  // A) PIKA — fade/bounce toward the nearest strong wall within range
  const pin = S.N.filter(n => n.g >= I.strong && Math.abs(n.k - spot) >= I.gap && Math.abs(n.k - spot) <= I.range).sort((a, b) => Math.abs(a.k - spot) - Math.abs(b.k - spot))[0];
  if (pin) cands.push({ kind: 'PIKA', dir: sign(pin.k - spot), anchor: pin.k, target: pin.k, strong: pin.g >= I.strong * 1.3, vanna: pin.v > 0 });
  // B) BARNEY — reject off a big negative-gamma node price has TAPPED and is now RETRACING from (failed-reach)
  const barn = S.N.filter(n => n.g <= -I.strong && Math.abs(n.k - spot) >= I.gap && Math.abs(n.k - spot) <= I.range * 0.5).sort((a, b) => Math.abs(a.k - spot) - Math.abs(b.k - spot))[0];
  if (barn) {
    const d = -sign(barn.k - spot);
    const ext = barn.k > spot ? Math.max(...hist) : Math.min(...hist);   // extreme toward the barney across recent reads
    const tapped = Math.abs(ext - barn.k) <= (sym === 'SPXW' ? 6 : 0.6);
    const retrace = barn.k > spot ? spot < ext - (sym === 'SPXW' ? 1 : 0.1) : spot > ext + (sym === 'SPXW' ? 1 : 0.1);
    if (tapped && retrace) cands.push({ kind: 'BARNEY', dir: d, anchor: barn.k, target: +(spot + d * I.stop * 1.3).toFixed(2), strong: barn.g <= -I.strong * 2, vanna: barn.v < 0 });
  }
  if (!cands.length) { out.push({ sym, spot, note: `no near strong node (king ${king ? `${king.k} ${(king.g / 1e6).toFixed(0)}M ${sign(king.k - spot) > 0 ? 'above' : 'below'}` : 'n/a'})` }); continue; }
  let best = null;
  for (const c of cands) {
    const cr = [
      ['at-node', true],
      ['strong', c.strong],
      [c.kind === 'BARNEY' ? 'vanna-' : 'vanna+', c.vanna],
      ['king-mig', migDir !== 0 && migDir === c.dir],
      ['flow', fl !== 0 && fl === c.dir],
      ['pivot-side', c.dir > 0 ? spot < S.prevClose : spot > S.prevClose],
      ['dp-extension', vah != null && (c.dir < 0 ? spot > vah : spot < val)],
    ];
    c.pass = cr.filter(x => x[1]).length; c.hits = cr.filter(x => x[1]).map(x => x[0]);
    if (!best || c.pass > best.pass) best = c;
  }
  out.push({ sym, spot, kingMig: migDir, flow: fl, ...best });
}
fs.writeFileSync(STATE, JSON.stringify(st));
const now = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5);
console.log(`\n═══ MULTI-INSTRUMENT SCAN · ${now} ET · validated engine (PIKA+BARNEY · 7-criteria) ═══`);
for (const o of out) {
  if (o.note) { console.log(`  ${o.sym.padEnd(4)} ${o.spot.toFixed(1)} · ${o.note}`); continue; }
  console.log(`  ${o.sym.padEnd(4)} ${o.spot.toFixed(1)} · ${o.kind} ${o.dir > 0 ? 'LONG ' : 'SHORT'} @${o.anchor} → tgt ${o.target} · king-mig ${o.kingMig > 0 ? 'UP' : o.kingMig < 0 ? 'DN' : '—'} · flow ${o.flow > 0 ? 'bull' : o.flow < 0 ? 'bear' : '0'} · ${o.pass}/7 [${o.hits.join('+')}]`);
}
const best = out.filter(o => o.pass != null).sort((a, b) => b.pass - a.pass)[0];
console.log(best && best.pass >= THRESH ? `\n>>> BEST: ${best.sym} ${best.kind} ${best.dir > 0 ? 'LONG' : 'SHORT'} @${best.anchor} → ${best.target} (confluence ${best.pass}/7) — WOULD FIRE` : `\n>>> no setup ≥${THRESH}/7 across SPX/SPY/QQQ — stand aside`);
