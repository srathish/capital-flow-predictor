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
      JSON.stringify({ patternDetection, timeInPrevStateMs: fireEvent.timeInPrevStateMs }),
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
  if (rows.length === 0) return { refreshed: 0, trailClosed: 0 };

  const update = db.prepare(`
    UPDATE tracked_plays
    SET current_mark = ?, current_ts_ms = ?,
        best_mark = ?, best_mark_ts_ms = ?, best_pct_gain = ?
    WHERE play_id = ?
  `);
  const closeStmt = db.prepare(`
    UPDATE tracked_plays
    SET status = 'closed_trail_stop',
        close_ts_ms = ?, close_mark = ?, close_reason = ?
    WHERE play_id = ?
  `);

  const now = Date.now();
  let refreshed = 0;
  let trailClosed = 0;
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

    // Trailing-stop check — arm only after real gain, then exit on giveback.
    if (pctGain >= TRAIL_ARM_MIN_GAIN &&
        newBest > 0 &&
        quote.mid <= newBest * (1 - TRAIL_GIVEBACK_PCT)) {
      closeStmt.run(now, quote.mid, CLOSE_REASON_TRAIL, r.play_id);
      trailClosed++;
    }
  }
  return { refreshed, trailClosed };
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
