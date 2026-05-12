#!/usr/bin/env node
/**
 * Scanner — bullish-hedging Top 5 picker.
 *
 * For a given prediction date, fetches GEX data at noon ET for every non-index/non-ETF
 * Heatseeker symbol, picks the closest non-OpEx expiration to 30D and 90D, computes
 * a composite bullish-hedging score, and ranks the top 5.
 *
 * Score interpretation (rough range -150 to +150):
 *   + barney (negative gamma) ABOVE spot → magnet pulling price up (bullish)
 *   + pika   (positive gamma) BELOW spot → floor support (bullish)
 *   - barney (negative gamma) BELOW spot → magnet pulling price down (bearish)
 *   - pika   (positive gamma) ABOVE spot → ceiling resistance (bearish)
 *
 * Output:
 *   - SQLite scanner/data/scanner.db: picks(date, ticker, rank, score, components_json, exp_30d, exp_90d, spot)
 *   - Console summary
 *
 * Usage:
 *   node scanner/scripts/scan-day.js --date=2026-02-06
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';
import { initAuth, getFreshToken } from '../../src/heatseeker/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCANNER_DIR = join(__dirname, '..');
const SYMBOLS_PATH = join(SCANNER_DIR, 'data', 'symbols.json');
const DB_PATH = join(SCANNER_DIR, 'data', 'scanner.db');

// Parse CLI args
const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}
if (!args.date) {
  console.error('Usage: --date=YYYY-MM-DD');
  process.exit(1);
}

// ETF/index filter — anything matching this regex is excluded from the universe
const ETF_REGEX = /^(SPXW|VIX|SPY|QQQ|IWM|DIA|IVV|VOO|VTI|VTV|VUG|XL[A-Z]|XBI|GDX|GDXJ|TLT|HYG|LQD|EEM|EFA|FXI|VWO|TQQQ|SQQQ|UVXY|VIXY|UPRO|SPXU|SPXL|TZA|TNA|FAS|FAZ|ARKK|ARKQ|ARKW|ARKG|ARKF|SMH|SOXX|SOXL|XOP|USO|UNG|GLD|SLV|DBA|DBC|TBT|TBF|ETHA|IBIT|KRE|KWEB|EWY|IGV|SDY|CLOU)$/;

// Monthly OpEx detection — 3rd Friday of any month
function isThirdFriday(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (d.getUTCDay() !== 5) return false; // not Friday
  return d.getUTCDate() >= 15 && d.getUTCDate() <= 21;
}

// Pick the expiration closest to (predictionDate + targetDaysOut).
// 30D pick: skip OpEx 3rd Fridays (front-month is hedge-flow dominated).
// 90D pick: ALLOW OpEx — longer-dated monthlies are where directional positioning lives,
//   and after OpEx-filtering, weeklies don't extend past ~60 days for most stocks.
// Also enforces 90D pick must be at least 21 days after 30D pick (no collapse to same date).
function pickExpiration(expirations, predictionDate, targetDaysOut, opts = {}) {
  const target = new Date(`${predictionDate}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() + targetDaysOut);
  const targetMs = target.getTime();
  const skipOpEx = opts.skipOpEx ?? false;
  const minDateMs = opts.minDateMs ?? 0;
  const candidates = expirations
    .filter(e => !skipOpEx || !isThirdFriday(e))
    .filter(e => new Date(`${e}T00:00:00Z`).getTime() >= minDateMs)
    .map(e => ({ exp: e, dist: Math.abs(new Date(`${e}T00:00:00Z`).getTime() - targetMs) }))
    .sort((a, b) => a.dist - b.dist);
  return candidates[0]?.exp ?? null;
}

// Compute bullish-hedging score for a single expiration column
function scoreExpiration(strikes, gammaColumn, spot) {
  let totalAbs = 0;
  let barneyAbove = 0, barneyBelow = 0; // largest |negative| gamma above/below spot
  let barneyAboveStrike = null, barneyBelowStrike = null;
  let pikaAbove = 0, pikaBelow = 0;     // largest positive gamma above/below spot
  let pikaAboveStrike = null, pikaBelowStrike = null;
  let netAbove = 0, netBelow = 0;       // signed sums
  let posAboveCount = 0, negAboveCount = 0, posBelowCount = 0, negBelowCount = 0;

  for (let i = 0; i < strikes.length; i++) {
    const s = strikes[i];
    const g = gammaColumn[i];
    if (g == null || g === 0 || !isFinite(g)) continue;
    totalAbs += Math.abs(g);
    if (s > spot) {
      netAbove += g;
      if (g < 0) {
        if (Math.abs(g) > barneyAbove) { barneyAbove = Math.abs(g); barneyAboveStrike = s; }
        negAboveCount++;
      } else {
        if (g > pikaAbove) { pikaAbove = g; pikaAboveStrike = s; }
        posAboveCount++;
      }
    } else if (s < spot) {
      netBelow += g;
      if (g < 0) {
        if (Math.abs(g) > barneyBelow) { barneyBelow = Math.abs(g); barneyBelowStrike = s; }
        negBelowCount++;
      } else {
        if (g > pikaBelow) { pikaBelow = g; pikaBelowStrike = s; }
        posBelowCount++;
      }
    }
  }

  if (totalAbs === 0) return null;

  // Composite score
  const score =
      (barneyAbove / totalAbs * 100)   // barney pulling up = bullish
    + (pikaBelow   / totalAbs *  50)   // floor support    = bullish
    - (barneyBelow / totalAbs * 100)   // barney pulling down = bearish
    - (pikaAbove   / totalAbs *  50);  // ceiling resistance  = bearish

  return {
    score: Math.round(score * 100) / 100,
    barneyAbove: Math.round(barneyAbove),
    barneyAboveStrike,
    barneyBelow: Math.round(barneyBelow),
    barneyBelowStrike,
    pikaAbove: Math.round(pikaAbove),
    pikaAboveStrike,
    pikaBelow: Math.round(pikaBelow),
    pikaBelowStrike,
    netAbove: Math.round(netAbove),
    netBelow: Math.round(netBelow),
    totalAbs: Math.round(totalAbs),
  };
}

// Fetch GEX data for one symbol at the prediction timestamp
async function fetchGex(symbol, timestamp, token) {
  const url = `https://app.skylit.ai/api/data?symbol=${encodeURIComponent(symbol)}&max_strikes=92&max_expirations=25&timestamp=${timestamp}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: 'https://app.skylit.ai',
      Referer: 'https://app.skylit.ai/',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
  }
  return r.json();
}

// SQLite schema
function openDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS picks (
      pick_date    TEXT NOT NULL,
      ticker       TEXT NOT NULL,
      rank         INTEGER NOT NULL,
      score        REAL NOT NULL,
      score_30d    REAL,
      score_90d    REAL,
      spot         REAL NOT NULL,
      exp_30d      TEXT,
      exp_90d      TEXT,
      components_json TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (pick_date, ticker)
    );
    CREATE TABLE IF NOT EXISTS scan_results (
      pick_date    TEXT NOT NULL,
      ticker       TEXT NOT NULL,
      score        REAL NOT NULL,
      score_30d    REAL,
      score_90d    REAL,
      spot         REAL,
      exp_30d      TEXT,
      exp_90d      TEXT,
      components_json TEXT,
      PRIMARY KEY (pick_date, ticker)
    );
    CREATE TABLE IF NOT EXISTS outcomes (
      pick_date    TEXT NOT NULL,
      ticker       TEXT NOT NULL,
      horizon_days INTEGER NOT NULL,
      check_date   TEXT NOT NULL,
      spot_at_pick REAL,
      spot_at_check REAL,
      move_bps     REAL,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (pick_date, ticker, horizon_days)
    );
  `);
  return db;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`━━━ Scanner — ${args.date} ━━━`);

  if (!initAuth()) {
    console.error('Auth not configured. Set CLERK_* values in .env');
    process.exit(1);
  }
  const token = await getFreshToken();
  console.log(`Auth OK (token ${token.length} chars)`);

  // Load + filter symbols
  const sym = JSON.parse(readFileSync(SYMBOLS_PATH, 'utf-8'));
  const all = (sym.symbols || sym).map(s => s.name);
  const universe = all.filter(t => !ETF_REGEX.test(t));
  console.log(`Universe: ${universe.length} stocks (filtered ${all.length - universe.length} indexes/ETFs)`);

  const db = openDb();
  const insertScan = db.prepare(`
    INSERT OR REPLACE INTO scan_results (pick_date, ticker, score, score_30d, score_90d, spot, exp_30d, exp_90d, components_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const timestamp = new Date(`${args.date}T17:00:00Z`).toISOString();
  const results = [];
  let ok = 0, err = 0;

  for (let i = 0; i < universe.length; i++) {
    const ticker = universe[i];
    process.stdout.write(`\r  [${i+1}/${universe.length}] ${ticker.padEnd(6)}  OK:${ok} ERR:${err}   `);
    try {
      const j = await fetchGex(ticker, timestamp, token);
      const spot = j.CurrentSpot;
      const expirations = j.Expirations || [];
      const strikes = j.Strikes || [];
      const gamma2d = j.GammaValues || [];

      // Score every available expiration — full term structure
      const predDateMs = new Date(`${args.date}T00:00:00Z`).getTime();
      const surface = [];
      for (let ei = 0; ei < expirations.length; ei++) {
        const exp = expirations[ei];
        const dte = Math.max(1, Math.round((new Date(`${exp}T00:00:00Z`).getTime() - predDateMs) / (24 * 3600 * 1000)));
        const col = strikes.map((_, si) => gamma2d[si]?.[ei] ?? 0);
        const r = scoreExpiration(strikes, col, spot);
        if (!r) continue;
        surface.push({ exp, dte, ...r });
      }

      // Bucketed views
      const frontBucket = surface.filter(s => s.dte <= 14);     // weeklies — hedge flow
      const midBucket   = surface.filter(s => s.dte > 14 && s.dte <= 90);   // monthlies — directional
      const swingBucket = surface.filter(s => s.dte > 90 && s.dte <= 270);  // 3-9mo — institutional positioning
      const leapsBucket = surface.filter(s => s.dte > 270);     // LEAPS — long-term conviction

      // Bucket scores: weighted by total gamma volume within the bucket
      function bucketScore(bucket) {
        if (bucket.length === 0) return null;
        const totalVol = bucket.reduce((s, b) => s + b.totalAbs, 0);
        if (totalVol === 0) return null;
        const wScore = bucket.reduce((s, b) => s + b.score * b.totalAbs, 0) / totalVol;
        return { score: Math.round(wScore * 100) / 100, totalVol: Math.round(totalVol), n: bucket.length };
      }
      const front = bucketScore(frontBucket);
      const mid   = bucketScore(midBucket);
      const swing = bucketScore(swingBucket);
      const leaps = bucketScore(leapsBucket);

      // Composite — prioritize the directional zone (mid + swing + leaps) where
      // institutional positioning lives. Front-month hedge-flow gets minimal weight.
      // Weights: mid 30%, swing 30%, leaps 30%, front 10%.
      const buckets = [
        { score: mid?.score, weight: 0.30 },
        { score: swing?.score, weight: 0.30 },
        { score: leaps?.score, weight: 0.30 },
        { score: front?.score, weight: 0.10 },
      ].filter(b => b.score != null);
      const totalW = buckets.reduce((s, b) => s + b.weight, 0);
      const composite = totalW > 0 ? buckets.reduce((s, b) => s + b.score * (b.weight / totalW), 0) : 0;
      const compositeRounded = Math.round(composite * 100) / 100;

      // Pick a representative 30D + 90D for display (closest to those targets, ANY exp allowed)
      const exp30 = pickExpiration(expirations, args.date, 30, { skipOpEx: false });
      const exp90 = pickExpiration(expirations, args.date, 90, { skipOpEx: false });
      const score30 = surface.find(s => s.exp === exp30)?.score ?? null;
      const score90 = surface.find(s => s.exp === exp90)?.score ?? null;
      const exp30_components = surface.find(s => s.exp === exp30) ?? null;
      const exp90_components = surface.find(s => s.exp === exp90) ?? null;

      const components = {
        front, mid, swing, leaps,
        exp_30d: exp30_components,
        exp_90d: exp90_components,
        n_expirations: surface.length,
        total_gamma: Math.round(surface.reduce((s, b) => s + b.totalAbs, 0)),
      };

      insertScan.run(
        args.date, ticker, compositeRounded, score30, score90, spot,
        exp30, exp90, JSON.stringify(components)
      );
      results.push({ ticker, score: compositeRounded, score30, score90, spot, exp30, exp90, components });
      ok++;
    } catch (e) {
      err++;
      // Don't dump every error to console — keep progress line clean
    }
    // Small delay to avoid rate-limiting
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`\n\nScan complete: ${ok} OK, ${err} errors`);

  // Rank top 5
  results.sort((a, b) => b.score - a.score);
  const top5 = results.slice(0, 5);

  const insertPick = db.prepare(`
    INSERT OR REPLACE INTO picks (pick_date, ticker, rank, score, score_30d, score_90d, spot, exp_30d, exp_90d, components_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // Wipe prior picks for this date to handle re-runs
  db.prepare('DELETE FROM picks WHERE pick_date = ?').run(args.date);
  top5.forEach((r, i) => {
    insertPick.run(
      args.date, r.ticker, i + 1, r.score, r.score30, r.score90, r.spot,
      r.exp30, r.exp90, JSON.stringify(r.components)
    );
  });

  console.log(`\n━━━ TOP 5 BULLISH-HEDGING PICKS — ${args.date} ━━━`);
  console.log(`(bucketed by DTE: front=≤14d  mid=15-90d  swing=91-270d  leaps=>270d)\n`);
  top5.forEach((r, i) => {
    const { front, mid, swing, leaps, n_expirations, total_gamma } = r.components;
    console.log(`#${i+1}  ${r.ticker.padEnd(6)} score=${r.score.toFixed(2).padStart(7)}  spot=$${r.spot?.toFixed(2)}  exps=${n_expirations}  total_γ=${(total_gamma/1e6).toFixed(1)}M`);
    const fmt = (b, label) => b ? `${label}: ${b.score >= 0 ? '+' : ''}${b.score.toFixed(1).padStart(6)} (n=${b.n}, γ=${(b.totalVol/1e6).toFixed(1)}M)` : `${label}: —`;
    console.log(`    ${fmt(front, 'FRONT ')}    ${fmt(mid, 'MID   ')}`);
    console.log(`    ${fmt(swing, 'SWING ')}    ${fmt(leaps, 'LEAPS ')}`);
  });

  // Bottom 5 too — sanity check the score isn't backwards
  console.log(`\n━━━ Bottom 5 (sanity check — should look bearish) ━━━`);
  results.slice(-5).reverse().forEach((r, i) => {
    console.log(`  ${r.ticker.padEnd(6)} score=${r.score.toFixed(2).padStart(7)}  spot=$${r.spot?.toFixed(2)}`);
  });

  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
