#!/usr/bin/env node
/**
 * Wave 2 — refine + invert + combine.
 *
 * Findings from wave 1 (experiment-100.js):
 *   • Top winner: T7.lunch_chop_with_recent EOD (66.7% / +5.15%)
 *   • M9.multi_expiry_align_3 EOD (65% / +3.95%)
 *   • C8.spx_qqq_diverge 60m (62.5% / +1.56%, Sharpe 0.43)
 *   • Level signals were INVERTED — ceiling growing pulls price UP, not down
 *   • Following recent 15-min direction works in all sessions
 *
 * Wave 2 tests:
 *   • Inverted L1 signals (corrected GEX magnet interpretation)
 *   • AND-combinations of winners (multi-condition gates)
 *   • Tighter / looser thresholds on winners
 *   • Ticker-specific variants (SPX-only, SPY-only, QQQ-only)
 *   • Direction-specific variants (LONG-only or SHORT-only)
 *   • Filters: skip first/last N minutes
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
  const states = frames.map(f => ({ frame: f, state: computeFrameState(f) }));
  const aggGammaVelByFrame = [];
  const aggVannaVelByFrame = [];
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
    const aggGamma = new Map();
    const aggVanna = new Map();
    for (const [key, buf] of gammaHist) {
      if (buf.length < VEL_WINDOW + 1) continue;
      const strike = parseFloat(key.split('|')[0]);
      const delta = buf[buf.length - 1] - buf[0];
      aggGamma.set(strike, (aggGamma.get(strike) || 0) + delta);
    }
    for (const [key, buf] of vannaHist) {
      if (buf.length < VEL_WINDOW + 1) continue;
      const strike = parseFloat(key.split('|')[0]);
      const delta = buf[buf.length - 1] - buf[0];
      aggVanna.set(strike, (aggVanna.get(strike) || 0) + delta);
    }
    aggGammaVelByFrame.push(aggGamma);
    aggVannaVelByFrame.push(aggVanna);
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
      if (!bestGex || delta > bestGex.delta) bestGex = { strike, delta, expIdx: parseInt(key.split('|')[1], 10) };
    }
    for (const [key, buf] of vannaHist) {
      if (buf.length < VEL_WINDOW + 1) continue;
      const strike = parseFloat(key.split('|')[0]);
      if (Math.abs(strike - f.spot) > proximity) continue;
      const now = buf[buf.length - 1];
      if (now <= MIN_MAGNITUDE_DOLLARS) continue;
      const delta = now - buf[0];
      if (delta <= 0) continue;
      if (!bestVex || delta > bestVex.delta) bestVex = { strike, delta, expIdx: parseInt(key.split('|')[1], 10) };
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
  const recent15MinReturn = new Array(frames.length).fill(0);
  const recent5MinReturn = new Array(frames.length).fill(0);
  const recent30MinReturn = new Array(frames.length).fill(0);
  let prevConfDir = 0, confStreak = 0, prevKing = null, upStreak = 0, downStreak = 0;
  for (let i = 0; i < frames.length; i++) {
    const st = states[i].state; if (!st) continue;
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
    const lb15 = Math.max(0, i - 15);
    const lb5 = Math.max(0, i - 5);
    const lb30 = Math.max(0, i - 30);
    recent15MinReturn[i] = (frames[i].spot - frames[lb15].spot) / frames[lb15].spot;
    recent5MinReturn[i] = (frames[i].spot - frames[lb5].spot) / frames[lb5].spot;
    recent30MinReturn[i] = (frames[i].spot - frames[lb30].spot) / frames[lb30].spot;
  }
  return { frames, states, bestGrowingByFrame, floorGrowStreak, floorDecayStreak, ceilingGrowStreak, ceilingDecayStreak, confluenceStreak, kingDriftUpStreak, kingDriftDownStreak, recent15MinReturn, recent5MinReturn, recent30MinReturn, aggGammaVelByFrame, aggVannaVelByFrame };
}

const signals = [];

function inSession(ts, hourStart, hourEnd) {
  const d = new Date(ts);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return h >= hourStart && h < hourEnd;
}

// ── Category: INVERTED L1 signals (the corrected GEX magnet interpretation) ──
for (const minStreak of [3, 5, 10]) {
  signals.push({ id: `W2.floor_growing_LONG_${minStreak}`, fn: (st, p, i) => {
    // Floor cell growing → magnet pulling DOWN. So go SHORT? But wave 1 showed
    // L1.floor_growing→LONG lost; that means floor growing → price goes DOWN.
    // So the inversion is floor_growing → SHORT.
    if (!st.floor) return 0;
    return p.floorGrowStreak[i] >= minStreak ? -1 : 0;
  }});
  signals.push({ id: `W2.ceiling_growing_LONG_${minStreak}`, fn: (st, p, i) => {
    if (!st.ceiling) return 0;
    return p.ceilingGrowStreak[i] >= minStreak ? 1 : 0;
  }});
  signals.push({ id: `W2.ceiling_decaying_SHORT_${minStreak}`, fn: (st, p, i) => {
    if (!st.ceiling) return 0;
    return p.ceilingDecayStreak[i] >= minStreak ? -1 : 0;
  }});
  signals.push({ id: `W2.floor_decaying_LONG_${minStreak}`, fn: (st, p, i) => {
    if (!st.floor) return 0;
    return p.floorDecayStreak[i] >= minStreak ? 1 : 0;
  }});
}

// ── Category: AND-combination of winners ──
function isLunchChop(ts) { return inSession(ts, 15.5, 17.5); }
function isOpeningDrive(ts) { return inSession(ts, 13.5, 14.0); }
function isAfternoon(ts) { return inSession(ts, 17.5, 19.0); }

signals.push({ id: `W2.lunch_chop_with_recent_AND_concentrated`, fn: (st, p, i) => {
  if (!isLunchChop(st.ts)) return 0;
  if (st.top3Share < 0.3) return 0;
  return Math.sign(p.recent15MinReturn[i] || 0);
}});
signals.push({ id: `W2.lunch_chop_with_recent_AND_pos_regime`, fn: (st, p, i) => {
  if (!isLunchChop(st.ts)) return 0;
  if (st.regimeScore <= 0.1) return 0;
  return Math.sign(p.recent15MinReturn[i] || 0);
}});
signals.push({ id: `W2.lunch_chop_with_recent_AND_neg_regime`, fn: (st, p, i) => {
  if (!isLunchChop(st.ts)) return 0;
  if (st.regimeScore >= -0.1) return 0;
  return Math.sign(p.recent15MinReturn[i] || 0);
}});
signals.push({ id: `W2.afternoon_with_recent_AND_ceiling_decaying`, fn: (st, p, i) => {
  if (!isAfternoon(st.ts)) return 0;
  if (p.ceilingDecayStreak[i] < 3) return 0;
  return Math.sign(p.recent15MinReturn[i] || 0);
}});
signals.push({ id: `W2.opening_drive_AND_multi_expiry`, fn: (st, p, i) => {
  if (!isOpeningDrive(st.ts)) return 0;
  const bg = p.bestGrowingByFrame[i];
  if (!bg.gex) return 0;
  return Math.sign(bg.gex.strike - st.spot);
}});

// ── Category: Ticker-specific top winner replicas ──
for (const ticker of ['SPXW', 'SPY', 'QQQ']) {
  signals.push({ id: `W2.${ticker}_only_lunch_with_recent`, fn: (st, p, i, ctx) => {
    if (ctx.ticker !== ticker) return 0;
    if (!isLunchChop(st.ts)) return 0;
    return Math.sign(p.recent15MinReturn[i] || 0);
  }});
  signals.push({ id: `W2.${ticker}_only_opening_with_recent`, fn: (st, p, i, ctx) => {
    if (ctx.ticker !== ticker) return 0;
    if (!isOpeningDrive(st.ts)) return 0;
    return Math.sign(p.recent15MinReturn[i] || 0);
  }});
}

// ── Category: Momentum via different lookback windows ──
for (const lookback of [5, 30, 60]) {
  signals.push({ id: `W2.momentum_${lookback}min`, fn: (st, p, i) => {
    const ret = lookback === 5 ? p.recent5MinReturn[i] : lookback === 30 ? p.recent30MinReturn[i] : p.recent15MinReturn[i];
    return Math.sign(ret || 0);
  }});
  signals.push({ id: `W2.momentum_${lookback}min_strong`, fn: (st, p, i) => {
    const ret = lookback === 5 ? p.recent5MinReturn[i] : lookback === 30 ? p.recent30MinReturn[i] : p.recent15MinReturn[i];
    if (Math.abs(ret) < 0.002) return 0; // require ≥0.2% move
    return Math.sign(ret);
  }});
  signals.push({ id: `W2.fade_${lookback}min_strong`, fn: (st, p, i) => {
    const ret = lookback === 5 ? p.recent5MinReturn[i] : lookback === 30 ? p.recent30MinReturn[i] : p.recent15MinReturn[i];
    if (Math.abs(ret) < 0.003) return 0; // require ≥0.3% move
    return -Math.sign(ret);
  }});
}

// ── Category: LONG-only and SHORT-only variants of top signals ──
signals.push({ id: `W2.lunch_chop_with_recent_LONG_only`, fn: (st, p, i) => {
  if (!isLunchChop(st.ts)) return 0;
  const d = Math.sign(p.recent15MinReturn[i] || 0);
  return d === 1 ? 1 : 0;
}});
signals.push({ id: `W2.lunch_chop_with_recent_SHORT_only`, fn: (st, p, i) => {
  if (!isLunchChop(st.ts)) return 0;
  const d = Math.sign(p.recent15MinReturn[i] || 0);
  return d === -1 ? -1 : 0;
}});
signals.push({ id: `W2.multi_expiry_LONG_only`, fn: (st, p, i) => {
  const bg = p.bestGrowingByFrame[i];
  if (!bg.gex) return 0;
  const d = Math.sign(bg.gex.strike - st.spot);
  return d === 1 ? 1 : 0;
}});

// ── Category: Cross-ticker confluence on momentum (new) ──
signals.push({ id: `W2.all_three_same_15min_momentum`, fn: (st, p, i, ctx) => {
  const a = Math.sign(ctx.crossPrecomputed?.SPXW?.recent15MinReturn[i] || 0);
  const b = Math.sign(ctx.crossPrecomputed?.SPY?.recent15MinReturn[i] || 0);
  const c = Math.sign(ctx.crossPrecomputed?.QQQ?.recent15MinReturn[i] || 0);
  if (a === 0 || b === 0 || c === 0) return 0;
  return (a === b && b === c) ? a : 0;
}});

// ── Category: Big move filter (only trade when ≥X% move expected) ──
signals.push({ id: `W2.king_far_above_spot`, fn: (st) => {
  if (!st.king || st.king.gamma <= 0) return 0;
  const dist = (st.king.strike - st.spot) / st.spot;
  if (dist < 0.005) return 0; // king must be ≥0.5% above
  return 1;
}});
signals.push({ id: `W2.king_far_below_spot`, fn: (st) => {
  if (!st.king || st.king.gamma <= 0) return 0;
  const dist = (st.spot - st.king.strike) / st.spot;
  if (dist < 0.005) return 0;
  return -1;
}});

// ── Category: Open-trade-and-hold ──
signals.push({ id: `W2.open_long_if_pos_regime`, fn: (st, p, i) => {
  if (i > 5) return 0;
  return st.regimeScore > 0.1 ? 1 : 0;
}});
signals.push({ id: `W2.open_short_if_neg_regime`, fn: (st, p, i) => {
  if (i > 5) return 0;
  return st.regimeScore < -0.1 ? -1 : 0;
}});
signals.push({ id: `W2.open_toward_king`, fn: (st, p, i) => {
  if (i > 5) return 0;
  if (!st.king || st.king.gamma <= 0) return 0;
  return Math.sign(st.king.strike - st.spot);
}});

// ── Category: Combined: momentum + confluence ──
signals.push({ id: `W2.momentum_AND_trinity`, fn: (st, p, i, ctx) => {
  const a = Math.sign(ctx.crossPrecomputed?.SPXW?.recent15MinReturn[i] || 0);
  const b = Math.sign(ctx.crossPrecomputed?.SPY?.recent15MinReturn[i] || 0);
  const c = Math.sign(ctx.crossPrecomputed?.QQQ?.recent15MinReturn[i] || 0);
  if (a !== b || b !== c || a === 0) return 0;
  const myMomentum = Math.sign(p.recent15MinReturn[i] || 0);
  if (myMomentum !== a) return 0;
  return a;
}});
signals.push({ id: `W2.momentum_AND_growing_ceiling`, fn: (st, p, i) => {
  const m = Math.sign(p.recent15MinReturn[i] || 0);
  if (m !== 1) return 0; // only LONG, with growing ceiling magnet
  if (p.ceilingGrowStreak[i] < 3) return 0;
  return 1;
}});
signals.push({ id: `W2.momentum_AND_growing_floor`, fn: (st, p, i) => {
  const m = Math.sign(p.recent15MinReturn[i] || 0);
  if (m !== -1) return 0; // only SHORT, with growing floor magnet (pulls down)
  if (p.floorGrowStreak[i] < 3) return 0;
  return -1;
}});

// ── Category: Spx_qqq_diverge variants ──
signals.push({ id: `W2.spx_spy_diverge_short`, fn: (st, p, i, ctx) => {
  if (ctx.ticker !== 'SPY') return 0;
  const a = ctx.crossKingBias?.SPXW;
  const b = ctx.crossKingBias?.SPY;
  if (a === 1 && b === -1) return -1;
  if (a === -1 && b === 1) return 1;
  return 0;
}});
signals.push({ id: `W2.spx_qqq_diverge_long_spy`, fn: (st, p, i, ctx) => {
  if (ctx.ticker !== 'SPY') return 0;
  const a = ctx.crossKingBias?.SPXW;
  const c = ctx.crossKingBias?.QQQ;
  if (a !== c && a !== 0) return a;
  return 0;
}});

// ── Category: Regime change ──
signals.push({ id: `W2.regime_score_drop`, fn: (st, p, i) => {
  // Use state[i-15] vs state[i] regime delta
  const past = p.states[Math.max(0, i - 15)]?.state;
  if (!past) return 0;
  const drop = past.regimeScore - st.regimeScore;
  if (drop > 0.3) return -1; // regime got more negative → trending bearish
  if (drop < -0.3) return 1; // regime got more positive → pinning bullish
  return 0;
}});

console.log(`Defined ${signals.length} wave-2 signals\n`);

function simulateSignal(signal, byDayTicker, hold) {
  const trades = [];
  for (const [date, byTicker] of Object.entries(byDayTicker)) {
    for (const ticker of TICKERS) {
      const p = byTicker[ticker];
      if (!p) continue;
      const cost = FLIP_COST[ticker];
      let cooldownUntil = null;
      // Pre-compute cross-precomputed snapshots & king bias for ctx
      const crossPrecomputed = {};
      for (const t of TICKERS) crossPrecomputed[t] = byTicker[t];
      for (let i = 0; i < p.frames.length; i++) {
        const st = p.states[i].state; if (!st) continue;
        const crossKingBias = {};
        for (const t of TICKERS) {
          const cs = byTicker[t]?.states[i]?.state;
          crossKingBias[t] = (cs && cs.king && cs.king.gamma > 0) ? Math.sign(cs.king.strike - cs.spot) : 0;
        }
        const ctx = { ticker, crossPrecomputed, crossKingBias };
        const direction = signal.fn(st, p, i, ctx);
        if (direction === 0) continue;
        if (cooldownUntil && p.frames[i].ts <= cooldownUntil) continue;
        let exitIdx;
        if (hold === 'EOD') exitIdx = p.frames.length - 1;
        else { exitIdx = i + hold; if (exitIdx >= p.frames.length) continue; }
        const moveReturn = (p.frames[exitIdx].spot - p.frames[i].spot) / p.frames[i].spot;
        const pnl = direction * moveReturn - cost;
        trades.push({ date, ticker, pnl, direction });
        const exitMs = hold === 'EOD' ? Infinity : hold * 60000;
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
  return { n: trades.length, winRate: wins / trades.length, avgPnL: avg, cumPnL: cum, sharpe, best: Math.max(...trades.map(t => t.pnl)), worst: Math.min(...trades.map(t => t.pnl)) };
}

function main() {
  const nDays = parseInt(process.argv[2] || '10', 10);
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(REPLAY_DIR).filter(f => /^gex-replay-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const recent = files.slice(-nDays).map(f => f.match(/(\d{4}-\d{2}-\d{2})/)[1]);
  console.log(`▶ Wave 2: ${signals.length} signals on ${recent.length} days\n`);
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
  console.log(`Done in ${Math.round((Date.now() - t0) / 1000)}s. Running...\n`);
  const results = [];
  const holds = [30, 60, 120, 'EOD'];
  for (const signal of signals) {
    for (const hold of holds) {
      const trades = simulateSignal(signal, byDayTicker, hold);
      const s = summarize(trades);
      if (!s || s.n < 5) continue;
      results.push({ id: signal.id, hold, ...s });
    }
  }
  results.sort((a, b) => (b.cumPnL * Math.sqrt(b.n)) - (a.cumPnL * Math.sqrt(a.n)));
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  WAVE 2 TOP 30 BY cum_pnl × sqrt(n)');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  ${'rank'.padEnd(5)} ${'id'.padEnd(50)} ${'hold'.padEnd(6)} ${'n'.padStart(4)}  ${'win%'.padStart(6)}  ${'cumP&L'.padStart(8)}  ${'sharpe'.padStart(7)}`);
  for (let i = 0; i < Math.min(30, results.length); i++) {
    const r = results[i];
    console.log(`  ${String(i + 1).padEnd(5)} ${r.id.padEnd(50)} ${String(r.hold).padEnd(6)} ${String(r.n).padStart(4)}  ${(r.winRate*100).toFixed(1).padStart(5)}%  ${(r.cumPnL*100).toFixed(2).padStart(7)}%  ${r.sharpe.toFixed(3).padStart(7)}`);
  }
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  WAVE 2 TOP 15 BY SHARPE (n ≥ 15)');
  console.log('══════════════════════════════════════════════════════════════════');
  const bySharpe = [...results].filter(r => r.n >= 15).sort((a, b) => b.sharpe - a.sharpe);
  for (let i = 0; i < Math.min(15, bySharpe.length); i++) {
    const r = bySharpe[i];
    console.log(`  ${String(i + 1).padEnd(5)} ${r.id.padEnd(50)} ${String(r.hold).padEnd(6)} ${String(r.n).padStart(4)}  ${(r.winRate*100).toFixed(1).padStart(5)}%  ${(r.cumPnL*100).toFixed(2).padStart(7)}%  ${r.sharpe.toFixed(3).padStart(7)}`);
  }
  const csvPath = join(OUT_DIR, 'experiment-wave2-results.csv');
  const headers = ['id', 'hold', 'n', 'winRate', 'avgPnL', 'cumPnL', 'sharpe', 'best', 'worst'];
  const lines = [headers.join(',')];
  for (const r of results) lines.push(headers.map(h => typeof r[h] === 'number' ? r[h].toFixed(6) : String(r[h])).join(','));
  writeFileSync(csvPath, lines.join('\n'));
  console.log(`\nResults: ${csvPath}\n`);
}

main();
