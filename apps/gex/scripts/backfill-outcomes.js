#!/usr/bin/env node
/**
 * Backfill forward-price-change outcomes for every decision in decision_log.
 *
 * For each row, look up the spot for that ticker at +5m / +15m / +30m / +60m
 * and compute the directional return:
 *   calls: (future - entry) / entry
 *   puts:  (entry - future) / entry
 *
 * Returns are stored in a new outcomes table so calibration can ask:
 *   - Of accepted trades, what fraction had positive forward return at +N?
 *   - Of REJECTED trades, would those have been winners if we'd let them through?
 *
 * This is a proxy for real PnL — assumes flat-to-flat hold. Real options trades
 * have theta, delta, slippage. But for relative threshold tuning, direction is
 * the right signal: if we lower a gate and the new admits still lose, the gate
 * was right. If the new admits win, the gate was too tight.
 *
 * Usage:
 *   npm run backfill-outcomes
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { config } from '../src/utils/config.js';

const dbPath = join(config.dataDir, 'gexester.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// One-shot table — drop and recompute.
db.exec(`
  DROP TABLE IF EXISTS decision_outcomes;
  CREATE TABLE decision_outcomes (
    decision_id INTEGER PRIMARY KEY,
    ts_ms INTEGER NOT NULL,
    trading_day TEXT NOT NULL,
    ticker TEXT NOT NULL,
    direction TEXT,
    entry_spot REAL NOT NULL,
    spot_5m REAL, ret_5m REAL,
    spot_15m REAL, ret_15m REAL,
    spot_30m REAL, ret_30m REAL,
    spot_60m REAL, ret_60m REAL,
    end_of_session_spot REAL, ret_eod REAL
  );
  CREATE INDEX idx_outcomes_day_ticker ON decision_outcomes(trading_day, ticker);
`);

const decisions = db.prepare(`
  SELECT dl.decision_id, dl.ts_ms, dl.trading_day, dl.ticker, dl.direction, s.spot AS entry_spot
  FROM decision_log dl
  JOIN snapshots s ON s.trading_day = dl.trading_day AND s.ticker = dl.ticker AND s.ts_ms = dl.ts_ms
  WHERE dl.direction IS NOT NULL
`).all();

console.log(`Backfilling outcomes for ${decisions.length.toLocaleString()} directional decisions…`);

const spotAt = db.prepare(`
  SELECT spot FROM snapshots
  WHERE ticker = ? AND trading_day = ? AND ts_ms >= ?
  ORDER BY ts_ms ASC LIMIT 1
`);
const eodSpot = db.prepare(`
  SELECT spot FROM snapshots
  WHERE ticker = ? AND trading_day = ?
  ORDER BY ts_ms DESC LIMIT 1
`);
const insert = db.prepare(`
  INSERT INTO decision_outcomes
    (decision_id, ts_ms, trading_day, ticker, direction, entry_spot,
     spot_5m, ret_5m, spot_15m, ret_15m, spot_30m, ret_30m, spot_60m, ret_60m,
     end_of_session_spot, ret_eod)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertAll = db.transaction((rows) => {
  for (const row of rows) {
    insert.run(...row);
  }
});

const MIN = 60_000;
const HORIZONS = [5, 15, 30, 60];
const batch = [];

for (const d of decisions) {
  if (d.entry_spot == null) continue;
  const dirSign = d.direction === 'calls' ? +1 : d.direction === 'puts' ? -1 : null;
  if (dirSign == null) continue;

  const horizonSpots = {};
  for (const h of HORIZONS) {
    const r = spotAt.get(d.ticker, d.trading_day, d.ts_ms + h * MIN);
    horizonSpots[h] = r?.spot ?? null;
  }
  const eod = eodSpot.get(d.ticker, d.trading_day)?.spot ?? null;

  const ret = (future) => future == null ? null : dirSign * (future - d.entry_spot) / d.entry_spot;

  batch.push([
    d.decision_id, d.ts_ms, d.trading_day, d.ticker, d.direction, d.entry_spot,
    horizonSpots[5], ret(horizonSpots[5]),
    horizonSpots[15], ret(horizonSpots[15]),
    horizonSpots[30], ret(horizonSpots[30]),
    horizonSpots[60], ret(horizonSpots[60]),
    eod, ret(eod),
  ]);

  if (batch.length >= 5_000) {
    insertAll(batch.splice(0));
  }
}
if (batch.length) insertAll(batch);

const total = db.prepare('SELECT COUNT(*) c FROM decision_outcomes').get().c;
console.log(`Wrote ${total.toLocaleString()} outcome rows.`);

// Sanity check — quick win-rate on accepts
const acceptStats = db.prepare(`
  SELECT
    COUNT(*) n,
    SUM(CASE WHEN ret_15m > 0 THEN 1 ELSE 0 END) winners_15m,
    SUM(CASE WHEN ret_30m > 0 THEN 1 ELSE 0 END) winners_30m,
    SUM(CASE WHEN ret_60m > 0 THEN 1 ELSE 0 END) winners_60m,
    ROUND(AVG(ret_15m) * 10000, 1) avg_bps_15m,
    ROUND(AVG(ret_30m) * 10000, 1) avg_bps_30m,
    ROUND(AVG(ret_60m) * 10000, 1) avg_bps_60m
  FROM decision_outcomes do
  JOIN decision_log dl USING (decision_id)
  WHERE dl.decision = 'would_enter'
`).get();
console.log('Accepted trades — direction-correctness vs forward spot:');
console.log(`  n=${acceptStats.n}`);
console.log(`  +15m: ${acceptStats.winners_15m}/${acceptStats.n} winners | avg ${acceptStats.avg_bps_15m} bps`);
console.log(`  +30m: ${acceptStats.winners_30m}/${acceptStats.n} winners | avg ${acceptStats.avg_bps_30m} bps`);
console.log(`  +60m: ${acceptStats.winners_60m}/${acceptStats.n} winners | avg ${acceptStats.avg_bps_60m} bps`);

db.close();
