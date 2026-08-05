// UNIT-TEST the manage() execution layer against concrete scenarios (esp. the 7/30 failures + the pyramid stack).
// We can't re-run the LLM over full-day frames, so we test EXECUTION directly: given (decision, price) does it
// hold winners, take profit at target, stop out, trail, gate counter-trend, flatten EOD, and pyramid on a trend?
// Replica of agent.mjs's positions-stack manage() — returns a status string for the assertions.
const ENTRY_BAR = 0.5, EXIT_BAR = 0.6, NO_NEW_ET = '15:45', FLATTEN_ET = '15:55', MAX_OPT_LOSS_PCT = -50, MAX_OPT_LOSS_PCT_WIDE = -70, PREM_TAKE_MIN = 60, PREM_TRAIL_GIVEBACK = 0.30;
const NOTIONAL_PER_POSITION = 3000, MAX_TRANCHES = 4, ADD_CUTOFF_ET = '14:00';
function closePosition(b, pos, px, et, why) { const i = b.positions.indexOf(pos); if (i < 0) return; const sgn = pos.dir === 'long' ? 1 : -1; b.closed.push({ ...pos, exitET: et, exitPx: px, pnl: +((px - pos.entryPx) * sgn).toFixed(1), why }); b.positions.splice(i, 1); }
function manage(b, dec, px, et, trend, optPct, ng) {
  b.positions ||= (b.open ? [b.open] : []); delete b.open; b.closed ||= [];
  const decDir = dec.direction, conv = dec.conviction ?? 0, held = b.positions;
  const wantsFlatten = decDir && ((decDir === 'stand_aside') || (held.length && held[0].dir !== decDir)) && conv >= EXIT_BAR;
  const isReverse = wantsFlatten && decDir !== 'stand_aside';
  const counter = (trend === 'up' && decDir === 'short') || (trend === 'down' && decDir === 'long');
  let mechExit = false, lastWhy = null;
  const core = held[0], trendAligned = (decDir === 'long' && trend === 'up') || (decDir === 'short' && trend === 'down');   // core = runner candidate
  for (const pos of [...held]) {
    const long = pos.dir === 'long', s = dec.stop_level, t = dec.target_level;
    if (s != null && (long ? s < px : s > px) && (pos.stop_level == null || (long ? s > pos.stop_level : s < pos.stop_level))) pos.stop_level = s;   // RATCHET (never loosen)
    const rt = dec.runner_target, wantRunner = rt != null && trendAligned && (t == null || (long ? rt > t : rt < t)); if ((pos === core && wantRunner) || pos.is_runner) { if (rt != null && (long ? rt > px : rt < px)) { pos.target_level = rt; pos.is_runner = true; } } else if (t != null && (long ? t > px : t < px)) pos.target_level = t;
    if (optPct != null) { pos.live_ret_pct = optPct; pos.peak_ret_pct = Math.max(pos.peak_ret_pct ?? optPct, optPct); }   // test: option P/L applies to every held tranche; track the peak
    const priceFav = long ? px >= pos.entryPx : px <= pos.entryPx, premCap = (priceFav || (ng ?? 0) > 0) ? MAX_OPT_LOSS_PCT_WIDE : MAX_OPT_LOSS_PCT;   // regime-aware theta stop
    let why = null;
    if (pos.stop_level != null && (long ? px <= pos.stop_level : px >= pos.stop_level)) why = 'stop hit';
    else if (pos.target_level != null && (long ? px >= pos.target_level : px <= pos.target_level)) why = 'target hit';
    else if (pos.peak_ret_pct != null && pos.peak_ret_pct >= PREM_TAKE_MIN && pos.live_ret_pct != null && ((pos.peak_ret_pct - pos.live_ret_pct) / (100 + pos.peak_ret_pct)) >= PREM_TRAIL_GIVEBACK) why = 'premium take';
    else if (pos.live_ret_pct != null && pos.live_ret_pct <= premCap) why = 'premium stop';
    else if (et >= FLATTEN_ET) why = 'EOD flatten';
    else if (wantsFlatten) why = isReverse ? 'reversed (high conviction)' : 'exit — thesis invalidated';
    if (why) { closePosition(b, pos, px, et, why); lastWhy = why; if (!isReverse) mechExit = true; }
  }
  if (mechExit) return lastWhy;                        // mechanical exit this tick → flat, no same-tick re-entry
  const openPos = (isAdd) => { const cp = decDir === 'long' ? 'C' : 'P'; const initStop = (dec.stop_level != null && (decDir === 'long' ? dec.stop_level < px : dec.stop_level > px)) ? dec.stop_level : null; const initTarget = (dec.target_level != null && (decDir === 'long' ? dec.target_level > px : dec.target_level < px)) ? dec.target_level : null; b.positions.push({ dir: decDir, entryET: et, entryPx: px, cp, tranche: b.positions.length + 1, is_add: !!isAdd, target_level: initTarget, stop_level: initStop, counter_trend: counter, conviction: conv }); };
  if (decDir && decDir !== 'stand_aside' && et < NO_NEW_ET) {
    const openCount = b.positions.length, sameDir = openCount === 0 || b.positions.every(p => p.dir === decDir);
    if (sameDir) {
      const wantPullback = dec.entry_type === 'pullback' && dec.entry_level != null;
      const reached = !wantPullback || (decDir === 'long' ? px <= dec.entry_level : px >= dec.entry_level);
      if (openCount === 0) {
        if (conv >= ENTRY_BAR && reached) { openPos(false); return 'OPEN ' + decDir + (counter ? ' [counter-flagged]' : ''); }
        if (conv >= ENTRY_BAR && !reached) return 'WAIT (pullback to ' + dec.entry_level + ')';
        return 'skip (conv<0.5)';
      }
      const trendOK = (decDir === 'long' && trend === 'up') || (decDir === 'short' && trend === 'down');
      const allGreen = b.positions.every(p => p.live_ret_pct == null || p.live_ret_pct > 0);
      if (dec.scale_in === true && conv >= ENTRY_BAR && trendOK && allGreen && openCount < MAX_TRANCHES && et < ADD_CUTOFF_ET) { openPos(true); return 'ADD ' + decDir + ' #' + b.positions.length; }   // AGENT-signalled add + pure risk floor
    }
  }
  return b.positions.length ? 'HOLD' : 'flat';
}

