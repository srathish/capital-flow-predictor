/**
 * replay-fires — run the FULL new-rules pipeline over archived Skylit
 * surfaces as if live. Skylit-ONLY: signals AND measurement come from the
 * archived GEX+VEX frames. No external quote feeds.
 *
 * Pipeline per archived day (data/skylit-archive/intraday/<day>/):
 *   1. 5-min frames → pattern detectors → fire-state machine (same code
 *      path as the live fire-loop, same cooldowns)
 *   2. Fire → ONE ATM strike (new ATM-only rule), entry spot = Skylit
 *      spot at the fire frame, baseline = full surface at fire
 *   3. Every frame: evaluateSurfaceExit (pin invalidate / anchor
 *      invalidate / barney-fuel hold) against the play's baseline
 *   4. Exit = earliest of structural invalidate, state clear, EOD
 *
 * Performance is measured in UNDERLYING BPS captured in the play's
 * direction (put: entry→exit down = positive; call: up = positive) plus
 * MFE/MAE — the pure test of whether the rules call direction and exit
 * timing right. (Skylit serves no option quotes; the live trail stop is
 * option-mark-based and is therefore out of scope here — structural exits
 * and state machiney are what this validates.)
 *
 * Usage:
 *   node scripts/replay-fires.js                     # all archived days
 *   node scripts/replay-fires.js --date=2026-07-07   # single day
 *   node scripts/replay-fires.js --from=2026-05-01 --to=2026-06-30
 *   node scripts/replay-fires.js --verbose           # per-play rows
 */

import './_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { runPerTickerPatterns } from '../src/domain/patterns/index.js';
import { createFireStateMachine, State } from '../src/domain/fire-state.js';
import { buildSurfaceBaseline, evaluateSurfaceExit } from '../src/tracker/plays.js';
import { createLogger } from '../src/utils/logger.js';

const log = createLogger('ReplayFires');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(__dirname, '..', 'data', 'skylit-archive', 'intraday');
const OUT = path.join(__dirname, 'out');

const TICKERS = ['SPXW', 'SPY', 'QQQ'];

function parseArgs() {
  const a = { date: null, from: null, to: null, verbose: false };
  for (const x of process.argv.slice(2)) {
    if (x.startsWith('--date=')) a.date = x.slice(7);
    else if (x.startsWith('--from=')) a.from = x.slice(7);
    else if (x.startsWith('--to=')) a.to = x.slice(5);
    else if (x === '--verbose') a.verbose = true;
  }
  return a;
}

function listDays({ date, from, to }) {
  if (!fs.existsSync(ARCHIVE)) return [];
  let days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (date) days = days.filter(d => d === date);
  if (from) days = days.filter(d => d >= from);
  if (to) days = days.filter(d => d <= to);
  return days;
}

function loadFrames(day, ticker) {
  const p = path.join(ARCHIVE, day, `${ticker}.jsonl.gz`);
  if (!fs.existsSync(p)) return [];
  const raw = zlib.gunzipSync(fs.readFileSync(p)).toString();
  return raw.trim().split('\n').map(l => JSON.parse(l))
    .map(s => ({ ...s, tsMs: Date.parse(s.requestedTs) }))
    .sort((a, b) => a.tsMs - b.tsMs);
}

function toNodes(snap) {
  const strikes = snap.strikes || [];
  const totalAbs = strikes.reduce((s, r) => s + Math.abs(r.gamma || 0), 0) || 1;
  return strikes.map(r => {
    const g = Number(r.gamma) || 0;
    return {
      strike: Number(r.strike), gamma: g, vanna: Number(r.vanna) || 0,
      sign: g > 0 ? 'pika' : g < 0 ? 'barney' : 'zero',
      relativeSignificance: Math.abs(g) / totalAbs,
    };
  });
}

const DIRECTION_BY_STATE = {
  BEAR_RUG: -1, BEAR_TRAPDOOR: -1, BEAR_CONTINUE: -1, BEAR_OVERNIGHT: -1,
  BULL_REVERSE: +1,
};

