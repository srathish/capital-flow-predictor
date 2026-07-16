// ── Non-Skylit candidate screener ────────────────────────────────────────
// Finds the handful of individual stocks worth watching as SWING GEX-node
// candidates — WITHOUT touching Skylit. A cheap, broad UW net so we only ever
// poll Skylit for names that already look interesting (never the 500-ticker
// universe). Output: candidates.json (the basket poll.mjs forward-collects).
//
// Doctrine: GEX/VEX analysis comes from Skylit, NEVER UW. UW's own gex_* fields
// are used here ONLY as a weak candidate-selection hint (regime shifting = a
// possible node-flip), never as the analytical surface. See memory
// feedback_gexvex_source_skylit.
//
// Usage: node research/stock-gex/screen.mjs [N=8]
// RESEARCH TOOLING — does not touch live trading code.
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const BASE = 'https://api.unusualwhales.com/api';
const N = Number(process.argv[2]) || 8;

// ── gates (tunable via env) ───────────────────────────────────────────────
const MIN_OI = Number(process.env.SCREEN_MIN_OI) || 300_000;   // dense, tight-spread option chains
const MIN_MCAP = Number(process.env.SCREEN_MIN_MCAP) || 20e9;   // large caps — avoid wide-spread names
const PRICE_MIN = Number(process.env.SCREEN_PRICE_MIN) || 15;
const PRICE_MAX = Number(process.env.SCREEN_PRICE_MAX) || 700;
const MOVE_MIN = Number(process.env.SCREEN_MOVE_MIN) || 0.02;   // must actually move (swing to catch)
const MOVE_MAX = Number(process.env.SCREEN_MOVE_MAX) || 0.15;   // but not a lottery ticket (wide spreads / erratic nodes)

if (!KEY) { console.error('No UNUSUAL_WHALES_API_KEY'); process.exit(1); }

async function screener(order, offset) {
  const u = new URL(BASE + '/screener/stocks');
  u.searchParams.set('order', order);
  u.searchParams.set('order_direction', 'desc');
  u.searchParams.set('limit', '100');
  u.searchParams.set('offset', String(offset));
  const r = await fetch(u, { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) { console.error(`screener ${order} p${offset}: HTTP ${r.status}`); return []; }
  return (await r.json()).data || [];
}

// Broad active-names pool: top by option premium AND by call volume, unioned.
const pool = new Map();
for (const order of ['premium', 'call_volume', 'net_call_premium']) {
  for (const off of [0, 1]) {
    for (const row of await screener(order, off)) if (row?.ticker) pool.set(row.ticker, row);
    await new Promise(r => setTimeout(r, 250));
  }
}
console.log(`pulled ${pool.size} distinct names from UW screener`);

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };

// ── gates ─────────────────────────────────────────────────────────────────
const rows = [...pool.values()].filter(r => {
  if (r.issue_type !== 'Common Stock') return false;            // stocks only (index/ETF = separate workstream)
  const close = num(r.close);
  if (close < PRICE_MIN || close > PRICE_MAX) return false;
  if (num(r.total_open_interest) < MIN_OI) return false;
  if (num(r.marketcap) < MIN_MCAP) return false;
  const mv = num(r.implied_move_perc);
  if (mv < MOVE_MIN || mv > MOVE_MAX) return false;   // tradeable move band
  return true;
});
console.log(`${rows.length} names pass liquidity/price/mcap gates`);

