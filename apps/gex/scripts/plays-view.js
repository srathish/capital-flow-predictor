/**
 * plays-view — quick CLI look at today's tracked plays without needing the
 * web UI or the API service. Reads directly from the local SQLite that the
 * standalone plays-tracker writes.
 *
 * Usage:
 *   node scripts/plays-view.js                  # today's plays, all tickers
 *   node scripts/plays-view.js --ticker=SPXW
 *   node scripts/plays-view.js --date=2026-07-08
 *   node scripts/plays-view.js --live           # only status='live'
 *   node scripts/plays-view.js --data=~/Data    # non-default SQLite dir
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, closeDb } from '../src/store/db.js';
import { getLivePlays, getTodaysPlays } from '../src/tracker/plays.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs() {
  const args = { ticker: null, date: null, live: false, dataDir: null };
  for (const a of process.argv.slice(2)) {
    if (a === '--live') args.live = true;
    else if (a.startsWith('--ticker=')) args.ticker = a.slice(9).toUpperCase();
    else if (a.startsWith('--date=')) args.date = a.slice(7);
    else if (a.startsWith('--data=')) args.dataDir = a.slice(7);
  }
  return args;
}

function fmtRow(r) {
  const t = new Date(r.fire_ts_ms).toLocaleTimeString('en-US', { hour12: false });
  const optStr = `${r.option_type === 'put' ? 'PUT' : 'CALL'} $${r.strike}`;
  const bestPct = r.best_pct_gain != null ? `${(r.best_pct_gain * 100).toFixed(0)}%` : '—';
  const curStr = r.current_mark != null ? `$${r.current_mark.toFixed(2)}` : '—';
  const bestStr = r.best_mark != null ? `$${r.best_mark.toFixed(2)}` : '—';
  const status = r.status === 'live'
    ? 'LIVE'
    : r.status.replace('closed_', 'CLOSED_').toUpperCase();
  return {
    t,
    ticker: r.ticker,
    state: r.state,
    optStr,
    exp: r.expiration.slice(5),
    entry: `$${r.entry_mark.toFixed(2)}`,
    now: curStr,
    best: bestStr,
    bestPct,
    status,
  };
}

function main() {
  const args = parseArgs();
  if (args.dataDir) {
    process.env.DATA_DIR = args.dataDir.replace(/^~/, process.env.HOME || '~');
  }

  const db = openDb();
  const rows = args.live
    ? getLivePlays({ db, ticker: args.ticker })
    : getTodaysPlays({ db, tradingDay: args.date || new Date().toISOString().slice(0, 10) })
        .filter(r => !args.ticker || r.ticker === args.ticker);

  if (rows.length === 0) {
    console.log('  (no plays match)');
    closeDb();
    return;
  }

  const fmt = rows.map(fmtRow);
  const header = [
    'time', 'ticker', 'state', 'contract', 'exp', 'entry', 'now', 'best', 'gain', 'status',
  ];
  const widths = header.map((h, i) => {
    const key = header[i];
    const maxCell = Math.max(...fmt.map(r => String(r[cellKey(key)] ?? '').length));
    return Math.max(h.length, maxCell);
  });

  console.log(`\n  Plays — ${rows.length} row${rows.length === 1 ? '' : 's'}\n`);
  console.log('  ' + header.map((h, i) => h.padEnd(widths[i])).join('  '));
  console.log('  ' + widths.map(w => '─'.repeat(w)).join('  '));
  for (const r of fmt) {
    const cells = [
      r.t, r.ticker, r.state, r.optStr, r.exp, r.entry, r.now, r.best, r.bestPct, r.status,
    ];
    console.log('  ' + cells.map((c, i) => String(c).padEnd(widths[i])).join('  '));
  }
  console.log('');
  closeDb();
}

function cellKey(header) {
  const map = {
    time: 't', ticker: 'ticker', state: 'state', contract: 'optStr', exp: 'exp',
    entry: 'entry', now: 'now', best: 'best', gain: 'bestPct', status: 'status',
  };
  return map[header];
}

main();