function atmStrike(ticker, spot) {
  return ticker === 'SPXW' || ticker === 'SPX' ? Math.round(spot / 5) * 5 : Math.round(spot);
}

// ---------- Replay one day ----------

function replayDay(day, { verbose }) {
  const machines = Object.fromEntries(TICKERS.map(t => [t, createFireStateMachine({ ticker: t })]));
  const spotHistory = Object.fromEntries(TICKERS.map(t => [t, []]));

  // Merge frames into a single chronological stream of {ticker, frame}.
  const stream = [];
  for (const t of TICKERS) for (const f of loadFrames(day, t)) stream.push({ ticker: t, frame: f });
  stream.sort((a, b) => a.frame.tsMs - b.frame.tsMs);
  if (!stream.length) return [];

  const live = [];
  const closed = [];
  let lastSpot = {};

  function closePlay(p, tsMs, spot, via) {
    p.exitTsMs = tsMs;
    p.exitSpot = spot;
    p.exitVia = via;
    p.capturedBps = p.dir * (spot - p.entrySpot) / p.entrySpot * 10000;
    closed.push(p);
    live.splice(live.indexOf(p), 1);
  }

  for (const { ticker, frame } of stream) {
    const now = frame.tsMs;
    const spot = frame.spot;
    if (spot == null) continue;
    lastSpot[ticker] = { spot, tsMs: now };

    spotHistory[ticker].push({ tsMs: now, spot });
    spotHistory[ticker] = spotHistory[ticker].filter(s => now - s.tsMs <= 60 * 60_000);

    const nodes = toNodes(frame);
    const surface = { tsMs: now, spot, nodes };

    // ---- update + exits for live plays on this ticker ----
    for (const p of [...live]) {
      if (p.ticker !== ticker) continue;
      const moveBps = p.dir * (spot - p.entrySpot) / p.entrySpot * 10000;
      if (moveBps > p.mfeBps) p.mfeBps = moveBps;
      if (moveBps < p.maeBps) p.maeBps = moveBps;

      const v = evaluateSurfaceExit({ play: { option_type: p.dir > 0 ? 'call' : 'put' }, baseline: p.baseline, surface });
      p.lastVerdict = v.action;
      if (v.action === 'hold') p.holdFrames++;
      if (v.action === 'invalidate') {
        closePlay(p, now, spot, `STRUCT:${v.reason}`);
      }
    }

    // ---- pattern detection + state machine ----
    const detections = runPerTickerPatterns({
      ticker, nodes, spot,
      spotHistory: spotHistory[ticker], previousClose: null,
    });
    const fire = machines[ticker].ingest({ detections, tsMs: now });
    if (!fire) continue;

    if (fire.fired) {
      const dir = DIRECTION_BY_STATE[fire.state];
      if (!dir) continue;
      live.push({
        day, ticker, state: fire.state, dir,
        K: atmStrike(ticker, spot),
        fireTsMs: now, entrySpot: spot,
        mfeBps: 0, maeBps: 0, holdFrames: 0,
        baseline: buildSurfaceBaseline(nodes, spot),
        lastVerdict: 'neutral',
      });
    } else if (fire.state === State.IDLE && fire.prevState !== State.IDLE && fire.prevState !== State.PIN) {
      for (const p of [...live]) {
        if (p.ticker !== ticker) continue;
        closePlay(p, now, spot, 'STATE_CLEAR');
      }
    }
  }

  // EOD close for anything still live, at that ticker's last archived spot.
  for (const p of [...live]) {
    const ls = lastSpot[p.ticker];
    closePlay(p, ls?.tsMs ?? p.fireTsMs, ls?.spot ?? p.entrySpot, 'EOD');
  }

  if (verbose) {
    const et = ts => new Date(ts).toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/New_York' });
    for (const p of closed) {
      console.log(`  ${p.day} ${et(p.fireTsMs)} ${p.ticker.padEnd(4)} ${p.state.padEnd(13)} ` +
        `${p.dir > 0 ? 'CALL' : 'PUT '} $${p.K}  ${et(p.exitTsMs)}  ` +
        `${p.exitVia.slice(0, 46).padEnd(46)} ${p.capturedBps >= 0 ? '+' : ''}${p.capturedBps.toFixed(0)}bps ` +
        `(mfe ${p.mfeBps.toFixed(0)} / mae ${p.maeBps.toFixed(0)})`);
    }
  }
  return closed;
}

