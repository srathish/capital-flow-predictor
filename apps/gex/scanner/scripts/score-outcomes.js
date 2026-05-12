#!/usr/bin/env node
/**
 * Score outcomes — for each pick on a prediction date, fetch spot at +1mo and +3mo
 * (or any horizons given), persist outcomes, and print a performance table.
 *
 * Spot is sourced from Heatseeker's /api/data endpoint (CurrentSpot field).
 *
 * Usage:
 *   node scanner/scripts/score-outcomes.js --date=2026-02-06 [--horizons=30,90]
 */

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';
import { initAuth, getFreshToken } from '../../src/heatseeker/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'scanner.db');

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}
if (!args.date) { console.error('Usage: --date=YYYY-MM-DD [--horizons=30,90]'); process.exit(1); }

const HORIZONS = (args.horizons || '30,90').split(',').map(n => parseInt(n, 10));

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T17:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  // If lands on weekend, roll to Monday
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

async function fetchSpot(symbol, timestampISO, token) {
  const url = `https://app.skylit.ai/api/data?symbol=${encodeURIComponent(symbol)}&max_strikes=20&max_expirations=1&timestamp=${timestampISO}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 100)}`);
  }
  const j = await r.json();
  return j.CurrentSpot;
}

async function main() {
  if (!initAuth()) { console.error('Auth not configured'); process.exit(1); }
  const token = await getFreshToken();

  const db = new Database(DB_PATH);
  const picks = db.prepare('SELECT * FROM picks WHERE pick_date = ? ORDER BY rank ASC').all(args.date);
  if (picks.length === 0) { console.error(`No picks for ${args.date}`); process.exit(1); }
  console.log(`Loaded ${picks.length} picks for ${args.date}, horizons=${HORIZONS.join(',')}\n`);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO outcomes (pick_date, ticker, horizon_days, check_date, spot_at_pick, spot_at_check, move_bps)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const results = [];
  for (const p of picks) {
    const row = { ticker: p.ticker, rank: p.rank, score: p.score, spotAtPick: p.spot, moves: {} };
    for (const h of HORIZONS) {
      const checkTs = addDays(args.date, h);
      const checkDate = checkTs.slice(0, 10);
      try {
        const spotAt = await fetchSpot(p.ticker, checkTs, token);
        if (spotAt == null) throw new Error('no spot');
        const moveBps = (spotAt - p.spot) / p.spot * 10000;
        row.moves[h] = { checkDate, spot: spotAt, bps: moveBps };
        insert.run(args.date, p.ticker, h, checkDate, p.spot, spotAt, moveBps);
      } catch (e) {
        row.moves[h] = { checkDate, error: e.message };
      }
      await new Promise(r => setTimeout(r, 250));
    }
    results.push(row);
    process.stdout.write('.');
  }
  console.log('\n');

  console.log(`━━━ OUTCOMES — picks from ${args.date} ━━━\n`);
  const header = `Rank Ticker   Entry      ` + HORIZONS.map(h => `+${h}d Date     Spot       $ Move    `).join('') + ' Verdict';
  console.log(header);
  console.log('-'.repeat(header.length));

  // 1% of entry price = "WIN" / -1% = "LOSS" — dollar threshold scales with stock price
  let nWin = 0, nLoss = 0, totalDollar = { 30: 0, 90: 0 };
  let nValid = { 30: 0, 90: 0 };
  for (const r of results) {
    let line = `#${r.rank.toString().padEnd(3)} ${r.ticker.padEnd(7)} $${r.spotAtPick?.toFixed(2).padStart(8)}  `;
    let verdict = '';
    for (const h of HORIZONS) {
      const m = r.moves[h];
      if (m.error) {
        line += `${m.checkDate}    ERR(${m.error.slice(0,15)})              `;
      } else {
        const dollar = m.spot - r.spotAtPick;
        const sign = dollar >= 0 ? '+' : '';
        line += `${m.checkDate}  $${m.spot.toFixed(2).padStart(8)}  ${sign}$${dollar.toFixed(2).padStart(7)}   `;
        totalDollar[h] += dollar;
        nValid[h]++;
        if (h === 90) {
          // Threshold = 1% of entry price (so AAPL needs $2.79+ to count as a win, NIO needs $0.05)
          const threshold = r.spotAtPick * 0.01;
          if (dollar > threshold) { verdict = '🟢 WIN'; nWin++; }
          else if (dollar < -threshold) { verdict = '🔴 LOSS'; nLoss++; }
          else { verdict = '⚪ flat'; }
        }
      }
    }
    line += ' ' + verdict;
    console.log(line);
  }

  console.log('-'.repeat(header.length));
  console.log(`Avg $ move +30d: ${nValid[30] ? '$' + (totalDollar[30]/nValid[30]).toFixed(2) : '—'}  (n=${nValid[30]})`);
  console.log(`Avg $ move +90d: ${nValid[90] ? '$' + (totalDollar[90]/nValid[90]).toFixed(2) : '—'}  (n=${nValid[90]})`);
  console.log(`Wins (>+1% of entry): ${nWin}   Losses (<-1% of entry): ${nLoss}   Flat: ${results.length - nWin - nLoss}`);

  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
