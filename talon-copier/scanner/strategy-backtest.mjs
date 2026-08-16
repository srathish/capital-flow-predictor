#!/usr/bin/env node
// strategy-backtest.mjs — test the FIXED strategy deterministically (NO LLM gate) across
// all scored weeks, reusing the saved <week>_score.json levels. Answers: does "long the
// bullish structure + at-market entry + hard -1R stop + let winners run the ladder" keep
// the down-week defense AND catch the up week?
//
// The 3 fixes vs the current LLM system:
//   FIX 1 breakout/at-market entry: enter at spot on day 1 (no waiting for a pullback OTE
//     that gap-ups never fill).
//   FIX 2 no gate: take EVERY bullish-structured name long (the king-migration veto was
//     net-negative — it stood us aside on NVDA the day before +13%).
//   FIX 3 ladder runners: scale out across the vanna ladder (first_target + swing_targets)
//     instead of one nearer target, to capture the +6R rips.
// Stop is hard (-1R at the structural support) — the realistic disciplined model.
import { loadEnvKeysFrom, resolveFromRoot, readJson, log } from './lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { FlowProvider } = await import('./providers/flow-uw.mjs');

const files = process.argv.slice(2);
if (!files.length) { console.log('usage: node strategy-backtest.mjs <wk1_score.json> [wk2 ...]'); process.exit(1); }
const flow = new FlowProvider();

// Resolve ONE long: enter at-market on the FIRST in-window bar's OPEN (realistic Monday
// fill, no saved-spot dependency), scale out equally across the ladder rungs (intraday
// touch), hard stop on a CLOSE below the structural support (Talon's "wicks aren't
// failure" rule) exiting the remainder at -1R — consistent with the +20.9R Talon hard-stop
// baseline. Unhit portion marks to the final close. Returns { entered, R, rungs_hit, stopped }.
function resolveLong(stop, ladder, ohlc, { from, to }) {
  const win = (ohlc || []).filter((d) => (!from || d.date >= from) && (!to || d.date <= to) && d.close != null).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!win.length) return { entered: false, R: 0, rungs_hit: 0, stopped: false, note: 'no-bars' };
  const entry = win[0].open ?? win[0].close;
  const rungs = [...new Set(ladder.filter((x) => x != null && x > entry))].sort((a, b) => a - b);
  const risk = entry - stop;
  if (risk <= 0 || !rungs.length) return { entered: false, R: 0, rungs_hit: 0, stopped: false, entry, note: risk <= 0 ? 'bad-risk' : 'no-rungs' };
  const N = rungs.length;
  let remaining = N, realized = 0, hit = 0, stopped = false;
  const pending = [...rungs];
  for (const b of win) {
    // scale out at any rungs the bar reaches intraday (booked during the day)…
    while (pending.length && b.high >= pending[0]) { const rung = pending.shift(); realized += (1 / N) * ((rung - entry) / risk); remaining--; hit++; }
    if (remaining <= 0) break;
    // …then a CLOSE below support stops the remainder at -1R (hard cap)
    if (b.close < stop) { realized += (remaining / N) * -1; remaining = 0; stopped = true; break; }
  }
  if (remaining > 0 && !stopped) { const last = win[win.length - 1]; realized += (remaining / N) * ((last.close - entry) / risk); }
  return { entered: true, R: realized, rungs_hit: hit, stopped, of_rungs: N, entry };
}

const perWeek = [];
for (const f of files) {
  const j = readJson(resolveFromRoot(f)) || readJson(f);
  if (!j) { log(`  · could not read ${f}`); continue; }
  let total = 0, entered = 0, wins = 0, skipped = 0, excludedShort = 0;
  const rows = [];
  for (const r of j.rows) {
    const dir = r.our_direction;
    // bull levels only (short/watch_short saved BEAR levels — can't force-long them here)
    if (dir === 'short' || dir === 'watch_short') { excludedShort++; continue; }
    const L = r.our_levels || {};
    const entry = r.our_current, stop = L.invalidation;
    const ladder = [L.first_target, ...(L.swing_targets || [])];
    if (entry == null || stop == null) { skipped++; continue; }
    const ohlc = await flow.getDailyOHLC(r.ticker, { limit: 90 }).catch(() => []);
    const res = resolveLong(entry, stop, ladder, ohlc, { from: j.resolve_from, to: j.resolve_to });
    if (!res.entered) { skipped++; continue; }
    entered++; total += res.R; if (res.R > 0) wins++;
    rows.push({ t: r.ticker, R: res.R, hit: res.rungs_hit, of: res.of_rungs, stopped: res.stopped });
  }
  perWeek.push({ week: j.week, total, entered, wins, skipped, excludedShort, rows });
  log(`\n═══ ${j.week} (${j.resolve_from}→${j.resolve_to}) ═══`);
  for (const x of rows) log(`  ${x.t.padEnd(6)} ${x.R >= 0 ? '+' : ''}${x.R.toFixed(2)}R  (${x.hit}/${x.of} rungs${x.stopped ? ', STOPPED' : ''})`);
  log(`  → ${entered} entered · ${wins} green · total ${total >= 0 ? '+' : ''}${total.toFixed(1)}R · (${excludedShort} short-classified excluded, ${skipped} skipped)`);
}
const grand = perWeek.reduce((s, w) => s + w.total, 0);
const gEnt = perWeek.reduce((s, w) => s + w.entered, 0);
const gWin = perWeek.reduce((s, w) => s + w.wins, 0);
log(`\n████ FIXED STRATEGY — ${perWeek.length} weeks ████`);
for (const w of perWeek) log(`  ${w.week}: ${w.total >= 0 ? '+' : ''}${w.total.toFixed(1)}R (${w.wins}/${w.entered})`);
log(`  TOTAL: ${grand >= 0 ? '+' : ''}${grand.toFixed(1)}R · ${gWin}/${gEnt} green · vs Talon +20.9R / our-LLM +7.5R (hard-stop, 4wk)`);
