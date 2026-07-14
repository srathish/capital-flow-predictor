// ARM B — STRUCTURE-EXIT LATENCY BOUND (research only, Clause 0).
// Pre-registered in GRANULARITY_2026-07-14.md.
//
// For every play closed by the structural exit, compare the ACTUAL exit mark
// (close_mark @ close_ts_ms) against the option's 1-min mark at T-5..T+5.
//
//   Δ(N) = (mark[close_ts + N min] - close_mark) / entry_mark    [return points]
//   Δ(-1) > 0  =>  exiting 1 MINUTE EARLIER would have been better.
//
// LOAD-BEARING INFERENCE: the structural condition is polled every 60s, so a
// condition firing at T became true within (T-60s, T]. Sub-60s polling can capture
// AT MOST the T-1min -> T move, and in expectation ~half of it. Therefore
//     E[gain from infinitely fast polling] <= Δ(-1),  realistically ~0.5*Δ(-1).
// Δ(-1) is a HARD UPPER BOUND on the whole value of finer surface polling.
// Δ(-2)/Δ(-5) are NOT granularity — they ask whether the SIGNAL should lead.
import '../../scripts/_env-bootstrap.js';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function pull(sym, day) {
  const file = path.join(CACHE, `${sym}_${day}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const url = `https://api.unusualwhales.com/api/option-contract/${sym}/intraday?date=${day}`;
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${KEY}`, 'User-Agent': 'bellwether-research/1.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (r.status === 429) { await sleep(2500 * (a + 1)); continue; }
      if (!r.ok) { console.error(`  ! ${sym} ${day} -> HTTP ${r.status}`); return null; }
      const rows = (await r.json())?.data || [];
      fs.writeFileSync(file, JSON.stringify(rows));
      await sleep(400);
      return rows;
    } catch (e) { console.error(`  ! ${sym} retry (${e.message})`); await sleep(1200); }
  }
  return null;
}

const db = new Database(path.join(HERE, '..', '..', 'data', 'gexester.db'), { readonly: true });
const plays = db.prepare(`
  SELECT play_id, trading_day, ticker, option_symbol, option_type, state,
         entry_mark, close_mark, close_ts_ms, best_pct_gain, close_reason
  FROM tracked_plays
  WHERE close_reason LIKE 'closed_structure_invalidated%'
    AND close_mark > 0 AND entry_mark > 0
  ORDER BY trading_day, close_ts_ms`).all();

console.log(`# ARM B — STRUCTURE-EXIT LATENCY BOUND`);
console.log(`structure-invalidated plays: ${plays.length}\n`);

const OFFSETS = [-5, -2, -1, 0, 1, 2, 5];
const rows = [];
for (const p of plays) {
  const bars = await pull(p.option_symbol, p.trading_day);
  if (!bars || !bars.length) { console.error(`  SKIP ${p.play_id} ${p.option_symbol} — no path`); continue; }
  // Two cache schemas coexist: UW pulls give {start_time, close, ...}; the
  // 07-09/07-10 files were written by an earlier script as {ts, close}.
  // Handle both, or half the sample silently vanishes as n/a.
  const path_ = bars
    .map(c => ({
      ts: c.start_time != null ? Date.parse(c.start_time) : Number(c.ts),
      close: Number(c.close) || 0,
    }))
    .filter(c => Number.isFinite(c.ts) && c.close > 0)
    .sort((a, b) => a.ts - b.ts);
  if (path_.length < 3) { console.error(`  SKIP ${p.play_id} — thin path`); continue; }

  // nearest bar at/before a target ts (the mark we'd actually have seen)
  const markAt = ts => {
    let best = null;
    for (const c of path_) { if (c.ts <= ts) best = c; else break; }
    return best ? best.close : null;
  };
  const rec = { p, deltas: {}, marks: {} };
  for (const N of OFFSETS) {
    const m = markAt(p.close_ts_ms + N * 60000);
    rec.marks[N] = m;
    rec.deltas[N] = m == null ? null : (m - p.close_mark) / p.entry_mark;
  }
  rec.kind = p.close_reason.includes('opposing_pika') ? 'opposing_pika'
    : p.close_reason.includes('pin_forming') ? 'pin_forming' : 'other';
  rec.realized = (p.close_mark - p.entry_mark) / p.entry_mark;
  rows.push(rec);
}

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const med = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const p2 = x => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}` : '  n/a');
const boot = (v, B = 4000) => {
  const n = v.length, out = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += v[(Math.random() * n) | 0]; out.push(s / n); }
  out.sort((a, b) => a - b);
  return { lo: out[(0.025 * B) | 0], hi: out[(0.975 * B) | 0] };
};

console.log(`paths resolved: ${rows.length}/${plays.length}\n`);

// ---- per-play table ----
console.log('PER-PLAY (Δ in return points vs entry; Δ(-1)>0 = earlier exit was better)');
console.log('id'.padEnd(5) + 'day'.padEnd(12) + 'sym'.padEnd(22) + 'realiz'.padStart(8) + 'peak'.padStart(8) +
  OFFSETS.map(N => `T${N > 0 ? '+' : ''}${N === 0 ? ' 0' : N}`.padStart(8)).join('') + '  kind');
for (const r of rows) {
  console.log(String(r.p.play_id).padEnd(5) + r.p.trading_day.padEnd(12) + r.p.option_symbol.padEnd(22) +
    p2(r.realized).padStart(8) + p2(r.p.best_pct_gain).padStart(8) +
    OFFSETS.map(N => p2(r.deltas[N]).padStart(8)).join('') + '  ' + r.kind);
}

// ---- aggregate ----
function agg(label, sub) {
  if (!sub.length) return;
  console.log(`\n${label}  (n=${sub.length})`);
  console.log('  offset'.padEnd(10) + 'mean Δ'.padStart(9) + 'med Δ'.padStart(9) + '  boot95'.padEnd(20) + 'better%'.padStart(9));
  for (const N of OFFSETS) {
    const v = sub.map(r => r.deltas[N]).filter(x => x != null);
    if (!v.length) continue;
    const b = boot(v);
    const betterPct = v.filter(x => x > 0).length / v.length * 100;
    const tag = N < 0 ? '(earlier)' : N > 0 ? '(later)' : '(actual)';
    console.log(`  T${N > 0 ? '+' : ''}${N} ${tag}`.padEnd(10) + p2(mean(v)).padStart(9) + p2(med(v)).padStart(9) +
      `  [${p2(b.lo)},${p2(b.hi)}]`.padEnd(20) + `${betterPct.toFixed(0)}%`.padStart(9));
  }
}
agg('ALL structure exits', rows);
agg('cohort: opposing_pika', rows.filter(r => r.kind === 'opposing_pika'));
agg('cohort: pin_forming', rows.filter(r => r.kind === 'pin_forming'));
agg('cohort: LOSERS at exit (realized < 0)', rows.filter(r => r.realized < 0));
agg('cohort: WINNERS at exit (realized >= 0)', rows.filter(r => r.realized >= 0));
agg('cohort: NEVER GREEN (peak gain <= 0)', rows.filter(r => r.p.best_pct_gain <= 0));

// ---- THE BOUND ----
const d1 = rows.map(r => r.deltas[-1]).filter(x => x != null);
const b1 = boot(d1);
console.log(`\n${'='.repeat(88)}`);
console.log(`THE BOUND — maximum value of infinitely-fast (sub-60s) surface polling`);
console.log(`${'='.repeat(88)}`);
console.log(`  Δ(-1)  mean = ${p2(mean(d1))} return points  boot95 [${p2(b1.lo)}, ${p2(b1.hi)}]  (n=${d1.length})`);
console.log(`  Expected realistic gain ~= 0.5 * Δ(-1) = ${p2(mean(d1) / 2)} return points`);
console.log(`  Round-trip fill haircut assumed                = 2.00 - 3.00 return points`);
const verdict = mean(d1) <= 0 ? 'NULL — earlier exit is NOT better on average. Finer polling cannot help.'
  : mean(d1) / 2 < 0.02 ? 'NULL — upper bound is SMALLER than the fill haircut it would cost.'
  : 'POSITIVE — bound exceeds fill cost; worth costing out.';
console.log(`  VERDICT: ${verdict}`);
console.log(`\n  Reminder: Δ(-2)/Δ(-5) are NOT achievable by faster polling — the condition`);
console.log(`  did not exist yet. They only tell us whether the SIGNAL should lead.`);
