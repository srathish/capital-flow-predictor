#!/usr/bin/env node
/**
 * Daily opportunity study — for each of the 60 days, measure the total available
 * movement on SPY/SPXW/QQQ and how much our system actually captured. Plus the
 * empirical tap-respect rates and where big intraday moves happened.
 *
 * Usage:
 *   DATA_DIR=./data/replay-experiments/baseline/data node scripts/study-daily-opportunity.js
 *   (npm script: `npm run study`)
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { config } from '../src/utils/config.js';

const dbPath = join(config.dataDir, 'gexester.db');
const db = new Database(dbPath, { readonly: true });

const fmt = (n, d=1) => n == null || Number.isNaN(n) ? '—' : Number(n).toFixed(d);
const pad = (s, w) => String(s).padEnd(w);
function header(t) { console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  ${t}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`); }

// Deflection zone per ticker, in spot units, per spec §6.2
const ZONE = { SPXW: 5.0, SPY: 0.5, QQQ: 0.5 };

// ─────────────────────────────────────────────────────────────────────────────
// 1. Per-ticker per-day movement metrics
//    range, total abs minute-by-minute motion, big-move minute count, OC return
// ─────────────────────────────────────────────────────────────────────────────
header('1. Daily opportunity per ticker (everything in bps unless noted)');

const dailyMetrics = db.prepare(`
  WITH ordered AS (
    SELECT trading_day, ticker, ts_ms, spot,
      LAG(spot) OVER (PARTITION BY trading_day, ticker ORDER BY ts_ms) prev_spot,
      FIRST_VALUE(spot) OVER (PARTITION BY trading_day, ticker ORDER BY ts_ms) open_spot,
      FIRST_VALUE(spot) OVER (PARTITION BY trading_day, ticker ORDER BY ts_ms DESC
                               ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) close_spot
    FROM snapshots
  )
  SELECT trading_day, ticker,
    MIN(spot) lo, MAX(spot) hi,
    MAX(open_spot) open_spot,
    MAX(close_spot) close_spot,
    SUM(CASE WHEN prev_spot IS NULL THEN 0 ELSE ABS(spot - prev_spot) END) total_abs_move,
    COUNT(CASE WHEN prev_spot IS NOT NULL AND ABS(spot - prev_spot)/prev_spot >= 0.0015 THEN 1 END) big_move_minutes,
    COUNT(*) frame_count
  FROM ordered
  GROUP BY trading_day, ticker
  HAVING frame_count > 50
  ORDER BY trading_day, ticker
`).all();

// Sum per ticker for header
const tickerTotals = {};
for (const r of dailyMetrics) {
  const range_bps = (r.hi - r.lo) / r.open_spot * 10000;
  const total_abs_bps = r.total_abs_move / r.open_spot * 10000;
  const oc_bps = (r.close_spot - r.open_spot) / r.open_spot * 10000;
  if (!tickerTotals[r.ticker]) tickerTotals[r.ticker] = { range:0, abs:0, big:0, days:0 };
  const t = tickerTotals[r.ticker];
  t.range += range_bps; t.abs += total_abs_bps; t.big += r.big_move_minutes; t.days++;
}
console.log('  Ticker  | days | avg_range | avg_total_abs | avg_big_min | total_abs_60d');
console.log('  ────────┼──────┼───────────┼───────────────┼─────────────┼──────────────');
for (const [tkr, t] of Object.entries(tickerTotals)) {
  console.log(`  ${pad(tkr,7)} | ${pad(t.days,4)} | ${pad(fmt(t.range/t.days),9)} | ${pad(fmt(t.abs/t.days),13)} | ${pad(fmt(t.big/t.days),11)} | ${pad(fmt(t.abs,0),12)}`);
}
console.log('  (avg_range, avg_total_abs in bps; avg_big_min = minutes/day with |Δspot|/spot ≥ 15bps)');

// ─────────────────────────────────────────────────────────────────────────────
// 2. Per-day capture summary across all 3 tickers
// ─────────────────────────────────────────────────────────────────────────────
header('2. Capture per day (10 best + 10 worst missed-opportunity days)');

const captureByDay = db.prepare(`
  SELECT
    dl.trading_day AS trading_day,
    SUM(CASE WHEN dl.decision = 'would_enter' THEN 1 ELSE 0 END) accepts,
    ROUND(SUM(CASE WHEN dl.decision = 'would_enter' THEN dout.ret_30m END) * 10000, 1) captured_bps_30m
  FROM decision_log dl
  LEFT JOIN decision_outcomes dout USING (decision_id)
  GROUP BY dl.trading_day
`).all();

// Build a per-day total opportunity (sum total_abs_bps across 3 tickers)
const oppByDay = {};
for (const r of dailyMetrics) {
  const total_abs_bps = r.total_abs_move / r.open_spot * 10000;
  oppByDay[r.trading_day] = (oppByDay[r.trading_day] || 0) + total_abs_bps;
}
const merged = captureByDay.map(c => ({
  day: c.trading_day,
  opp_bps: Math.round(oppByDay[c.trading_day] || 0),
  accepts: c.accepts,
  captured: c.captured_bps_30m ?? 0,
  capture_pct: oppByDay[c.trading_day]
    ? ((c.captured_bps_30m ?? 0) / oppByDay[c.trading_day] * 100).toFixed(2)
    : '—',
}));

const byCaptureDesc = [...merged].sort((a, b) => (b.captured ?? -1e9) - (a.captured ?? -1e9));
const byOppDescNoCapture = [...merged]
  .filter(d => d.accepts === 0 && d.opp_bps > 0)
  .sort((a, b) => b.opp_bps - a.opp_bps);

console.log('  TOP 10 CAPTURED DAYS (by bps captured):');
console.log('  day         | opp_bps | accepts | captured_bps | capture %');
console.log('  ────────────┼─────────┼─────────┼──────────────┼──────────');
for (const r of byCaptureDesc.slice(0, 10)) {
  console.log(`  ${pad(r.day,11)} | ${pad(r.opp_bps,7)} | ${pad(r.accepts,7)} | ${pad(fmt(r.captured),12)} | ${r.capture_pct}%`);
}

console.log('\n  TOP 10 MISSED-OPPORTUNITY DAYS (high movement, zero accepts):');
console.log('  day         | opp_bps | accepts');
console.log('  ────────────┼─────────┼────────');
for (const r of byOppDescNoCapture.slice(0, 10)) {
  console.log(`  ${pad(r.day,11)} | ${pad(r.opp_bps,7)} | 0`);
}

// 60-day rollup
const totalOpp = merged.reduce((s, r) => s + r.opp_bps, 0);
const totalCap = merged.reduce((s, r) => s + (r.captured || 0), 0);
const totalAccepts = merged.reduce((s, r) => s + r.accepts, 0);
console.log('\n  60-DAY ROLLUP:');
console.log(`  total opportunity (sum of |Δspot|/spot across all 3 tickers, 60 days): ${totalOpp.toLocaleString()} bps`);
console.log(`  total captured (sum of ret_30m on accepts):                            ${fmt(totalCap)} bps`);
console.log(`  capture ratio:                                                         ${(totalCap / totalOpp * 100).toFixed(3)}%`);
console.log(`  total accepts:                                                         ${totalAccepts}  (${(totalAccepts/60).toFixed(2)}/day)`);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Tap respect/break rates by tap count (empirical version of spec §6.4)
//    Per spec: 1st tap ~80% reaction, 2nd ~66%, 3rd ~33%
// ─────────────────────────────────────────────────────────────────────────────
header('3. Tap reaction empirical (spec claims 1st=80%, 2nd=66%, 3rd=33%, 4+=no edge)');

const tapEvents = db.prepare(`
  SELECT e.ts_ms, e.trading_day, e.ticker, e.strike, e.event_type,
    (SELECT spot FROM snapshots s
     WHERE s.ticker = e.ticker AND s.trading_day = e.trading_day
       AND s.ts_ms >= e.ts_ms + 5*60*1000
     ORDER BY s.ts_ms ASC LIMIT 1) spot_5m,
    (SELECT spot FROM snapshots s
     WHERE s.ticker = e.ticker AND s.trading_day = e.trading_day
       AND s.ts_ms = e.ts_ms
     LIMIT 1) spot_at_tap
  FROM event_log e
  WHERE e.event_type IN ('tap_1st','tap_2nd','tap_3rd','tap_4plus')
`).all();

const tapStats = {};
for (const t of tapEvents) {
  if (t.spot_5m == null) continue;
  const zone = ZONE[t.ticker] || 0.5;
  // Respect: spot moved AWAY from strike (in the direction expected by deflection)
  // Define respect as |spot_5m - strike| > zone (price has cleared the deflection zone moving away)
  // AND moved in either direction by at least 1× zone — i.e. the level didn't keep price pinned
  const distAtTap = Math.abs(t.spot_at_tap - t.strike);
  const dist5m = Math.abs(t.spot_5m - t.strike);
  // Simpler: did spot move ≥1× zone away from strike within 5 min?
  const moved = dist5m > zone;
  // Direction-correct deflection: spot at tap was inside zone (≤ zone away). After 5 min,
  //   distance > zone AND on the same side as it approached from = respected.
  // For now we use the simpler "moved away" definition. Break = spot crossed past strike or stayed inside.
  const respected = dist5m > zone;
  // crossed = spot 5m later is on the opposite side of strike vs at tap
  const crossed = (t.spot_at_tap < t.strike && t.spot_5m > t.strike + zone) ||
                  (t.spot_at_tap > t.strike && t.spot_5m < t.strike - zone);

  const key = t.event_type;
  if (!tapStats[key]) tapStats[key] = { n:0, respected:0, crossed:0 };
  tapStats[key].n++;
  if (respected) tapStats[key].respected++;
  if (crossed) tapStats[key].crossed++;
}

console.log('  tap     | n     | respected | %      | crossed | %');
console.log('  ────────┼───────┼───────────┼────────┼─────────┼──────');
const order = ['tap_1st','tap_2nd','tap_3rd','tap_4plus'];
for (const k of order) {
  const s = tapStats[k];
  if (!s) { console.log(`  ${pad(k,7)} | (no events)`); continue; }
  const respPct = (s.respected/s.n*100).toFixed(1);
  const crossPct = (s.crossed/s.n*100).toFixed(1);
  console.log(`  ${pad(k,7)} | ${pad(s.n,5)} | ${pad(s.respected,9)} | ${pad(respPct,6)} | ${pad(s.crossed,7)} | ${crossPct}`);
}
console.log('  (respected = price moved >1× zone away within 5min;  crossed = price ended on opposite side)');

// ─────────────────────────────────────────────────────────────────────────────
// 4. Big-move minutes: at-structure vs air-pocket
// ─────────────────────────────────────────────────────────────────────────────
header('4. Where the big moves happened — at structural levels vs in air pockets');

// For each "big" 1-minute move (≥15bps), check if the snapshot at the START of the minute
// had a node ≥3% rel_sig within 1× deflection zone of spot. That's "at structure."
const bigMoveLocations = db.prepare(`
  WITH big_moves AS (
    SELECT trading_day, ticker, ts_ms, spot, prev_spot
    FROM (
      SELECT trading_day, ticker, ts_ms, spot,
        LAG(spot) OVER (PARTITION BY trading_day, ticker ORDER BY ts_ms) prev_spot
      FROM snapshots
    )
    WHERE prev_spot IS NOT NULL AND ABS(spot - prev_spot)/prev_spot >= 0.0015
  ),
  classified AS (
    SELECT bm.ticker, bm.trading_day, bm.ts_ms, bm.spot,
      EXISTS (
        SELECT 1 FROM node_snapshots ns
        WHERE ns.ticker = bm.ticker AND ns.trading_day = bm.trading_day
          AND ns.ts_ms = bm.ts_ms
          AND ns.relative_significance >= 0.03
          AND ABS(ns.strike - bm.spot) <= CASE WHEN bm.ticker='SPXW' THEN 5 ELSE 0.5 END
      ) AS at_structure
    FROM big_moves bm
  )
  SELECT ticker,
    COUNT(*) total_big_moves,
    SUM(at_structure) at_structure,
    COUNT(*) - SUM(at_structure) air_pocket,
    ROUND(SUM(at_structure) * 100.0 / COUNT(*), 1) at_structure_pct
  FROM classified
  GROUP BY ticker
`).all();

console.log('  ticker | big_moves | at_structure | air_pocket | at_structure %');
console.log('  ───────┼───────────┼──────────────┼────────────┼───────────────');
for (const r of bigMoveLocations) {
  console.log(`  ${pad(r.ticker,6)} | ${pad(r.total_big_moves,9)} | ${pad(r.at_structure,12)} | ${pad(r.air_pocket,10)} | ${r.at_structure_pct}%`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Capture-vs-opportunity scatter view (rough)
// ─────────────────────────────────────────────────────────────────────────────
header('5. Capture vs opportunity quartiles');

const sortedByOpp = [...merged].sort((a, b) => a.opp_bps - b.opp_bps);
const q = i => sortedByOpp[Math.floor(sortedByOpp.length * i)]?.opp_bps;
const quartiles = [
  { name: 'Q1 (quietest 25%)', filter: r => r.opp_bps <= q(0.25) },
  { name: 'Q2 (25-50%)',       filter: r => r.opp_bps > q(0.25) && r.opp_bps <= q(0.50) },
  { name: 'Q3 (50-75%)',       filter: r => r.opp_bps > q(0.50) && r.opp_bps <= q(0.75) },
  { name: 'Q4 (most active 25%)', filter: r => r.opp_bps > q(0.75) },
];
console.log('  quartile               | days | avg_opp | total_capt | avg_accepts/day');
console.log('  ───────────────────────┼──────┼─────────┼────────────┼────────────────');
for (const q of quartiles) {
  const rows = merged.filter(q.filter);
  const avgOpp = rows.reduce((s,r)=>s+r.opp_bps,0) / rows.length;
  const totCap = rows.reduce((s,r)=>s+(r.captured||0),0);
  const avgAcc = rows.reduce((s,r)=>s+r.accepts,0) / rows.length;
  console.log(`  ${pad(q.name,22)} | ${pad(rows.length,4)} | ${pad(fmt(avgOpp,0),7)} | ${pad(fmt(totCap),10)} | ${fmt(avgAcc,2)}`);
}

console.log();
db.close();
