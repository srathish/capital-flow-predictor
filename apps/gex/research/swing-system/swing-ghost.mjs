/**
 * OPERATOR-EYE SWING SYSTEM — GHOST ONLY (Clause 0: no live trading logic; paper fires only).
 *
 * A transcription of the operator's annotated trading style (operator_trades.json,
 * 2026-07-14/-10) into four causal rules on 1-min spot:
 *   1. V-RECLAIM long:  down-swing >= R from the running high, then CONFIRM consecutive
 *      rising closes -> enter long at that minute's close. (Mirror short on down-days.)
 *   2. HIGHER-LOW long: up-context (close > day open AND a prior completed up-swing),
 *      pullback >= PULL*R holding above the last pivot low, then CONFIRM rising closes.
 *   3. STALL exit: no new favorable extreme for S minutes -> exit.
 *   4. FAILED-HIGH FLIP: while long, a pullback >= PULL*R off a swing high with CONFIRM
 *      falling closes -> exit long AND enter short (structure-gated, not day-gated,
 *      max FLIPS_MAX/day) — the operator's 11:32 short.
 *   Structural stop (validated +4.3% lean): close beyond the entry pivot by STOP_PCT
 *   for STOP_MIN consecutive minutes -> exit; that level is dead for the day.
 *
 * PARAMETERS ARE PROVISIONAL (marked *) until OPERATOR_EYE_SWING_1MIN.md pins the
 * walk-forward-best cell. Usage:
 *   node swing-ghost.mjs --replay 2026-07-14            # paper-run one backfill day
 *   node swing-ghost.mjs --replay-all                   # all backfill days
 * Fires log to swing_ghost_log.jsonl (underlying-based; option P&L scored separately).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BF = path.join(HERE, '..', 'velocity-capture', 'backfill');
const LOG = path.join(HERE, 'swing_ghost_log.jsonl');

export const P = {
  R: 0.0020,        // * swing reversal threshold (0.20% of spot)
  PULL: 0.6,        // * pullback fraction of R for higher-low / flip triggers
  CONFIRM: 2,       //   consecutive closes to confirm a turn (the causal lag we pay)
  S: 10,            // * stall exit: minutes without a new favorable extreme
  STOP_PCT: 0.0010, //   structural stop: 0.10% beyond the entry pivot...
  STOP_MIN: 2,      //   ...for 2 consecutive minutes (validated lean)
  BUDGET: 6,        //   max entries/side/day
  COOL: 5,          //   minutes between entries
  FLIPS_MAX: 2,     //   failed-high flip shorts per day
  PIN_ZONE: 0.0012, //   within 0.12% of a dominant pika = pin territory (v2)
  PIN_STALL_X: 2.5, //   stall patience multiplier while the pin holds (v2: stay in longer)
};

const et = m => `${String(Math.floor((m + 570) / 60)).padStart(2, '0')}:${String((m + 570) % 60).padStart(2, '0')}`;

export function runDay(frames, params = P) {
  // frames: [{m, spot}] 1-min closes, m = minutes since 09:30 ET
  const p = params, trades = [], out = [];
  let dir = 0, runHigh = frames[0].spot, runLow = frames[0].spot;
  let pivotLow = null, pivotHigh = null, hadUpSwing = false;
  let pos = null, longs = 0, shorts = 0, flips = 0, lastEntry = -99, deadLevels = [];
  const dayOpen = frames[0].spot;
  const closes = frames.map(f => f.spot);

  const rising = i => { for (let k = 0; k < p.CONFIRM; k++) if (!(closes[i - k] > closes[i - k - 1])) return false; return true; };
  const falling = i => { for (let k = 0; k < p.CONFIRM; k++) if (!(closes[i - k] < closes[i - k - 1])) return false; return true; };

  const open = (i, side, rule, pivot) => {
    pos = { side, rule, m1: frames[i].m, s1: closes[i], pivot, best: closes[i], bestM: frames[i].m, stopRun: 0 };
    lastEntry = frames[i].m; side === 'long' ? longs++ : shorts++;
  };
  const close = (i, why) => {
    const s2 = closes[i];
    const und = (s2 - pos.s1) / pos.s1 * (pos.side === 'long' ? 1 : -1) * 100;
    trades.push({ ...pos, m2: frames[i].m, s2, why, und: +und.toFixed(3), e1: et(pos.m1), e2: et(frames[i].m) });
    if (why === 'struct_stop') deadLevels.push(pos.pivot);
    pos = null;
  };

  for (let i = Math.max(2, p.CONFIRM); i < frames.length; i++) {
    const s = closes[i], m = frames[i].m;
    // ---- swing tracking (ZigZag on closes) ----
    if (dir >= 0) { if (s > runHigh) runHigh = s; if ((runHigh - s) / runHigh >= p.R) { dir = -1; pivotHigh = runHigh; runLow = s; } }
    if (dir <= 0) { if (s < runLow) runLow = s; if ((s - runLow) / runLow >= p.R) { if (dir === -1) hadUpSwing = true; dir = 1; pivotLow = runLow; runHigh = s; } }

    // v2: dominant-pika context at this minute
    const pikasNow = frames[i].pikas || [];
    const nearPika = pikasNow.some(k => Math.abs(k - s) / s <= p.PIN_ZONE);

    // ---- position management first ----
    if (pos) {
      const fav = pos.side === 'long' ? s > pos.best : s < pos.best;
      if (fav) { pos.best = s; pos.bestM = m; }
      // structural stop at the entry pivot
      const beyond = pos.side === 'long' ? s < pos.pivot * (1 - p.STOP_PCT) : s > pos.pivot * (1 + p.STOP_PCT);
      pos.stopRun = beyond ? pos.stopRun + 1 : 0;
      if (pos.stopRun >= p.STOP_MIN) { close(i, 'struct_stop'); continue; }
      // stall exit — v2: if a dominant pika holds under/over us (pin oscillation),
      // stay in longer: noise at a pin is not a reversal (operator rule).
      const pinHeld = nearPika && pos.stopRun === 0;
      if (m - pos.bestM >= (pinHeld ? Math.round(p.S * p.PIN_STALL_X) : p.S)) { close(i, 'stall'); continue; }
      // failed-high flip (long -> short) — v2 NODE GATE: never flip while price sits
      // in a dominant pika's pin zone (that pullback is pin-chop, not reversal);
      // a flip also requires the pika under us to have BROKEN (structural), not just wobbled.
      if (pos.side === 'long' && flips < p.FLIPS_MAX && dir <= 0 && pivotHigh
          && !nearPika
          && !pikasNow.some(k => k < s && (s - k) / s <= p.PIN_ZONE * 2)
          && (pivotHigh - s) / pivotHigh >= p.PULL * p.R && falling(i)) {
        close(i, 'flip'); flips++; if (shorts < p.BUDGET) open(i, 'short', 'flip', pivotHigh);
        continue;
      }
      if (m >= 375) { close(i, 'eod'); continue; }  // 15:45 flat
      continue;
    }

    // ---- entries ----
    if (m < 30 || m > 360 || m - lastEntry < p.COOL) continue;   // skip open chop + last 30m
    const downDay = s < dayOpen;
    // V-reclaim long: down-swing in progress >= R off the high, then rising confirm
    if (longs < p.BUDGET && dir === -1 && (runHigh * 1 - runLow) / runHigh >= 0 && (pivotHigh ?? runHigh) &&
        (frames[0] && ((Math.max(runHigh, pivotHigh || 0) - runLow) / Math.max(runHigh, pivotHigh || 0)) >= p.R) &&
        rising(i) && !deadLevels.some(L => Math.abs(L - runLow) / s < 0.0005)) {
      open(i, 'long', 'vreclaim', runLow); continue;
    }
    // higher-low pullback long
    if (longs < p.BUDGET && !downDay && hadUpSwing && dir === 1 && pivotLow && pivotHigh &&
        s > pivotLow && (pivotHigh - Math.min(...closes.slice(Math.max(0, i - 15), i + 1))) / pivotHigh >= p.PULL * p.R &&
        Math.min(...closes.slice(Math.max(0, i - 15), i + 1)) > pivotLow * (1 - 0.0002) && rising(i)) {
      open(i, 'long', 'higherlow', pivotLow); continue;
    }
    // mirror V-reclaim short on down-days
    if (shorts < p.BUDGET && downDay && dir === 1 && pivotLow &&
        ((s - runLow) / runLow) < p.R && falling(i) === false && false) { /* reserved: study will pin short rules */ }
  }
  if (pos) close(frames.length - 1, 'eod');
  return trades;
}