let pass = 0, fail = 0; const chk = (name, got, want) => { const ok = got === want; console.log(`  ${ok ? '✓' : '✗ FAIL'} ${name}: ${got}${ok ? '' : '  (wanted ' + want + ')'}`); ok ? pass++ : fail++; };
const P0 = (b) => b.positions[0];   // the primary tranche (old "b.open")

console.log('── SCENARIO A: the 7385C — open long, target 7400, price wobbles to 7373 (old bug: dumped it), then hits the 7376 stop ──');
let b = { positions: [], closed: [] };
chk('open long @7385 conv.55 tgt7400 stop7376', manage(b, { direction: 'long', conviction: .55, target_level: 7400, stop_level: 7376 }, 7385, '11:06', 'up'), 'OPEN long');
chk('11:12 agent gets nervous (stand_aside conv.3) @7378', manage(b, { direction: 'stand_aside', conviction: .3 }, 7378, '11:12', 'up'), 'HOLD');
chk('11:15 dips to 7373 (below stop 7376 → STOP)', manage(b, { direction: 'long', conviction: .4 }, 7373, '11:15', 'up'), 'stop hit');

console.log('\n── SCENARIO A2: same but stop 7370 (survives the dip), then hits 7400 target ──');
b = { positions: [], closed: [] };
manage(b, { direction: 'long', conviction: .55, target_level: 7400, stop_level: 7370 }, 7385, '11:06', 'up');
chk('11:12 nervous stand_aside @7378', manage(b, { direction: 'stand_aside', conviction: .3 }, 7378, '11:12', 'up'), 'HOLD');
chk('11:15 dip 7373 (above 7370 stop)', manage(b, { direction: 'long', conviction: .4 }, 7373, '11:15', 'up'), 'HOLD');
chk('later rips to 7401 → TAKE PROFIT at target', manage(b, { direction: 'long', conviction: .5 }, 7401, '13:00', 'up'), 'target hit');
chk('booked 1 trade', b.closed.length, 1);

