#!/usr/bin/env node
/**
 * Intraday monitor — every 30 min during the session, compare current trinity state
 * to the morning baseline and emit only material changes.
 *
 * Material changes detected:
 *   - Regime score crossed ±0.30 boundary on any ticker
 *   - Spot tested or broke a baseline-defined floor / ceiling / king
 *   - New pattern detected (rainbow road, rug, reverse rug, etc.)
 *   - Trinity alignment shifted (e.g. 2/3 LONG → 1/3 LONG)
 *   - King node strike shifted by >1 deflection zone
 *
 * Output: per-checkpoint update (only if material change present)
 *
 * Usage:
 *   npm run monitor -- --date=2026-02-04
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { config } from '../src/utils/config.js';
import { postEmbed, COLORS } from '../src/discord/webhook.js';
import { loadPostedTitlesForDay } from '../src/store/pg.js';

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}
if (!args.date) {
  console.error('Usage: --date=YYYY-MM-DD');
  process.exit(1);
}

const db = new Database(join(config.dataDir, 'gexester.db'), { readonly: true });
const TICKERS = ['SPXW', 'SPY', 'QQQ'];
const ZONE = { SPXW: 5, SPY: 0.5, QQQ: 0.5 };

// ─── Helpers ────────────────────────────────────────────────────────────────
function snapshotAt(ticker, tsMs, mode = 'closest') {
  // Pick the snapshot closest to the requested time (or first/last if at edge)
  const stmt = mode === 'first'
    ? db.prepare(`SELECT * FROM snapshots WHERE ticker=? AND trading_day=? ORDER BY ts_ms ASC LIMIT 1`)
    : mode === 'last'
    ? db.prepare(`SELECT * FROM snapshots WHERE ticker=? AND trading_day=? ORDER BY ts_ms DESC LIMIT 1`)
    : db.prepare(`SELECT * FROM snapshots WHERE ticker=? AND trading_day=? AND ts_ms<=? ORDER BY ts_ms DESC LIMIT 1`);
  return mode === 'closest' ? stmt.get(ticker, args.date, tsMs) : stmt.get(ticker, args.date);
}

function nodesAtSnapshot(snapshotId) {
  return db.prepare(`SELECT * FROM node_snapshots WHERE snapshot_id = ? ORDER BY ABS(gamma) DESC`).all(snapshotId);
}

// Compare strike-level rel_sig now vs `windowMs` ago. Returns top fast-growers.
// This catches strikes BUILDING before they become the king — earlier signal
// than KING_SIGN_FLIP. The 7200 strike on Apr 30 jumped from 1.5% to 7.3% rel_sig
// between 11:00 and 11:30 ET, 30 minutes before becoming the king at 12:00 ET.
function strikeVelocityAlerts(ticker, currentTsMs, requestedWindowMs = 30 * 60 * 1000, minDelta = 0.03) {
  // Adaptive look-back: in the first 30 min of the session we don't have a full 30-min
  // window. Use whatever history is available (min 5 min) so early-day fast checkpoints
  // can still surface building nodes — important for catching V-bottom recoveries.
  const elapsedMs = currentTsMs - dayStart;
  const windowMs = Math.max(5 * 60 * 1000, Math.min(requestedWindowMs, elapsedMs - 60_000));
  // Snapshots at or near currentTsMs and currentTsMs - windowMs
  const curSnap = db.prepare(`
    SELECT snapshot_id, spot FROM snapshots
    WHERE ticker=? AND trading_day=? AND ts_ms<=?
    ORDER BY ts_ms DESC LIMIT 1
  `).get(ticker, args.date, currentTsMs);
  const priorSnap = db.prepare(`
    SELECT snapshot_id, spot FROM snapshots
    WHERE ticker=? AND trading_day=? AND ts_ms<=?
    ORDER BY ts_ms DESC LIMIT 1
  `).get(ticker, args.date, currentTsMs - windowMs);
  if (!curSnap || !priorSnap || curSnap.snapshot_id === priorSnap.snapshot_id) return [];

  const curNodes = db.prepare(`
    SELECT strike, gamma, sign, relative_significance
    FROM node_snapshots WHERE snapshot_id=?
  `).all(curSnap.snapshot_id);
  const priorNodes = db.prepare(`
    SELECT strike, relative_significance
    FROM node_snapshots WHERE snapshot_id=?
  `).all(priorSnap.snapshot_id);
  const priorBy = new Map(priorNodes.map(n => [n.strike, n.relative_significance]));

  const movers = [];
  for (const n of curNodes) {
    const prior = priorBy.get(n.strike) ?? 0;
    const delta = n.relative_significance - prior;
    if (delta >= minDelta) {
      const distFromSpot = n.strike - curSnap.spot;
      const above = distFromSpot > 0;
      movers.push({
        strike: n.strike,
        sign: n.sign,
        gamma: n.gamma,
        relSigNow: n.relative_significance,
        relSigPrior: prior,
        deltaPp: delta * 100,
        distFromSpot,
        above,
      });
    }
  }
  movers.sort((a, b) => b.deltaPp - a.deltaPp);
  return movers.slice(0, 3);
}

// Translate a fast-growing strike into a trade idea framed for option positioning.
function strikeToTradeIdea(m, spot) {
  const dist = Math.abs(m.strike - spot);
  const distBps = (dist / spot) * 10000;
  if (m.sign === 'barney' && m.above) {
    // Barney building above spot — could be resistance/target if regime holds, trapdoor if breaks
    return `${m.strike} BARNEY building above (+${m.deltaPp.toFixed(1)}pp, now ${(m.relSigNow*100).toFixed(1)}% sig) — possible UPSIDE TARGET. Buy ${m.strike} calls cheap (~${distBps.toFixed(0)} bps OTM)`;
  }
  if (m.sign === 'barney' && !m.above) {
    return `${m.strike} BARNEY building below (+${m.deltaPp.toFixed(1)}pp) — TRAPDOOR risk. Buy ${m.strike} puts if floor breaks`;
  }
  if (m.sign === 'pika' && m.above) {
    return `${m.strike} PIKA ceiling building above (+${m.deltaPp.toFixed(1)}pp) — resistance forming, fade if tested`;
  }
  if (m.sign === 'pika' && !m.above) {
    return `${m.strike} PIKA floor building below (+${m.deltaPp.toFixed(1)}pp) — support forming, calls if tested + holds`;
  }
  return null;
}

function patternsAt(snapshotId) {
  return db.prepare(`SELECT pattern FROM pattern_detections WHERE snapshot_id = ? AND detected = 1`).all(snapshotId).map(r => r.pattern);
}

function biasAt(snapshotId) {
  return db.prepare(`SELECT bias_score FROM bias_scores WHERE snapshot_id = ?`).get(snapshotId);
}

function tickerState(ticker, tsMs, mode) {
  const snap = snapshotAt(ticker, tsMs, mode);
  if (!snap) return null;
  const nodes = nodesAtSnapshot(snap.snapshot_id);
  const king = nodes.find(n => n.is_king === 1) || nodes[0];
  const pikaCeiling = nodes.filter(n => n.sign === 'pika' && n.strike > snap.spot)
    .sort((a, b) => b.relative_significance - a.relative_significance)[0];
  const pikaFloor = nodes.filter(n => n.sign === 'pika' && n.strike < snap.spot)
    .sort((a, b) => b.relative_significance - a.relative_significance)[0];
  const barneyAbove = nodes.filter(n => n.sign === 'barney' && n.strike > snap.spot)
    .sort((a, b) => Math.abs(b.gamma) - Math.abs(a.gamma))[0];
  const barneyBelow = nodes.filter(n => n.sign === 'barney' && n.strike < snap.spot)
    .sort((a, b) => Math.abs(b.gamma) - Math.abs(a.gamma))[0];
  const patterns = patternsAt(snap.snapshot_id);
  const bias = biasAt(snap.snapshot_id);
  return {
    ticker, snap, snapshotId: snap.snapshot_id,
    spot: snap.spot, regimeScore: snap.regime_score,
    king, pikaCeiling, pikaFloor, barneyAbove, barneyBelow,
    nodes,
    patterns,
    biasScore: bias?.bias_score,
  };
}

// Build the 2 break levels for a ticker at a given moment (above/below).
// Same logic as morning-brief, condensed for monitor display.
function currentBreakLevels(state) {
  if (!state) return { up: null, down: null };
  const zone = ZONE[state.ticker];
  const nodes = state.nodes;

  const targetAbove = (fromStrike, minSig=0.03) => nodes
    .filter(n => n.strike > fromStrike && n.relative_significance >= minSig)
    .sort((a, b) => Math.abs(b.gamma) - Math.abs(a.gamma))[0];
  const targetBelow = (fromStrike, minSig=0.03) => nodes
    .filter(n => n.strike < fromStrike && n.relative_significance >= minSig)
    .sort((a, b) => Math.abs(b.gamma) - Math.abs(a.gamma))[0];

  // Up break: spot breaks above the next significant resistance (barney above or king if pika+above)
  let upLevel = null, upTarget = null;
  if (state.barneyAbove && state.barneyAbove.strike > state.spot) {
    const tgt = targetAbove(state.barneyAbove.strike, 0.05);
    if (tgt) { upLevel = state.barneyAbove.strike; upTarget = tgt.strike; }
  }
  // If no barney resistance above, try the pika ceiling itself
  if (!upLevel && state.pikaCeiling && state.pikaCeiling.strike > state.spot) {
    const tgt = targetAbove(state.pikaCeiling.strike, 0.05);
    if (tgt) { upLevel = state.pikaCeiling.strike; upTarget = tgt.strike; }
  }

  // Down break: spot breaks below the pika floor toward next significant target below
  let dnLevel = null, dnTarget = null;
  if (state.pikaFloor && state.pikaFloor.strike < state.spot) {
    const tgt = targetBelow(state.pikaFloor.strike, 0.03);
    if (tgt) { dnLevel = state.pikaFloor.strike; dnTarget = tgt.strike; }
  }

  return {
    up: upLevel ? { breakAt: upLevel, target: upTarget, rr: ((upTarget - upLevel) / (2 * zone)).toFixed(1) } : null,
    down: dnLevel ? { breakAt: dnLevel, target: dnTarget, rr: ((dnLevel - dnTarget) / (2 * zone)).toFixed(1) } : null,
  };
}

function regimeCategory(score) {
  if (score == null) return 'unknown';
  if (score > 0.30) return 'positive';
  if (score < -0.30) return 'negative';
  return 'mixed';
}

// ─── Build baseline at market open ──────────────────────────────────────────
// Pick first snapshot AT OR AFTER 9:31 ET — works for both replay (skips stale 9:30)
// and live (skips pre-market frames written before market open).
function pick931Snapshot(ticker) {
  const open931Ms = new Date(`${args.date}T09:31:00-04:00`).getTime();
  return db.prepare(`
    SELECT * FROM snapshots WHERE ticker=? AND trading_day=? AND ts_ms >= ?
    ORDER BY ts_ms ASC LIMIT 1
  `).get(ticker, args.date, open931Ms);
}

const baseline = {};
for (const t of TICKERS) {
  const snap = pick931Snapshot(t);
  if (!snap) continue;
  const nodes = nodesAtSnapshot(snap.snapshot_id);
  const king = nodes.find(n => n.is_king === 1) || nodes[0];
  const pikaCeiling = nodes.filter(n => n.sign === 'pika' && n.strike > snap.spot)
    .sort((a, b) => b.relative_significance - a.relative_significance)[0];
  const pikaFloor = nodes.filter(n => n.sign === 'pika' && n.strike < snap.spot)
    .sort((a, b) => b.relative_significance - a.relative_significance)[0];
  const barneyAbove = nodes.filter(n => n.sign === 'barney' && n.strike > snap.spot)
    .sort((a, b) => Math.abs(b.gamma) - Math.abs(a.gamma))[0];
  const barneyBelow = nodes.filter(n => n.sign === 'barney' && n.strike < snap.spot)
    .sort((a, b) => Math.abs(b.gamma) - Math.abs(a.gamma))[0];
  baseline[t] = {
    ticker: t, snap, snapshotId: snap.snapshot_id,
    spot: snap.spot, regimeScore: snap.regime_score,
    king, pikaCeiling, pikaFloor, barneyAbove, barneyBelow,
    nodes, patterns: patternsAt(snap.snapshot_id), biasScore: biasAt(snap.snapshot_id)?.bias_score,
  };
}
if (Object.keys(baseline).length < 3) {
  console.error(`Insufficient baseline data for ${args.date}`);
  process.exit(1);
}

// ─── Compute the morning brief's break levels and persist as "trade plans" ─────
// These are the ORIGINAL trade thesis from the 9:31 brief. As the day progresses,
// we track whether each plan fired and what state it's in.
//
// IMPORTANT: this must mirror morning-brief.js buildTradeTriggers exactly.
// The brief uses ONLY the barneyAbove path for upside breaks (no pikaCeiling fallback).
// Anything else creates phantom plans the user never saw in the brief.
function briefPlanLevels(b) {
  const zone = ZONE[b.ticker];
  const targetAbove = (fromStrike, minSig=0.05) => b.nodes
    .filter(n => n.strike > fromStrike && n.relative_significance >= minSig)
    .sort((a, c) => Math.abs(c.gamma) - Math.abs(a.gamma))[0];
  const targetBelow = (fromStrike, minSig=0.03) => b.nodes
    .filter(n => n.strike < fromStrike && n.relative_significance >= minSig)
    .sort((a, c) => Math.abs(c.gamma) - Math.abs(a.gamma))[0];

  let up = null, down = null;
  // LONG break: barney above + target further above (rel_sig >= 0.05)
  if (b.barneyAbove && b.barneyAbove.strike > b.spot) {
    const tgt = targetAbove(b.barneyAbove.strike, 0.05);
    if (tgt && tgt.strike > b.barneyAbove.strike) {
      up = { breakAt: b.barneyAbove.strike, target: tgt.strike, rr: ((tgt.strike - b.barneyAbove.strike) / (2 * zone)).toFixed(1) };
    }
  }
  // SHORT break: pika floor + target further below (rel_sig >= 0.03)
  if (b.pikaFloor && b.pikaFloor.strike < b.spot) {
    const tgt = targetBelow(b.pikaFloor.strike, 0.03);
    if (tgt && tgt.strike < b.pikaFloor.strike) {
      down = { breakAt: b.pikaFloor.strike, target: tgt.strike, rr: ((b.pikaFloor.strike - tgt.strike) / (2 * zone)).toFixed(1) };
    }
  }
  return { up, down };
}

const tradePlans = {};
for (const t of TICKERS) {
  const planLevels = briefPlanLevels(baseline[t]);
  tradePlans[t] = {
    up: planLevels.up ? {
      ...planLevels.up, side: 'LONG', state: 'PENDING',
      firedAt: null, firedSpot: null,
      targetHitAt: null, stopHitAt: null,
    } : null,
    down: planLevels.down ? {
      ...planLevels.down, side: 'SHORT', state: 'PENDING',
      firedAt: null, firedSpot: null,
      targetHitAt: null, stopHitAt: null,
    } : null,
  };
}

// Premium-bleed threshold: a 0DTE put bought at the morning brief loses meaningful
// extrinsic value once spot moves >50 bps the wrong way. Once that happens, the plan
// should be marked INVALIDATED — even if spot eventually returns to the trigger,
// the morning premium is gone. (User feedback 2026-04-30 on 2026-03-12 case.)
const PREMIUM_BLEED_BPS = 50;

// Update tradePlans state by scanning the snapshot stream up to a given time.
// State machine per side:
//   PENDING → ACTIVE  (level crossed cleanly, premium still alive)
//   PENDING → INVALIDATED  (opposite-side level fired first OR adverse excursion >50 bps)
//   ACTIVE  → target hit / stopped
function updateTradePlanStates(ticker, asOfMs) {
  const plan = tradePlans[ticker];
  const zone = ZONE[ticker];
  const allSnaps = db.prepare(`
    SELECT ts_ms, spot FROM snapshots
    WHERE ticker=? AND trading_day=? AND ts_ms <= ? ORDER BY ts_ms ASC
  `).all(ticker, args.date, asOfMs);
  // Skip the stale 9:30 frame (same fix as pick931Snapshot / morning-brief)
  const snaps = allSnaps.slice(1);
  if (snaps.length < 2) return;

  // Anchor adverse-excursion check to the spot the plan was built from:
  //   - morning plans → 9:31 baseline spot
  //   - emergent plans → spot at createdAt (resolved per plan below)
  const morningOpenSpot = baseline[ticker].spot;

  for (const sideKey of ['up', 'down']) {
    const p = plan[sideKey];
    if (!p) continue;
    const otherKey = sideKey === 'up' ? 'down' : 'up';
    const other = plan[otherKey];

    if (p.state === 'PENDING') {
      // For emergent plans, only scan from when the plan was created (spot before that
      // time is irrelevant — the plan didn't exist yet).
      const scanStartIdx = p.createdAt
        ? snaps.findIndex(s => s.ts_ms >= p.createdAt)
        : 1;
      // Adverse-excursion reference spot:
      //   - morning plans use 9:31 baseline
      //   - emergent plans use spot at creation (otherwise pre-creation drift would
      //     instantly invalidate them — that drift is what created the plan in the first place)
      const refSpot = p.emergent && scanStartIdx >= 0
        ? snaps[Math.max(0, scanStartIdx)]?.spot ?? morningOpenSpot
        : morningOpenSpot;
      for (let i = Math.max(1, scanStartIdx); i < snaps.length; i++) {
        const prev = snaps[i-1].spot;
        const cur = snaps[i].spot;

        // Adverse excursion — PUTS plan: upside move >50bps kills premium.
        // CALLS plan: downside move >50bps kills premium.
        // Reference is the open spot for morning plans, creation spot for emergent.
        const refLabel = p.emergent ? 'plan creation' : 'open';
        if (sideKey === 'down' && (cur - refSpot) / refSpot * 10000 > PREMIUM_BLEED_BPS) {
          p.state = 'INVALIDATED'; p.invalidatedAt = snaps[i].ts_ms;
          p.invalidatedReason = `spot rallied +${((cur - refSpot)/refSpot*10000).toFixed(0)}bps from ${refLabel} before break — puts bled`;
          break;
        }
        if (sideKey === 'up' && (refSpot - cur) / refSpot * 10000 > PREMIUM_BLEED_BPS) {
          p.state = 'INVALIDATED'; p.invalidatedAt = snaps[i].ts_ms;
          p.invalidatedReason = `spot dropped -${((refSpot - cur)/refSpot*10000).toFixed(0)}bps from ${refLabel} before break — calls bled`;
          break;
        }

        // Opposite-side HIT TARGET → invalidate this side. Reasoning: a brief opposite-side
        // wick-and-exit (small loss, level reclaimed quickly) doesn't disprove our thesis,
        // and the structure can still resolve our way later in the day. Only a TARGET HIT on
        // the opposite side is a real structural confirmation that flips the day's bias.
        // Emergent plans always survive — they have their own structural justification.
        if (!p.emergent && other && other.targetHitAt && other.targetHitAt < snaps[i].ts_ms) {
          p.state = 'INVALIDATED'; p.invalidatedAt = other.targetHitAt;
          p.invalidatedReason = `opposite ${otherKey === 'up' ? 'CALLS' : 'PUTS'} side hit target — bias confirmed against this side`;
          break;
        }

        // Break trigger — fire AT the level cross, not breakAt ± zone. The brief
        // promised "below 6485 → PUTS"; entering at 6480 wastes 5 points the trade
        // already gave us. Exit (level reclaim) uses the same exact level, so a
        // single-bar whipsaw simply rounds to small loss — acceptable for live alerts.
        if (sideKey === 'up' && cur > p.breakAt) {
          p.state = 'ACTIVE'; p.firedAt = snaps[i].ts_ms; p.firedSpot = cur; break;
        }
        if (sideKey === 'down' && cur < p.breakAt) {
          p.state = 'ACTIVE'; p.firedAt = snaps[i].ts_ms; p.firedSpot = cur; break;
        }
      }
    }

    if (p.state === 'ACTIVE') {
      // After fire, check (in priority order):
      //   1. Target hit — take profit, freeze state
      //   2. Level reclaim — thesis dead, EXIT immediately (don't wait for wider stop)
      //   3. Hard stop — fallback if level was already reclaimed silently (shouldn't happen)
      const startIdx = snaps.findIndex(s => s.ts_ms >= p.firedAt);
      for (let i = Math.max(1, startIdx); i < snaps.length; i++) {
        const cur = snaps[i].spot;

        // Target hit
        if (sideKey === 'up' && cur >= p.target && !p.targetHitAt) {
          p.targetHitAt = snaps[i].ts_ms; p.targetHitSpot = cur;
        }
        if (sideKey === 'down' && cur <= p.target && !p.targetHitAt) {
          p.targetHitAt = snaps[i].ts_ms; p.targetHitSpot = cur;
        }
        if (p.targetHitAt) continue;

        // Level reclaim (thesis broken — exit now). For PUTS: spot back AT or ABOVE the
        // break level means the floor held; for CALLS: spot back AT or BELOW the break
        // level means the ceiling held.
        if (sideKey === 'down' && cur >= p.breakAt && !p.exitedAt) {
          p.exitedAt = snaps[i].ts_ms; p.exitedSpot = cur;
          p.exitReason = 'floor reclaimed';
        }
        if (sideKey === 'up' && cur <= p.breakAt && !p.exitedAt) {
          p.exitedAt = snaps[i].ts_ms; p.exitedSpot = cur;
          p.exitReason = 'ceiling reclaimed';
        }
      }
    }
  }
}

function tradePlanStatusLines(ticker, currentSpot) {
  const plan = tradePlans[ticker];
  const lines = [];
  for (const sideKey of ['up', 'down']) {
    const p = plan[sideKey];
    if (!p) continue;
    const arrow = sideKey === 'up' ? '⬆' : '⬇';
    const optionType = sideKey === 'up' ? 'CALLS' : 'PUTS';

    const tag = p.emergent ? '📡 emergent ' : '';
    if (p.state === 'PENDING') {
      lines.push(`${arrow} ${tag}**${p.breakAt}** → ${optionType} (target ${p.target}, R:R ${p.rr}) — *waiting for break*`);
    } else if (p.state === 'INVALIDATED') {
      const invTime = new Date(p.invalidatedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5);
      lines.push(`${arrow} ❌ ${optionType} plan INVALIDATED @ ${invTime} ET — ${p.invalidatedReason}`);
    } else if (p.state === 'ACTIVE') {
      const fireTime = new Date(p.firedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5);
      // Entry-only display — exit/target/stop tracked internally but not shown
      // (user manages exits via TradingView, not from these alerts).
      lines.push(`${arrow} ${tag}✅ ${optionType} entered ${fireTime} ET @ ${p.firedSpot.toFixed(2)} (target ref: ${p.target})`);
    }
  }
  return lines;
}

const dayStart = baseline.SPXW.snap.ts_ms;
// In live mode, dayEnd is fixed at 16:00 ET (close); we wait real time between checkpoints.
// In replay mode, dayEnd is the last available snapshot.
const dayEnd = (() => {
  if (args.live) {
    const closeEt = new Date(args.date + 'T16:00:00-04:00').getTime();
    return closeEt;
  }
  const last = snapshotAt('SPXW', 0, 'last');
  return last ? last.ts_ms : dayStart + 6.5 * 60 * 60 * 1000;
})();

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  INTRADAY MONITOR — ${args.date}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

const fmtTime = (ms) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5) + ' ET';

console.log(`\n[OPEN] Baseline snapshot @ ${fmtTime(dayStart)}`);
for (const t of TICKERS) {
  const b = baseline[t];
  console.log(`  ${t}: spot=${b.spot.toFixed(2)} regime=${regimeCategory(b.regimeScore)} (${b.regimeScore.toFixed(2)}) | king=${b.king?.strike} (${b.king?.gamma > 0 ? 'pika' : 'barney'}) | floor=${b.pikaFloor?.strike} ceil=${b.pikaCeiling?.strike} | bias=${b.biasScore?.toFixed(0) ?? '—'}`);
}

// ─── Build checkpoint schedule ──────────────────────────────────────────────
// First 30 min (9:31 → 10:01 ET): 5-min granularity to catch early directional moves
// (the open-drive often locks in the day's bias before a 30-min checkpoint).
// After 10:01 ET: 30-min checkpoints through close.
const FAST_INTERVAL_MS = 5 * 60 * 1000;
const SLOW_INTERVAL_MS = 30 * 60 * 1000;
const FAST_WINDOW_MS = 30 * 60 * 1000; // first 30 min
const checkpoints = [];
const fastEnd = dayStart + FAST_WINDOW_MS;
for (let t = dayStart + FAST_INTERVAL_MS; t <= fastEnd; t += FAST_INTERVAL_MS) {
  checkpoints.push(t);
}
for (let t = fastEnd + SLOW_INTERVAL_MS; t <= dayEnd; t += SLOW_INTERVAL_MS) {
  checkpoints.push(t);
}
// INTERVAL_MS used by scanLevelInteractions to define the look-back window per checkpoint.
// Use the spacing to the previous checkpoint so fast-mode scans 5-min windows.

const allSnaps = (ticker, fromMs, toMs) => db.prepare(`
  SELECT * FROM snapshots WHERE ticker=? AND trading_day=? AND ts_ms BETWEEN ? AND ?
  ORDER BY ts_ms ASC
`).all(ticker, args.date, fromMs, toMs);

function scanLevelInteractions(ticker, base, fromMs, toMs) {
  const events = [];
  const zone = ZONE[ticker];
  const baseFloor = base.pikaFloor?.strike;
  const baseCeil = base.pikaCeiling?.strike;
  const baseKing = base.king?.strike;
  const snaps = allSnaps(ticker, fromMs, toMs);
  if (snaps.length < 2) return events;

  const flags = { floorTested: false, floorBroke: false, ceilTested: false, ceilBroke: false, kingReached: false };
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i-1].spot;
    const cur = snaps[i].spot;

    if (baseFloor != null && !flags.floorTested && Math.abs(cur - baseFloor) <= zone) {
      flags.floorTested = true;
      events.push(`tested FLOOR ${baseFloor} @ spot=${cur.toFixed(2)}  → watch LONG bounce`);
    }
    if (baseFloor != null && !flags.floorBroke && prev >= baseFloor && cur < baseFloor - zone) {
      flags.floorBroke = true;
      events.push(`BROKE FLOOR ${baseFloor} (close ${cur.toFixed(2)})  → SHORT BREAK trigger active`);
    }
    if (baseCeil != null && !flags.ceilTested && Math.abs(cur - baseCeil) <= zone) {
      flags.ceilTested = true;
      events.push(`tested CEILING ${baseCeil} @ spot=${cur.toFixed(2)}  → watch SHORT reject`);
    }
    if (baseCeil != null && !flags.ceilBroke && prev <= baseCeil && cur > baseCeil + zone) {
      flags.ceilBroke = true;
      events.push(`BROKE CEILING ${baseCeil} (close ${cur.toFixed(2)})  → LONG BREAK trigger active`);
    }
    if (baseKing != null && !flags.kingReached && Math.abs(cur - baseKing) <= zone) {
      flags.kingReached = true;
      const ksign = base.king.gamma > 0 ? 'pin target' : 'barney king (gravitational)';
      events.push(`REACHED KING ${baseKing} (${ksign}) @ spot=${cur.toFixed(2)}`);
    }
  }
  return events;
}

let prevState = { ...baseline }; // shallow copy so prevState[t] = cur doesn't mutate baseline

// ─── Event-driven alerts (between regular checkpoints) ──────────────────────
// Plan transitions and major structural shifts get their OWN focused Discord embed
// the moment they're detected, with "above X consider CALLS / below Y consider PUTS"
// guidance based on current structure. Avoid duplicates via postedEvents set.
const postedEvents = new Set();

async function postEventAlert({ ticker, eventType, ts, headline, detail, suggestion, color }) {
  if (!args.discord) return;
  const key = `${ticker}:${eventType}:${ts}`;
  if (postedEvents.has(key)) return;
  postedEvents.add(key);
  const fields = [];
  if (detail) fields.push({ name: 'What happened', value: detail.slice(0, 1024), inline: false });
  if (suggestion) fields.push({ name: 'Next move', value: suggestion.slice(0, 1024), inline: false });
  try {
    await postEmbed({
      source: 'monitor',
      title: `🚨 ${ticker} · ${headline} · ${fmtTime(ts)}`,
      fields,
      color: color ?? COLORS.warning,
      footer: 'gexester-vexster · event alert',
    });
    await new Promise(r => setTimeout(r, 1100));
  } catch (err) {
    console.error(`[Discord] event post failed: ${err.message}`);
    if (err.message.includes('429')) await new Promise(r => setTimeout(r, 3000));
  }
}

// For an EXIT/INVALIDATE event, suggest the opposite-side fresh structural setup
// using the current state's break levels.
function pivotSuggestion(curState, exitedSide) {
  const lvl = currentBreakLevels(curState);
  if (exitedSide === 'down' && lvl.up) {
    return `Spot rallying — watch \`${lvl.up.breakAt}\` for fresh CALLS (target ${lvl.up.target}, R:R ${lvl.up.rr}).`;
  }
  if (exitedSide === 'up' && lvl.down) {
    return `Spot falling — watch \`${lvl.down.breakAt}\` for fresh PUTS (target ${lvl.down.target}, R:R ${lvl.down.rr}).`;
  }
  return null;
}

async function checkAndEmitPlanEvents(ticker, curState) {
  const plan = tradePlans[ticker];
  if (!plan) return;
  for (const sideKey of ['up', 'down']) {
    const p = plan[sideKey];
    if (!p) continue;
    const optionType = sideKey === 'up' ? 'CALLS' : 'PUTS';

    if (p.firedAt) {
      await postEventAlert({
        ticker, eventType: `fire-${sideKey}`, ts: p.firedAt,
        headline: `${optionType} entered @ ${p.firedSpot.toFixed(2)}`,
        detail: `Morning plan triggered: spot crossed the ${sideKey === 'up' ? 'ceiling' : 'floor'} break level **${p.breakAt}**. Target reference: ${p.target}.`,
        suggestion: `Plan exits on TV — system won't alert further on this trade.`,
        color: sideKey === 'up' ? COLORS.positive : COLORS.negative,
      });
    }
    // Target/exit/stop alerts intentionally suppressed — user manages exits via TradingView.
    // Internal detection still runs so suppress-redundant-entries logic works.
    if (p.invalidatedAt && p.state === 'INVALIDATED') {
      await postEventAlert({
        ticker, eventType: `invalidate-${sideKey}`, ts: p.invalidatedAt,
        headline: `${optionType} ❌ INVALIDATED`,
        detail: `Morning ${optionType} plan dead — ${p.invalidatedReason}.`,
        suggestion: pivotSuggestion(curState, sideKey),
        color: COLORS.warning,
      });
    }
  }
}

// Posted-title dedup set. Each scheduler firing spawns this script with no
// "slot" hint, so the script walks every checkpoint from open → now and would
// re-post the same titles every 30 min — every prior checkpoint then surfaced
// as a "catch-up" badge in the UI feed. Skip checkpoints whose title is
// already in gex_feed for today.
const postedMonitorTitles = await loadPostedTitlesForDay(args.date, 'monitor');
if (postedMonitorTitles.size > 0) {
  console.log(`[skip-dedup] ${postedMonitorTitles.size} monitor titles already posted for ${args.date}`);
}

// Per-checkpoint Discord post buffer — accumulated then posted at end of checkpoint
async function postCheckpointToDiscord(cp, perTickerData) {
  if (!args.discord) return;
  const title = `📈 ${args.date} · ${fmtTime(cp)}`;
  if (postedMonitorTitles.has(title)) {
    console.log(`[skip-dedup] ${title} already in gex_feed — not re-posting`);
    return;
  }
  const fields = [];
  let anyMaterial = false;
  for (const t of TICKERS) {
    const data = perTickerData[t];
    if (!data) continue;
    const cur = data.cur;
    const base = baseline[t];
    const dSinceOpenBps = (cur.spot - base.spot) / base.spot * 10000;
    const arrow = dSinceOpenBps > 5 ? '↑' : dSinceOpenBps < -5 ? '↓' : '→';

    const lines = [`${arrow} **${cur.spot.toFixed(2)}** (${dSinceOpenBps >= 0 ? '+' : ''}${dSinceOpenBps.toFixed(0)} bps from open) · regime ${regimeCategory(cur.regimeScore)} · bias ${cur.biasScore?.toFixed(0) ?? '—'}`];
    for (const a of data.alerts) lines.push(`⚠ ${a}`);
    // Morning trade plan status (PENDING / ACTIVE / TARGET HIT / STOPPED)
    for (const pl of (data.planLines || [])) lines.push(pl);
    // Fresh structural levels — only when not blocked by an active morning plan
    if (data.levels?.up && !data.upBlocked) {
      lines.push(`⬆ \`${data.levels.up.breakAt}\` → CALLS  → target ${data.levels.up.target}, R:R ${data.levels.up.rr}`);
    }
    if (data.levels?.down && !data.downBlocked) {
      lines.push(`⬇ \`${data.levels.down.breakAt}\` → PUTS  → target ${data.levels.down.target}, R:R ${data.levels.down.rr}`);
    }
    for (const m of data.fastMovers) {
      const idea = strikeToTradeIdea(m, cur.spot);
      if (idea) lines.push(`🚀 ${idea}`);
    }
    // Material if: alert fired, velocity mover, or any morning trade plan transitioned (ACTIVE / target / stop)
    const planTransition = (data.planLines || []).some(l => l.includes('✅') || l.includes('🎯') || l.includes('🛑'));
    if (data.alerts.length > 0 || data.fastMovers.length > 0 || planTransition) anyMaterial = true;
    fields.push({ name: t, value: lines.join('\n').slice(0, 1024), inline: false });
  }
  // Always post every checkpoint so Discord shows a complete timeline.
  // (Was previously skipping non-material checkpoints — left gaps in the timeline.)
  void anyMaterial;
  try {
    await postEmbed({
      source: 'monitor',
      title,
      fields,
      color: COLORS.default,
      footer: 'gexester-vexster · 30-min update',
    });
    postedMonitorTitles.add(title);
    // Replay mode fires posts in rapid succession — Discord rate limit is ~5 req/2s.
    // 1s delay is safely under in replay; in live mode, 30-min spacing makes this irrelevant.
    await new Promise(r => setTimeout(r, 1100));
  } catch (err) {
    console.error(`[Discord] checkpoint post failed: ${err.message}`);
    // On 429, back off harder
    if (err.message.includes('429')) await new Promise(r => setTimeout(r, 3000));
  }
}

for (let cpIdx = 0; cpIdx < checkpoints.length; cpIdx++) {
  const cp = checkpoints[cpIdx];
  const prevCp = cpIdx === 0 ? dayStart : checkpoints[cpIdx - 1];
  const windowStart = prevCp + 60_000;
  const headerTime = fmtTime(cp);

  // LIVE MODE: wait real wall-clock time until this checkpoint
  if (args.live) {
    const waitMs = cp - Date.now();
    if (waitMs > 0) {
      console.log(`\n[${headerTime}] waiting ${Math.round(waitMs / 1000)}s for next checkpoint...`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  console.log(`\n[${headerTime}]`);
  const perTickerData = {};

  for (const t of TICKERS) {
    const cur = tickerState(t, cp, 'closest');
    if (!cur) { console.log(`  ${t}: no data`); continue; }
    const base = baseline[t];
    const prev = prevState[t];
    const alerts = [];

    // 1. Level interactions in the last 30 min (scan each 1-min snap)
    const interactions = scanLevelInteractions(t, base, windowStart, cp);
    for (const ev of interactions) alerts.push(ev);

    // 2. Regime category change since last checkpoint
    if (regimeCategory(prev.regimeScore) !== regimeCategory(cur.regimeScore)) {
      const arrow = cur.regimeScore > prev.regimeScore ? '↑' : '↓';
      alerts.push(`REGIME FLIP ${regimeCategory(prev.regimeScore)} → ${regimeCategory(cur.regimeScore)} ${arrow} (${prev.regimeScore.toFixed(2)} → ${cur.regimeScore.toFixed(2)})`);
    }

    // 3. New rainbow_road since last checkpoint = sit out
    if (cur.patterns.includes('rainbow_road') && !prev.patterns.includes('rainbow_road')) {
      alerts.push(`RAINBOW ROAD now active → SIT OUT`);
    }

    // 4. King SIGN flip (pika ↔ barney) since baseline — this is the structurally-important shift
    if (cur.king && base.king) {
      const baseSign = base.king.gamma > 0 ? 'pika' : 'barney';
      const curSign = cur.king.gamma > 0 ? 'pika' : 'barney';
      if (baseSign !== curSign) {
        alerts.push(`KING SIGN FLIP: ${baseSign} ${base.king.strike} → ${curSign} ${cur.king.strike} (was ${(base.king.gamma/1e6).toFixed(0)}M, now ${(cur.king.gamma/1e6).toFixed(0)}M) — major regime shift`);
      }
    }

    // 5. Bias direction flip (sign change) since last checkpoint
    if (cur.biasScore != null && prev.biasScore != null) {
      const flipped = (prev.biasScore > 10 && cur.biasScore < -10) || (prev.biasScore < -10 && cur.biasScore > 10);
      if (flipped) alerts.push(`bias FLIPPED: ${prev.biasScore.toFixed(0)} → ${cur.biasScore.toFixed(0)} (direction reversal)`);
    }

    // Status line — always
    const dSinceOpen = cur.spot - base.spot;
    const dSinceOpenBps = (dSinceOpen / base.spot * 10000);
    const arrow = dSinceOpenBps > 5 ? '↑' : dSinceOpenBps < -5 ? '↓' : '→';
    console.log(`  ${t} ${arrow} ${cur.spot.toFixed(2)} (${dSinceOpenBps >= 0 ? '+' : ''}${dSinceOpenBps.toFixed(0)} bps from open)  regime=${regimeCategory(cur.regimeScore)} bias=${cur.biasScore?.toFixed(0) ?? '—'}`);
    for (const a of alerts) console.log(`     ⚠ ${a}`);

    // MORNING TRADE PLAN status — track each side's lifecycle since 9:31 brief
    updateTradePlanStates(t, cp);
    // Emit standalone Discord event alerts for any new transitions (FIRE / EXIT / TARGET / INVALIDATE)
    await checkAndEmitPlanEvents(t, cur);
    const planLines = tradePlanStatusLines(t, cur.spot);
    for (const line of planLines) console.log(`     ${line}`);

    // EMERGENT PLAN creation — when a king sign flip happens toward an undefended side,
    // the structure has fundamentally changed and a new tradable setup exists. Create
    // an emergent plan rooted in the new structure and emit a narrative alert. Once
    // created, the emergent plan is LOCKED — same lifecycle as morning plan, no further
    // re-targeting per checkpoint.
    const plan = tradePlans[t];
    const hadKingFlip = alerts.some(a => a.startsWith('KING SIGN FLIP'));
    if (hadKingFlip && cur.king) {
      const newKingAbove = cur.king.strike > cur.spot;
      const isBarney = cur.king.gamma < 0;
      const lvl = currentBreakLevels(cur);
      // Barney king ABOVE spot = magnet pulling spot UP = emergent CALLS setup
      if (newKingAbove && isBarney && !plan.up && lvl.up) {
        plan.up = {
          ...lvl.up, side: 'LONG', state: 'PENDING',
          firedAt: null, firedSpot: null, targetHitAt: null, exitedAt: null,
          emergent: true, createdAt: cp,
          rationale: `king flipped to barney ${cur.king.strike} (gravitational pull up)`,
        };
        if (args.discord) {
          await postEventAlert({
            ticker: t, eventType: `emergent-up`, ts: cp,
            headline: `📡 EMERGENT CALLS SETUP — above \`${lvl.up.breakAt}\` → target ${lvl.up.target}`,
            detail: `Structural shift: ${plan.up.rationale}. Morning brief had no upside plan — this setup emerged from real node-level changes (R:R ${lvl.up.rr}).`,
            suggestion: `If spot crosses ${lvl.up.breakAt}, enter CALLS. Exit on reclaim of ${lvl.up.breakAt} or target hit at ${lvl.up.target}.`,
            color: COLORS.positive,
          });
        }
      }
      // Barney king BELOW spot = magnet pulling spot DOWN = emergent PUTS setup
      if (!newKingAbove && isBarney && !plan.down && lvl.down) {
        plan.down = {
          ...lvl.down, side: 'SHORT', state: 'PENDING',
          firedAt: null, firedSpot: null, targetHitAt: null, exitedAt: null,
          emergent: true, createdAt: cp,
          rationale: `king flipped to barney ${cur.king.strike} (gravitational pull down)`,
        };
        if (args.discord) {
          await postEventAlert({
            ticker: t, eventType: `emergent-down`, ts: cp,
            headline: `📡 EMERGENT PUTS SETUP — below \`${lvl.down.breakAt}\` → target ${lvl.down.target}`,
            detail: `Structural shift: ${plan.down.rationale}. Morning brief had no downside plan — this setup emerged from real node-level changes (R:R ${lvl.down.rr}).`,
            suggestion: `If spot crosses below ${lvl.down.breakAt}, enter PUTS. Exit on reclaim of ${lvl.down.breakAt} or target hit at ${lvl.down.target}.`,
            color: COLORS.negative,
          });
        }
      }
    }

    // Suppress fresh structural levels for any side that has a tracked plan (morning OR emergent).
    // The plan handles its own lifecycle; per-checkpoint fresh re-issues = blind chasing.
    // Fresh levels only show on sides with NO plan AND no structural justification yet.
    const upBlocked  = !!plan.up;
    const downBlocked = !!plan.down;
    const levels = currentBreakLevels(cur);
    if (levels.up && !upBlocked) {
      console.log(`     ⬆ (info) ABOVE ${levels.up.breakAt} → CALLS structure present (target ${levels.up.target}, R:R ${levels.up.rr}) — waiting for structural confirmation`);
    }
    if (levels.down && !downBlocked) {
      console.log(`     ⬇ (info) BELOW ${levels.down.breakAt} → PUTS structure present (target ${levels.down.target}, R:R ${levels.down.rr}) — waiting for structural confirmation`);
    }

    // STRIKE-VELOCITY ALERT — fast-growing strikes BEFORE they become the king
    // (catches accumulation early so OTM options can be bought cheap)
    const fastMovers = strikeVelocityAlerts(t, cp);
    for (const m of fastMovers) {
      const idea = strikeToTradeIdea(m, cur.spot);
      if (idea) console.log(`     🚀 ${idea}`);
    }
    perTickerData[t] = { cur, alerts, levels, fastMovers, planLines, upBlocked, downBlocked };
    prevState[t] = cur;
  }
  await postCheckpointToDiscord(cp, perTickerData);
}

// ─── EOD recap ──────────────────────────────────────────────────────────────
console.log(`\n[CLOSE] EOD recap`);
for (const t of TICKERS) {
  const eod = tickerState(t, 0, 'last');
  const base = baseline[t];
  if (!eod || !base) continue;
  const ocBps = (eod.spot - base.spot) / base.spot * 10000;
  const arrow = ocBps > 20 ? '🟢' : ocBps < -20 ? '🔴' : '⚪';
  console.log(`  ${arrow} ${t}: open ${base.spot.toFixed(2)} → close ${eod.spot.toFixed(2)}  (${ocBps >= 0 ? '+' : ''}${ocBps.toFixed(0)} bps)`);
}

console.log(`\n${'━'.repeat(75)}\n`);
db.close();
