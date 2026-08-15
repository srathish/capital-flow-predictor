// resolve.mjs — pure outcome resolution against forward daily OHLC. NO I/O.
// Powers BOTH the live outcome logger and the walk-forward backtest.
// Rules: entry_trigger/target are intraday (high/low), invalidation is CLOSING
// basis (matches the pipeline's global rule), time_stop is trading days held.

// Resolve one card's plan against forward OHLC (sorted asc, {date,open,high,low,close}).
// fromDate = the scan date; the card acts on sessions strictly after it.
export function resolveCard(plan, ohlc, fromDate) {
  if (!plan || plan.direction === 'no_trade') return { status: 'n/a', triggered: false };
  const long = plan.direction === 'long';
  const fwd = (ohlc || []).filter((d) => d.date > fromDate && d.close != null);
  const expiry = plan.contract?.expiry || null;
  const out = {
    status: 'open', direction: plan.direction, triggered: false,
    entry_date: null, entry_price: null, exit_date: null, exit_price: null, exit_reason: null,
    days_to_trigger: null, days_held: 0, days_to_resolution: null,
    hit_target: false, hit_runner: false, mfe: 0, mfe_pct: 0, mae: 0, mae_pct: 0, bars_seen: fwd.length,
  };
  if (!fwd.length) return out;

  // --- find entry (or die pre-entry on a closing-basis invalidation) ---
  let ei = -1;
  for (let i = 0; i < fwd.length; i++) {
    const b = fwd[i];
    if (expiry && b.date > expiry) break; // never triggered before the contract expired
    const triggered = long ? b.high >= plan.entry_trigger : b.low <= plan.entry_trigger;
    if (triggered) { ei = i; break; }
    const preInvalidated = long ? b.close < plan.invalidation : b.close > plan.invalidation;
    if (preInvalidated) { out.status = 'never_triggered'; out.exit_reason = 'pre-entry invalidation'; out.exit_date = b.date; return out; }
  }
  if (ei < 0) { out.status = 'never_triggered'; out.exit_reason = expiry ? 'no trigger before expiry' : 'no trigger in window'; return out; }

  out.triggered = true;
  out.entry_date = fwd[ei].date;
  out.entry_price = plan.entry_trigger;
  out.days_to_trigger = ei + 1;
  const entry = plan.entry_trigger;

  // --- walk the holding period ---
  let held = 0;
  for (let i = ei; i < fwd.length; i++) {
    const b = fwd[i];
    held++;
    // excursions from entry
    const fav = long ? b.high - entry : entry - b.low;
    const adv = long ? b.low - entry : entry - b.high;
    if (fav > out.mfe) out.mfe = fav;
    if (adv < out.mae) out.mae = adv;
    // target (intraday) resolves before the close-basis invalidation on the same bar
    const targetHit = long ? b.high >= plan.target : b.low <= plan.target;
    if (targetHit) {
      out.hit_target = true;
      out.hit_runner = plan.runner_target != null && (long ? b.high >= plan.runner_target : b.low <= plan.runner_target);
      out.status = 'target'; out.exit_reason = out.hit_runner ? 'target+runner' : 'target';
      out.exit_date = b.date; out.exit_price = out.hit_runner ? plan.runner_target : plan.target; break;
    }
    const invalidated = long ? b.close < plan.invalidation : b.close > plan.invalidation;
    if (invalidated) { out.status = 'invalidation'; out.exit_reason = 'closing-basis invalidation'; out.exit_date = b.date; out.exit_price = b.close; break; }
    if (plan.time_stop != null && held >= plan.time_stop) { out.status = 'time_stop'; out.exit_reason = 'time stop'; out.exit_date = b.date; out.exit_price = b.close; break; }
    if (expiry && b.date >= expiry) { out.status = 'expiry'; out.exit_reason = 'contract expiry'; out.exit_date = b.date; out.exit_price = b.close; break; }
  }
  out.days_held = held;
  out.mfe_pct = out.mfe / entry;
  out.mae_pct = out.mae / entry;
  if (out.exit_date) {
    const di = fwd.findIndex((d) => d.date === out.exit_date);
    out.days_to_resolution = di + 1;
  }
  return out;
}

// Cheap, LLM-free test of the DETERMINISTIC edge: from `spot` on `fromDate`, does the
// magnet get reached within `horizonDays` before a `stopPct` close-basis stop?
// Lets a universe-wide walk-forward measure whether flow_through_score ranks edge.
export function resolveMagnetReach(magnetStrike, spot, ohlc, fromDate, { horizonDays = 5, stopPct = 0.05 } = {}) {
  const long = magnetStrike > spot;
  const fwd = (ohlc || []).filter((d) => d.date > fromDate && d.close != null).slice(0, horizonDays);
  const stop = long ? spot * (1 - stopPct) : spot * (1 + stopPct);
  const res = { reached: false, days_to_reach: null, stopped_out: false, mfe_pct: 0, mae_pct: 0, bars: fwd.length, direction: long ? 'long' : 'short' };
  for (let i = 0; i < fwd.length; i++) {
    const b = fwd[i];
    const fav = long ? (b.high - spot) / spot : (spot - b.low) / spot;
    const adv = long ? (b.low - spot) / spot : (spot - b.high) / spot;
    if (fav > res.mfe_pct) res.mfe_pct = fav;
    if (adv < res.mae_pct) res.mae_pct = adv;
    const reached = long ? b.high >= magnetStrike : b.low <= magnetStrike;
    if (reached) { res.reached = true; res.days_to_reach = i + 1; break; }
    const stopped = long ? b.close < stop : b.close > stop;
    if (stopped) { res.stopped_out = true; res.days_to_reach = null; break; }
  }
  return res;
}
