/**
 * Bull tape gate — blocks BULLISH fires when SPY, QQQ, and SPX are ALL
 * trading below their prior session close (buying calls into unanimously
 * red tape).
 *
 * Evidence (64-day real-dollar study, 2026-07-09): bulls fired with 0/3
 * indexes above prior close were −15.0% option EV (n=117, 43% win),
 * negative on every stability cut (odd/even days, both halves, all three
 * tickers, all day types, survives dropping the 3 worst trades). Blocking
 * that one cell moved the system −3.7% → +0.6% and improved every holdout
 * (+2.9 to +5.5pp) and the flags_eq_0 policy (+35.4% → +48.2%). This is
 * the symmetric completion of the G7-PC bear gate: bears already require
 * spot < prior close; bulls had no tape requirement.
 *
 * The 77-study structure program (research/gexvex-structure/) confirmed
 * every other candidate entry rule (flip reclaim, opening-range break,
 * dense-GEX breakout) was a shadow of this gate: −0.2pp incremental.
 *
 * Config: ENABLE_BULL_TAPE_GATE
 *   unset/false → gate fully off, behavior identical to pre-gate system
 *   'true'      → gate active, blocks
 *   'dry'       → gate evaluates + logs + counts but NEVER blocks
 *
 * Missing data (any spot or prior close unavailable) → NEVER block; the
 * verdict is 'unknown' and the miss is logged.
 */

export const TAPE_TICKERS = ['SPY', 'QQQ', 'SPXW']; // SPX trades as SPXW here

export function bullTapeGateMode(env = process.env) {
  const v = env.ENABLE_BULL_TAPE_GATE;
  if (v === 'true') return 'on';
  if (v === 'dry') return 'dry';
  return 'off';
}

/**
 * Pure decision. tape: { SPY: {spot, priorClose}, QQQ: {...}, SPXW: {...} }
 * (any field may be null/undefined → missing).
 * Returns { pass: true|false|'unknown', reason, missing: string[], data }.
 * Only meaningful for bullish fires; callers must not invoke it for bears.
 */
export function evaluateBullTapeGate(tape) {
  const data = {};
  const missing = [];
  for (const t of TAPE_TICKERS) {
    const spot = tape?.[t]?.spot;
    const prior = tape?.[t]?.priorClose;
    data[`${t.toLowerCase()}_current`] = spot ?? null;
    data[`${t.toLowerCase()}_prior_close`] = prior ?? null;
    if (spot == null || !Number.isFinite(spot)) missing.push(`${t}_current`);
    if (prior == null || !Number.isFinite(prior)) missing.push(`${t}_prior_close`);
  }
  if (missing.length) {
    return { pass: 'unknown', reason: 'missing_tape_gate_data', missing, data };
  }
  const allBelow = TAPE_TICKERS.every(t => tape[t].spot < tape[t].priorClose);
  if (allBelow) {
    return { pass: false, reason: 'SPY_QQQ_SPX_BELOW_PRIOR_CLOSE', missing, data };
  }
  return { pass: true, reason: 'ok', missing, data };
}

// ---- session counters for the dry-run / validation summary ----
const stats = {
  bull_fires: 0,
  bull_blocked: 0,       // 'on' mode actual blocks
  bull_would_block: 0,   // 'dry' mode would-blocks
  bull_allowed: 0,
  bull_missing_data: 0,
  bear_fires_unaffected: 0,
};

export function recordBullTapeGateFire({ dir, verdict, mode }) {
  if (dir < 0) {
    stats.bear_fires_unaffected += 1;
    return;
  }
  stats.bull_fires += 1;
  if (verdict.pass === 'unknown') {
    stats.bull_missing_data += 1;
    stats.bull_allowed += 1;
  } else if (verdict.pass === false) {
    if (mode === 'on') stats.bull_blocked += 1;
    else {
      stats.bull_would_block += 1;
      stats.bull_allowed += 1;
    }
  } else {
    stats.bull_allowed += 1;
  }
}

export function bullTapeGateStats() {
  return { ...stats };
}

export function formatBullTapeGateStats() {
  return `[BullTapeGate] session: bulls=${stats.bull_fires} blocked=${stats.bull_blocked}` +
    ` would_block(dry)=${stats.bull_would_block} allowed=${stats.bull_allowed}` +
    ` missing_data=${stats.bull_missing_data} bears_unaffected=${stats.bear_fires_unaffected}`;
}