console.log('\n── SCENARIO B: counter-trend NOT hard-blocked (agentic) — opens at the normal bar, FLAGGED for the diary ──');
b = { positions: [], closed: [] };
chk('7370P short conv.55 on up-trend OPENS (no mechanical gate)', manage(b, { direction: 'short', conviction: .55, target_level: 7360, stop_level: 7395 }, 7372, '11:30', 'up'), 'OPEN short [counter-flagged]');
chk('counter_trend flag recorded for the diary', P0(b).counter_trend, true);
chk('a weak fade (conv.4) still fails the decisive-entry bar', (() => { let b2 = { positions: [], closed: [] }; return manage(b2, { direction: 'short', conviction: .4, target_level: 7360, stop_level: 7395 }, 7372, '11:30', 'up'); })(), 'skip (conv<0.5)');

console.log('\n── SCENARIO C: HOLD through noise — no churn ──');
b = { positions: [], closed: [] };
manage(b, { direction: 'long', conviction: .6, target_level: 7430, stop_level: 7400 }, 7413, '12:52', 'up');
let held = 0; for (const [px, et] of [[7415, '13:00'], [7410, '13:10'], [7418, '13:20'], [7409, '13:30']]) if (manage(b, { direction: 'stand_aside', conviction: .35 }, px, et, 'up') === 'HOLD') held++;
chk('held through 4 noisy wobbles (no churn)', held, 4);
chk('still 0 closed', b.closed.length, 0);

console.log('\n── SCENARIO D: EOD force-flatten ──');
b = { positions: [], closed: [] }; manage(b, { direction: 'long', conviction: .6, target_level: 7500, stop_level: 7400 }, 7440, '15:30', 'up');
chk('no NEW entry after 15:45', (() => { let b2 = { positions: [], closed: [] }; return manage(b2, { direction: 'long', conviction: .9, target_level: 7500, stop_level: 7400 }, 7440, '15:50', 'up'); })(), 'flat');
chk('open position force-flattened at 15:55', manage(b, { direction: 'long', conviction: .6 }, 7445, '15:56', 'up'), 'EOD flatten');
chk('flat after EOD', b.positions.length, 0);

console.log('\n── SCENARIO E: legit reversal (high-conviction) DOES flip ──');
b = { positions: [], closed: [] }; manage(b, { direction: 'long', conviction: .6, target_level: 7430, stop_level: 7400 }, 7415, '12:00', 'chop');
chk('reverse long→short conv.7 (chop)', manage(b, { direction: 'short', conviction: .7, target_level: 7395, stop_level: 7422 }, 7412, '12:10', 'chop'), 'OPEN short [counter-flagged]'.replace(' [counter-flagged]', ''));
chk('closed the long + opened short', b.closed.length === 1 && P0(b)?.dir === 'short', true);

console.log('\n── SCENARIO F: TRAILING STOP (long) — ratchet up, loosen blocked, trailed-above-entry FIRES ──');
b = { positions: [], closed: [] };
manage(b, { direction: 'long', conviction: .6, target_level: 7620, stop_level: 7580 }, 7585, '11:00', 'up');
chk('initial stop 7580', P0(b).stop_level, 7580);
manage(b, { direction: 'long', conviction: .6, target_level: 7620, stop_level: 7595 }, 7600, '11:10', 'up');
chk('stop RAISED to 7595 (above entry 7585)', P0(b).stop_level, 7595);
manage(b, { direction: 'long', conviction: .6, target_level: 7620, stop_level: 7588 }, 7605, '11:15', 'up');
chk('loosen to 7588 BLOCKED — stays 7595', P0(b).stop_level, 7595);
chk('pullback to 7595 STOPS OUT at protected level (old code never fired above entry)', manage(b, { direction: 'long', conviction: .5 }, 7595, '11:20', 'up'), 'stop hit');
chk('booked at trailed 7595, not entry-stop 7580', b.closed[b.closed.length - 1].exitPx, 7595);

