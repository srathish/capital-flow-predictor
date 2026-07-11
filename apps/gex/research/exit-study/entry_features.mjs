// Overnight study Phase 3b — DEEP ENTRY FEATURES (research only).
// Beyond regime buckets: does the system's own trend/chop label, pin-in-reason,
// fire sequence/density, moneyness, or day-of-week separate winners from losers?
// Label = realized under fixed time_30m exit on real 0DTE marks. Train/test split.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
function exit30(fire) {
  const opt = load(path.join(CACHE, `${fire.sym}_${fire.day}.json`)).map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= fire.fireTsMs + 60000); if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close, steps = opt.slice(ei), t0 = steps[0].ts;
  for (const s of steps) if (s.ts - t0 >= 30 * 60000) return (s.close - entry) / entry;
  return (steps.at(-1).close - entry) / entry;
}

const raw = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'scripts', 'out', 'replay-fires-2026-04-10_2026-07-08.json'), 'utf8')).filter(f => f.state === 'BULL_REVERSE');
const idx = load(path.join(HERE, 'fires_index.json'));
const symOf = f => { const m = idx.find(x => x.src === 'replay' && x.day === f.day && x.ticker === f.ticker && x.fireTsMs === f.fireTsMs && x.K === f.K); return m?.sym; };
const days = [...new Set(raw.map(f => f.day))].sort();
const split = days[Math.floor(days.length / 2)];

// per-day fire ordering for sequence/density
const perDay = {}; for (const f of raw) (perDay[f.day] = perDay[f.day] || []).push(f);
for (const d in perDay) perDay[d].sort((a, b) => a.fireTsMs - b.fireTsMs);

const recs = [];
for (const f of raw) {
  const sym = symOf(f); if (!sym) continue;
  const g = exit30({ ...f, sym }); if (g == null) continue;
  const seq = perDay[f.day].indexOf(f) + 1, dens = perDay[f.day].length;
  const reg = f.regimes?.['30m'] || {}; const reg5 = f.regimes?.['5m'] || {};
  const mny = (f.K - f.entrySpot) / f.entrySpot;   // + = OTM call strike above spot
  recs.push({
    isTest: f.day >= split, g,
    reg30: reg.label || 'na', reg5: reg5.label || 'na',
    pin: /pin/i.test(reg.reason || '') ? 'pin' : 'no_pin',
    seq: seq === 1 ? '1_first' : seq <= 3 ? '2_2nd-3rd' : seq <= 6 ? '3_4th-6th' : '4_7th+',
    dens: dens <= 5 ? 'a_quiet(<=5)' : dens <= 9 ? 'b_normal(6-9)' : 'c_busy(10+)',
    mny: mny < -0.001 ? 'ITM(<spot)' : mny < 0.0015 ? 'ATM' : 'OTM(>spot)',
    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(f.fireTsMs).getUTCDay()],
  });
}
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pct = x => Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%` : '  -';
console.log(`\nDEEP ENTRY FEATURES — BULL_REVERSE, n=${recs.length} (split ${split})`);
function seg(label, key) {
  console.log(`\n== ${label} ==`);
  for (const b of [...new Set(recs.map(r => r[key]))].sort()) {
    const tr = recs.filter(r => r[key] === b && !r.isTest).map(r => r.g), te = recs.filter(r => r[key] === b && r.isTest).map(r => r.g);
    const trM = mean(tr), teM = mean(te);
    const rob = trM > 0.03 && teM > 0.03 ? ' ✅' : (trM < 0 && teM < 0 ? ' ❌both-' : '');
    console.log('  ' + b.padEnd(16) + `n=${String(tr.length + te.length).padStart(4)}  train ${pct(trM).padStart(6)}  test ${pct(teM).padStart(6)}${rob}`);
  }
}
seg('30m regime label (system trend/chop)', 'reg30');
seg('5m regime label', 'reg5');
seg('pin in regime reason', 'pin');
seg('fire sequence in day', 'seq');
seg('fire density that day', 'dens');
seg('strike moneyness', 'mny');
seg('day of week', 'dow');