// ---------- Main ----------

function main() {
  const args = parseArgs();
  const days = listDays(args);
  if (!days.length) { console.log('no archived days match'); return; }
  console.log(`\n  Replaying ${days.length} archived day(s): ${days[0]} → ${days[days.length - 1]}\n`);

  const all = [];
  for (const day of days) {
    try {
      const plays = replayDay(day, { verbose: args.verbose });
      all.push(...plays.map(p => ({
        day: p.day, ticker: p.ticker, state: p.state, dir: p.dir, K: p.K,
        fireTsMs: p.fireTsMs, entrySpot: p.entrySpot,
        exitTsMs: p.exitTsMs, exitSpot: p.exitSpot, exitVia: p.exitVia,
        capturedBps: p.capturedBps, mfeBps: p.mfeBps, maeBps: p.maeBps,
        holdFrames: p.holdFrames,
      })));
      const dayBps = plays.reduce((s, p) => s + p.capturedBps, 0);
      log.info(`${day}: ${plays.length} plays, net ${dayBps >= 0 ? '+' : ''}${dayBps.toFixed(0)}bps`);
    } catch (err) {
      log.error(`${day} failed: ${err.message}`);
    }
  }

  const wins = all.filter(p => p.capturedBps > 0).length;
  const netBps = all.reduce((s, p) => s + p.capturedBps, 0);
  const avgBps = all.length ? netBps / all.length : 0;
  console.log(`\n  ═══ TOTAL: ${all.length} plays · net ${netBps >= 0 ? '+' : ''}${netBps.toFixed(0)}bps · ` +
    `avg ${avgBps >= 0 ? '+' : ''}${avgBps.toFixed(1)}bps/play · winners ${wins}/${all.length} ` +
    `(${all.length ? (wins / all.length * 100).toFixed(0) : 0}%) ═══`);

  const groups = (key) => {
    const g = {};
    for (const p of all) {
      const k = key(p);
      const v = g[k] ||= { n: 0, bps: 0, wins: 0 };
      v.n++; v.bps += p.capturedBps; if (p.capturedBps > 0) v.wins++;
    }
    return Object.entries(g).sort((a, b) => b[1].bps - a[1].bps);
  };

  console.log('\n  By exit type:');
  for (const [k, v] of groups(p => p.exitVia.split(':')[0])) {
    console.log(`    ${k.padEnd(12)} n=${String(v.n).padStart(4)}  net=${v.bps >= 0 ? '+' : ''}${v.bps.toFixed(0)}bps  win=${(v.wins / v.n * 100).toFixed(0)}%`);
  }
  console.log('\n  By state:');
  for (const [k, v] of groups(p => p.state)) {
    console.log(`    ${k.padEnd(14)} n=${String(v.n).padStart(4)}  net=${v.bps >= 0 ? '+' : ''}${v.bps.toFixed(0)}bps  win=${(v.wins / v.n * 100).toFixed(0)}%`);
  }
  console.log('\n  By ticker:');
  for (const [k, v] of groups(p => p.ticker)) {
    console.log(`    ${k.padEnd(6)} n=${String(v.n).padStart(4)}  net=${v.bps >= 0 ? '+' : ''}${v.bps.toFixed(0)}bps  win=${(v.wins / v.n * 100).toFixed(0)}%`);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const outPath = path.join(OUT, `replay-fires-${days[0]}_${days[days.length - 1]}.json`);
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2));
  console.log(`\n  Plays → ${outPath}\n`);
}

main();