console.log('\n── SCENARIO G: TRAILING (bearish/long-put) — stop ratchets DOWN, loosen-up blocked ──');
b = { positions: [], closed: [] };
manage(b, { direction: 'short', conviction: .7, target_level: 7550, stop_level: 7620 }, 7600, '11:00', 'chop');
chk('initial short stop 7620', P0(b).stop_level, 7620);
manage(b, { direction: 'short', conviction: .7, target_level: 7550, stop_level: 7605 }, 7590, '11:10', 'chop');
chk('short stop LOWERED to 7605 (ratchet down)', P0(b).stop_level, 7605);
chk('loosen up to 7615 BLOCKED', (() => { manage(b, { direction: 'short', conviction: .7, target_level: 7550, stop_level: 7615 }, 7585, '11:15', 'chop'); return P0(b).stop_level; })(), 7605);

console.log('\n── SCENARIO H: REGIME-AWARE PREMIUM/THETA STOP — lenient when price HOLDS or it’s CHOP (theta expected); tight only when price goes ADVERSE on a trend (stop the thesis breaking, not the clock ticking) ──');
b = { positions: [], closed: [] };
manage(b, { direction: 'long', conviction: .6, target_level: 7620, stop_level: 7580 }, 7600, '13:00', 'up');   // entry @7600
chk('price 7601 FAVORABLE + option -55% (trend) → HOLD (theta-lenient -70; thesis intact, just clock ticking)', manage(b, { direction: 'long', conviction: .5 }, 7601, '13:05', 'up', -55, -30), 'HOLD');
chk('price 7601 favorable but option -72% → PREMIUM STOP (past the lenient -70 cap; don’t hold to zero)', manage(b, { direction: 'long', conviction: .5 }, 7601, '13:10', 'up', -72, -30), 'premium stop');
let bh = { positions: [], closed: [] };
manage(bh, { direction: 'long', conviction: .6, target_level: 7620, stop_level: 7580 }, 7600, '13:00', 'up');
chk('price 7595 ADVERSE on a TREND (ng<0, above the 7580 price-stop) + option -55% → PREMIUM STOP (tight -50, thesis breaking)', manage(bh, { direction: 'long', conviction: .5 }, 7595, '13:05', 'up', -55, -30), 'premium stop');
let bc = { positions: [], closed: [] };
manage(bc, { direction: 'long', conviction: .6, target_level: 7620, stop_level: 7580 }, 7600, '13:00', 'chop');
chk('price 7595 adverse but CHOP (ng>0) + option -55% → HOLD (chop-lenient -70; oscillation is expected)', manage(bc, { direction: 'long', conviction: .5 }, 7595, '13:05', 'chop', -55, 30), 'HOLD');

console.log('\n── SCENARIO I: RESTING/PULLBACK ENTRY — waits for the dip, fills at the level; market fills now ──');
b = { positions: [], closed: [] };
chk('pullback long @7585, price 7592 → WAITS (no chase)', manage(b, { direction: 'long', conviction: .6, entry_type: 'pullback', entry_level: 7585, target_level: 7620, stop_level: 7580 }, 7592, '11:00', 'up'), 'WAIT (pullback to 7585)');
chk('still flat while waiting', b.positions.length, 0);
chk('price dips to 7584 → FILLS at the deflection', manage(b, { direction: 'long', conviction: .6, entry_type: 'pullback', entry_level: 7585, target_level: 7620, stop_level: 7580 }, 7584, '11:05', 'up'), 'OPEN long');
b = { positions: [], closed: [] };
chk('market entry fills immediately (no wait)', manage(b, { direction: 'long', conviction: .6, entry_type: 'market', target_level: 7620, stop_level: 7580 }, 7592, '11:00', 'up'), 'OPEN long');

