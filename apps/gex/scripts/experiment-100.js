#!/usr/bin/env node
/**
 * 100 GEX/VEX experiments — PRECOMPUTED VERSION.
 *
 * Refactor: precompute per-frame state + cell histories for all 10 days × 3
 * tickers ONCE, then evaluate every signal against the cache. Should reduce
 * runtime from many minutes to under a minute.
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
const TOUCH_TOL = { SPXW: 2.5, SPY: 0.5, QQQ: 0.5 };
const MIN_FLOOR_CEIL_REL = 0.02;
const MIN_GATEKEEPER_REL = 0.015;
const MIN_MAGNITUDE_DOLLARS = 1e6;

// ─── Replay loading ───
function loadReplay(path) {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  const out = {};
  for (const t of TICKERS) {
    const frames = [];
    for (const f of raw.frames) {
      const tk = f.tickers[t];
      if (!tk || !tk.spotPrice || !Array.isArray(tk.gammaValues)) continue;
      frames.push({
        ts: f.timestamp,
        spot: tk.spotPrice,
        strikes: tk.strikes,
        gamma: tk.gammaValues,
        vanna: tk.vannaValues,
      });
    }
    out[t] = frames;
  }
  return out;
}

// ─── State computation ───
function computeFrameState(frame) {
  const { spot, strikes, gamma, vanna } = frame;
  const expCount = gamma[0]?.length || 0;
  let totalAbs = 0, signedTotal = 0;
  const nodes = strikes.map((s, i) => {
    const g = gamma[i]?.[0] ?? 0;
    return { strike: s, gamma: g, absG: Math.abs(g) };
  });
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
        if (!biggestAirPocket || span > biggestAirPocket.span) {
          biggestAirPocket = { low: runStart, high: n.strike, span };
        }
      }
      runStart = null;
    }
  }
  const top3 = [...nodes].sort((a, b) => b.absG - a.absG).slice(0, 3);
  const top3Share = top3.reduce((a, n) => a + n.absG, 0) / totalAbs;
  let vannaAbs = 0, vannaSigned = 0;
  for (let i = 0; i < strikes.length; i++) {
    const v = vanna?.[i]?.[0] ?? 0;
    vannaAbs += Math.abs(v); vannaSigned += v;
  }
  const vannaRegime = vannaAbs > 0 ? vannaSigned / vannaAbs : 0;

  return {
    ts: frame.ts, spot, expCount,
    totalAbs, signedTotal, regimeScore,
    king, floor, ceiling,
    biggestAirPocket, top3Share,
    vannaAbs, vannaSigned, vannaRegime,
  };
}

// Build cell-velocity arrays per (ticker, strike, expIdx) → per-frame value
function precomputeForTicker(frames) {
  const states = frames.map(f => ({ frame: f, state: computeFrameState(f) }));
  // gamma velocity per strike (aggregated across expiries) per frame
  const aggGammaVelByStrikeStrIdx = []; // [frameIdx] = Map(strike → vel)
  const bestGrowingByFrame = []; // [frameIdx] = {gex: bestCell, vex: bestCell}

  const gammaHist = new Map(); // strike|exp → buf
  const vannaHist = new Map();

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const expLimit = f.gamma[0]?.length || 0;
    for (let si = 0; si < f.gamma.length; si++) {
      for (let ei = 0; ei < expLimit; ei++) {
        const key = `${f.strikes[si]}|${ei}`;
        if (!gammaHist.has(key)) gammaHist.set(key, []);
        if (!vannaHist.has(key)) vannaHist.set(key, []);
        const bg = gammaHist.get(key);
        bg.push(f.gamma[si]?.[ei] ?? 0);
        if (bg.length > VEL_WINDOW + 1) bg.shift();
        const bv = vannaHist.get(key);
        bv.push(f.vanna?.[si]?.[ei] ?? 0);
        if (bv.length > VEL_WINDOW + 1) bv.shift();
      }
    }
    // aggregate gamma velocity per strike (sum across expiries)
    const aggMap = new Map();
    for (const [key, buf] of gammaHist) {
      if (buf.length < VEL_WINDOW + 1) continue;
      const strikeStr = key.split('|')[0];
      const strike = parseFloat(strikeStr);
      const delta = buf[buf.length - 1] - buf[0];
      aggMap.set(strike, (aggMap.get(strike) || 0) + delta);
    }
    aggGammaVelByStrikeStrIdx.push(aggMap);

    // best-growing cell GEX and VEX
    const proximity = (f.spot || 0) * 0.02;
    let bestGex = null;
    let bestVex = null;
    for (const [key, buf] of gammaHist) {
      if (buf.length < VEL_WINDOW + 1) continue;
      const strikeStr = key.split('|')[0];
      const strike = parseFloat(strikeStr);
      if (Math.abs(strike - f.spot) > proximity) continue;
      const now = buf[buf.length - 1];
      if (now <= MIN_MAGNITUDE_DOLLARS) continue;
      const delta = now - buf[0];
      if (delta <= 0) continue;
      if (!bestGex || delta > bestGex.delta) bestGex = { strike, delta, expIdx: parseInt(key.split('|')[1], 10) };
    }
    for (const [key, buf] of vannaHist) {
      if (buf.length < VEL_WINDOW + 1) continue;
      const strikeStr = key.split('|')[0];
      const strike = parseFloat(strikeStr);
      if (Math.abs(strike - f.spot) > proximity) continue;
      const now = buf[buf.length - 1];
      if (now <= MIN_MAGNITUDE_DOLLARS) continue;
      const delta = now - buf[0];
      if (delta <= 0) continue;
      if (!bestVex || delta > bestVex.delta) bestVex = { strike, delta, expIdx: parseInt(key.split('|')[1], 10) };
    }
    bestGrowingByFrame.push({ gex: bestGex, vex: bestVex });
  }

  // Streaks
  const floorGrowStreak = new Array(frames.length).fill(0);
  const floorDecayStreak = new Array(frames.length).fill(0);
  const ceilingGrowStreak = new Array(frames.length).fill(0);
  const ceilingDecayStreak = new Array(frames.length).fill(0);
  const confluenceStreak = new Array(frames.length).fill(0);
  const multiExpiryStreak = new Array(frames.length).fill(0);
  const kingDriftUpStreak = new Array(frames.length).fill(0);
  const kingDriftDownStreak = new Array(frames.length).fill(0);
  const regimeJustFlippedPos = new Array(frames.length).fill(false);
  const recent15MinReturn = new Array(frames.length).fill(0);
  const kingStrike15MinAgo = new Array(frames.length).fill(null);

  let prevConfDir = 0, confStreak = 0;
  let prevMultiDir = 0, multiStreak = 0;
  let prevKing = null, upStreak = 0, downStreak = 0;
  let prevRegimeSign = null;

  for (let i = 0; i < frames.length; i++) {
    const st = states[i].state;
    if (!st) continue;

    // floor / ceiling velocity streaks
    if (i > 0 && states[i - 1].state) {
      const fv = st.floor ? aggGammaVelByStrikeStrIdx[i].get(st.floor.strike) : null;
      const cv = st.ceiling ? aggGammaVelByStrikeStrIdx[i].get(st.ceiling.strike) : null;
      floorGrowStreak[i] = fv != null && fv > 0 ? floorGrowStreak[i - 1] + 1 : 0;
      floorDecayStreak[i] = fv != null && fv < 0 ? floorDecayStreak[i - 1] + 1 : 0;
      ceilingGrowStreak[i] = cv != null && cv > 0 ? ceilingGrowStreak[i - 1] + 1 : 0;
      ceilingDecayStreak[i] = cv != null && cv < 0 ? ceilingDecayStreak[i - 1] + 1 : 0;
    }

    // confluence streak
    const bg = bestGrowingByFrame[i];
    const confDir = (bg.gex && bg.vex)
      ? (Math.sign(bg.gex.strike - st.spot) === Math.sign(bg.vex.strike - st.spot) ? Math.sign(bg.gex.strike - st.spot) : 0)
      : 0;
    if (confDir !== 0 && confDir === prevConfDir) confStreak++;
    else confStreak = confDir !== 0 ? 1 : 0;
    confluenceStreak[i] = confStreak;
    prevConfDir = confDir;

    // multi-expiry streak (cell with both 0 and weekly growing)
    let multiDir = 0;
    if (bg.gex) {
      const strike = bg.gex.strike;
      const expLim = st.expCount;
      // get individual velocity for cell at expIdx 0 and expIdx max
      const key0 = `${strike}|0`;
      const keyW = `${strike}|${Math.min(4, expLim - 1)}`;
      const buf0 = gammaHist.get(key0);
      const bufW = gammaHist.get(keyW);
      if (buf0 && bufW && buf0.length >= VEL_WINDOW + 1 && bufW.length >= VEL_WINDOW + 1) {
        const v0 = buf0[buf0.length - 1] - buf0[0];
        const vw = bufW[bufW.length - 1] - bufW[0];
        if (v0 > 0 && vw > 0) multiDir = Math.sign(strike - st.spot);
      }
    }
    if (multiDir !== 0 && multiDir === prevMultiDir) multiStreak++;
    else multiStreak = multiDir !== 0 ? 1 : 0;
    multiExpiryStreak[i] = multiStreak;
    prevMultiDir = multiDir;

    // king drift streaks
    if (prevKing != null && st.king) {
      if (st.king.strike > prevKing) { upStreak++; downStreak = 0; }
      else if (st.king.strike < prevKing) { downStreak++; upStreak = 0; }
      else { upStreak = 0; downStreak = 0; }
    }
    kingDriftUpStreak[i] = upStreak;
    kingDriftDownStreak[i] = downStreak;
    prevKing = st.king?.strike ?? prevKing;

    // 15-min lookback
    const lookback = Math.max(0, i - 15);
    recent15MinReturn[i] = (frames[i].spot - frames[lookback].spot) / frames[lookback].spot;
    kingStrike15MinAgo[i] = states[lookback]?.state?.king?.strike ?? null;

    // regime flip
    const curSign = Math.sign(st.regimeScore);
    regimeJustFlippedPos[i] = (prevRegimeSign === -1 && curSign === 1);
    prevRegimeSign = curSign;
  }

  return {
    frames, states,
    bestGrowingByFrame,
    floorGrowStreak, floorDecayStreak,
    ceilingGrowStreak, ceilingDecayStreak,
    confluenceStreak,
    multiExpiryStreak,
    kingDriftUpStreak, kingDriftDownStreak,
    regimeJustFlippedPos,
    recent15MinReturn,
    kingStrike15MinAgo,
  };
}

// ─── Signals (same as before) ───
const signals = [];
function inSession(ts, session) {
  const d = new Date(ts);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return h >= session.hours[0] && h < session.hours[1];
}

// Family 1: Level-conditioned cell velocity
for (const minStreak of [3, 5, 10]) {
  signals.push({ id: `L1.floor_growing_${minStreak}`, fn: (st, p, i, ctx) => {
    if (!st.floor) return 0;
    return p.floorGrowStreak[i] >= minStreak ? 1 : 0;
  }});
  signals.push({ id: `L1.ceiling_growing_${minStreak}`, fn: (st, p, i, ctx) => {
    if (!st.ceiling) return 0;
    return p.ceilingGrowStreak[i] >= minStreak ? -1 : 0;
  }});
  signals.push({ id: `L1.ceiling_decaying_${minStreak}`, fn: (st, p, i, ctx) => {
    if (!st.ceiling) return 0;
    return p.ceilingDecayStreak[i] >= minStreak ? 1 : 0;
  }});
  signals.push({ id: `L1.floor_decaying_${minStreak}`, fn: (st, p, i, ctx) => {
    if (!st.floor) return 0;
    return p.floorDecayStreak[i] >= minStreak ? -1 : 0;
  }});
}

// Family 2: Greek confluence
for (const minStreak of [5, 10, 20]) {
  signals.push({ id: `G2.gex_vex_agree_${minStreak}`, fn: (st, p, i, ctx) => {
    const bg = p.bestGrowingByFrame[i];
    if (!bg.gex || !bg.vex) return 0;
    const d = Math.sign(bg.gex.strike - st.spot);
    if (d !== Math.sign(bg.vex.strike - st.spot)) return 0;
    return p.confluenceStreak[i] >= minStreak ? d : 0;
  }});
}
signals.push({ id: `G2.gex_pos_vex_pos`, fn: (st) => (st.regimeScore > 0.1 && st.vannaRegime > 0.1 ? 1 : 0) });
signals.push({ id: `G2.gex_pos_vex_neg`, fn: (st) => (st.regimeScore > 0.1 && st.vannaRegime < -0.1 ? -1 : 0) });
signals.push({ id: `G2.gex_neg_vex_pos`, fn: (st) => (st.regimeScore < -0.1 && st.vannaRegime > 0.1 ? 1 : 0) });
signals.push({ id: `G2.gex_neg_vex_neg`, fn: (st) => (st.regimeScore < -0.1 && st.vannaRegime < -0.1 ? -1 : 0) });

// Family 3: Air pockets
for (const proximity of [0.5, 1.0]) {
  signals.push({ id: `A3.air_pocket_above_${proximity}pct`, fn: (st) => {
    if (!st.biggestAirPocket) return 0;
    const d = (st.biggestAirPocket.low - st.spot) / st.spot * 100;
    return (d > 0 && d < proximity) ? 1 : 0;
  }});
  signals.push({ id: `A3.air_pocket_below_${proximity}pct`, fn: (st) => {
    if (!st.biggestAirPocket) return 0;
    const d = (st.spot - st.biggestAirPocket.high) / st.spot * 100;
    return (d > 0 && d < proximity) ? -1 : 0;
  }});
}
signals.push({ id: `A3.large_air_pocket_above`, fn: (st) => {
  if (!st.biggestAirPocket) return 0;
  if (st.biggestAirPocket.low <= st.spot) return 0;
  return (st.biggestAirPocket.span / st.spot) > 0.01 ? 1 : 0;
}});
signals.push({ id: `A3.large_air_pocket_below`, fn: (st) => {
  if (!st.biggestAirPocket) return 0;
  if (st.biggestAirPocket.high >= st.spot) return 0;
  return (st.biggestAirPocket.span / st.spot) > 0.01 ? -1 : 0;
}});

// Family 4: King migration
for (const dir of ['up', 'down']) {
  for (const minStreak of [3, 5, 10]) {
    signals.push({ id: `K4.king_drift_${dir}_${minStreak}`, fn: (st, p, i, ctx) => {
      const s = dir === 'up' ? p.kingDriftUpStreak[i] : p.kingDriftDownStreak[i];
      return s >= minStreak ? (dir === 'up' ? 1 : -1) : 0;
    }});
  }
}
signals.push({ id: `K4.spot_chasing_king`, fn: (st, p, i, ctx) => {
  if (!p.kingStrike15MinAgo[i] || !st.king) return 0;
  if (Math.abs(st.king.strike - st.spot) < Math.abs(p.kingStrike15MinAgo[i] - st.spot) * 0.5) {
    return Math.sign(st.king.strike - st.spot);
  }
  return 0;
}});
signals.push({ id: `K4.king_far_from_spot`, fn: (st) => {
  if (!st.king || st.king.gamma <= 0) return 0;
  if (Math.abs(st.king.strike - st.spot) / st.spot < 0.005) return 0;
  return Math.sign(st.king.strike - st.spot);
}});

// Family 5: Regime
for (const minRegime of [0.1, 0.3, 0.5]) {
  signals.push({ id: `R5.pos_regime_${minRegime}_below_king`, fn: (st) => {
    if (st.regimeScore <= minRegime || !st.king || st.king.gamma <= 0) return 0;
    return st.spot < st.king.strike ? 1 : 0;
  }});
  signals.push({ id: `R5.pos_regime_${minRegime}_above_king`, fn: (st) => {
    if (st.regimeScore <= minRegime || !st.king || st.king.gamma <= 0) return 0;
    return st.spot > st.king.strike ? -1 : 0;
  }});
  signals.push({ id: `R5.neg_regime_${minRegime}_continuation`, fn: (st, p, i, ctx) => {
    if (st.regimeScore >= -minRegime) return 0;
    return Math.sign(p.recent15MinReturn[i] || 0);
  }});
}
signals.push({ id: `R5.regime_flipped_pos`, fn: (st, p, i, ctx) => {
  if (!p.regimeJustFlippedPos[i] || !st.king) return 0;
  return Math.sign(st.king.strike - st.spot);
}});

// Family 6: Spot position
signals.push({ id: `S6.spot_in_lower_third`, fn: (st) => {
  if (!st.floor || !st.ceiling) return 0;
  const r = st.ceiling.strike - st.floor.strike;
  if (r <= 0) return 0;
  return ((st.spot - st.floor.strike) / r) < 0.33 ? 1 : 0;
}});
signals.push({ id: `S6.spot_in_upper_third`, fn: (st) => {
  if (!st.floor || !st.ceiling) return 0;
  const r = st.ceiling.strike - st.floor.strike;
  if (r <= 0) return 0;
  return ((st.spot - st.floor.strike) / r) > 0.67 ? -1 : 0;
}});
signals.push({ id: `S6.spot_below_floor`, fn: (st) => (st.floor && st.spot < st.floor.strike ? -1 : 0) });
signals.push({ id: `S6.spot_above_ceiling`, fn: (st) => (st.ceiling && st.spot > st.ceiling.strike ? 1 : 0) });
signals.push({ id: `S6.spot_near_floor`, fn: (st, p, i, ctx) => st.floor && Math.abs(st.spot - st.floor.strike) <= TOUCH_TOL[ctx.ticker] ? 1 : 0 });
signals.push({ id: `S6.spot_near_ceiling`, fn: (st, p, i, ctx) => st.ceiling && Math.abs(st.spot - st.ceiling.strike) <= TOUCH_TOL[ctx.ticker] ? -1 : 0 });
signals.push({ id: `S6.spot_near_king_from_below`, fn: (st, p, i, ctx) => {
  if (!st.king || st.king.gamma <= 0 || st.spot >= st.king.strike) return 0;
  return (st.king.strike - st.spot) <= TOUCH_TOL[ctx.ticker] * 2 ? -1 : 0;
}});
signals.push({ id: `S6.spot_near_king_from_above`, fn: (st, p, i, ctx) => {
  if (!st.king || st.king.gamma <= 0 || st.spot <= st.king.strike) return 0;
  return (st.spot - st.king.strike) <= TOUCH_TOL[ctx.ticker] * 2 ? 1 : 0;
}});

// Family 7: Time of day
const sessions = [
  { label: 'opening_drive', hours: [13.5, 14.0] },
  { label: 'morning_trend', hours: [14.0, 15.5] },
  { label: 'lunch_chop',    hours: [15.5, 17.5] },
  { label: 'afternoon',     hours: [17.5, 19.0] },
  { label: 'power_hour',    hours: [19.0, 20.0] },
];
for (const s of sessions) {
  signals.push({ id: `T7.${s.label}_toward_king`, fn: (st, p, i, ctx) => {
    if (!inSession(st.ts, s)) return 0;
    if (!st.king || st.king.gamma <= 0) return 0;
    return Math.sign(st.king.strike - st.spot);
  }});
  signals.push({ id: `T7.${s.label}_against_recent`, fn: (st, p, i, ctx) => {
    if (!inSession(st.ts, s)) return 0;
    return -Math.sign(p.recent15MinReturn[i] || 0);
  }});
  signals.push({ id: `T7.${s.label}_with_recent`, fn: (st, p, i, ctx) => {
    if (!inSession(st.ts, s)) return 0;
    return Math.sign(p.recent15MinReturn[i] || 0);
  }});
}

// Family 8: Cross-ticker (uses ctx.crossTickerStates)
function crossBias(s) {
  if (!s || !s.king || s.king.gamma <= 0) return 0;
  return Math.sign(s.king.strike - s.spot);
}
signals.push({ id: `C8.trinity_unanimous_king`, fn: (st, p, i, ctx) => {
  const a = crossBias(ctx.crossStates?.SPXW);
  const b = crossBias(ctx.crossStates?.SPY);
  const c = crossBias(ctx.crossStates?.QQQ);
  if (a === 0 || b === 0 || c === 0) return 0;
  return (a === b && b === c) ? a : 0;
}});
signals.push({ id: `C8.majority_king_bias`, fn: (st, p, i, ctx) => {
  const a = crossBias(ctx.crossStates?.SPXW);
  const b = crossBias(ctx.crossStates?.SPY);
  const c = crossBias(ctx.crossStates?.QQQ);
  const sum = a + b + c;
  return Math.abs(sum) >= 2 ? Math.sign(sum) : 0;
}});
signals.push({ id: `C8.spx_regime_pos_strong`, fn: (st, p, i, ctx) => {
  const spx = ctx.crossStates?.SPXW;
  return spx && spx.regimeScore > 0.4 ? 1 : 0;
}});
signals.push({ id: `C8.spx_regime_neg_strong`, fn: (st, p, i, ctx) => {
  const spx = ctx.crossStates?.SPXW;
  return spx && spx.regimeScore < -0.4 ? -1 : 0;
}});
signals.push({ id: `C8.spx_qqq_diverge`, fn: (st, p, i, ctx) => {
  if (ctx.ticker !== 'QQQ') return 0;
  const a = crossBias(ctx.crossStates?.SPXW);
  const c = crossBias(ctx.crossStates?.QQQ);
  if (a === 1 && c === -1) return -1;
  if (a === -1 && c === 1) return 1;
  return 0;
}});

// Family 9: Multi-expiry
for (const minStreak of [3, 5, 10]) {
  signals.push({ id: `M9.multi_expiry_align_${minStreak}`, fn: (st, p, i, ctx) => {
    if (p.multiExpiryStreak[i] < minStreak) return 0;
    const bg = p.bestGrowingByFrame[i];
    if (!bg.gex) return 0;
    return Math.sign(bg.gex.strike - st.spot);
  }});
}

// Family 10: Concentration
for (const minShare of [0.3, 0.5, 0.7]) {
  signals.push({ id: `E10.concentrated_${minShare}_toward_king`, fn: (st) => {
    if (st.top3Share < minShare || !st.king || st.king.gamma <= 0) return 0;
    return Math.sign(st.king.strike - st.spot);
  }});
}
signals.push({ id: `E10.diffuse_continuation`, fn: (st, p, i, ctx) => {
  if (st.top3Share >= 0.25) return 0;
  return Math.sign(p.recent15MinReturn[i] || 0);
}});
signals.push({ id: `E10.king_share_high`, fn: (st) => {
  if (!st.king || st.king.gamma <= 0) return 0;
  return (st.king.absG / st.totalAbs) > 0.2 ? Math.sign(st.king.strike - st.spot) : 0;
}});

console.log(`Defined ${signals.length} signal experiments\n`);

// ─── Simulation ───
function simulateSignal(signal, byDayTicker, hold) {
  const trades = [];
  for (const [date, byTicker] of Object.entries(byDayTicker)) {
    for (const ticker of TICKERS) {
      const p = byTicker[ticker];
      if (!p) continue;
      const cost = FLIP_COST[ticker];
      let cooldownUntil = null;

      for (let i = 0; i < p.frames.length; i++) {
        const st = p.states[i].state;
        if (!st) continue;
        // Cross-ticker states (just take state of same frame index from other tickers)
        const crossStates = {};
        for (const t of TICKERS) {
          const other = byTicker[t];
          if (other?.states[i]?.state) crossStates[t] = other.states[i].state;
        }
        const ctx = { ticker, crossStates };
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
  return {
    n: trades.length,
    winRate: wins / trades.length,
    avgPnL: avg, cumPnL: cum, sharpe,
    best: Math.max(...trades.map(t => t.pnl)),
    worst: Math.min(...trades.map(t => t.pnl)),
  };
}

function main() {
  const nDays = parseInt(process.argv[2] || '10', 10);
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(REPLAY_DIR)
    .filter(f => /^gex-replay-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const recent = files.slice(-nDays).map(f => f.match(/(\d{4}-\d{2}-\d{2})/)[1]);

  console.log(`▶ ${signals.length} GEX/VEX experiments on ${recent.length} days: ${recent[0]} → ${recent[recent.length-1]}\n`);

  console.log('Precomputing per-day per-ticker states + cell histories...');
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
  console.log(`Precompute done in ${Math.round((Date.now() - t0) / 1000)}s\n`);

  console.log('Running experiments...');
  const t1 = Date.now();
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
  console.log(`Ran ${results.length} (signal, hold) combinations in ${Math.round((Date.now() - t1) / 1000)}s\n`);

  results.sort((a, b) => (b.cumPnL * Math.sqrt(b.n)) - (a.cumPnL * Math.sqrt(a.n)));

  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  TOP 25 BY cum_pnl × sqrt(n)');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`  ${'rank'.padEnd(5)} ${'id'.padEnd(45)} ${'hold'.padEnd(6)} ${'n'.padStart(4)}  ${'win%'.padStart(6)}  ${'cumP&L'.padStart(8)}  ${'sharpe'.padStart(7)}`);
  for (let i = 0; i < Math.min(25, results.length); i++) {
    const r = results[i];
    console.log(`  ${String(i + 1).padEnd(5)} ${r.id.padEnd(45)} ${String(r.hold).padEnd(6)} ${String(r.n).padStart(4)}  ${(r.winRate*100).toFixed(1).padStart(5)}%  ${(r.cumPnL*100).toFixed(2).padStart(7)}%  ${r.sharpe.toFixed(3).padStart(7)}`);
  }

  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  TOP 15 BY SHARPE (n ≥ 15)');
  console.log('══════════════════════════════════════════════════════════════════');
  const bySharpe = [...results].filter(r => r.n >= 15).sort((a, b) => b.sharpe - a.sharpe);
  console.log(`  ${'rank'.padEnd(5)} ${'id'.padEnd(45)} ${'hold'.padEnd(6)} ${'n'.padStart(4)}  ${'win%'.padStart(6)}  ${'cumP&L'.padStart(8)}  ${'sharpe'.padStart(7)}`);
  for (let i = 0; i < Math.min(15, bySharpe.length); i++) {
    const r = bySharpe[i];
    console.log(`  ${String(i + 1).padEnd(5)} ${r.id.padEnd(45)} ${String(r.hold).padEnd(6)} ${String(r.n).padStart(4)}  ${(r.winRate*100).toFixed(1).padStart(5)}%  ${(r.cumPnL*100).toFixed(2).padStart(7)}%  ${r.sharpe.toFixed(3).padStart(7)}`);
  }

  // Worst performers (the ones to fade)
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  WORST 10 — potential FADE candidates');
  console.log('══════════════════════════════════════════════════════════════════');
  const worst = [...results].filter(r => r.n >= 15).sort((a, b) => (a.cumPnL * Math.sqrt(a.n)) - (b.cumPnL * Math.sqrt(b.n)));
  for (let i = 0; i < Math.min(10, worst.length); i++) {
    const r = worst[i];
    console.log(`  ${String(i + 1).padEnd(5)} ${r.id.padEnd(45)} ${String(r.hold).padEnd(6)} ${String(r.n).padStart(4)}  ${(r.winRate*100).toFixed(1).padStart(5)}%  ${(r.cumPnL*100).toFixed(2).padStart(7)}%`);
  }

  const csvPath = join(OUT_DIR, 'experiment-100-results.csv');
  const headers = ['id', 'hold', 'n', 'winRate', 'avgPnL', 'cumPnL', 'sharpe', 'best', 'worst'];
  const lines = [headers.join(',')];
  for (const r of results) lines.push(headers.map(h => typeof r[h] === 'number' ? r[h].toFixed(6) : String(r[h])).join(','));
  writeFileSync(csvPath, lines.join('\n'));
  console.log(`\n${results.length} results saved to: ${csvPath}\n`);
}

main();
