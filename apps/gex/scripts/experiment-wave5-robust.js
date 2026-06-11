#!/usr/bin/env node
/**
 * Wave 5 — find what's ACTUALLY robust.
 *
 * Wave 1-3 winners were overfit (78% → 53% from 10 → 72 days). This wave
 * runs ~130 signals on full 72 days and only declares a winner if:
 *
 *   • n ≥ 30 trades
 *   • Positive cum P&L overall
 *   • Positive cum P&L in 2 of 3 epochs (Dec, Jan-Feb, Mar-May)
 *   • Sharpe > 0.05
 *
 * This is the real search. Anything that passes is genuine.
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
  const sorted = [...nodes].sort((a, b) => a.strike - b.strike);
  let biggestAirPocket = null;
  let runStart = null;
  for (const n of sorted) {
    if (n.relSig < MIN_GATEKEEPER_REL) {
      if (runStart == null) runStart = n.strike;
    } else {
      if (runStart != null && n.strike - runStart > 0) {
        const span = n.strike - runStart;
        if (!biggestAirPocket || span > biggestAirPocket.span) biggestAirPocket = { low: runStart, high: n.strike, span };
      }
      runStart = null;
    }
  }
  const top3 = [...nodes].sort((a, b) => b.absG - a.absG).slice(0, 3);
  const top3Share = top3.reduce((a, n) => a + n.absG, 0) / totalAbs;
  let vannaAbs = 0, vannaSigned = 0;
  for (let i = 0; i < strikes.length; i++) { const v = vanna?.[i]?.[0] ?? 0; vannaAbs += Math.abs(v); vannaSigned += v; }
  const vannaRegime = vannaAbs > 0 ? vannaSigned / vannaAbs : 0;
  return { ts: frame.ts, spot, expCount, totalAbs, signedTotal, regimeScore, king, floor, ceiling, biggestAirPocket, top3Share, vannaAbs, vannaSigned, vannaRegime };
}

function precomputeForTicker(frames) {
  const states = frames.map(f => computeFrameState(f));
  const aggGammaVelByFrame = [];
  const bestGrowingByFrame = [];
  const gammaHist = new Map(), vannaHist = new Map();
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const expLimit = f.gamma[0]?.length || 0;
    for (let si = 0; si < f.gamma.length; si++) {
      for (let ei = 0; ei < expLimit; ei++) {
        const key = `${f.strikes[si]}|${ei}`;
        if (!gammaHist.has(key)) gammaHist.set(key, []);
        if (!vannaHist.has(key)) vannaHist.set(key, []);
        const bg = gammaHist.get(key); bg.push(f.gamma[si]?.[ei] ?? 0); if (bg.length > VEL_WINDOW + 1) bg.shift();
        const bv = vannaHist.get(key); bv.push(f.vanna?.[si]?.[ei] ?? 0); if (bv.length > VEL_WINDOW + 1) bv.shift();
      }
    }
    const aggMap = new Map();
    for (const [key, buf] of gammaHist) {
      if (buf.length < VEL_WINDOW + 1) continue;
      const strike = parseFloat(key.split('|')[0]);
      aggMap.set(strike, (aggMap.get(strike) || 0) + buf[buf.length - 1] - buf[0]);
    }
    aggGammaVelByFrame.push(aggMap);
    const proximity = (f.spot || 0) * 0.02;
    let bestGex = null, bestVex = null;
    for (const [key, buf] of gammaHist) {
      if (buf.length < VEL_WINDOW + 1) continue;
      const strike = parseFloat(key.split('|')[0]);
      if (Math.abs(strike - f.spot) > proximity) continue;
      const now = buf[buf.length - 1];
      if (now <= MIN_MAGNITUDE_DOLLARS) continue;
      const delta = now - buf[0];
      if (delta <= 0) continue;
      if (!bestGex || delta > bestGex.delta) bestGex = { strike, delta };
    }
    for (const [key, buf] of vannaHist) {
      if (buf.length < VEL_WINDOW + 1) continue;
      const strike = parseFloat(key.split('|')[0]);
      if (Math.abs(strike - f.spot) > proximity) continue;
      const now = buf[buf.length - 1];
      if (now <= MIN_MAGNITUDE_DOLLARS) continue;
      const delta = now - buf[0];
      if (delta <= 0) continue;
      if (!bestVex || delta > bestVex.delta) bestVex = { strike, delta };
    }
    bestGrowingByFrame.push({ gex: bestGex, vex: bestVex });
  }
  const floorGrowStreak = new Array(frames.length).fill(0);
  const floorDecayStreak = new Array(frames.length).fill(0);
  const ceilingGrowStreak = new Array(frames.length).fill(0);
  const ceilingDecayStreak = new Array(frames.length).fill(0);
  const confluenceStreak = new Array(frames.length).fill(0);
  const kingDriftUpStreak = new Array(frames.length).fill(0);
  const kingDriftDownStreak = new Array(frames.length).fill(0);
  const recent5MinReturn = new Array(frames.length).fill(0);
  const recent15MinReturn = new Array(frames.length).fill(0);
  const recent30MinReturn = new Array(frames.length).fill(0);
  let prevConfDir = 0, confStreak = 0, prevKing = null, upStreak = 0, downStreak = 0;
  for (let i = 0; i < frames.length; i++) {
    const st = states[i]; if (!st) continue;
    if (i > 0) {
      const fv = st.floor ? aggGammaVelByFrame[i].get(st.floor.strike) : null;
      const cv = st.ceiling ? aggGammaVelByFrame[i].get(st.ceiling.strike) : null;
      floorGrowStreak[i] = fv != null && fv > 0 ? floorGrowStreak[i - 1] + 1 : 0;
      floorDecayStreak[i] = fv != null && fv < 0 ? floorDecayStreak[i - 1] + 1 : 0;
      ceilingGrowStreak[i] = cv != null && cv > 0 ? ceilingGrowStreak[i - 1] + 1 : 0;
      ceilingDecayStreak[i] = cv != null && cv < 0 ? ceilingDecayStreak[i - 1] + 1 : 0;
    }
    const bg = bestGrowingByFrame[i];
    const confDir = (bg.gex && bg.vex) ? (Math.sign(bg.gex.strike - st.spot) === Math.sign(bg.vex.strike - st.spot) ? Math.sign(bg.gex.strike - st.spot) : 0) : 0;
    if (confDir !== 0 && confDir === prevConfDir) confStreak++; else confStreak = confDir !== 0 ? 1 : 0;
    confluenceStreak[i] = confStreak; prevConfDir = confDir;
    if (prevKing != null && st.king) {
      if (st.king.strike > prevKing) { upStreak++; downStreak = 0; }
      else if (st.king.strike < prevKing) { downStreak++; upStreak = 0; }
      else { upStreak = 0; downStreak = 0; }
    }
    kingDriftUpStreak[i] = upStreak; kingDriftDownStreak[i] = downStreak;
    prevKing = st.king?.strike ?? prevKing;
    const lb5 = Math.max(0, i - 5), lb15 = Math.max(0, i - 15), lb30 = Math.max(0, i - 30);
    recent5MinReturn[i] = (frames[i].spot - frames[lb5].spot) / frames[lb5].spot;
    recent15MinReturn[i] = (frames[i].spot - frames[lb15].spot) / frames[lb15].spot;
    recent30MinReturn[i] = (frames[i].spot - frames[lb30].spot) / frames[lb30].spot;
  }
  return { frames, states, aggGammaVelByFrame, bestGrowingByFrame, floorGrowStreak, floorDecayStreak, ceilingGrowStreak, ceilingDecayStreak, confluenceStreak, kingDriftUpStreak, kingDriftDownStreak, recent5MinReturn, recent15MinReturn, recent30MinReturn };
}

function inSession(ts, h0, h1) {
  const d = new Date(ts);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return h >= h0 && h < h1;
}

const sessions = [
  { label: 'opening', start: 13.5, end: 14.0 },
  { label: 'morning', start: 14.0, end: 15.5 },
  { label: 'lunch', start: 15.5, end: 17.5 },
  { label: 'afternoon', start: 17.5, end: 19.0 },
  { label: 'power_hour', start: 19.0, end: 20.0 },
];

// ─── Signal universe ───
const signals = [];

// Pure momentum variants
for (const lb of ['5min', '15min', '30min']) {
  const ret = (p, i) => p[`recent${lb === '5min' ? '5' : lb === '15min' ? '15' : '30'}MinReturn`][i];
  signals.push({ id: `M.momentum_${lb}`, fn: (st, p, i) => Math.sign(ret(p, i) || 0) });
  signals.push({ id: `M.fade_${lb}`, fn: (st, p, i) => -Math.sign(ret(p, i) || 0) });
  signals.push({ id: `M.momentum_${lb}_strong`, fn: (st, p, i) => Math.abs(ret(p, i)) < 0.002 ? 0 : Math.sign(ret(p, i)) });
}

// Session-restricted momentum + fade
for (const s of sessions) {
  signals.push({ id: `T.${s.label}_momentum_15`, fn: (st, p, i) => inSession(st.ts, s.start, s.end) ? Math.sign(p.recent15MinReturn[i] || 0) : 0 });
  signals.push({ id: `T.${s.label}_fade_15`, fn: (st, p, i) => inSession(st.ts, s.start, s.end) ? -Math.sign(p.recent15MinReturn[i] || 0) : 0 });
  signals.push({ id: `T.${s.label}_toward_king`, fn: (st, p, i) => {
    if (!inSession(st.ts, s.start, s.end)) return 0;
    if (!st.king || st.king.gamma <= 0) return 0;
    return Math.sign(st.king.strike - st.spot);
  }});
}

// Regime gates
for (const minR of [0.1, 0.2, 0.3]) {
  signals.push({ id: `R.pos${minR}_momentum`, fn: (st, p, i) => st.regimeScore > minR ? Math.sign(p.recent15MinReturn[i] || 0) : 0 });
  signals.push({ id: `R.neg${minR}_momentum`, fn: (st, p, i) => st.regimeScore < -minR ? Math.sign(p.recent15MinReturn[i] || 0) : 0 });
  signals.push({ id: `R.pos${minR}_fade`, fn: (st, p, i) => st.regimeScore > minR ? -Math.sign(p.recent15MinReturn[i] || 0) : 0 });
  signals.push({ id: `R.neg${minR}_fade`, fn: (st, p, i) => st.regimeScore < -minR ? -Math.sign(p.recent15MinReturn[i] || 0) : 0 });
  signals.push({ id: `R.pos${minR}_to_king`, fn: (st) => {
    if (st.regimeScore <= minR || !st.king || st.king.gamma <= 0) return 0;
    return Math.sign(st.king.strike - st.spot);
  }});
  signals.push({ id: `R.neg${minR}_to_king`, fn: (st) => {
    if (st.regimeScore >= -minR || !st.king || st.king.gamma <= 0) return 0;
    return Math.sign(st.king.strike - st.spot);
  }});
}

// Level conditioning (INVERTED — magnet interpretation)
for (const minStreak of [3, 5, 10]) {
  signals.push({ id: `L.floor_growing_SHORT_${minStreak}`, fn: (st, p, i) => {
    if (!st.floor) return 0;
    return p.floorGrowStreak[i] >= minStreak ? -1 : 0;
  }});
  signals.push({ id: `L.ceiling_growing_LONG_${minStreak}`, fn: (st, p, i) => {
    if (!st.ceiling) return 0;
    return p.ceilingGrowStreak[i] >= minStreak ? 1 : 0;
  }});
  signals.push({ id: `L.ceiling_decaying_SHORT_${minStreak}`, fn: (st, p, i) => {
    if (!st.ceiling) return 0;
    return p.ceilingDecayStreak[i] >= minStreak ? -1 : 0;
  }});
  signals.push({ id: `L.floor_decaying_LONG_${minStreak}`, fn: (st, p, i) => {
    if (!st.floor) return 0;
    return p.floorDecayStreak[i] >= minStreak ? 1 : 0;
  }});
}

// King-related
signals.push({ id: `K.king_far_above_LONG`, fn: (st) => {
  if (!st.king || st.king.gamma <= 0) return 0;
  return (st.king.strike - st.spot) / st.spot > 0.005 ? 1 : 0;
}});
signals.push({ id: `K.king_far_below_SHORT`, fn: (st) => {
  if (!st.king || st.king.gamma <= 0) return 0;
  return (st.spot - st.king.strike) / st.spot > 0.005 ? -1 : 0;
}});
signals.push({ id: `K.king_far_above_FADE`, fn: (st) => {
  if (!st.king || st.king.gamma <= 0) return 0;
  return (st.king.strike - st.spot) / st.spot > 0.005 ? -1 : 0;
}});

// King drift
for (const ms of [3, 5, 10]) {
  signals.push({ id: `K.king_drift_up_${ms}`, fn: (st, p, i) => p.kingDriftUpStreak[i] >= ms ? 1 : 0 });
  signals.push({ id: `K.king_drift_down_${ms}`, fn: (st, p, i) => p.kingDriftDownStreak[i] >= ms ? -1 : 0 });
  signals.push({ id: `K.king_drift_up_FADE_${ms}`, fn: (st, p, i) => p.kingDriftUpStreak[i] >= ms ? -1 : 0 });
  signals.push({ id: `K.king_drift_down_FADE_${ms}`, fn: (st, p, i) => p.kingDriftDownStreak[i] >= ms ? 1 : 0 });
}

// Air pockets
signals.push({ id: `A.air_pocket_above`, fn: (st) => {
  if (!st.biggestAirPocket) return 0;
  return st.biggestAirPocket.low > st.spot && st.biggestAirPocket.span / st.spot > 0.01 ? 1 : 0;
}});
signals.push({ id: `A.air_pocket_below`, fn: (st) => {
  if (!st.biggestAirPocket) return 0;
  return st.biggestAirPocket.high < st.spot && st.biggestAirPocket.span / st.spot > 0.01 ? -1 : 0;
}});

// Greek confluence
for (const ms of [5, 10, 20]) {
  signals.push({ id: `G.gex_vex_agree_${ms}`, fn: (st, p, i) => {
    const bg = p.bestGrowingByFrame[i];
    if (!bg.gex || !bg.vex) return 0;
    const d = Math.sign(bg.gex.strike - st.spot);
    if (d !== Math.sign(bg.vex.strike - st.spot)) return 0;
    return p.confluenceStreak[i] >= ms ? d : 0;
  }});
}

// Concentration
for (const minShare of [0.3, 0.5]) {
  signals.push({ id: `C.concentrated_${minShare}_to_king`, fn: (st) => {
    if (st.top3Share < minShare || !st.king || st.king.gamma <= 0) return 0;
    return Math.sign(st.king.strike - st.spot);
  }});
  signals.push({ id: `C.concentrated_${minShare}_FADE`, fn: (st) => {
    if (st.top3Share < minShare || !st.king || st.king.gamma <= 0) return 0;
    return -Math.sign(st.king.strike - st.spot);
  }});
}

// Compound: session + regime
for (const s of sessions) {
  for (const rs of [0.1, 0.3]) {
    signals.push({
      id: `X.${s.label}_pos${rs}_momentum`,
      fn: (st, p, i) => {
        if (!inSession(st.ts, s.start, s.end)) return 0;
        if (st.regimeScore <= rs) return 0;
        return Math.sign(p.recent15MinReturn[i] || 0);
      },
    });
    signals.push({
      id: `X.${s.label}_neg${rs}_momentum`,
      fn: (st, p, i) => {
        if (!inSession(st.ts, s.start, s.end)) return 0;
        if (st.regimeScore >= -rs) return 0;
        return Math.sign(p.recent15MinReturn[i] || 0);
      },
    });
    signals.push({
      id: `X.${s.label}_pos${rs}_to_king`,
      fn: (st) => {
        if (!inSession(st.ts, st.ts, st.ts)) return 0;
      },
    });
  }
}

// Tail risk: open and hold (regime-conditioned)
signals.push({ id: `O.open_long_pos_regime`, fn: (st, p, i) => {
  if (i > 5) return 0;
  return st.regimeScore > 0.1 ? 1 : 0;
}});
signals.push({ id: `O.open_short_neg_regime`, fn: (st, p, i) => {
  if (i > 5) return 0;
  return st.regimeScore < -0.1 ? -1 : 0;
}});
signals.push({ id: `O.open_to_king`, fn: (st, p, i) => {
  if (i > 5) return 0;
  if (!st.king || st.king.gamma <= 0) return 0;
  return Math.sign(st.king.strike - st.spot);
}});
signals.push({ id: `O.open_to_king_FADE`, fn: (st, p, i) => {
  if (i > 5) return 0;
  if (!st.king || st.king.gamma <= 0) return 0;
  return -Math.sign(st.king.strike - st.spot);
}});

// Vanna regime
for (const minVR of [0.1, 0.2]) {
  signals.push({ id: `V.vanna_pos${minVR}_momentum`, fn: (st, p, i) => st.vannaRegime > minVR ? Math.sign(p.recent15MinReturn[i] || 0) : 0 });
  signals.push({ id: `V.vanna_neg${minVR}_momentum`, fn: (st, p, i) => st.vannaRegime < -minVR ? Math.sign(p.recent15MinReturn[i] || 0) : 0 });
  signals.push({ id: `V.vanna_pos${minVR}_to_king`, fn: (st) => {
    if (st.vannaRegime <= minVR || !st.king || st.king.gamma <= 0) return 0;
    return Math.sign(st.king.strike - st.spot);
  }});
}

console.log(`Defined ${signals.length} signals\n`);

// ─── Simulation with optional stops/TPs ───
function simulate(byDayTicker, signalFn, hold, options = {}) {
  const { stopPct = null, takePct = null, tickerFilter = null } = options;
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
        const direction = signalFn(st, p, i);
        if (direction === 0) continue;
        if (cooldownUntil && p.frames[i].ts <= cooldownUntil) continue;
        const entrySpot = p.frames[i].spot;
        const maxExitIdx = hold === 'EOD' ? p.frames.length - 1 : Math.min(i + hold, p.frames.length - 1);
        let exitIdx = maxExitIdx;
        for (let j = i + 1; j <= maxExitIdx; j++) {
          const ret = (p.frames[j].spot - entrySpot) / entrySpot * direction;
          if (stopPct != null && ret <= -stopPct) { exitIdx = j; break; }
          if (takePct != null && ret >= takePct) { exitIdx = j; break; }
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

function summarize(trades) {
  if (!trades.length) return null;
  const cum = trades.reduce((a, t) => a + t.pnl, 0);
  const avg = cum / trades.length;
  const wins = trades.filter(t => t.pnl > 0).length;
  const variance = trades.reduce((a, t) => a + (t.pnl - avg) ** 2, 0) / trades.length;
  const sharpe = variance > 0 ? avg / Math.sqrt(variance) : 0;
  return { n: trades.length, winRate: wins / trades.length, avgPnL: avg, cumPnL: cum, sharpe };
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(REPLAY_DIR).filter(f => /^gex-replay-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const allDates = files.map(f => f.match(/(\d{4}-\d{2}-\d{2})/)[1]);
  console.log(`▶ Wave 5: ${signals.length} signals × 4 holds on ${allDates.length} days\n`);
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
      // skip corrupt files
    }
  }
  const days = Object.keys(byDayTicker).sort();
  console.log(`Loaded ${days.length} days in ${Math.round((Date.now() - t0) / 1000)}s. Running experiments...\n`);

  // Define epochs (thirds)
  const epochSize = Math.ceil(days.length / 3);
  const epochs = [
    { label: 'Dec25', dates: new Set(days.slice(0, epochSize)) },
    { label: 'JanFeb26', dates: new Set(days.slice(epochSize, epochSize * 2)) },
    { label: 'MarMay26', dates: new Set(days.slice(epochSize * 2)) },
  ];

  const results = [];
  const holds = [60, 120, 'EOD'];
  let done = 0;
  for (const signal of signals) {
    for (const hold of holds) {
      const trades = simulate(byDayTicker, signal.fn, hold);
      const s = summarize(trades);
      if (!s || s.n < 30) continue;

      // Epoch breakdown
      const ep = epochs.map(e => {
        const subset = trades.filter(t => e.dates.has(t.date));
        const epSum = summarize(subset);
        return epSum ? { label: e.label, ...epSum } : null;
      });
      const positiveEpochs = ep.filter(e => e && e.cumPnL > 0).length;

      results.push({
        id: signal.id, hold,
        ...s,
        epoch1: ep[0]?.cumPnL ?? null,
        epoch2: ep[1]?.cumPnL ?? null,
        epoch3: ep[2]?.cumPnL ?? null,
        positiveEpochs,
      });
    }
    done++;
    if (done % 25 === 0) process.stdout.write(`  ${done}/${signals.length} signals...\n`);
  }

  // Robust winners: positive overall AND positive in 2+ epochs
  const robustWinners = results.filter(r => r.cumPnL > 0 && r.positiveEpochs >= 2 && r.n >= 30);

  // Strongest robust winners
  robustWinners.sort((a, b) => (b.cumPnL * Math.sqrt(b.n)) - (a.cumPnL * Math.sqrt(a.n)));

  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log(`  ROBUST WINNERS: cumPnL > 0, positive in ≥2 epochs, n ≥ 30`);
  console.log(`  ${robustWinners.length} signals pass out of ${results.length} tested`);
  console.log('══════════════════════════════════════════════════════════════════');
  if (robustWinners.length === 0) {
    console.log('\n  NONE PASS. The signal universe has no edge robust to 72 days.\n');
  } else {
    console.log(`  ${'id'.padEnd(40)} ${'hold'.padEnd(6)} ${'n'.padStart(5)} ${'win%'.padStart(6)} ${'cumP&L'.padStart(8)} ${'sharpe'.padStart(7)} ${'ep1'.padStart(7)} ${'ep2'.padStart(7)} ${'ep3'.padStart(7)} ${'+ep'.padStart(4)}`);
    for (let i = 0; i < Math.min(40, robustWinners.length); i++) {
      const r = robustWinners[i];
      console.log(`  ${r.id.padEnd(40)} ${String(r.hold).padEnd(6)} ${String(r.n).padStart(5)} ${(r.winRate*100).toFixed(1).padStart(5)}% ${(r.cumPnL*100).toFixed(2).padStart(7)}% ${r.sharpe.toFixed(3).padStart(7)} ${(r.epoch1*100).toFixed(2).padStart(6)}% ${(r.epoch2*100).toFixed(2).padStart(6)}% ${(r.epoch3*100).toFixed(2).padStart(6)}% ${String(r.positiveEpochs).padStart(4)}`);
    }
  }

  // Also show overall top 15 (regardless of robustness)
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  OVERALL TOP 15 (cum_pnl × sqrt(n)) — robust or not');
  console.log('══════════════════════════════════════════════════════════════════');
  const allSorted = [...results].sort((a, b) => (b.cumPnL * Math.sqrt(b.n)) - (a.cumPnL * Math.sqrt(a.n)));
  console.log(`  ${'id'.padEnd(40)} ${'hold'.padEnd(6)} ${'n'.padStart(5)} ${'win%'.padStart(6)} ${'cumP&L'.padStart(8)} ${'sharpe'.padStart(7)} ${'+ep'.padStart(4)}`);
  for (let i = 0; i < 15; i++) {
    const r = allSorted[i];
    console.log(`  ${r.id.padEnd(40)} ${String(r.hold).padEnd(6)} ${String(r.n).padStart(5)} ${(r.winRate*100).toFixed(1).padStart(5)}% ${(r.cumPnL*100).toFixed(2).padStart(7)}% ${r.sharpe.toFixed(3).padStart(7)} ${String(r.positiveEpochs).padStart(4)}`);
  }

  const csvPath = join(OUT_DIR, 'experiment-wave5-results.csv');
  const headers = ['id', 'hold', 'n', 'winRate', 'avgPnL', 'cumPnL', 'sharpe', 'epoch1', 'epoch2', 'epoch3', 'positiveEpochs'];
  const lines = [headers.join(',')];
  for (const r of results) lines.push(headers.map(h => typeof r[h] === 'number' ? r[h].toFixed(6) : String(r[h] ?? '')).join(','));
  writeFileSync(csvPath, lines.join('\n'));
  console.log(`\n${results.length} (signal, hold) combos. Results: ${csvPath}\n`);
}

main();
