/**
 * Plays tracker service — the plumbing that turns a fire-state event into
 * tracked contracts with best-mark tracking. Mirrors what Falcon's card feed
 * shows publicly.
 *
 * Entry points:
 *   - openPlaysForFire(fireEvent, { db, quoteFetcher }) : creates candidate
 *     contract rows in tracked_plays and snapshots entry marks.
 *   - refreshLivePlays({ db, quoteFetcher }) : polls current marks and
 *     updates best_mark for all status='live' rows.
 *   - closePlays({ db, reason, ticker? }) : closes plays on state clear or EOD.
 */

import { getSurface } from './surface-cache.js';

// ATM-only ladder. Prior versions fired 3-4 strikes per event covering out to
// ±25 points, but the deep OTM legs die worthless (see 2026-07-08 EOD:
// BEAR_RUG puts at -25 offset averaged −57% at close). Every fire is now a
// single ATM contract — the strike Skylit's deflection doctrine actually
// prices at the direct tap of the anchor.
const CANDIDATE_STRIKES_BY_STATE = {
  BEAR_RUG:       { type: 'put',  offsets: [0] },
  BEAR_TRAPDOOR:  { type: 'put',  offsets: [0] },
  BEAR_CONTINUE:  { type: 'put',  offsets: [0] },
  BEAR_OVERNIGHT: { type: 'put',  offsets: [0] },
  BULL_REVERSE:   { type: 'call', offsets: [0] },
};

function occSymbol(underlying, expiration, type, strike) {
  // OCC format: TICKER + YYMMDD + C/P + strike*1000 (8 digits)
  const [y, m, d] = expiration.split('-');
  const yy = y.slice(2);
  const cp = type === 'call' ? 'C' : 'P';
  const strikeInt = Math.round(strike * 1000).toString().padStart(8, '0');
  return `${underlying}${yy}${m}${d}${cp}${strikeInt}`;
}

function pickCandidateContracts({ ticker, spot, state, expiration }) {
  const cfg = CANDIDATE_STRIKES_BY_STATE[state];
  if (!cfg) return [];
  const roundedSpot = ticker === 'SPXW' || ticker === 'SPX'
    ? Math.round(spot / 5) * 5
    : ticker === 'SPY' || ticker === 'QQQ'
      ? Math.round(spot)
      : Math.round(spot);
  return cfg.offsets.map(off => {
    const strike = roundedSpot + off;
    return {
      strike,
      type: cfg.type,
      symbol: occSymbol(ticker, expiration, cfg.type, strike),
    };
  });
}

/**
 * Open plays for a fire event. `quoteFetcher(symbol)` returns
 * { bid, ask, mid } or null.
 */
export async function openPlaysForFire(fireEvent, { db, quoteFetcher, expiration }) {
  if (!fireEvent?.fired) return { opened: 0, skipped: 'not_fired' };
  const { ticker, state, tsMs, patternName, patternDetection } = fireEvent;
  const spot = patternDetection?.spot ?? patternDetection?.trapdoor?.distFromSpot != null
    ? undefined
    : undefined;
  // We rely on caller to pass spot in patternDetection.supportingState or via context — fall back:
  const spotFromCtx = fireEvent.spot ?? null;
  if (!spotFromCtx) return { opened: 0, skipped: 'no_spot_in_fire_event' };

  // Surface baseline: the near-spot slice of the strike map AT FIRE TIME.
  // The structural exit in refreshLivePlays diffs the live surface against
  // this to detect the setup invalidating (floor hardening against a bear,
  // ceiling hardening against a bull) or strengthening (barney fuel).
  // Persisted in supporting_state so it survives tracker restarts.
  const surfaceBaseline = buildSurfaceBaseline(fireEvent.surfaceNodes, spotFromCtx);

  const candidates = pickCandidateContracts({
    ticker, spot: spotFromCtx, state, expiration,
  });
  if (candidates.length === 0) return { opened: 0, skipped: 'no_candidates_for_state' };

  const tradingDay = new Date(tsMs).toISOString().slice(0, 10);
  const insert = db.prepare(`
    INSERT INTO tracked_plays (
      fire_ts_ms, trading_day, ticker, state, pattern_name,
      option_symbol, option_type, strike, expiration,
      spot_at_fire, entry_mark, entry_bid, entry_ask,
      status, supporting_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?)
  `);

  let opened = 0;
  for (const c of candidates) {
    let quote = null;
    try { quote = await quoteFetcher(c.symbol); } catch (_) { quote = null; }
    if (!quote || !quote.mid) continue;
    insert.run(
      tsMs, tradingDay, ticker, state, patternName,
      c.symbol, c.type, c.strike, expiration,
      spotFromCtx, quote.mid, quote.bid ?? null, quote.ask ?? null,
      JSON.stringify({
        patternDetection,
        timeInPrevStateMs: fireEvent.timeInPrevStateMs,
        surfaceBaseline,
      }),
    );
    opened++;
  }
  return { opened };
}

