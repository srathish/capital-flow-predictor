/**
 * Reader for trinity-format replay JSON files captured by gex-data-replay-reader.
 *
 * File shape:
 *   {
 *     metadata: {...},
 *     frames: [
 *       { timestamp: "2026-03-21T13:30:00.000Z",
 *         tickers: {
 *           SPXW: { spotPrice, expirations[], gammaValues[][], strikes[], ... },
 *           SPY:  { ... },
 *           QQQ:  { ... }
 *         }
 *       }, ...
 *     ]
 *   }
 *
 * GammaValues is 2D (rows=strikes, cols=expirations). Per spec §0.6 (0DTE only),
 * we consume column 0 = earliest expiration.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { DateTime } from 'luxon';

export const DEFAULT_REPLAY_DIR = '/Users/saiyeeshrathish/gex-data-replay-reader/data';
const TICKERS = ['SPXW', 'SPY', 'QQQ'];

export function replayPathFor(date, dir = DEFAULT_REPLAY_DIR) {
  return join(dir, `gex-replay-${date}.json`);
}

export function loadDay(date, dir = DEFAULT_REPLAY_DIR) {
  const path = replayPathFor(date, dir);
  if (!existsSync(path)) throw new Error(`replay file not found: ${path}`);
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  if (!Array.isArray(raw.frames)) throw new Error(`malformed replay file (no frames): ${path}`);
  return raw;
}

/**
 * Convert one frame's per-ticker payload into the snapshot shape that processSnapshot expects.
 *  spec: { ticker, fetchedAtMs, spot, expiration, strikes:[{strike,gamma},...], apiVelocity:null }
 */
export function frameToSnapshots(frame) {
  const tsMs = Date.parse(frame.timestamp);
  const tradingDay = DateTime.fromMillis(tsMs).setZone('America/New_York').toFormat('yyyy-MM-dd');
  const out = [];

  for (const ticker of TICKERS) {
    const t = frame.tickers?.[ticker];
    if (!t) continue;
    const strikes = t.strikes || [];
    const gammaRows = t.gammaValues || [];

    const nodes = [];
    for (let i = 0; i < gammaRows.length; i++) {
      const row = gammaRows[i];
      const gamma = (row && row[0]) || 0; // 0DTE column
      const strike = strikes[i];
      if (strike == null) continue;
      nodes.push({ strike, gamma });
    }

    out.push({
      ticker,
      tradingDay,
      snap: {
        ticker,
        fetchedAtMs: tsMs,
        spot: t.spotPrice,
        expiration: (t.expirations || [])[0] || null,
        strikes: nodes,
        apiVelocity: null,
      },
    });
  }
  return out;
}

export function listAvailableDates(dir = DEFAULT_REPLAY_DIR) {
  const fs = require('fs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /^gex-replay-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map(f => f.match(/(\d{4}-\d{2}-\d{2})/)[1])
    .sort();
}