// ---------- CLI ----------
function loadDay(day, ticker) {
  const f = path.join(BF, day, `${ticker}.jsonl.gz`);
  if (!fs.existsSync(f)) return null;
  const rows = zlib.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').map(l => JSON.parse(l));
  return rows.map(r => {
    const [hh, mm] = r.requestedTs.slice(11, 16).split(':');
    const tot = (r.strikes || []).reduce((a, x) => a + Math.abs(x.gamma || 0), 0) || 1;
    const pikas = (r.strikes || []).filter(x => (x.gamma || 0) > 0 && Math.abs(x.gamma) / tot >= 0.15).map(x => +x.strike);
    return { m: (+hh * 60 + +mm) - 810, spot: +r.spot, pikas };
  }).filter(r => r.m >= 0 && r.m <= 390);
}

const arg = process.argv[2];
if (arg === '--replay' || arg === '--replay-all') {
  const days = arg === '--replay-all' ? fs.readdirSync(BF).sort() : [process.argv[3]];
  const all = [];
  for (const day of days) for (const tk of ['SPXW', 'SPY', 'QQQ']) {
    const frames = loadDay(day, tk); if (!frames || frames.length < 100) continue;
    for (const t of runDay(frames)) { all.push({ day, tk, ...t }); }
  }
  fs.writeFileSync(LOG, all.map(t => JSON.stringify(t)).join('\n') + '\n');
  console.log(`${all.length} ghost trades -> ${LOG}`);
  for (const t of all) console.log(`  ${t.day} ${t.tk.padEnd(4)} ${t.side.padEnd(5)} ${t.rule.padEnd(9)} ${t.e1}->${t.e2}  und ${t.und >= 0 ? '+' : ''}${t.und}%  (${t.why})`);
}