// Trailing-stop thresholds. A play must first RUN to at least ARM_MIN_GAIN
// before the trail arms — that ensures we hold small early-fire drawdown
// while the setup develops. Once armed, we exit if the option mid drops by
// TRAIL_GIVEBACK_PCT of the peak — that's the signal the anchor deflection
// is exhausting on the option side (which mirrors nodes shifting against
// us on the underlying map without needing another Skylit pull).
//
// Calibrated 2026-07-08 against that day's 34 ATM fires via grid search over
// arm ∈ {0.25, 0.30, 0.50} × giveback ∈ {0.15, 0.20, 0.30}: giveback
// tightness dominated — dropping it 0.30 → 0.15 roughly tripled PnL at every
// arm level. Best combo (0.50 / 0.15) captured +17.7% portfolio return vs
// +6.8% with the initial 0.50 / 0.30. Arm kept at 0.50 so we don't exit
// setups still developing at +25%.
const TRAIL_ARM_MIN_GAIN = 0.50;   // arm once peak >= +50%
const TRAIL_GIVEBACK_PCT = 0.15;   // exit if mid falls 15% off peak
const CLOSE_REASON_TRAIL = 'closed_trail_stop';

// ---------- Structural exit: read the WHOLE surface, not the option mark ----------
//
// The option mid is a lagging shadow of dealer positioning. The map itself is
// the leading signal. Every refresh tick we diff the live Skylit surface
// (shared from the fire loop via surface-cache) against the surface recorded
// at fire time, per play:
//
//   INVALIDATE (close now, capture what's left):
//     The opposing anchor is HARDENING. For a bear play (puts), the strongest
//     pika at/below spot — the floor that catches the drop — has grown to
//     ≥1.5× its fire-time relSig AND gained ≥5 percentage points. Empirical
//     example (2026-07-08 SPY 09:57 BEAR_RUG): $742 floor went 12.0% → 24.6%
//     relSig in 90 min while the put bled from +151% peak to −97%. The floor
//     hardening telegraphed the death long before the mark confirmed it.
//     Mirror for bull plays: strongest pika at/above spot (ceiling).
//
//   HOLD (suppress trail stop this tick, let the winner run):
//     Barney fuel is ACCUMULATING in the play's direction. For a bull play,
//     total |gamma| of negative-gamma nodes in the path above spot (within
//     2%) has grown to ≥2× fire-time. Dealers short gamma there must buy
//     into the rally — trapdoor-up. Empirical example (2026-07-08 SPXW
//     11:36 BULL_REVERSE): barneys at 7440-7475 ballooned from ~−1M to
//     −7-9M each while the call ran +231%. Mirror for bear plays: barney
//     accumulation below spot.
//
// Baseline slice = strikes within 3% of fire-spot (persisted per play in
// supporting_state.surfaceBaseline, restart-safe).

const PATH_WINDOW_PCT = 0.02;       // barney-fuel path width past spot
const INVALIDATE_ANCHOR_RATIO = 1.5;  // opposing pika relSig ≥ 1.5× baseline...
const INVALIDATE_ANCHOR_MIN_GAIN = 0.05; // ...AND gained ≥5pp
const INVALIDATE_ANCHOR_MIN_RELSIG = 0.08; // ...AND is a real node (≥8%)
const HOLD_FUEL_RATIO = 2.0;        // path barney |gamma| ≥ 2× baseline
const HOLD_FUEL_MIN_RELSIG_SUM = 0.10; // fallback when baseline fuel ≈ 0
// PIN detection: a pika sitting ON TOP of spot that has grown into a
// dominant node kills 0DTE plays in BOTH directions — price sticks and
// theta eats the premium. Checked before the barney-fuel hold. Empirical
// example (2026-07-08 SPY 09:57 BEAR_RUG): put peaked +151% as spot fell,
// then $742 grew 12.0% → 24.6% relSig right at spot and the put closed −97%
// pinned. Note the barney-fuel HOLD was correct earlier in that trade — the
// put kept running while fuel accumulated; it was the PIN that killed it.
const PIN_DISTANCE_PCT = 0.005;     // pika within 0.5% of spot...
const PIN_MIN_RELSIG = 0.20;        // ...that now owns ≥20% of the surface...
const PIN_GROWTH_RATIO = 1.5;       // ...and grew ≥1.5× since fire
const CLOSE_REASON_STRUCTURE = 'closed_structure_invalidated';

