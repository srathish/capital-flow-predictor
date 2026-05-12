#!/usr/bin/env node
/**
 * Filter discovery for gatekeeper breaks.
 *
 * Testing two structural hypotheses:
 *   H1 — small gatekeeper breaks continue more often than thick ones.
 *   H2 — gatekeeper breaks with a MAJOR node within reach (target) continue more often
 *        than breaks into open air.
 *
 * For each of the 732 gatekeeper-break impulses:
 *   - find the broken node's rel_sig (largest node crossed)
 *   - find any major node (rel_sig ≥ 5%) within ±50 bps in the direction of the move (target)
 *   - check forward 30-min continuation
 *
 * Output: continuation rate by gatekeeper size bucket, by target-presence,
 * and the combined matrix.
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { config } from '../src/utils/config.js';

const dbPath = join(config.dataDir, 'gexester.db');
const db = new Database(dbPath, { readonly: true });

const pad = (s, w) => String(s).padEnd(w);
const fmt = (n, d=1) => n == null ? '—' : Number(n).toFixed(d);
function header(t) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  ${t}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

// Step 1 — pull all impulses (5-min ≥30bps moves)
const impulses = db.prepare(`
  WITH ordered AS (
    SELECT trading_day, ticker, ts_ms, spot,
      LAG(spot, 5) OVER (PARTITION BY trading_day, ticker ORDER BY ts_ms) prev5_spot
    FROM snapshots
  )
  SELECT trading_day, ticker, ts_ms, spot, prev5_spot,
    (spot - prev5_spot) AS delta,
    CASE WHEN spot > prev5_spot THEN 'up' ELSE 'down' END AS direction
  FROM ordered
  WHERE prev5_spot IS NOT NULL
    AND ABS((spot - prev5_spot) / prev5_spot) >= 0.0030
`).all();

// Per-impulse helpers
const broken = db.prepare(`
  SELECT MAX(relative_significance) AS max_sig, COUNT(*) AS n
  FROM node_snapshots
  WHERE ticker = ? AND trading_day = ? AND ts_ms = ?
    AND relative_significance >= 0.03
    AND strike >= ? AND strike <= ?
`);

const targetUp = db.prepare(`
  SELECT MIN(strike) AS strike, MAX(relative_significance) AS sig
  FROM node_snapshots
  WHERE ticker = ? AND trading_day = ? AND ts_ms = ?
    AND relative_significance >= 0.05
    AND strike > ? AND strike <= ? * 1.005
`);

const targetDown = db.prepare(`
  SELECT MAX(strike) AS strike, MAX(relative_significance) AS sig
  FROM node_snapshots
  WHERE ticker = ? AND trading_day = ? AND ts_ms = ?
    AND relative_significance >= 0.05
    AND strike < ? AND strike >= ? * 0.995
`);

const continuation = db.prepare(`
  SELECT spot AS spot_30m FROM snapshots
  WHERE ticker = ? AND trading_day = ? AND ts_ms >= ? + 30*60*1000
  ORDER BY ts_ms ASC LIMIT 1
`);

// ── Classify each impulse ────────────────────────────────────────────────────
const enriched = [];
for (const imp of impulses) {
  const lo = Math.min(imp.spot, imp.prev5_spot);
  const hi = Math.max(imp.spot, imp.prev5_spot);
  const b = broken.get(imp.ticker, imp.trading_day, imp.ts_ms, lo, hi);
  if (!b || !b.max_sig) continue; // pure_trend, skip

  const tgt = imp.direction === 'up'
    ? targetUp.get(imp.ticker, imp.trading_day, imp.ts_ms, imp.spot, imp.spot)
    : targetDown.get(imp.ticker, imp.trading_day, imp.ts_ms, imp.spot, imp.spot);

  const has_target = tgt && tgt.strike != null;
  const target_dist_bps = has_target
    ? Math.abs(tgt.strike - imp.spot) / imp.spot * 10000
    : null;

  const fwd = continuation.get(imp.ticker, imp.trading_day, imp.ts_ms);
  const continued = fwd && (
    (imp.direction === 'up' && fwd.spot_30m > imp.spot) ||
    (imp.direction === 'down' && fwd.spot_30m < imp.spot)
  );
  const ret_30m_bps = fwd
    ? (imp.direction === 'up' ? 1 : -1) * (fwd.spot_30m - imp.spot) / imp.spot * 10000
    : null;

  enriched.push({
    ticker: imp.ticker, day: imp.trading_day, direction: imp.direction,
    broken_sig: b.max_sig,
    broken_count: b.n,
    has_target,
    target_sig: tgt?.sig ?? null,
    target_dist_bps,
    continued: !!continued,
    ret_30m_bps,
  });
}

console.log(`  enriched ${enriched.length} gatekeeper-break events`);

// ── H1: gatekeeper size bucket → continuation rate ────────────────────────────
header('H1: continuation rate by gatekeeper size (broken-node max rel_sig)');
{
  const buckets = [
    { name: 'thin   (3-5%)',  test: e => e.broken_sig >= 0.03 && e.broken_sig < 0.05 },
    { name: 'medium (5-7%)',  test: e => e.broken_sig >= 0.05 && e.broken_sig < 0.07 },
    { name: 'thick  (7-10%)', test: e => e.broken_sig >= 0.07 && e.broken_sig < 0.10 },
    { name: 'huge   (10%+)', test: e => e.broken_sig >= 0.10 },
  ];
  console.log('  bucket          | n    | continued | win_pct | avg_bps');
  console.log('  ────────────────┼──────┼───────────┼─────────┼────────');
  for (const b of buckets) {
    const subset = enriched.filter(b.test);
    const cont = subset.filter(e => e.continued).length;
    const avgBps = subset.length ? subset.reduce((s, e) => s + (e.ret_30m_bps || 0), 0) / subset.length : 0;
    const pct = subset.length ? (cont / subset.length * 100).toFixed(1) : '—';
    console.log(`  ${pad(b.name,15)} | ${pad(subset.length,4)} | ${pad(cont,9)} | ${pad(pct + '%',7)} | ${fmt(avgBps,1)}`);
  }
}

// ── H2: target presence → continuation rate ────────────────────────────────
header('H2: continuation rate by target-beyond presence');
{
  const cases = [
    { name: 'has_target (≥5% rel_sig within 50bps in direction)', test: e => e.has_target },
    { name: 'no_target',                                          test: e => !e.has_target },
  ];
  console.log('  case                                                     | n    | continued | win_pct | avg_bps');
  console.log('  ─────────────────────────────────────────────────────────┼──────┼───────────┼─────────┼────────');
  for (const c of cases) {
    const subset = enriched.filter(c.test);
    const cont = subset.filter(e => e.continued).length;
    const avgBps = subset.length ? subset.reduce((s, e) => s + (e.ret_30m_bps || 0), 0) / subset.length : 0;
    const pct = subset.length ? (cont / subset.length * 100).toFixed(1) : '—';
    console.log(`  ${pad(c.name,56)} | ${pad(subset.length,4)} | ${pad(cont,9)} | ${pad(pct + '%',7)} | ${fmt(avgBps,1)}`);
  }
}

// ── H3: combined matrix — gatekeeper size × target presence ──────────────────
header('H3: combined matrix — gatekeeper size × target presence');
{
  const sizeBuckets = [
    ['thin',   e => e.broken_sig < 0.05],
    ['medium', e => e.broken_sig >= 0.05 && e.broken_sig < 0.07],
    ['thick',  e => e.broken_sig >= 0.07],
  ];
  const targetCases = [
    ['has_target', e => e.has_target],
    ['no_target',  e => !e.has_target],
  ];
  console.log('  size    × target     | n    | win_pct | avg_bps | best filter?');
  console.log('  ─────────────────────┼──────┼─────────┼─────────┼─────────────');
  for (const [sname, sfn] of sizeBuckets) {
    for (const [tname, tfn] of targetCases) {
      const subset = enriched.filter(e => sfn(e) && tfn(e));
      if (subset.length === 0) {
        console.log(`  ${pad(sname,7)} × ${pad(tname,11)} | ${pad(0,4)} | (no events)`);
        continue;
      }
      const cont = subset.filter(e => e.continued).length;
      const avgBps = subset.reduce((s, e) => s + (e.ret_30m_bps || 0), 0) / subset.length;
      const pct = (cont / subset.length * 100).toFixed(1);
      const isBest = (cont/subset.length) >= 0.55 && subset.length >= 30 ? '★' : '';
      console.log(`  ${pad(sname,7)} × ${pad(tname,11)} | ${pad(subset.length,4)} | ${pad(pct + '%',7)} | ${pad(fmt(avgBps,1),7)} | ${isBest}`);
    }
  }
}

// ── H4: target distance — closer target = better? ──────────────────────────────
header('H4: continuation rate by target distance (only when has_target)');
{
  const buckets = [
    { name: 'very close (<25 bps)',  test: e => e.has_target && e.target_dist_bps < 25 },
    { name: 'close      (25-50 bps)',test: e => e.has_target && e.target_dist_bps >= 25 && e.target_dist_bps < 50 },
    { name: 'far        (50+ bps)',  test: e => e.has_target && e.target_dist_bps >= 50 },
  ];
  console.log('  bucket                 | n    | continued | win_pct | avg_bps');
  console.log('  ───────────────────────┼──────┼───────────┼─────────┼────────');
  for (const b of buckets) {
    const subset = enriched.filter(b.test);
    const cont = subset.filter(e => e.continued).length;
    const avgBps = subset.length ? subset.reduce((s, e) => s + (e.ret_30m_bps || 0), 0) / subset.length : 0;
    const pct = subset.length ? (cont / subset.length * 100).toFixed(1) : '—';
    console.log(`  ${pad(b.name,22)} | ${pad(subset.length,4)} | ${pad(cont,9)} | ${pad(pct + '%',7)} | ${fmt(avgBps,1)}`);
  }
}

console.log();
db.close();
