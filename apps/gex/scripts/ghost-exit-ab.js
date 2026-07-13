/**
 * GHOST EXIT A/B — forward paper-test of the verified scale-out ladder.
 *
 * RESEARCH / REPORTING ONLY (Clause 0). Reads the day's real fires from
 * tracked_plays, replays each contract's UW 1-min path, and reports what the
 * SCALE-OUT ladder (⅓@+50 / ⅓@+100 / trail final third) WOULD have realized
 * vs what the live exit ACTUALLY realized. Touches NOTHING in the fire/exit
 * loop — it never closes a play. Appends one row/day to ghost_ab_log.jsonl so
 * forward A/B evidence accumulates until the ladder has earned a live slot.
 *
 * The ladder math (trailLeg / scaleThirds) is copied VERBATIM from the
 * adversarially-verified research driver research/exit-study/scaleout_regime.mjs
 * so ghost == the tested strategy.
 *
 *   node scripts/ghost-exit-ab.js                 # latest trading day
 *   node scripts/ghost-exit-ab.js --day 2026-07-13
 */
import './_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/store/db.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(HERE, '..', 'research', 'exit-study', 'ghost_ab_log.jsonl');
const HAIR = 0.03;                 // fill haircut on market-exited fraction (matches verify)
const dayArg = (process.argv.find(a => a.startsWith('--day')) || '').split('=')[1]
  || (process.argv.includes('--day') ? process.argv[process.argv.indexOf('--day') + 1] : null);

// ---- verified ladder math (verbatim from scaleout_regime.mjs) ----
function trailLeg(steps, startIdx, arm, gb, stop) {
  let peak = -Infinity, armed = false;
  for (let i = startIdx; i < steps.length; i++) {
    const g = steps[i].g;
    if (g > peak) peak = g;
    if (!armed && peak >= arm) armed = true;
    if (stop != null && g <= -stop) return g;
    if (armed && (1 + g) <= (1 + peak) * (1 - gb)) return g;
  }
  return steps.at(-1).g;
}
function liveTrail(steps) { return { g: trailLeg(steps, 0, 0.50, 0.15, 0.60), marketFrac: 1 }; }
function scaleThirds(steps, t1 = 0.50, t2 = 1.00, gb = 0.30, stop = 0.60) {
  // CONSERVATIVE fill (matches the adversarial verify): a limit rung only counts
  // if the level HOLDS >=2 consecutive bars — not a single spike-print. Fill is
  // confirmed on the 2nd bar; the remainder trails from there.
  const firstHeld = (lvl) => { for (let i = 0; i < steps.length - 1; i++) if (steps[i].g >= lvl && steps[i + 1].g >= lvl) return i + 1; return -1; };
  const i1 = firstHeld(t1), i2 = firstHeld(t2);
  if (i1 < 0) return { g: trailLeg(steps, 0, 0.50, gb, stop), marketFrac: 1 };
  if (i2 < 0) { const r = trailLeg(steps, i1, t1, gb, stop); return { g: (1 / 3) * t1 + (2 / 3) * r, marketFrac: 2 / 3 }; }
  const r = trailLeg(steps, i2, t2, gb, stop); return { g: (1 / 3) * t1 + (1 / 3) * t2 + (1 / 3) * r, marketFrac: 1 / 3 };
}
const net = ({ g, marketFrac }) => g - HAIR * marketFrac;   // haircut only the market-exited fraction

async function uwPath(sym, day) {
  const key = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${sym}/intraday?date=${day}`,
      { headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'bellwether-ghost-ab/1.0' }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    return ((await r.json())?.data || []).map(c => ({ ts: Date.parse(c.start_time), close: Number(c.close) || 0 })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  } catch { return null; }
}
const pct = x => (x == null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`);

async function main() {
  const db = openDb();
  const day = dayArg || db.prepare(`SELECT max(trading_day) d FROM tracked_plays`).get().d;
  const rows = db.prepare(`SELECT * FROM tracked_plays WHERE trading_day = ? ORDER BY fire_ts_ms`).all(day);
  if (!rows.length) { console.log(`No plays for ${day}.`); return; }

  const actuals = [], ghosts = [], trails = []; let scored = 0;
  console.log(`\n  GHOST EXIT A/B — ${day}  (scale-out ⅓@+50/⅓@+100/trail vs live exit; ${HAIR * 100}% fill haircut)\n`);
  console.log('  ' + 'contract'.padEnd(26) + 'ACTUAL'.padStart(8) + 'GHOST'.padStart(9) + '  Δ');
  for (const r of rows) {
    const opt = await uwPath(r.option_symbol, day);
    const exitMark = r.close_mark != null ? r.close_mark : r.current_mark;
    const actual = (exitMark != null && r.entry_mark > 0) ? (exitMark - r.entry_mark) / r.entry_mark : null;
    let ghost = null;
    if (opt && r.entry_mark > 0) {
      const entryTs = r.fire_ts_ms + 60000;
      const ei = opt.findIndex(o => o.ts >= entryTs);
      if (ei >= 0 && ei < opt.length - 1) {
        const steps = opt.slice(ei).map(o => ({ g: (o.close - r.entry_mark) / r.entry_mark }));
        ghost = net(scaleThirds(steps));
        trails.push(net(liveTrail(steps)));
      }
    }
    if (actual != null) actuals.push(actual);
    if (ghost != null) { ghosts.push(ghost); scored++; }
    const d = (actual != null && ghost != null) ? ghost - actual : null;
    const lbl = `${r.state} ${r.option_type === 'put' ? 'P' : 'C'}${r.strike}`.slice(0, 25);
    console.log('  ' + lbl.padEnd(26) + pct(actual).padStart(8) + pct(ghost).padStart(9) + '  ' + (d == null ? '—' : (d >= 0 ? '+' : '') + (d * 100).toFixed(0) + 'pt'));
  }
  const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const aA = mean(actuals), aG = mean(ghosts);
  console.log('\n  ' + '─'.repeat(50));
  console.log(`  ACTUAL avg ${pct(aA)}   GHOST ladder avg ${pct(aG)}   Δ ${aG != null && aA != null ? ((aG - aA) >= 0 ? '+' : '') + ((aG - aA) * 100).toFixed(1) + 'pt' : '—'}   (ghost-scored ${scored}/${rows.length})`);
  console.log('  NOTE: ghost = paper only; no live exit was changed. Forward A/B accumulating in ghost_ab_log.jsonl.\n');

  // append one row/day for forward accumulation (idempotent-ish: replace same-day line)
  try {
    const rec = { day, n: rows.length, ghost_scored: scored, actual_avg: aA, ghost_avg: aG, delta: (aG != null && aA != null) ? aG - aA : null, ts: new Date().toISOString() };
    let lines = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).filter(l => { try { return JSON.parse(l).day !== day; } catch { return false; } }) : [];
    lines.push(JSON.stringify(rec));
    fs.writeFileSync(LOG, lines.join('\n') + '\n');
  } catch (e) { console.warn('ghost log append skipped:', e.message); }
}
main();