export function buildSurfaceBaseline(nodes, spot) {
  if (!Array.isArray(nodes) || !nodes.length || !spot) return null;
  // EVERY strike on the map, not a near-spot slice. Exit logic weights the
  // action zone around spot, but the baseline must let us ask "which strike
  // anywhere is growing or shrinking since fire" — the whole surface is the
  // signal (user directive 2026-07-08).
  return {
    spot,
    nodes: nodes.map(n => ({
      strike: n.strike,
      gamma: n.gamma,
      relSig: n.relativeSignificance,
    })),
  };
}

/**
 * Diff the live surface against a play's fire-time baseline.
 * Returns { action: 'invalidate' | 'hold' | 'neutral', reason }.
 */
export function evaluateSurfaceExit({ play, baseline, surface }) {
  if (!baseline?.nodes?.length || !surface?.nodes?.length) {
    return { action: 'neutral', reason: 'no_baseline_or_surface' };
  }
  const isBull = play.option_type === 'call';
  const spot = surface.spot;
  const baseByStrike = new Map(baseline.nodes.map(n => [n.strike, n]));

  // --- INVALIDATE: pin forming on top of spot (kills both directions) ---
  const pinZone = spot * PIN_DISTANCE_PCT;
  const pin = surface.nodes
    .filter(n => n.sign === 'pika' && Math.abs(n.strike - spot) <= pinZone)
    .sort((a, b) => b.relativeSignificance - a.relativeSignificance)[0];
  if (pin && pin.relativeSignificance >= PIN_MIN_RELSIG) {
    const base = baseByStrike.get(pin.strike);
    const baseSig = base?.relSig ?? 0;
    if (baseSig > 0 && pin.relativeSignificance >= baseSig * PIN_GROWTH_RATIO) {
      return {
        action: 'invalidate',
        reason: `pin_forming_$${pin.strike}_${(baseSig * 100).toFixed(1)}%→${(pin.relativeSignificance * 100).toFixed(1)}%`,
      };
    }
  }

  // --- INVALIDATE: opposing pika anchor hardening ---
  // Bear: strongest pika at/below spot (floor). Bull: at/above spot (ceiling).
  const opposing = surface.nodes
    .filter(n => n.sign === 'pika' && (isBull ? n.strike >= spot : n.strike <= spot))
    .sort((a, b) => b.relativeSignificance - a.relativeSignificance)[0];
  if (opposing && opposing.relativeSignificance >= INVALIDATE_ANCHOR_MIN_RELSIG) {
    const base = baseByStrike.get(opposing.strike);
    const baseSig = base?.relSig ?? 0;
    if (
      baseSig > 0 &&
      opposing.relativeSignificance >= baseSig * INVALIDATE_ANCHOR_RATIO &&
      opposing.relativeSignificance - baseSig >= INVALIDATE_ANCHOR_MIN_GAIN
    ) {
      return {
        action: 'invalidate',
        reason: `opposing_pika_$${opposing.strike}_hardened_${(baseSig * 100).toFixed(1)}%→${(opposing.relativeSignificance * 100).toFixed(1)}%`,
      };
    }
  }

  // --- HOLD: barney fuel accumulating in the play's direction ---
  const pathLo = isBull ? spot : spot * (1 - PATH_WINDOW_PCT);
  const pathHi = isBull ? spot * (1 + PATH_WINDOW_PCT) : spot;
  const fuelNow = surface.nodes
    .filter(n => n.sign === 'barney' && n.strike >= pathLo && n.strike <= pathHi)
    .reduce((s, n) => s + Math.abs(n.gamma), 0);
  const fuelBase = baseline.nodes
    .filter(n => n.gamma < 0 && n.strike >= pathLo && n.strike <= pathHi)
    .reduce((s, n) => s + Math.abs(n.gamma), 0);
  const fuelRelSigNow = surface.nodes
    .filter(n => n.sign === 'barney' && n.strike >= pathLo && n.strike <= pathHi)
    .reduce((s, n) => s + n.relativeSignificance, 0);
  const fuelGrowing = fuelBase > 0
    ? fuelNow >= fuelBase * HOLD_FUEL_RATIO
    : fuelRelSigNow >= HOLD_FUEL_MIN_RELSIG_SUM;
  if (fuelGrowing && fuelNow > 0) {
    return {
      action: 'hold',
      reason: `barney_fuel_${isBull ? 'above' : 'below'}_spot_${fuelBase > 0 ? (fuelNow / fuelBase).toFixed(1) + 'x' : (fuelRelSigNow * 100).toFixed(0) + '%relSig'}`,
    };
  }

  return { action: 'neutral', reason: 'no_structural_change' };
}

