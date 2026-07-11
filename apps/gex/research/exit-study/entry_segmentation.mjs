// Overnight study Phase 3 — ENTRY / REGIME segmentation (research only).
// Phase 1 proved exits aren't the lever: BULL_REVERSE P&L is regime-contingent.
// So: tag each fire with regime features and find buckets with edge in BOTH
// train (first half) AND test (second half) — robust "fire only when" conditions.
//
// Label per fire = realized under a FIXED, neutral exit (time_30m) on real option
// marks, so segmentation isn't confounded by exit choice. Also report MFE (did
// the entry catch a move) to separate "no catch" from "caught but faded".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const UND = path.join(HERE, 'cache_underlying');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
const undKey = t => (t === 'SPXW' ? 'SPY' : t);

// preload SPY per day for a market-tape proxy (aligns with the bull-tape gate)
const spyCache = {};
function spyDay(day) {
  if (spyCache[day]) return spyCache[day];
  const c = load(path.join(UND, `SPY_${day}.json`))
    .map(r => ({ ts: Date.parse(r.start_time), close: +r.close })).filter(r => r.close > 0).sort((a, b) => a.ts - b.ts);
  // session open = first bar at/after 13:30 UTC
  const open = (c.find(r => new Date(r.ts).getUTCHours() >= 13 && (new Date(r.ts).getUTCHours() > 13 || new Date(r.ts).getUTCMinutes() >= 30)) || c[0])?.close;
  return (spyCache[day] = { c, open });
}
function spyTapeAt(day, ts) {
  const { c, open } = spyDay(day); if (!open) return null;
  let i = 0; while (i < c.length - 1 && c[i + 1].ts <= ts) i++;
  return (c[i].close - open) / open;
}

function optPath(fire) {
  const opt = load(path.join(CACHE, `${fire.sym}_${fire.day}.json`))
    .map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= fire.fireTsMs + 60000);
  if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close, steps = opt.slice(ei);
  const t0 = steps[0].ts;
  let mfe = -1, exit30 = null;
  for (const s of steps) { const g = (s.close - entry) / entry; if (g > mfe) mfe = g; if (exit30 == null && s.ts - t0 >= 30 * 60000) exit30 = g; }
  if (exit30 == null) exit30 = (steps.at(-1).close - entry) / entry;
  return { mfe, exit30 };
}

const fires = load(path.join(HERE, 'fires_index.json')).filter(f => f.state === 'BULL_REVERSE');
const days = [...new Set(fires.map(f => f.day))].sort();
const split = days[Math.floor(days.length / 2)];

const recs = [];
for (const f of fires) {
  const o = optPath(f); if (!o) continue;
  const mins = Math.round((f.fireTsMs - Date.parse(`${f.day}T13:30:00Z`)) / 60000);
  const tape = spyTapeAt(f.day, f.fireTsMs);
  recs.push({
    day: f.day, isTest: f.day >= split, ticker: f.ticker, exit30: o.exit30, mfe: o.mfe,
    tod: mins < 30 ? '1_open(0-30m)' : mins < 120 ? '2_morning(30-120)' : mins < 240 ? '3_midday(120-240)' : mins < 330 ? '4_afternoon(240-330)' : '5_close(330m+)',
    tape: tape == null ? 'na' : tape > 0.003 ? 'a_strong_up(>+0.3%)' : tape > 0 ? 'b_up(0..0.3)' : tape > -0.003 ? 'c_flat(-0.3..0)' : 'd_down(<-0.3%)',
  });
}
console.log(`BULL_REVERSE fires with marks: ${recs.length}  (train ${recs.filter(r => !r.isTest).length} / test ${recs.filter(r => r.isTest).length}, split ${split})`);

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pct = x => Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%` : '  -';
function seg(label, keyFn) {
  console.log(`\n===== by ${label} =====`);
  console.log('bucket'.padEnd(22) + 'n'.padStart(5) + 'TRAIN exit30'.padStart(13) + 'TEST exit30'.padStart(12) + 'TRAIN mfe'.padStart(11) + 'TEST mfe'.padStart(10) + '  robust?');
  const buckets = [...new Set(recs.map(keyFn))].sort();
  for (const b of buckets) {
    const tr = recs.filter(r => keyFn(r) === b && !r.isTest), te = recs.filter(r => keyFn(r) === b && r.isTest);
    const trM = mean(tr.map(r => r.exit30)), teM = mean(te.map(r => r.exit30));
    const robust = trM > 0.05 && teM > 0.05 ? ' ✅ BOTH+' : (trM > 0 && teM > 0 ? ' ~both+' : '');
    console.log(b.padEnd(22) + String(tr.length + te.length).padStart(5) + pct(trM).padStart(13) + pct(teM).padStart(12) +
      pct(mean(tr.map(r => r.mfe))).padStart(11) + pct(mean(te.map(r => r.mfe))).padStart(10) + '  ' + robust);
  }
}
seg('time-of-day', r => r.tod);
seg('market tape @ fire (SPY vs open)', r => r.tape);
seg('ticker', r => r.ticker);
// cross: tape x time-of-day (the confluence that matters)
console.log('\n===== tape × time-of-day (exit30, train→test) =====');
const combos = [...new Set(recs.map(r => `${r.tape}|${r.tod}`))].sort();
for (const c of combos) {
  const [tp, td] = c.split('|');
  const tr = recs.filter(r => r.tape === tp && r.tod === td && !r.isTest), te = recs.filter(r => r.tape === tp && r.tod === td && r.isTest);
  if (tr.length + te.length < 15) continue;
  const trM = mean(tr.map(r => r.exit30)), teM = mean(te.map(r => r.exit30));
  const flag = trM > 0.05 && teM > 0.05 ? ' ✅' : '';
  console.log(`${c.padEnd(40)} n=${String(tr.length + te.length).padStart(4)}  train ${pct(trM).padStart(6)}  test ${pct(teM).padStart(6)}${flag}`);
}
