// resolve-plan.mjs — resolve an LLM trade plan against forward OHLC with a REALISTIC fill.
// entry_trigger is a BREAKOUT/confirmation level (matches resolveCard): a long enters when
// price trades up to/through it, a short when price trades down to/through it. Critically,
// the fill price is GAP-AWARE — you cannot fill better than the entry bar's open, so a name
// that gaps past the trigger fills at the OPEN, not the trigger. (The first pass filled at
// the trigger even when the stock gapped past it — e.g. MSFT gapped Fri 382 → Mon open 390
// yet "filled" at 382 — which fabricated ~4x the real R. This is the fix.)
//
// Exit = 2-scale: half the position at `target` (first wall), half at `runner_target`
// (the ladder), both via intraday touch (a limit fills on the wick). A CLOSE beyond the
// structural invalidation stops the remainder — reported both close-basis (actual exit at
// that close) and hard-stop (loss capped at -1R), matching the Talon baseline.
export function resolvePlan(plan, ohlc, { from = null, to = null } = {}) {
  const long = plan.direction === 'long';
  const { entry_trigger: trig, invalidation: inval, target: tgt, runner_target: run } = plan;
  const out = { entered: false, outcome: 'no_fill', entry: null, R: 0, R_stop: 0, rungs_hit: 0, stopped: false };
  if ((plan.direction !== 'long' && plan.direction !== 'short') || trig == null || inval == null || tgt == null) { out.outcome = 'incomplete'; return out; }
  const win = (ohlc || []).filter((d) => (!from || d.date >= from) && (!to || d.date <= to) && d.close != null).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!win.length) return out;

  // entry: first bar price reaches the trigger; fill = gap-aware (never better than the open)
  let ei = -1, entry = null;
  for (let i = 0; i < win.length; i++) {
    const b = win[i];
    if (long ? b.high >= trig : b.low <= trig) { ei = i; entry = long ? Math.max(trig, b.open) : Math.min(trig, b.open); break; }
  }
  if (ei < 0) return out;
  out.entered = true; out.entry = entry;
  const risk = Math.abs(entry - inval);
  // invalidation must be on the correct (losing) side of the real fill, else the plan is malformed
  if (!risk || (long ? inval >= entry : inval <= entry)) { out.outcome = 'incomplete'; return out; }
  const signed = (px) => (long ? px - entry : entry - px) / risk;

  // rungs beyond the fill, nearest-first (a rung the gap already passed is dropped)
  let rungs = [tgt, run].filter((x) => x != null && (long ? x > entry : x < entry));
  rungs = [...new Set(rungs)].sort((a, b) => (long ? a - b : b - a));
  const N = rungs.length || 1;
  // close-basis exit (primary, matches the Talon baseline): a wick through the stop is not
  // failure; only a CLOSE beyond it stops. R = actual close, R_stop = loss capped at -1R.
  const pending = [...rungs]; let remaining = N, realized = 0, realizedStop = 0;
  for (let i = ei; i < win.length; i++) {
    const b = win[i];
    while (pending.length && (long ? b.high >= pending[0] : b.low <= pending[0])) { const rg = pending.shift(); realized += (1 / N) * signed(rg); realizedStop += (1 / N) * signed(rg); remaining--; out.rungs_hit++; }
    if (remaining <= 0) break;
    if (long ? b.close < inval : b.close > inval) { realized += (remaining / N) * signed(b.close); realizedStop += (remaining / N) * -1; remaining = 0; out.stopped = true; out.outcome = 'stopped'; break; }
  }
  if (remaining > 0 && !out.stopped) { const last = win[win.length - 1]; realized += (remaining / N) * signed(last.close); realizedStop += (remaining / N) * signed(last.close); out.outcome = out.rungs_hit ? 'partial' : 'open'; }
  else if (!out.stopped && out.outcome !== 'stopped') out.outcome = 'target';
  if (rungs.length === 0) out.outcome = 'gapped_past';
  out.R = realized; out.R_stop = realizedStop;

  // intraday-stop sensitivity (pessimistic): a hard stop order fills the moment price
  // TOUCHES the invalidation, capped -1R — same-bar the stop wins over the target (you
  // can't know intrabar order). Bounds the downside of tight stops surviving on close-basis.
  { const pend2 = [...rungs]; let rem2 = N, r2 = 0;
    for (let i = ei; i < win.length; i++) { const b = win[i];
      if (long ? b.low <= inval : b.high >= inval) { r2 += (rem2 / N) * -1; rem2 = 0; break; }
      while (pend2.length && (long ? b.high >= pend2[0] : b.low <= pend2[0])) { const rg = pend2.shift(); r2 += (1 / N) * signed(rg); rem2--; }
      if (rem2 <= 0) break;
    }
    if (rem2 > 0) { const last = win[win.length - 1]; r2 += (rem2 / N) * signed(last.close); }
    out.R_intra = r2; }
  return out;
}
