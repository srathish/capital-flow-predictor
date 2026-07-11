// Overnight study Phase 3c — "TREND DAY -> HOLD TO CLOSE?" (research only).
// User hypothesis: on a trending day (not chop), let the aligned BULL_REVERSE
// call run to the close instead of scalping. Test hold_eod vs scalp(exit30),
// segmented by DAY type, with a REALIZABLE early proxy (can we know by fire time?).
//   day type (hindsight): SPY (close-open)/open  -> trendUp / chop / trendDown
//   early proxy (real-time at fire): SPY (fire-open)/open  -> already-moving?
// Train/test split preserved.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache'), UND = path.join(HERE, 'cache_underlying');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

const spyC = {};
function spy(day) {
  if (spyC[day]) return spyC[day];
  const c = load(path.join(UND, `SPY_${day}.json`)).map(r => ({ ts: Date.parse(r.start_time), close: +r.close })).filter(r => r.close > 0).sort((a, b) => a.ts - b.ts);
  const reg = c.filter(r => { const h = new Date(r.ts).getUTCHours(), m = new Date(r.ts).getUTCMinutes(); return (h > 13 || (h === 13 && m >= 30)) && h < 20; });
  return (spyC[day] = { open: reg[0]?.close, close: reg.at(-1)?.close, bars: c });
}
const spyAt = (day, ts) => { const b = spy(day).bars; let i = 0; while (i < b.length - 1 && b[i + 1].ts <= ts) i++; return b[i].close; };

function marks(fire) {
  const opt = load(path.join(CACHE, `${fire.sym}_${fire.day}.json`)).map(c => ({ ts: Date.parse(c.start_time), close: +c.close })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const ei = opt.findIndex(o => o.ts >= fire.fireTsMs + 60000); if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close, steps = opt.slice(ei), t0 = steps[0].ts;
  let e30 = null; for (const s of steps) if (e30 == null && s.ts - t0 >= 30 * 60000) e30 = (s.close - entry) / entry;
  return { eod: (steps.at(-1).close - entry) / entry, e30: e30 ?? (steps.at(-1).close - entry) / entry };
}

const fires = load(path.join(HERE, 'fires_index.json')).filter(f => f.state === 'BULL_REVERSE');
const days = [...new Set(fires.map(f => f.day))].sort();
const split = days[Math.floor(days.length / 2)];
const recs = [];
for (const f of fires) {
  const m = marks(f); if (!m) continue;
  const s = spy(f.day); if (!s.open || !s.close) continue;
  const dayMove = (s.close - s.open) / s.open;
  const early = (spyAt(f.day, f.fireTsMs) - s.open) / s.open;
  recs.push({
    isTest: f.day >= split, eod: m.eod, e30: m.e30, dayMove, early,
    dayType: dayMove > 0.005 ? 'trendUP' : dayMove < -0.005 ? 'trendDOWN' : 'chop',
    earlyProxy: early > 0.004 ? 'up>0.4%' : early < -0.004 ? 'dn>0.4%' : 'flat',
  });
}
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pct = x => Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%` : '  -';
function seg(label, key, metric) {
  console.log(`\n== ${label} (metric: ${metric}) ==`);
  for (const b of [...new Set(recs.map(r => r[key]))].sort()) {
    const tr = recs.filter(r => r[key] === b && !r.isTest).map(r => r[metric]), te = recs.filter(r => r[key] === b && r.isTest).map(r => r[metric]);
    const trM = mean(tr), teM = mean(te), rob = trM > 0.05 && teM > 0.05 ? ' ✅' : (trM < 0 && teM < 0 ? ' ❌' : '');
    console.log('  ' + b.padEnd(12) + `n=${String(tr.length + te.length).padStart(4)}  train ${pct(trM).padStart(6)}  test ${pct(teM).padStart(6)}${rob}`);
  }
}
console.log(`\nTREND-DAY HOLD TEST — BULL_REVERSE calls, n=${recs.length} (split ${split})`);
console.log('(trendUP = day aligned with a call; chop/trendDOWN = not)');
seg('HOLD-TO-CLOSE by day type', 'dayType', 'eod');
seg('SCALP 30m by day type', 'dayType', 'e30');
console.log('\n--- REALIZABLE: can the early proxy (SPY move from open AT fire) flag the hold? ---');
seg('HOLD-TO-CLOSE by early proxy', 'earlyProxy', 'eod');
seg('SCALP 30m by early proxy', 'earlyProxy', 'e30');
// the money question: on trendUP days, hold vs scalp, side by side
const up = recs.filter(r => r.dayType === 'trendUP');
console.log(`\ntrendUP days (n=${up.length}):  HOLD ${pct(mean(up.map(r => r.eod)))} vs SCALP ${pct(mean(up.map(r => r.e30)))}` +
  `   | test-only HOLD ${pct(mean(up.filter(r => r.isTest).map(r => r.eod)))} vs SCALP ${pct(mean(up.filter(r => r.isTest).map(r => r.e30)))}`);
