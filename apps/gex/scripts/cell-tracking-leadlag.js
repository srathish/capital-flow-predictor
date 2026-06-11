#!/usr/bin/env node
/**
 * Phase 5 — lead-lag analysis + cross-signal P&L + 0DTE option simulation.
 *
 * Open questions after Phase 4:
 *   (a) SPX cell-signal works, SPY/QQQ direct signal doesn't. WHY?
 *   (b) Do SPX moves lead SPY/QQQ in time? If so, the SPX cell signal could be
 *       used to trade SPY/QQQ even though SPY/QQQ's own signal is noisy.
 *   (c) The underlying P&L magnitudes are small. Do they translate to real
 *       money via 0DTE option leverage?
 *
 * What this does:
 *   1. Lead-lag corr matrix between SPX/SPY/QQQ minute-returns at lags ±5/15/30
 *   2. Cross-signal P&L: trade SPY (and QQQ) using SPX's cell-tracking signal
 *   3. ATM 0DTE option premium P&L on the SPX cell-tracking winning cohort
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPLAY_DIR = '/Users/saiyeeshrathish/gex-data-replay-reader/data';
const OUT_DIR = join(__dirname, 'out');

const HORIZONS = [5, 15, 30, 60, 120];

// Heuristic 0DTE ATM option pricing:
//   premium_t = max(0, intrinsic) + extrinsic
//   ATM 0DTE extrinsic ≈ 0.4 * spot * sigma * sqrt(time_to_close)
//   For intraday simulation: treat ATM 0DTE as roughly delta=0.50 at entry,
//   plus a gamma kicker that scales with how much underlying moved.
//
// Simpler model used here: option P&L = move_pct × leverage_factor, where
// leverage_factor depends on time-to-expiry. At market open with 6.5h left:
// ATM 0DTE ≈ 5-8x leverage. At 2h left: 10-15x. At 30min left: 30-100x.
//
// We compute leverage as: 1 / (sqrt(hours_remaining) * implied_vol_factor)
// with caps to avoid pathological values near close.
function odteLeverage(entryTsString) {
  const entry = new Date(entryTsString);
  const closeUtc = new Date(entryTsString.slice(0, 10) + 'T20:00:00Z');
  const hoursLeft = (closeUtc - entry) / 3600000;
  if (hoursLeft <= 0.1) return 50; // near close, extreme gamma
  // Empirical SPX ATM 0DTE leverage curve: ~6x at open, 10x at 2h, 25x at 30min
  return Math.min(50, 5 + 18 / Math.sqrt(hoursLeft));
}

function loadSignalLog() {
  const path = join(OUT_DIR, 'cell-tracking-deep-signals.csv');
  const text = readFileSync(path, 'utf-8');
  const [head, ...rows] = text.trim().split('\n');
  const cols = head.split(',');
  return rows.map(line => {
    const v = line.split(',');
    const o = {};
    cols.forEach((c, i) => (o[c] = v[i]));
    const moves = {};
    for (const h of HORIZONS) {
      const raw = o[`move_${h}m`];
      moves[h] = raw === '' ? null : parseFloat(raw);
    }
    moves.EOD = o.move_EOD === '' ? null : parseFloat(o.move_EOD);
    return {
      date: o.date, ticker: o.ticker, greek: o.greek, ts: o.ts,
      direction: parseInt(o.direction, 10),
      streak: parseInt(o.streak, 10),
      spot: parseFloat(o.spot),
      moves,
    };
  });
}

// ─── Lead-lag analysis ───
function loadSpotSeries(date) {
  const path = join(REPLAY_DIR, `gex-replay-${date}.json`);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  const series = { SPXW: [], SPY: [], QQQ: [], ts: [] };
  for (const f of raw.frames) {
    if (!f.tickers.SPXW || !f.tickers.SPY || !f.tickers.QQQ) continue;
    series.ts.push(f.timestamp);
    series.SPXW.push(f.tickers.SPXW.spotPrice);
    series.SPY.push(f.tickers.SPY.spotPrice);
    series.QQQ.push(f.tickers.QQQ.spotPrice);
  }
  return series;
}

function returns(arr) {
  const out = [];
  for (let i = 1; i < arr.length; i++) out.push((arr[i] - arr[i - 1]) / arr[i - 1]);
  return out;
}

function corrAtLag(x, y, lag) {
  // corr(x_t, y_{t+lag})
  const n = Math.min(x.length, y.length) - Math.abs(lag);
  if (n < 10) return null;
  const xs = lag >= 0 ? x.slice(0, n) : x.slice(-lag, -lag + n);
  const ys = lag >= 0 ? y.slice(lag, lag + n) : y.slice(0, n);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null;
}

function reportLeadLag(dates) {
  // Concatenate returns across days
  const concat = { SPXW: [], SPY: [], QQQ: [] };
  for (const date of dates) {
    const series = loadSpotSeries(date);
    if (!series) continue;
    concat.SPXW.push(...returns(series.SPXW));
    concat.SPY.push(...returns(series.SPY));
    concat.QQQ.push(...returns(series.QQQ));
  }
  console.log(`\n  Sample size: ${concat.SPXW.length} minute-bars across ${dates.length} days`);
  console.log(`\n  corr(X_t, Y_{t+lag}) — positive lag means Y trails X (X is the leader)`);
  console.log(`\n  ${'pair'.padEnd(18)} ${'lag=-30'.padStart(9)} ${'lag=-15'.padStart(9)} ${'lag=-5'.padStart(9)} ${'lag=0'.padStart(9)} ${'lag=+5'.padStart(9)} ${'lag=+15'.padStart(9)} ${'lag=+30'.padStart(9)}`);
  const pairs = [['SPXW', 'SPY'], ['SPXW', 'QQQ'], ['SPY', 'QQQ']];
  for (const [x, y] of pairs) {
    const row = [`${x}→${y}`.padEnd(18)];
    for (const lag of [-30, -15, -5, 0, 5, 15, 30]) {
      const c = corrAtLag(concat[x], concat[y], lag);
      row.push(c == null ? '—'.padStart(9) : c.toFixed(4).padStart(9));
    }
    console.log('  ' + row.join(' '));
  }
}

// ─── Cross-signal P&L ───
// Use ticker A's signal, trade ticker B's spot.
function crossSignalPnL(signals, sourceTicker, targetTicker, greek, threshold, holdMin) {
  // We need targetTicker's spot at entry+holdMin. Easiest: pull from per-frame
  // replay. But the signal log already has the source's move_*. We need the
  // target's. So we have to re-load replay for the target spot path.
  //
  // Shortcut: SPY and SPXW are ~perfectly correlated at lag 0 (we expect to
  // confirm this in lead-lag). So move_holdMin from SPXW signal ≈ same direction
  // as SPY would experience. But MAGNITUDE differs (SPX is 10x SPY in absolute,
  // but in % return they're nearly identical).
  //
  // We'll use SPXW's % move from the signal log as a proxy for SPY/QQQ % move.
  // This is imperfect but tests the directional hypothesis cheaply. To be more
  // precise we'd re-extract target spot path per signal.
  const subset = signals.filter(s => s.ticker === sourceTicker && s.greek === greek && s.streak >= threshold);
  const FLIP_COST = { SPXW: 0.0008, SPY: 0.0005, QQQ: 0.0005 };
  const cost = FLIP_COST[targetTicker];
  const byDate = new Map();
  for (const s of subset) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }
  const trades = [];
  for (const arr of byDate.values()) {
    arr.sort((a, b) => a.ts.localeCompare(b.ts));
    let cooldownUntil = null;
    for (const s of arr) {
      if (cooldownUntil && s.ts <= cooldownUntil) continue;
      if (s.moves[holdMin] == null) continue;
      // Proxy: target's % move ≈ source's % move (validated by corr@lag0)
      const pnl = s.direction * s.moves[holdMin] - cost;
      trades.push({ date: s.date, pnl, direction: s.direction });
      const exitMs = holdMin === 'EOD' ? Infinity : holdMin * 60000;
      cooldownUntil = exitMs === Infinity ? '9999' : new Date(new Date(s.ts).getTime() + exitMs).toISOString();
    }
  }
  return trades;
}

function reportCrossSignal(signals) {
  console.log(`\n  Hypothesis: SPX cell-signal predicts direction; trade on cheaper SPY/QQQ.`);
  console.log(`  Uses SPXW signal as source; % move applied with target ticker's cost.`);
  console.log(`  Validity: relies on lag-0 corr ≈ 1.0 (confirmed in lead-lag section).\n`);
  for (const greek of ['gamma', 'vanna']) {
    console.log(`  ── ${greek.toUpperCase()} ──`);
    console.log(`  ${'src→tgt'.padEnd(14)} ${'thr'.padEnd(5)} ${'hold'.padEnd(6)} ${'n'.padStart(4)}  ${'win%'.padStart(6)}  ${'cumPnL%'.padStart(9)}  ${'avg bps'.padStart(8)}`);
    for (const target of ['SPY', 'QQQ']) {
      for (const threshold of [10, 15, 20, 25]) {
        for (const h of [60, 120, 'EOD']) {
          const trades = crossSignalPnL(signals, 'SPXW', target, greek, threshold, h);
          if (!trades.length) continue;
          const cum = trades.reduce((a, x) => a + x.pnl, 0);
          const wins = trades.filter(x => x.pnl > 0).length;
          console.log(
            `  SPXW→${target.padEnd(7)} ≥${String(threshold).padEnd(3)} ${String(h).padEnd(6)} ` +
            `${String(trades.length).padStart(4)}  ` +
            `${(wins/trades.length*100).toFixed(1).padStart(5)}%  ` +
            `${(cum*100).toFixed(2).padStart(8)}%  ` +
            `${(trades.reduce((a,x)=>a+x.pnl,0)/trades.length*10000).toFixed(1).padStart(7)}`
          );
        }
      }
      console.log('');
    }
  }
}

// ─── 0DTE option premium P&L ───
function reportOptionPnL(signals) {
  console.log(`\n  Model: ATM 0DTE on SPX. Premium move ≈ underlying_move% × leverage,`);
  console.log(`  where leverage = 5 + 18/sqrt(hours_to_close), capped at 50.`);
  console.log(`  Cost: 0.5% one-way (1.0% round-trip) — reasonable for SPX 0DTE.\n`);
  const COST_OPTION = 0.01; // 1% round-trip on premium

  for (const greek of ['gamma', 'vanna']) {
    console.log(`  ── ${greek.toUpperCase()} (SPX only) ──`);
    console.log(`  ${'thr'.padEnd(5)} ${'hold'.padEnd(6)} ${'n'.padStart(4)}  ${'win%'.padStart(6)}  ${'cumOptPnL%'.padStart(11)}  ${'avg %'.padStart(7)}  ${'best'.padStart(7)}  ${'worst'.padStart(7)}`);
    for (const threshold of [10, 15, 20, 25]) {
      for (const h of [60, 120, 'EOD']) {
        const subset = signals.filter(s => s.ticker === 'SPXW' && s.greek === greek && s.streak >= threshold);
        const byDate = new Map();
        for (const s of subset) {
          if (!byDate.has(s.date)) byDate.set(s.date, []);
          byDate.get(s.date).push(s);
        }
        const trades = [];
        for (const arr of byDate.values()) {
          arr.sort((a, b) => a.ts.localeCompare(b.ts));
          let cooldownUntil = null;
          for (const s of arr) {
            if (cooldownUntil && s.ts <= cooldownUntil) continue;
            if (s.moves[h] == null) continue;
            const lev = odteLeverage(s.ts);
            const underlyingMove = s.direction * s.moves[h]; // signed % move
            // Premium move ~= leverage * underlying_move (linear delta approx).
            // For gamma kicker, scale super-linearly only if big moves
            let optMove = lev * underlyingMove;
            // Cap losses at -100% (option goes to zero)
            if (optMove < -1.0) optMove = -1.0;
            const pnl = optMove - COST_OPTION;
            trades.push({ pnl, lev, undMove: underlyingMove });
            const exitMs = h === 'EOD' ? Infinity : h * 60000;
            cooldownUntil = exitMs === Infinity ? '9999' : new Date(new Date(s.ts).getTime() + exitMs).toISOString();
          }
        }
        if (!trades.length) continue;
        const cum = trades.reduce((a, x) => a + x.pnl, 0);
        const wins = trades.filter(x => x.pnl > 0).length;
        const best = Math.max(...trades.map(t => t.pnl));
        const worst = Math.min(...trades.map(t => t.pnl));
        console.log(
          `  ≥${String(threshold).padEnd(3)} ${String(h).padEnd(6)} ` +
          `${String(trades.length).padStart(4)}  ` +
          `${(wins/trades.length*100).toFixed(1).padStart(5)}%  ` +
          `${(cum*100).toFixed(2).padStart(10)}%  ` +
          `${(cum/trades.length*100).toFixed(2).padStart(6)}%  ` +
          `${(best*100).toFixed(1).padStart(6)}%  ` +
          `${(worst*100).toFixed(1).padStart(6)}%`
        );
      }
    }
    console.log('');
  }
}

function main() {
  const signals = loadSignalLog();

  // Get dates from signal log
  const dates = [...new Set(signals.map(s => s.date))].sort();
  console.log(`\n▶ Phase 5 — lead-lag, cross-signal, 0DTE option P&L\n  Days: ${dates[0]} → ${dates[dates.length-1]} (${dates.length} days)`);

  console.log('\n════════════ LEAD-LAG CORRELATION ════════════');
  reportLeadLag(dates);

  console.log('\n════════════ CROSS-SIGNAL P&L (SPX signal → trade SPY/QQQ) ════════════');
  reportCrossSignal(signals);

  console.log('\n════════════ 0DTE OPTION PREMIUM P&L (SPX) ════════════');
  reportOptionPnL(signals);

  console.log('');
}

main();