// ── sub-signals per name ────────────────────────────────────────────────────
for (const r of rows) {
  const close = num(r.close), hi = num(r.week_52_high), lo = num(r.week_52_low);
  const rangePos = hi > lo ? (close - lo) / (hi - lo) : 0.5;    // 0=at 52w low, 1=at 52w high
  r._rangePos = rangePos;
  r._liq = Math.log10(num(r.total_open_interest));
  r._activity = num(r.avg_30_day_call_volume) > 0 ? num(r.call_volume) / num(r.avg_30_day_call_volume) : 0; // unusual call day
  r._conviction = num(r.marketcap) > 0 ? Math.abs(num(r.net_call_premium)) / num(r.marketcap) : 0;          // directional $ per size
  r._move = num(r.implied_move_perc);                          // swing-worthiness (expected move)
  r._trend = Math.abs(rangePos - 0.5) * 2;                     // distance from mid-range = trending (either dir)
  r._regime = Math.abs(num(r.gex_perc_change));                // UW gamma regime shift (node-flip HINT only)
  // directional read
  const flowBias = num(r.net_call_premium) > 0 ? 'bull' : 'bear';
  const trendBias = rangePos > 0.6 ? 'up' : rangePos < 0.4 ? 'down' : 'mid';
  r._bias = flowBias === 'bull' && trendBias !== 'down' ? 'BULL'
    : flowBias === 'bear' && trendBias === 'down' ? 'BEAR'
    : trendBias === 'up' ? 'BULL' : trendBias === 'down' ? 'BEAR' : 'MIXED';
}

// ── percentile-rank each sub-signal across the pool (robust to outliers) ────
function pctRank(arr, key) {
  const sorted = [...arr].map(r => r[key]).sort((a, b) => a - b);
  for (const r of arr) {
    const v = r[key];
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
    r['_p' + key] = sorted.length > 1 ? lo / (sorted.length - 1) : 0.5;
  }
}
for (const k of ['_liq', '_activity', '_conviction', '_move', '_trend', '_regime']) pctRank(rows, k);

// ── composite score ─────────────────────────────────────────────────────────
const W = { _liq: 0.28, _conviction: 0.22, _trend: 0.22, _activity: 0.12, _move: 0.08, _regime: 0.08 };
for (const r of rows) r._score = Object.entries(W).reduce((s, [k, w]) => s + w * r['_p' + k], 0);
rows.sort((a, b) => b._score - a._score);

const top = rows.slice(0, N).map((r, i) => ({
  rank: i + 1,
  ticker: r.ticker,
  name: r.full_name,
  sector: r.sector,
  close: num(r.close),
  marketcap: num(r.marketcap),
  bias: r._bias,
  score: +r._score.toFixed(3),
  signals: {
    total_oi: num(r.total_open_interest),
    call_day_vs_avg: +r._activity.toFixed(2),
    net_call_premium: num(r.net_call_premium),
    implied_move_pct: +(r._move * 100).toFixed(1),
    range_pos_52w: +r._rangePos.toFixed(2),
    iv_rank: num(r.iv_rank),
    uw_gex_regime_hint: +r._regime.toFixed(3),
    next_earnings: r.next_earnings_date,
  },
  breakdown: { liq: +r._p_liq.toFixed(2), conviction: +r._p_conviction.toFixed(2), move: +r._p_move.toFixed(2), trend: +r._p_trend.toFixed(2), activity: +r._p_activity.toFixed(2), regime: +r._p_regime.toFixed(2) },
}));

const out = { as_of: rows[0]?.date || null, generated: process.argv[3] || null, gates: { MIN_OI, MIN_MCAP, PRICE_MIN, PRICE_MAX }, weights: W, count: top.length, candidates: top };
const file = path.join(HERE, 'candidates.json');
fs.writeFileSync(file, JSON.stringify(out, null, 2));

console.log(`\nTOP ${N} SWING GEX-NODE CANDIDATES (UW screen, no Skylit):`);
console.log('  #  TICKER   bias   score  OI(M)  impMove%  52wPos  netCallPrem($M)  why');
for (const c of top) {
  console.log(`  ${String(c.rank).padStart(2)} ${c.ticker.padEnd(6)} ${c.bias.padEnd(6)} ${c.score.toFixed(3)}  ${(c.signals.total_oi / 1e6).toFixed(1).padStart(5)}  ${c.signals.implied_move_pct.toFixed(1).padStart(6)}  ${c.signals.range_pos_52w.toFixed(2).padStart(5)}  ${(c.signals.net_call_premium / 1e6).toFixed(1).padStart(8)}       ${c.sector}`);
}
console.log(`\n-> ${file}`);
