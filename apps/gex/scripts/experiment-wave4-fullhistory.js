#!/usr/bin/env node
/**
 * Wave 4 — full 72-day validation of the refined strategy.
 *
 * Refined strategy from wave 3:
 *   • Session: 11:30-12:00 ET (lunch chop first 30 min)
 *   • Regime gate: regimeScore > +0.1
 *   • Direction: follow recent 15-min spot move
 *   • Hold: to EOD
 *   • Exit: 0.3% take-profit OR trailing 0.5% OR no exit (hold)
 *
 * Plus variants:
 *   • Full lunch (11:30-12:30 vs 11:30-13:30)
 *   • Per-ticker isolation
 *   • Direction-asymmetric (only take SHORT signals)
 *   • Different TP / trail / stop levels
 *
 * Validation: split the 72 days into 3 epochs (Dec 2025, Jan-Feb 2026, Mar-May
 * 2026) and check consistency.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPLAY_DIR = '/Users/saiyeeshrathish/gex-data-replay-reader/data';
const OUT_DIR = join(__dirname, 'out');
const TICKERS = ['SPXW', 'SPY', 'QQQ'];

const FLIP_COST = { SPXW: 0.0008, SPY: 0.0005, QQQ: 0.0005 };
const VEL_WINDOW = 5;
const MIN_FLOOR_CEIL_REL = 0.02;

function loadReplay(path) {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  const out = {};
  for (const t of TICKERS) {
    const frames = [];
    for (const f of raw.frames) {
      const tk = f.tickers[t];
      if (!tk || !tk.spotPrice || !Array.isArray(tk.gammaValues)) continue;
      frames.push({ ts: f.timestamp, spot: tk.spotPrice, strikes: tk.strikes, gamma: tk.gammaValues, vanna: tk.vannaValues });
    }
    out[t] = frames;
  }
  return out;
}

function computeFrameState(frame) {
  const { spot, strikes, gamma, vanna } = frame;
  let totalAbs = 0, signedTotal = 0;
  let king = null, kingAbs = 0;
  for (let i = 0; i < strikes.length; i++) {
    const g = gamma[i]?.[0] ?? 0;
    const ag = Math.abs(g);
    totalAbs += ag;
    signedTotal += g;
    if (ag > kingAbs) { kingAbs = ag; king = { strike: strikes[i], gamma: g, absG: ag }; }
  }
  if (totalAbs === 0) return null;
  const regimeScore = signedTotal / totalAbs;
  return { ts: frame.ts, spot, regimeScore, king };
}

function precomputeForTicker(frames) {
  const states = frames.map(f => computeFrameState(f));
  const recent15MinReturn = new Array(frames.length).fill(0);
  for (let i = 0; i < frames.length; i++) {
    const lb = Math.max(0, i - 15);
    recent15MinReturn[i] = (frames[i].spot - frames[lb].spot) / frames[lb].spot;
  }
  return { frames, states, recent15MinReturn };
}

function inSession(ts, h0, h1) {
  const d = new Date(ts);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return h >= h0 && h < h1;
}

function simulate(byDayTicker, signalFn, hold, options = {}) {
  const { stopPct = null, takePct = null, trailingPct = null, tickerFilter = null } = options;
  const trades = [];
  for (const [date, byTicker] of Object.entries(byDayTicker)) {
    for (const ticker of TICKERS) {
      if (tickerFilter && ticker !== tickerFilter) continue;
      const p = byTicker[ticker];
      if (!p) continue;
      const cost = FLIP_COST[ticker];
      let cooldownUntil = null;
      for (let i = 0; i < p.frames.length; i++) {
        const st = p.states[i]; if (!st) continue;
        const direction = signalFn(st, p, i, { ticker });
        if (direction === 0) continue;
        if (cooldownUntil && p.frames[i].ts <= cooldownUntil) continue;
        const entrySpot = p.frames[i].spot;
        const maxExitIdx = hold === 'EOD' ? p.frames.length - 1 : Math.min(i + hold, p.frames.length - 1);
        let exitIdx = maxExitIdx;
        let peakRet = 0;
        let hitStop = false, hitTake = false, hitTrail = false;
        for (let j = i + 1; j <= maxExitIdx; j++) {
          const ret = (p.frames[j].spot - entrySpot) / entrySpot * direction;
          if (ret > peakRet) peakRet = ret;
          if (stopPct != null && ret <= -stopPct) { exitIdx = j; hitStop = true; break; }
          if (takePct != null && ret >= takePct) { exitIdx = j; hitTake = true; break; }
          if (trailingPct != null && peakRet > 0 && (peakRet - ret) >= trailingPct) { exitIdx = j; hitTrail = true; break; }
        }
        const moveReturn = (p.frames[exitIdx].spot - entrySpot) / entrySpot;
        const pnl = direction * moveReturn - cost;
        trades.push({ date, ticker, ts: p.frames[i].ts, direction, pnl, hitStop, hitTake, hitTrail });
        cooldownUntil = new Date(new Date(p.frames[i].ts).getTime() + (exitIdx - i) * 60000).toISOString();
      }
    }
  }
  return trades;
}

function summarize(trades) {
  if (!trades.length) return null;
  const cum = trades.reduce((a, t) => a + t.pnl, 0);
  const avg = cum / trades.length;
  const wins = trades.filter(t => t.pnl > 0).length;
  const variance = trades.reduce((a, t) => a + (t.pnl - avg) ** 2, 0) / trades.length;
  const sharpe = variance > 0 ? avg / Math.sqrt(variance) : 0;
  return { n: trades.length, winRate: wins / trades.length, avgPnL: avg, cumPnL: cum, sharpe, best: Math.max(...trades.map(t => t.pnl)), worst: Math.min(...trades.map(t => t.pnl)) };
}

const sigBare = (st, p, i) => {
  if (!inSession(st.ts, 15.5, 17.5)) return 0;
  if (st.regimeScore <= 0.1) return 0;
  return Math.sign(p.recent15MinReturn[i] || 0);
};
const sigNarrow = (st, p, i) => {
  if (!inSession(st.ts, 15.5, 16.5)) return 0; // 11:30-12:30 only
  if (st.regimeScore <= 0.1) return 0;
  return Math.sign(p.recent15MinReturn[i] || 0);
};
const sigTight = (st, p, i) => {
  if (!inSession(st.ts, 15.5, 16.0)) return 0; // 11:30-12:00 only
  if (st.regimeScore <= 0.1) return 0;
  return Math.sign(p.recent15MinReturn[i] || 0);
};

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(REPLAY_DIR).filter(f => /^gex-replay-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const allDates = files.map(f => f.match(/(\d{4}-\d{2}-\d{2})/)[1]);
  console.log(`\n▶ Wave 4: full-history validation on ${allDates.length} days (${allDates[0]} → ${allDates[allDates.length-1]})\n`);

  console.log('Precomputing...');
  const t0 = Date.now();
  const byDayTicker = {};
  for (const date of allDates) {
    const path = join(REPLAY_DIR, `gex-replay-${date}.json`);
    if (!existsSync(path)) continue;
    try {
      const replay = loadReplay(path);
      byDayTicker[date] = {};
      for (const ticker of TICKERS) {
        const frames = replay[ticker];
        if (!frames || frames.length < VEL_WINDOW + 30) continue;
        byDayTicker[date][ticker] = precomputeForTicker(frames);
      }
    } catch (e) {
      console.error(`  [skip] ${date}: ${e.message}`);
    }
  }
  console.log(`Loaded ${Object.keys(byDayTicker).length} days in ${Math.round((Date.now() - t0) / 1000)}s\n`);

  // Define strategy variants to compare
  const strategies = [
    { id: 'S1.bare_lunch_pos_regime_EOD', signalFn: sigBare, hold: 'EOD' },
    { id: 'S2.tight_window_1130-1200_EOD', signalFn: sigTight, hold: 'EOD' },
    { id: 'S3.narrow_window_1130-1230_EOD', signalFn: sigNarrow, hold: 'EOD' },
    { id: 'S4.bare_lunch_TP_0.3pct_EOD', signalFn: sigBare, hold: 'EOD', options: { takePct: 0.003 } },
    { id: 'S5.bare_lunch_TP_0.5pct_EOD', signalFn: sigBare, hold: 'EOD', options: { takePct: 0.005 } },
    { id: 'S6.bare_lunch_TRAIL_0.5pct_EOD', signalFn: sigBare, hold: 'EOD', options: { trailingPct: 0.005 } },
    { id: 'S7.bare_lunch_STOP_0.5_TP_1.0_EOD', signalFn: sigBare, hold: 'EOD', options: { stopPct: 0.005, takePct: 0.01 } },
    { id: 'S8.tight_TP_0.3pct_EOD', signalFn: sigTight, hold: 'EOD', options: { takePct: 0.003 } },
    { id: 'S9.tight_TRAIL_0.5pct_EOD', signalFn: sigTight, hold: 'EOD', options: { trailingPct: 0.005 } },
  ];

  // Per-ticker SUPER strategy
  for (const ticker of TICKERS) {
    strategies.push({ id: `S_${ticker}.tight_TP_0.3pct_EOD`, signalFn: sigTight, hold: 'EOD', options: { takePct: 0.003, tickerFilter: ticker } });
  }

  console.log('Running strategies...\n');
  const results = [];
  for (const s of strategies) {
    const trades = simulate(byDayTicker, s.signalFn, s.hold, s.options || {});
    const summary = summarize(trades);
    if (!summary) continue;
    results.push({ ...s, trades, summary });
  }

  // Print top-line summary
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  FULL-HISTORY RESULTS (all 72 days, all 3 tickers)');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  ${'id'.padEnd(40)} ${'n'.padStart(4)}  ${'win%'.padStart(6)}  ${'cumP&L'.padStart(8)}  ${'sharpe'.padStart(7)}  ${'best%'.padStart(6)}  ${'worst%'.padStart(6)}`);
  for (const r of results) {
    const s = r.summary;
    console.log(`  ${r.id.padEnd(40)} ${String(s.n).padStart(4)}  ${(s.winRate*100).toFixed(1).padStart(5)}%  ${(s.cumPnL*100).toFixed(2).padStart(7)}%  ${s.sharpe.toFixed(3).padStart(7)}  ${(s.best*100).toFixed(2).padStart(5)}%  ${(s.worst*100).toFixed(2).padStart(5)}%`);
  }

  // Epoch validation: split 72 days into 3 epochs and check consistency
  const sortedDates = Object.keys(byDayTicker).sort();
  const epochSize = Math.ceil(sortedDates.length / 3);
  const epochs = [
    { label: 'EPOCH 1 (Dec 2025)', dates: new Set(sortedDates.slice(0, epochSize)) },
    { label: 'EPOCH 2 (Jan-Feb 2026)', dates: new Set(sortedDates.slice(epochSize, epochSize * 2)) },
    { label: 'EPOCH 3 (Mar-May 2026)', dates: new Set(sortedDates.slice(epochSize * 2)) },
  ];

  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  EPOCH VALIDATION (does the strategy hold across time?)');
  console.log('══════════════════════════════════════════════════════════════════');

  for (const r of results.slice(0, 6)) {
    console.log(`\n  ${r.id}:`);
    console.log(`    ${'epoch'.padEnd(30)} ${'n'.padStart(4)}  ${'win%'.padStart(6)}  ${'cumP&L'.padStart(8)}  ${'sharpe'.padStart(7)}`);
    for (const ep of epochs) {
      const epTrades = r.trades.filter(t => ep.dates.has(t.date));
      const s = summarize(epTrades);
      if (!s) { console.log(`    ${ep.label.padEnd(30)} (no trades)`); continue; }
      console.log(`    ${ep.label.padEnd(30)} ${String(s.n).padStart(4)}  ${(s.winRate*100).toFixed(1).padStart(5)}%  ${(s.cumPnL*100).toFixed(2).padStart(7)}%  ${s.sharpe.toFixed(3).padStart(7)}`);
    }
  }

  // Per-ticker breakdown of best variant
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  PER-TICKER BREAKDOWN (S4 = bare TP 0.3pct)');
  console.log('══════════════════════════════════════════════════════════════════');
  const s4 = results.find(r => r.id.startsWith('S4.'));
  if (s4) {
    for (const ticker of TICKERS) {
      const t = s4.trades.filter(x => x.ticker === ticker);
      const s = summarize(t);
      if (!s) continue;
      console.log(`  ${ticker.padEnd(6)}  n=${String(s.n).padStart(4)}  win=${(s.winRate*100).toFixed(1)}%  cum=${(s.cumPnL*100).toFixed(2)}%  sharpe=${s.sharpe.toFixed(3)}`);
    }
  }

  // Write results CSV
  const csvPath = join(OUT_DIR, 'experiment-wave4-results.csv');
  const headers = ['id', 'n', 'winRate', 'avgPnL', 'cumPnL', 'sharpe', 'best', 'worst'];
  const lines = [headers.join(',')];
  for (const r of results) {
    const s = r.summary;
    lines.push([r.id, s.n, s.winRate, s.avgPnL, s.cumPnL, s.sharpe, s.best, s.worst].map(v => typeof v === 'number' ? v.toFixed(6) : String(v)).join(','));
  }
  writeFileSync(csvPath, lines.join('\n'));

  // Write trade-level log for best variant
  if (s4) {
    const tradesPath = join(OUT_DIR, 'wave4-trades-S4.csv');
    const tHead = ['date', 'ticker', 'ts', 'direction', 'pnl', 'hitStop', 'hitTake', 'hitTrail'];
    const tLines = [tHead.join(',')];
    for (const t of s4.trades) tLines.push(tHead.map(h => t[h] ?? '').join(','));
    writeFileSync(tradesPath, tLines.join('\n'));
  }
  console.log(`\n${results.length} strategies tested.\nResults: ${csvPath}\n`);
}

main();
