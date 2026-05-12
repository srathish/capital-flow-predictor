#!/usr/bin/env node
/**
 * Read the latest trinity_evaluations row from the live SQLite store and
 * print it as JSON. Bridge for the_final_plan agents (option 3).
 *
 * If the live poller hasn't written anything (or the row is older than
 * --max-age-min minutes, default 30), prints {} so callers can skip cleanly.
 *
 * Usage:
 *   node scripts/trinity-latest.js
 *   node scripts/trinity-latest.js --max-age-min=60
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import { resolve, join } from 'path';
import { existsSync } from 'fs';

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}
const maxAgeMin = parseInt(args['max-age-min'] || '30', 10);

const dataDir = resolve(process.env.DATA_DIR || './data');
const dbPath = join(dataDir, 'gexester.db');

if (!existsSync(dbPath)) {
  process.stdout.write('{}\n');
  process.exit(0);
}

try {
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare(`
    SELECT ts_ms, trading_day, triggering_ticker, classification, direction,
           bias_spx, bias_spy, bias_qqq, avg_bias, spread, flags, whipsaw_detected
    FROM trinity_evaluations
    ORDER BY ts_ms DESC
    LIMIT 1
  `).get();
  db.close();

  if (!row) {
    process.stdout.write('{}\n');
    process.exit(0);
  }

  const ageMin = (Date.now() - row.ts_ms) / 60000;
  if (ageMin > maxAgeMin) {
    process.stdout.write(JSON.stringify({ stale: true, age_minutes: ageMin }) + '\n');
    process.exit(0);
  }

  let flagList = [];
  try { flagList = row.flags ? JSON.parse(row.flags) : []; } catch { /* keep empty */ }

  process.stdout.write(JSON.stringify({
    ts_ms: row.ts_ms,
    trading_day: row.trading_day,
    triggering_ticker: row.triggering_ticker,
    classification: row.classification,
    direction: row.direction,
    bias_spx: row.bias_spx,
    bias_spy: row.bias_spy,
    bias_qqq: row.bias_qqq,
    avg_bias: row.avg_bias,
    spread: row.spread,
    flags: flagList,
    whipsaw_detected: row.whipsaw_detected === 1,
    age_minutes: ageMin,
  }) + '\n');
  process.exit(0);
} catch (err) {
  console.error(`trinity-latest failed: ${err.message}`);
  process.stdout.write('{}\n');
  process.exit(1);
}
