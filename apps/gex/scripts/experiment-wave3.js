#!/usr/bin/env node
/**
 * Wave 3 — refine the lunch_chop_pos_regime winner + add stops/TPs.
 *
 * Wave 2 winner: lunch_chop + recent-momentum + pos_regime, EOD hold
 *   → 68.4% win, +4.04%, Sharpe 0.52 over 19 trades
 *
 * Wave 3 hypotheses:
 *   • Per-ticker breakdown of the winner (SPX-only, SPY-only, QQQ-only)
 *   • Stop-loss variants: 0.3%, 0.5%, 1.0% intraday stop
 *   • Take-profit variants: lock at +0.3%, +0.5%, +1.0%
 *   • Time-of-entry granularity: split lunch into 30-min buckets
 *   • Layered filter stacks: lunch + pos_regime + concentrated + something_else
 *   • Out-of-sample: train signals on first 5 days, validate on last 5
 *   • Direction asymmetry: LONG vs SHORT of each top signal
 *   • Cooldown sweep: 30/60/120/240 min between trades vs EOD lockout
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
const MIN_GATEKEEPER_REL = 0.015;
const MIN_MAGNITUDE_DOLLARS = 1e6;

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
  const expCount = gamma[0]?.length || 0;
  let totalAbs = 0, signedTotal = 0;
  const nodes = strikes.map((s, i) => { const g = gamma[i]?.[0] ?? 0; return { strike: s, gamma: g, absG: Math.abs(g) }; });
  for (const n of nodes) { totalAbs += n.absG; signedTotal += n.gamma; }
  if (totalAbs === 0) return null;
  for (const n of nodes) n.relSig = n.absG / totalAbs;
  const regimeScore = signedTotal / totalAbs;
  let king = null;
  for (const n of nodes) if (!king || n.absG > king.absG) king = n;
  let floor = null, ceiling = null;
  for (const n of nodes) {
    if (n.gamma <= 0 || n.relSig < MIN_FLOOR_CEIL_REL) continue;
    if (n.strike < spot) { if (!floor || n.gamma > floor.gamma) floor = n; }
    else if (n.strike > spot) { if (!ceiling || n.gamma > ceiling.gamma) ceiling = n; }
  }
  const top3 = [...nodes].sort((a, b) => b.absG - a.absG).slice(0, 3);
  const top3Share = top3.reduce((a, n) => a + n.absG, 0) / totalAbs;
  let vannaAbs = 0, vannaSigned = 0;
  for (let i = 0; i < strikes.length; i++) { const v = vanna?.[i]?.[0] ?? 0; vannaAbs += Math.abs(v); vannaSigned += v; }
  const vannaRegime = vannaAbs > 0 ? vannaSigned / vannaAbs : 0;
  return { ts: frame.ts, spot, expCount, totalAbs, signedTotal, regimeScore, king, floor, ceiling, top3Share, vannaAbs, vannaSigned, vannaRegime };
}

function precomputeForTicker(frames) {
  const states = frames.map(f => ({ frame: f, state: computeFrameState(f) }));
  const recent15MinReturn = new Array(frames.length).fill(0);
  const recent5MinReturn = new Array(frames.length).fill(0);
  const recent30MinReturn = new Array(frames.length).fill(0);
  for (let i = 0; i < frames.length; i++) {
    const lb15 = Math.max(0, i - 15);
    const lb5 = Math.max(0, i - 5);
    const lb30 = Math.max(0, i - 30);
    recent15MinReturn[i] = (frames[i].spot - frames[lb15].spot) / frames[lb15].spot;
    recent5MinReturn[i] = (frames[i].spot - frames[lb5].spot) / frames[lb5].spot;
    recent30MinReturn[i] = (frames[i].spot - frames[lb30].spot) / frames[lb30].spot;
  }
  return { frames, states, recent15MinReturn, recent5MinReturn, recent30MinReturn };
}

function inSession(ts, hourStart, hourEnd) {
  const d = new Date(ts);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return h >= hourStart && h < hourEnd;
}

// ─── Simulation with optional stop / take-profit ───
function simulate(byDayTicker, signalFn, hold, options = {}) {
  const { stopPct = null, takePct = null, tickerFilter = null, dateFilter = null } = options;
  const trades = [];
  for (const [date, byTicker] of Object.entries(byDayTicker)) {
    if (dateFilter && !dateFilter(date)) continue;
    for (const ticker of TICKERS) {
      if (tickerFilter && ticker !== tickerFilter) continue;
      const p = byTicker[ticker];
      if (!p) continue;
      const cost = FLIP_COST[ticker];
      let cooldownUntil = null;
      for (let i = 0; i < p.frames.length; i++) {
        const st = p.states[i].state; if (!st) continue;
        const crossKingBias = {};
        for (const t of TICKERS) {
          const cs = byTicker[t]?.states[i]?.state;
          crossKingBias[t] = (cs && cs.king && cs.king.gamma > 0) ? Math.sign(cs.king.strike - cs.spot) : 0;
        }
        const ctx = { ticker, crossKingBias, dayFrames: p.frames, dayIdx: i };
        const direction = signalFn(st, p, i, ctx);
        if (direction === 0) continue;
        if (cooldownUntil && p.frames[i].ts <= cooldownUntil) continue;

        // Determine exit with stop/TP logic
        const entrySpot = p.frames[i].spot;
        const maxExitIdx = hold === 'EOD' ? p.frames.length - 1 : Math.min(i + hold, p.frames.length - 1);
        let exitIdx = maxExitIdx;
        let hitStop = false, hitTake = false;
        for (let j = i + 1; j <= maxExitIdx; j++) {
          const ret = (p.frames[j].spot - entrySpot) / entrySpot * direction;
          if (stopPct != null && ret <= -stopPct) {
            exitIdx = j; hitStop = true; break;
          }
          if (takePct != null && ret >= takePct) {
            exitIdx = j; hitTake = true; break;
          }
        }
        const moveReturn = (p.frames[exitIdx].spot - entrySpot) / entrySpot;
        const pnl = direction * moveReturn - cost;
        trades.push({ date, ticker, ts: p.frames[i].ts, direction, pnl, hitStop, hitTake, holdMin: exitIdx - i });

        const exitMs = hold === 'EOD' ? Infinity : (exitIdx - i) * 60000;
        cooldownUntil = exitMs === Infinity ? '9999' : new Date(new Date(p.frames[i].ts).getTime() + exitMs).toISOString();
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
  const stops = trades.filter(t => t.hitStop).length;
  const takes = trades.filter(t => t.hitTake).length;
  return { n: trades.length, winRate: wins / trades.length, avgPnL: avg, cumPnL: cum, sharpe, best: Math.max(...trades.map(t => t.pnl)), worst: Math.min(...trades.map(t => t.pnl)), stops, takes };
}

// ─── Signal definitions ───
const baseSignal_lunchChopPosRegime = (st, p, i) => {
  if (!inSession(st.ts, 15.5, 17.5)) return 0;
  if (st.regimeScore <= 0.1) return 0;
  return Math.sign(p.recent15MinReturn[i] || 0);
};

const baseSignal_momentumEOD = (st, p, i) => {
  return Math.sign(p.recent15MinReturn[i] || 0);
};

const baseSignal_lunchChopBare = (st, p, i) => {
  if (!inSession(st.ts, 15.5, 17.5)) return 0;
  return Math.sign(p.recent15MinReturn[i] || 0);
};

// ─── Wave 3 experiments ───
const experiments = [];

// A. Per-ticker breakdown of top signals
for (const t of TICKERS) {
  experiments.push({
    id: `W3.lunch_pos_regime_${t}_only`,
    signalFn: baseSignal_lunchChopPosRegime,
    hold: 'EOD',
    options: { tickerFilter: t },
  });
}
for (const t of TICKERS) {
  experiments.push({
    id: `W3.momentum_15min_${t}_only_60`,
    signalFn: baseSignal_momentumEOD,
    hold: 60,
    options: { tickerFilter: t },
  });
}

// B. Stop-loss variants on top winner
for (const stop of [0.003, 0.005, 0.01]) {
  experiments.push({
    id: `W3.lunch_pos_regime_stop_${stop*100}pct_EOD`,
    signalFn: baseSignal_lunchChopPosRegime,
    hold: 'EOD',
    options: { stopPct: stop },
  });
}
for (const stop of [0.003, 0.005, 0.01]) {
  experiments.push({
    id: `W3.momentum_15min_stop_${stop*100}pct_120`,
    signalFn: baseSignal_momentumEOD,
    hold: 120,
    options: { stopPct: stop },
  });
}

// C. Take-profit variants
for (const tp of [0.003, 0.005, 0.01]) {
  experiments.push({
    id: `W3.lunch_pos_regime_tp_${tp*100}pct_EOD`,
    signalFn: baseSignal_lunchChopPosRegime,
    hold: 'EOD',
    options: { takePct: tp },
  });
}

// D. Stop + TP combo (the classic risk-managed trade)
for (const stop of [0.005, 0.01]) {
  for (const tp of [0.005, 0.01, 0.02]) {
    experiments.push({
      id: `W3.lunch_pos_regime_stop${stop*1000}_tp${tp*1000}_EOD`,
      signalFn: baseSignal_lunchChopPosRegime,
      hold: 'EOD',
      options: { stopPct: stop, takePct: tp },
    });
  }
}

// E. Out-of-sample split: train on first 5, test on last 5
const split5 = (date, isFirst) => {
  const allDates = ['2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20', '2026-03-21', '2026-03-31', '2026-04-02', '2026-04-30', '2026-05-05'];
  const first5 = new Set(allDates.slice(0, 5));
  return isFirst ? first5.has(date) : !first5.has(date);
};
experiments.push({ id: `W3.lunch_pos_regime_FIRST5`, signalFn: baseSignal_lunchChopPosRegime, hold: 'EOD', options: { dateFilter: (d) => split5(d, true) } });
experiments.push({ id: `W3.lunch_pos_regime_LAST5`, signalFn: baseSignal_lunchChopPosRegime, hold: 'EOD', options: { dateFilter: (d) => split5(d, false) } });
experiments.push({ id: `W3.momentum_15min_60_FIRST5`, signalFn: baseSignal_momentumEOD, hold: 60, options: { dateFilter: (d) => split5(d, true) } });
experiments.push({ id: `W3.momentum_15min_60_LAST5`, signalFn: baseSignal_momentumEOD, hold: 60, options: { dateFilter: (d) => split5(d, false) } });

// F. LONG-only / SHORT-only variants
experiments.push({
  id: 'W3.lunch_pos_regime_LONG_only_EOD',
  signalFn: (st, p, i) => { const d = baseSignal_lunchChopPosRegime(st, p, i); return d === 1 ? 1 : 0; },
  hold: 'EOD',
});
experiments.push({
  id: 'W3.lunch_pos_regime_SHORT_only_EOD',
  signalFn: (st, p, i) => { const d = baseSignal_lunchChopPosRegime(st, p, i); return d === -1 ? -1 : 0; },
  hold: 'EOD',
});

// G. Time-of-entry granularity: 30-min buckets of lunch chop
const lunchBuckets = [
  { label: 'lunch_1130_1200', start: 15.5, end: 16.0 },
  { label: 'lunch_1200_1230', start: 16.0, end: 16.5 },
  { label: 'lunch_1230_1300', start: 16.5, end: 17.0 },
  { label: 'lunch_1300_1330', start: 17.0, end: 17.5 },
];
for (const b of lunchBuckets) {
  experiments.push({
    id: `W3.${b.label}_pos_regime_recent_EOD`,
    signalFn: (st, p, i) => {
      if (!inSession(st.ts, b.start, b.end)) return 0;
      if (st.regimeScore <= 0.1) return 0;
      return Math.sign(p.recent15MinReturn[i] || 0);
    },
    hold: 'EOD',
  });
}

// H. Additional filter stacks
experiments.push({
  id: 'W3.lunch_pos_regime_concentrated_EOD',
  signalFn: (st, p, i) => {
    if (!inSession(st.ts, 15.5, 17.5)) return 0;
    if (st.regimeScore <= 0.1) return 0;
    if (st.top3Share < 0.3) return 0;
    return Math.sign(p.recent15MinReturn[i] || 0);
  },
  hold: 'EOD',
});
experiments.push({
  id: 'W3.lunch_pos_regime_strong_momentum_EOD',
  signalFn: (st, p, i) => {
    if (!inSession(st.ts, 15.5, 17.5)) return 0;
    if (st.regimeScore <= 0.1) return 0;
    if (Math.abs(p.recent15MinReturn[i]) < 0.002) return 0;
    return Math.sign(p.recent15MinReturn[i] || 0);
  },
  hold: 'EOD',
});
experiments.push({
  id: 'W3.lunch_pos_regime_aligned_vex_EOD',
  signalFn: (st, p, i) => {
    if (!inSession(st.ts, 15.5, 17.5)) return 0;
    if (st.regimeScore <= 0.1) return 0;
    const m = Math.sign(p.recent15MinReturn[i] || 0);
    if (m === 0) return 0;
    // require vannaRegime to align with desired direction
    if (m === 1 && st.vannaRegime < 0) return 0;
    if (m === -1 && st.vannaRegime > 0) return 0;
    return m;
  },
  hold: 'EOD',
});

// I. Trailing stop variants (manual: exit if return drops X% from peak after first 30min)
// Implement via custom exit logic — adapt simulate
function simulateWithTrailingStop(byDayTicker, signalFn, hold, options) {
  const { trailingPct, tickerFilter, dateFilter } = options;
  const trades = [];
  for (const [date, byTicker] of Object.entries(byDayTicker)) {
    if (dateFilter && !dateFilter(date)) continue;
    for (const ticker of TICKERS) {
      if (tickerFilter && ticker !== tickerFilter) continue;
      const p = byTicker[ticker];
      if (!p) continue;
      const cost = FLIP_COST[ticker];
      let cooldownUntil = null;
      for (let i = 0; i < p.frames.length; i++) {
        const st = p.states[i].state; if (!st) continue;
        const ctx = { ticker, dayIdx: i };
        const direction = signalFn(st, p, i, ctx);
        if (direction === 0) continue;
        if (cooldownUntil && p.frames[i].ts <= cooldownUntil) continue;
        const entrySpot = p.frames[i].spot;
        const maxExitIdx = hold === 'EOD' ? p.frames.length - 1 : Math.min(i + hold, p.frames.length - 1);
        let exitIdx = maxExitIdx;
        let peakRet = 0;
        for (let j = i + 1; j <= maxExitIdx; j++) {
          const ret = (p.frames[j].spot - entrySpot) / entrySpot * direction;
          if (ret > peakRet) peakRet = ret;
          if (peakRet > 0 && (peakRet - ret) >= trailingPct) {
            exitIdx = j;
            break;
          }
        }
        const moveReturn = (p.frames[exitIdx].spot - entrySpot) / entrySpot;
        const pnl = direction * moveReturn - cost;
        trades.push({ date, ticker, pnl, direction });
        cooldownUntil = new Date(new Date(p.frames[i].ts).getTime() + (exitIdx - i) * 60000).toISOString();
      }
    }
  }
  return trades;
}

// J. Run everything
function main() {
  const nDays = parseInt(process.argv[2] || '10', 10);
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(REPLAY_DIR).filter(f => /^gex-replay-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const recent = files.slice(-nDays).map(f => f.match(/(\d{4}-\d{2}-\d{2})/)[1]);
  console.log(`▶ Wave 3: ${experiments.length} experiments on ${recent.length} days\n`);
  console.log('Precomputing...');
  const t0 = Date.now();
  const byDayTicker = {};
  for (const date of recent) {
    const path = join(REPLAY_DIR, `gex-replay-${date}.json`);
    if (!existsSync(path)) continue;
    const replay = loadReplay(path);
    byDayTicker[date] = {};
    for (const ticker of TICKERS) {
      const frames = replay[ticker];
      if (!frames || frames.length < VEL_WINDOW + 30) continue;
      byDayTicker[date][ticker] = precomputeForTicker(frames);
    }
  }
  console.log(`Done in ${Math.round((Date.now() - t0) / 1000)}s\n`);

  const results = [];
  for (const exp of experiments) {
    const trades = simulate(byDayTicker, exp.signalFn, exp.hold, exp.options || {});
    const s = summarize(trades);
    if (!s || s.n < 3) continue;
    results.push({ id: exp.id, hold: exp.hold, ...s });
  }

  // Add trailing-stop variants
  for (const trailingPct of [0.003, 0.005, 0.01]) {
    const trades = simulateWithTrailingStop(byDayTicker, baseSignal_lunchChopPosRegime, 'EOD', { trailingPct });
    const s = summarize(trades);
    if (s) results.push({ id: `W3.lunch_pos_regime_trail${trailingPct*1000}_EOD`, hold: 'EOD', ...s });
  }

  results.sort((a, b) => (b.cumPnL * Math.sqrt(b.n)) - (a.cumPnL * Math.sqrt(a.n)));
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  WAVE 3 ALL RESULTS (ranked by cum_pnl × sqrt(n))');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  ${'rank'.padEnd(5)} ${'id'.padEnd(55)} ${'hold'.padEnd(6)} ${'n'.padStart(4)}  ${'win%'.padStart(6)}  ${'cumP&L'.padStart(8)}  ${'sharpe'.padStart(7)}  ${'stops'.padStart(5)}  ${'tps'.padStart(4)}`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`  ${String(i + 1).padEnd(5)} ${r.id.padEnd(55)} ${String(r.hold).padEnd(6)} ${String(r.n).padStart(4)}  ${(r.winRate*100).toFixed(1).padStart(5)}%  ${(r.cumPnL*100).toFixed(2).padStart(7)}%  ${r.sharpe.toFixed(3).padStart(7)}  ${String(r.stops ?? 0).padStart(5)}  ${String(r.takes ?? 0).padStart(4)}`);
  }

  const csvPath = join(OUT_DIR, 'experiment-wave3-results.csv');
  const headers = ['id', 'hold', 'n', 'winRate', 'avgPnL', 'cumPnL', 'sharpe', 'best', 'worst', 'stops', 'takes'];
  const lines = [headers.join(',')];
  for (const r of results) lines.push(headers.map(h => typeof r[h] === 'number' ? r[h].toFixed(6) : String(r[h] ?? '')).join(','));
  writeFileSync(csvPath, lines.join('\n'));
  console.log(`\nResults: ${csvPath}\n`);
}

main();