console.log('\n── SCENARIO J: FAST/SLOW SPLIT — fast loop fires stop/target off the live price (no LLM); per-tranche mutex ──');
function fastCheck(o, spot) { if (!o) return null; const long = o.dir === 'long'; if (o.stop_level != null && (long ? spot <= o.stop_level : spot >= o.stop_level)) return 'stop hit (fast)'; if (o.target_level != null && (long ? spot >= o.target_level : spot <= o.target_level)) return 'target hit (fast)'; return null; }
async function closePosMx(b, pos, px, et, why) { if (!pos || pos._closing || b.positions.indexOf(pos) < 0) return; pos._closing = true; try { const sgn = pos.dir === 'long' ? 1 : -1; await Promise.resolve(); const i = b.positions.indexOf(pos); if (i < 0) return; b.closed.push({ ...pos, exitET: et, exitPx: px, pnl: +((px - pos.entryPx) * sgn).toFixed(1), why }); b.positions.splice(i, 1); } finally { pos._closing = false; } }
b = { positions: [], closed: [] }; manage(b, { direction: 'long', conviction: .6, target_level: 7620, stop_level: 7580 }, 7600, '13:00', 'up');
chk('long: spot 7600 between stop/target → HOLD (no fast exit)', fastCheck(P0(b), 7600), null);
chk('long: spot ticks to 7579 (< 7580 stop) → FAST stop fires', fastCheck(P0(b), 7579), 'stop hit (fast)');
chk('long: spot rips to 7621 (> 7620 target) → FAST target fires', fastCheck(P0(b), 7621), 'target hit (fast)');
let bs = { positions: [], closed: [] }; manage(bs, { direction: 'short', conviction: .7, target_level: 7550, stop_level: 7620 }, 7600, '11:00', 'chop');
chk('short: spot 7621 (>= 7620 stop) → FAST stop fires', fastCheck(P0(bs), 7621), 'stop hit (fast)');
chk('short: spot 7549 (<= 7550 target) → FAST target fires', fastCheck(P0(bs), 7549), 'target hit (fast)');
b = { positions: [], closed: [] }; manage(b, { direction: 'long', conviction: .6, target_level: 7620, stop_level: 7580 }, 7600, '13:00', 'up');
const racePos = P0(b);
await Promise.all([closePosMx(b, racePos, 7580, '13:05', 'stop hit (fast)'), closePosMx(b, racePos, 7580, '13:05', 'stop hit')]);   // fast + slow both breach the SAME tranche at once
chk('MUTEX: concurrent fast+slow close of one tranche → exactly 1 booked', b.closed.length, 1);
chk('flat after the race', b.positions.length, 0);
chk('the winner booked the fast reason', b.closed[0].why, 'stop hit (fast)');