/**
 * Poll live plays and update current + best marks. Call once per minute
 * during market hours.
 *
 * Also runs the trailing-stop exit inline: any live play that has printed
 * ≥+50% peak and then given back 30% from that peak is closed here as
 * 'closed_trail_stop' with close_mark = current mid. That captures the fade
 * before the EOD sweep zeros everything out.
 */
export async function refreshLivePlays({ db, quoteFetcher }) {
  const rows = db.prepare(`SELECT * FROM tracked_plays WHERE status = 'live'`).all();
  if (rows.length === 0) return { refreshed: 0, trailClosed: 0, structureClosed: 0 };

  const update = db.prepare(`
    UPDATE tracked_plays
    SET current_mark = ?, current_ts_ms = ?,
        best_mark = ?, best_mark_ts_ms = ?, best_pct_gain = ?
    WHERE play_id = ?
  `);
  const closeStmt = db.prepare(`
    UPDATE tracked_plays
    SET status = ?, close_ts_ms = ?, close_mark = ?, close_reason = ?
    WHERE play_id = ?
  `);

  const now = Date.now();
  let refreshed = 0;
  let trailClosed = 0;
  let structureClosed = 0;
  for (const r of rows) {
    let quote = null;
    try { quote = await quoteFetcher(r.option_symbol); } catch (_) { quote = null; }
    if (!quote || quote.mid == null) continue;
    const newBest = r.best_mark == null || quote.mid > r.best_mark
      ? quote.mid : r.best_mark;
    const newBestTs = newBest === quote.mid ? now : r.best_mark_ts_ms;
    const pctGain = (newBest - r.entry_mark) / r.entry_mark;
    update.run(quote.mid, now, newBest, newBestTs, pctGain, r.play_id);
    refreshed++;

    // Structural read — the WHOLE surface, every tick. Fire loop publishes
    // the full strike map each minute; here we diff it against this play's
    // fire-time baseline.
    let structural = { action: 'neutral' };
    const surface = getSurface(r.ticker);
    if (surface) {
      let baseline = null;
      try { baseline = JSON.parse(r.supporting_state || '{}').surfaceBaseline; } catch (_) {}
      structural = evaluateSurfaceExit({ play: r, baseline, surface });
    }

    if (structural.action === 'invalidate') {
      // The map turned against the play — exit NOW at current mid, before
      // the option mark finishes catching down to the new structure.
      closeStmt.run(CLOSE_REASON_STRUCTURE, now, quote.mid,
        `${CLOSE_REASON_STRUCTURE}:${structural.reason}`, r.play_id);
      structureClosed++;
      continue;
    }

    // Trailing-stop check — arm only after real gain, then exit on giveback.
    // Suppressed while barney fuel is accumulating in the play's direction:
    // the map says the move has structural fuel left, so let it run.
    if (structural.action !== 'hold' &&
        pctGain >= TRAIL_ARM_MIN_GAIN &&
        newBest > 0 &&
        quote.mid <= newBest * (1 - TRAIL_GIVEBACK_PCT)) {
      closeStmt.run(CLOSE_REASON_TRAIL, now, quote.mid, CLOSE_REASON_TRAIL, r.play_id);
      trailClosed++;
    }
  }
  return { refreshed, trailClosed, structureClosed };
}

/**
 * Close live plays. Called on state clear, EOD, or manual override.
 */
export function closePlays({ db, reason, ticker, state }) {
  const now = Date.now();
  const filters = ["status = 'live'"];
  const params = {};
  if (ticker) { filters.push('ticker = @ticker'); params.ticker = ticker; }
  if (state)  { filters.push('state = @state'); params.state = state; }
  const sql = `
    UPDATE tracked_plays
    SET status = @status, close_ts_ms = @now, close_mark = current_mark, close_reason = @reason
    WHERE ${filters.join(' AND ')}
  `;
  const stmt = db.prepare(sql);
  const info = stmt.run({ ...params, status: reason.startsWith('closed_') ? reason : 'closed_state_clear', now, reason });
  return { closed: info.changes };
}

/**
 * Fetch live plays for the API/UI feed.
 */
export function getLivePlays({ db, ticker }) {
  const filter = ticker ? 'AND ticker = ?' : '';
  const rows = db.prepare(`
    SELECT * FROM tracked_plays
    WHERE status = 'live' ${filter}
    ORDER BY fire_ts_ms DESC
  `).all(ticker ? [ticker] : []);
  return rows;
}

/**
 * Fetch today's closed/completed plays with best marks for the "results" feed.
 */
export function getTodaysPlays({ db, tradingDay }) {
  const day = tradingDay || new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT * FROM tracked_plays
    WHERE trading_day = ?
    ORDER BY fire_ts_ms DESC
  `).all(day);
  return rows;
}
