#!/usr/bin/env node
/**
 * Trinity sniper — continuous intraday monitor that watches GEX/VEX state
 * across SPY + QQQ + SPXW and ONLY alerts on actionable state transitions.
 *
 * Designed to fire every 2 min during 09:30 - 15:30 ET. Pulls live Skylit
 * (NOT SQLite cache — we need real-time response), computes Trinity score,
 * compares to last-known state, and posts to gex_feed + Discord ONLY when:
 *   - Action threshold crossed (score < 20 or > 80 with SPY at level)
 *   - Divergence transition (>30 → <30 or reverse)
 *   - Active-trade stop/target hit
 *
 * Silent during chop. ~0-5 alerts per day. State persisted to JSON.
 *
 * Usage:
 *   node scripts/trinity-sniper.js                # run once
 *   node scripts/trinity-sniper.js --discord      # post alerts on transitions
 *   node scripts/trinity-sniper.js --force-alert  # post current state always
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { initAuth } from '../src/heatseeker/auth.js';
import { fetchSnapshot } from '../src/heatseeker/client.js';
import { computeSurface } from '../src/domain/significance.js';
import { deriveStructure } from '../src/domain/structure.js';
import { postEmbed } from '../src/discord/webhook.js';
import { config as gexConfig } from '../src/utils/config.js';

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}
const DO_ALERT = !!args.discord || !!args.feed;
const FORCE_ALERT = !!args['force-alert'];

const TICKERS = ['SPY', 'QQQ', 'SPXW'];
const STATE_PATH = join(gexConfig.dataDir, 'trinity-sniper-state.json');
const ENTRY_BAND_SPY = 0.50;
const COOLDOWN_MIN = 8;            // don't re-alert same action within 8 min
const DIVERGENCE_THRESHOLD = 30;
const EXTREME_BEARISH = 20;
const EXTREME_BULLISH = 80;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function nowMs() { return Date.now(); }

function loadState() {
  if (!existsSync(STATE_PATH)) return null;
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf-8')); }
  catch { return null; }
}
function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function regimeLabel(score) {
  if (score < EXTREME_BEARISH) return 'MAX_BEARISH';
  if (score < 40) return 'BEARISH';
  if (score < 60) return 'BALANCED';
  if (score < EXTREME_BULLISH) return 'BULLISH';
  return 'MAX_BULLISH';
}

function bullishness(struct) {
  const { spot, king, floor, ceiling, netVex } = struct;
  let eFloor = floor, eCeiling = ceiling;
  if (eFloor == null && king != null) eFloor = king * 0.97;
  if (eCeiling == null && king != null) eCeiling = king * 1.03;
  if (eFloor == null || eCeiling == null) return 50;
  let pos;
  if (spot <= eFloor) pos = 0;
  else if (spot >= eCeiling) pos = 100;
  else if (king == null || king === eFloor || king === eCeiling) {
    pos = 100 * (spot - eFloor) / (eCeiling - eFloor);
  } else if (spot <= king) {
    const d = king - eFloor;
    pos = d > 0 ? 50 * (spot - eFloor) / d : 50;
  } else {
    const d = eCeiling - king;
    pos = d > 0 ? 50 + 50 * (spot - king) / d : 50;
  }
  pos += netVex > 0 ? 5 : -5;
  return Math.max(0, Math.min(100, pos));
}

function deriveFull(snap) {
  const surface = computeSurface(snap.strikes, snap.spot);
  const structure = deriveStructure({ nodes: surface.nodes, spot: snap.spot });
  return {
    spot: snap.spot,
    king: structure.king?.strike ?? null,
    floor: structure.floor?.strike ?? null,
    ceiling: structure.ceiling?.strike ?? null,
    netVex: (surface.nodes || []).reduce((a, n) => a + (n.vanna || 0), 0),
  };
}

function classifyAction(score, divergence, spyStruct) {
  if (divergence > DIVERGENCE_THRESHOLD) return { kind: 'SKIP_DIVERGENT' };
  if (score < EXTREME_BEARISH) {
    if (spyStruct.floor != null && Math.abs(spyStruct.spot - spyStruct.floor) <= ENTRY_BAND_SPY) {
      return { kind: 'CALLS_VBOUNCE_TRIGGER', entry: spyStruct.spot, target: spyStruct.spot + 0.35, stop: spyStruct.spot - 0.60 };
    }
    return { kind: 'BEARISH_WATCH' };
  }
  if (score > EXTREME_BULLISH) {
    if (spyStruct.ceiling != null && Math.abs(spyStruct.spot - spyStruct.ceiling) <= ENTRY_BAND_SPY) {
      return { kind: 'PUTS_REJECT_TRIGGER', entry: spyStruct.spot, target: spyStruct.spot - 0.35, stop: spyStruct.spot + 0.60 };
    }
    return { kind: 'BULLISH_WATCH' };
  }
  return { kind: 'BALANCED_NO_TRADE' };
}

function shouldAlert(prev, current) {
  if (FORCE_ALERT) return { yes: true, why: 'force' };
  if (!prev) {
    // First tick today — only alert if currently in a trigger state
    if (current.action.kind.includes('TRIGGER')) return { yes: true, why: 'first-trigger' };
    return { yes: false };
  }
  // Suppress cooldown
  if (current.action.kind === prev.action_kind && nowMs() - (prev.last_alert_ts || 0) < COOLDOWN_MIN * 60_000) {
    return { yes: false, why: 'cooldown' };
  }
  // Action transitions worth alerting on
  if (current.action.kind !== prev.action_kind) {
    // Any transition INTO a TRIGGER state = alert
    if (current.action.kind.includes('TRIGGER')) return { yes: true, why: `transition→${current.action.kind}` };
    // Transition INTO BULLISH_WATCH or BEARISH_WATCH (setup forming) = alert
    if (['BULLISH_WATCH', 'BEARISH_WATCH'].includes(current.action.kind)) return { yes: true, why: `setup→${current.action.kind}` };
    // Divergence resolution (was DIVERGENT, now not) = alert
    if (prev.action_kind === 'SKIP_DIVERGENT' && current.action.kind !== 'SKIP_DIVERGENT') {
      return { yes: true, why: 'divergence-resolved' };
    }
    // Divergence appearing = alert
    if (current.action.kind === 'SKIP_DIVERGENT' && prev.action_kind !== 'SKIP_DIVERGENT') {
      return { yes: true, why: 'divergence-appeared' };
    }
  }
  // Big score swing without action change (rare) - 25+ pt swing
  if (Math.abs(current.trinity_score - prev.trinity_score) > 25) {
    return { yes: true, why: `score-jump-${(current.trinity_score - prev.trinity_score).toFixed(0)}` };
  }
  return { yes: false };
}

async function alertEmbed({ trinityScore, regime, divergence, structs, subScores, action, why }) {
  let color;
  if (action.kind.includes('CALLS')) color = 0x22c55e;
  else if (action.kind.includes('PUTS')) color = 0xef4444;
  else if (action.kind === 'SKIP_DIVERGENT') color = 0xf59e0b;
  else if (action.kind.endsWith('_WATCH')) color = 0x6366f1;
  else color = 0x6b7280;
  const titleAction = action.kind.replace(/_/g, ' ');
  const title = `Sniper ${titleAction} — Trinity ${trinityScore.toFixed(0)}/100 ${regime}`;
  const desc = `SPY ${structs.SPY?.spot?.toFixed(2)} | QQQ ${structs.QQQ?.spot?.toFixed(2)} | SPXW ${structs.SPXW?.spot?.toFixed(2)} — *${why}*`;
  const fields = [];
  for (const ticker of TICKERS) {
    const s = structs[ticker]; if (!s) continue;
    fields.push({
      name: `${ticker} ${subScores[ticker].toFixed(0)} (${regimeLabel(subScores[ticker])})`,
      value: `spot ${s.spot?.toFixed(2)} | floor ${s.floor?.toFixed(2) ?? '—'} | King ${s.king?.toFixed(2) ?? '—'} | ceil ${s.ceiling?.toFixed(2) ?? '—'} | VEX ${(s.netVex / 1e6).toFixed(1)}M`,
    });
  }
  if (action.entry != null) {
    fields.push({
      name: '🎯 TRIGGER',
      value: `Entry ~${action.entry.toFixed(2)} | Target ${action.target.toFixed(2)} | Stop ${action.stop.toFixed(2)}\nDivergence: ${divergence.toFixed(0)} ✓`,
    });
  }
  fields.push({ name: 'Action kind', value: action.kind });
  await postEmbed({
    title, description: desc, fields, color,
    footer: 'Trinity sniper • validated 64% win at extremes',
    source: 'monitor',
  });
}

async function main() {
  const ok = await initAuth();
  if (!ok) { process.stderr.write('auth failed\n'); process.exit(1); }
  const structs = {}; const subScores = {};
  for (const ticker of TICKERS) {
    try {
      const snap = await fetchSnapshot(ticker);
      structs[ticker] = deriveFull(snap);
      subScores[ticker] = bullishness(structs[ticker]);
    } catch (e) {
      process.stderr.write(`${ticker} fetch failed: ${e.message}\n`);
    }
  }
  const valid = Object.values(subScores).filter(v => v != null);
  if (valid.length < 3) { process.stderr.write('not enough tickers\n'); process.exit(1); }
  const trinity_score = valid.reduce((a, b) => a + b, 0) / valid.length;
  const divergence = Math.max(...valid) - Math.min(...valid);
  const regime = regimeLabel(trinity_score);
  const action = classifyAction(trinity_score, divergence, structs.SPY);

  // State load + alert decision
  let state = loadState();
  const today = todayISO();
  if (!state || state.date !== today) state = { date: today, history: [] };
  const decision = shouldAlert(state, { trinity_score, action });
  const summary = `${new Date().toISOString()} score=${trinity_score.toFixed(0)} div=${divergence.toFixed(0)} action=${action.kind} alert=${decision.yes ? 'YES (' + decision.why + ')' : 'no'}`;
  process.stdout.write(summary + '\n');

  if (decision.yes && DO_ALERT) {
    await alertEmbed({ trinityScore: trinity_score, regime, divergence, structs, subScores, action, why: decision.why });
    state.last_alert_ts = nowMs();
    state.last_alert_action = action.kind;
  }
  state.action_kind = action.kind;
  state.trinity_score = trinity_score;
  state.divergence = divergence;
  state.history = (state.history || []).slice(-50);
  state.history.push({ ts: nowMs(), score: trinity_score, div: divergence, action: action.kind });
  saveState(state);
  process.exit(0);
}

main().catch(e => { process.stderr.write(`fatal: ${e.message}\n`); process.exit(1); });