console.log('\n── SCENARIO K: PYRAMIDING — AGENT-signalled adds (scale_in); the code enforces only the risk floor (green / max4 / pre-14:00 / trend-aligned) ──');
let bk = { positions: [], closed: [] };
chk('open tranche #1 long @7675 conv.7 up-trend', manage(bk, { direction: 'long', conviction: .7, target_level: 7760, stop_level: 7665 }, 7675, '10:40', 'up'), 'OPEN long');
chk('  1 tranche held', bk.positions.length, 1);
chk('stay long @7700 but NO scale_in → HOLD (adds are the agent’s call, not automatic)', manage(bk, { direction: 'long', conviction: .7, target_level: 7760, stop_level: 7690 }, 7700, '11:00', 'up'), 'HOLD');
chk('  still 1 tranche (no silent add)', bk.positions.length, 1);
chk('agent signals scale_in @7700 → ADD #2', manage(bk, { direction: 'long', conviction: .7, scale_in: true, target_level: 7760, stop_level: 7690 }, 7700, '11:05', 'up'), 'ADD long #2');
chk('scale_in @7725 → ADD #3', manage(bk, { direction: 'long', conviction: .7, scale_in: true, target_level: 7760, stop_level: 7712 }, 7725, '11:30', 'up'), 'ADD long #3');
chk('scale_in @7745 → ADD #4', manage(bk, { direction: 'long', conviction: .7, scale_in: true, target_level: 7760, stop_level: 7735 }, 7745, '12:00', 'up'), 'ADD long #4');
chk('  4 tranches stacked (~$12k)', bk.positions.length, 4);
chk('scale_in @7758 but MAX 4 → HOLD (risk floor caps it)', manage(bk, { direction: 'long', conviction: .7, scale_in: true, target_level: 7770, stop_level: 7748 }, 7758, '12:30', 'up'), 'HOLD');
chk('  cap holds at 4', bk.positions.length, 4);
chk('every tranche stop rolled UP to 7748 (structural ratchet)', bk.positions.every(p => p.stop_level === 7748), true);
chk('dip to 7748 → stack exits together at the protected level', manage(bk, { direction: 'long', conviction: .5 }, 7748, '12:40', 'up'), 'stop hit');
chk('  flat after stack stop-out', bk.positions.length, 0);
chk('  booked all 4 tranches', bk.closed.length, 4);
// RISK FLOOR still REFUSES a bad add even WITH scale_in set:
let bk2 = { positions: [], closed: [] }; manage(bk2, { direction: 'long', conviction: .7, stop_level: 7665 }, 7675, '10:40', 'up');
chk('scale_in but trend=CHOP → HOLD (refused, adds are trend-only)', manage(bk2, { direction: 'long', conviction: .7, scale_in: true, stop_level: 7690 }, 7700, '11:00', 'chop'), 'HOLD');
chk('  no add on chop', bk2.positions.length, 1);
chk('scale_in + up-trend but stack RED (-10%) → HOLD (no averaging down)', manage(bk2, { direction: 'long', conviction: .7, scale_in: true, stop_level: 7690 }, 7705, '11:05', 'up', -10), 'HOLD');
chk('  never add on top of a red stack', bk2.positions.length, 1);
let bk3 = { positions: [], closed: [] }; manage(bk3, { direction: 'long', conviction: .7, stop_level: 7665 }, 7675, '10:40', 'up');
chk('scale_in but after 14:00 cutoff → HOLD (refused, charm/pin risk)', manage(bk3, { direction: 'long', conviction: .7, scale_in: true, stop_level: 7690 }, 7700, '14:30', 'up'), 'HOLD');
chk('  no late-day adds', bk3.positions.length, 1);

console.log('\n── SCENARIO L: STRIKE STYLE — atm (default, max gamma) vs itm (higher delta, slower theta) offset ──');
const ITM_PCT = 0.0015;
const strikeOf = (px, dir, style, step) => { const refPx = style === 'itm' ? (dir === 'long' ? px * (1 - ITM_PCT) : px * (1 + ITM_PCT)) : px; return Math.round(refPx / step) * step; };
chk('atm long SPX @7700 → 7700 (at the money)', strikeOf(7700, 'long', 'atm', 5), 7700);
chk('itm long SPX @7700 → 7690 (strike BELOW spot = ITM call, higher delta, slower decay)', strikeOf(7700, 'long', 'itm', 5), 7690);
chk('itm bearish/put SPX @7700 → 7710 (strike ABOVE spot = ITM put)', strikeOf(7700, 'short', 'itm', 5), 7710);
chk('atm long SPY @765 → 765', strikeOf(765, 'long', 'atm', 1), 765);
chk('itm long SPY @765 → 764 (1 strike ITM)', strikeOf(765, 'long', 'itm', 1), 764);

console.log('\n── SCENARIO M: RUNNER / SCALE-OUT — on a confirmed trend, target_level banks the scalps but the CORE rides toward runner_target (the fix for selling-too-early) ──');
let bm = { positions: [], closed: [] };
manage(bm, { direction: 'short', conviction: .7, target_level: 7740, stop_level: 7778 }, 7770, '10:30', 'down');   // #1 core @7770
manage(bm, { direction: 'short', conviction: .7, scale_in: true, target_level: 7740, stop_level: 7762 }, 7755, '10:45', 'down');   // add #2
manage(bm, { direction: 'short', conviction: .7, scale_in: true, target_level: 7740, stop_level: 7752 }, 7745, '11:00', 'down');   // add #3
chk('3-tranche short stack built', bm.positions.length, 3);
manage(bm, { direction: 'short', conviction: .7, target_level: 7740, runner_target: 7700, stop_level: 7748 }, 7739, '11:18', 'down');   // near target hit + runner_target set on a confirmed down-trend
chk('  scalps banked, ONE runner held (not the whole stack)', bm.positions.length, 1);
chk('  2 scalps closed at the near target', bm.closed.length, 2);
chk('  the survivor is the CORE (best entry 7770)', bm.positions[0].entryPx, 7770);
chk('  core converted to a RUNNER toward runner_target 7700', bm.positions[0].is_runner === true && bm.positions[0].target_level === 7700, true);
chk('  bounce to 7742 (runner stop 7748 not hit) → HOLD the runner', manage(bm, { direction: 'short', conviction: .55, runner_target: 7700 }, 7742, '11:30', 'down'), 'HOLD');
chk('  runner reaches 7699 (past runner_target 7700) → target hit', manage(bm, { direction: 'short', conviction: .55, runner_target: 7700 }, 7699, '12:00', 'down'), 'target hit');
chk('  flat after the runner books the full move', bm.positions.length, 0);
let bch = { positions: [], closed: [] };
manage(bch, { direction: 'short', conviction: .7, target_level: 7740, stop_level: 7778 }, 7770, '10:30', 'chop');
chk('  CHOP guard: target hit with runner_target set but trend≠down → whole position exits (no runner in chop)', manage(bch, { direction: 'short', conviction: .7, target_level: 7740, runner_target: 7700, stop_level: 7748 }, 7739, '11:18', 'chop'), 'target hit');
chk('  chop: flat, no runner held', bch.positions.length, 0);

console.log('\n── SCENARIO N: PREMIUM-TRAILING TAKE — bank the option near its high when it spikes then gives back (option-value mirror of the theta stop) ──');
let bp = { positions: [], closed: [] };
manage(bp, { direction: 'long', conviction: .6, target_level: 7620, stop_level: 7580 }, 7600, '13:00', 'up');   // entry @7600; price stays ~7601 (far from stop/target) so only the option moves
chk('option +80% (fresh peak) → HOLD', manage(bp, { direction: 'long', conviction: .5 }, 7601, '13:05', 'up', 80), 'HOLD');
chk('option eases to +75% (~3% off the premium peak) → HOLD', manage(bp, { direction: 'long', conviction: .5 }, 7601, '13:10', 'up', 75), 'HOLD');
chk('option drops to +25% (~30% off the +80% premium peak) → PREMIUM TAKE', manage(bp, { direction: 'long', conviction: .5 }, 7601, '13:15', 'up', 25), 'premium take');
let bp2 = { positions: [], closed: [] };
manage(bp2, { direction: 'long', conviction: .6, target_level: 7620, stop_level: 7580 }, 7600, '13:00', 'up');
manage(bp2, { direction: 'long', conviction: .5 }, 7601, '13:05', 'up', 40);   // peak only +40% (below the +60% arm)
chk('option peaked only +40% then eased to +5% → HOLD (take not armed under a +60% peak)', manage(bp2, { direction: 'long', conviction: .5 }, 7601, '13:10', 'up', 5), 'HOLD');

console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
