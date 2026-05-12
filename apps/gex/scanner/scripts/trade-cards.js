#!/usr/bin/env node
/**
 * Trade cards — re-fetches each persisted Top-N pick to produce an actionable
 * trade idea: BUY [strike] [call/put] exp [date], target [barney], invalidation [pika].
 *
 * For each pick:
 *   1. Identify the strongest bullish bucket among MID/SWING/LEAPS (skip FRONT — hedge noise)
 *   2. Re-fetch GEX, find the expiration in that bucket with the largest barney↑ × γ_volume
 *   3. Within that expiration: barney↑ above spot = target, pika↓ below spot = invalidation
 *   4. Output Talon-style card: BUY [strike] CALL exp [date], target [X], inval [Y], R:R [Z]
 *
 * Usage:
 *   node scanner/scripts/trade-cards.js --date=2026-05-06
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
if (!args.date) { console.error('Usage: --date=YYYY-MM-DD'); process.exit(1); }

async function fetchGex(symbol, timestampISO, token) {
  const url = `https://app.skylit.ai/api/data?symbol=${encodeURIComponent(symbol)}&max_strikes=92&max_expirations=25&timestamp=${timestampISO}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Per-expiration structure scan — find barney above, pika below, etc.
function expProfile(strikes, gammaCol, spot) {
  let barneyAboveStrike = null, barneyAbove = 0;
  let pikaBelowStrike = null, pikaBelow = 0;
  let pikaAboveStrike = null, pikaAbove = 0;
  let totalAbs = 0;
  for (let i = 0; i < strikes.length; i++) {
    const s = strikes[i], g = gammaCol[i];
    if (g == null || g === 0 || !isFinite(g)) continue;
    totalAbs += Math.abs(g);
    if (s > spot) {
      if (g < 0 && Math.abs(g) > barneyAbove) { barneyAbove = Math.abs(g); barneyAboveStrike = s; }
      if (g > 0 && g > pikaAbove) { pikaAbove = g; pikaAboveStrike = s; }
    } else if (s < spot) {
      if (g > 0 && g > pikaBelow) { pikaBelow = g; pikaBelowStrike = s; }
    }
  }
  return { barneyAboveStrike, barneyAbove, pikaBelowStrike, pikaBelow, pikaAboveStrike, pikaAbove, totalAbs };
}

const BUCKETS = [
  { name: 'MID',   minDte: 15,  maxDte: 90  },
  { name: 'SWING', minDte: 91,  maxDte: 270 },
  { name: 'LEAPS', minDte: 271, maxDte: 9999 },
];

function bucketFor(dte) {
  for (const b of BUCKETS) if (dte >= b.minDte && dte <= b.maxDte) return b.name;
  return 'FRONT';
}

async function buildCard(pick, predDate, token) {
  const ts = new Date(`${predDate}T17:00:00Z`).toISOString();
  const j = await fetchGex(pick.ticker, ts, token);
  const spot = j.CurrentSpot;
  const expirations = j.Expirations || [];
  const strikes = j.Strikes || [];
  const gamma2d = j.GammaValues || [];

  // Score each expiration; tag with bucket
  const predMs = new Date(`${predDate}T00:00:00Z`).getTime();
  const surface = [];
  for (let ei = 0; ei < expirations.length; ei++) {
    const exp = expirations[ei];
    const dte = Math.max(1, Math.round((new Date(`${exp}T00:00:00Z`).getTime() - predMs) / (24 * 3600 * 1000)));
    const col = strikes.map((_, si) => gamma2d[si]?.[ei] ?? 0);
    const p = expProfile(strikes, col, spot);
    surface.push({ exp, dte, bucket: bucketFor(dte), ...p });
  }

  // Pick the best non-FRONT expiration: highest barney_above × γ_total in that exp
  const candidates = surface
    .filter(s => s.bucket !== 'FRONT')
    .filter(s => s.barneyAboveStrike != null)  // must have a target above
    .map(s => ({ ...s, magnetScore: s.barneyAbove * Math.log(1 + s.totalAbs) }))
    .sort((a, b) => b.magnetScore - a.magnetScore);

  const best = candidates[0];
  if (!best) return { ticker: pick.ticker, spot, error: 'no bullish target found' };

  // Recommend strike: barney↑ if within reasonable OTM range, else next ITM round number
  const otmPct = (best.barneyAboveStrike - spot) / spot;
  let strike = best.barneyAboveStrike;
  let strikeRationale = `barney↑ magnet`;
  if (otmPct > 0.20) {
    // Too far OTM — pick a closer strike at ~5-10% OTM (better delta)
    strike = Math.round(spot * 1.05);
    strikeRationale = `~5% OTM (barney ${best.barneyAboveStrike} too far)`;
  }

  return {
    ticker: pick.ticker,
    spot,
    rank: pick.rank,
    score: pick.score,
    setup: {
      bucket: best.bucket,
      exp: best.exp,
      dte: best.dte,
      strike,
      strikeRationale,
      target: best.barneyAboveStrike,
      targetGamma: best.barneyAbove,
      invalidation: best.pikaBelowStrike,
      otmPct: (otmPct * 100).toFixed(1),
      targetUpsidePct: ((best.barneyAboveStrike - spot) / spot * 100).toFixed(1),
      invalidationDownsidePct: best.pikaBelowStrike ? ((spot - best.pikaBelowStrike) / spot * 100).toFixed(1) : null,
    },
  };
}

async function main() {
  if (!initAuth()) { console.error('Auth not configured'); process.exit(1); }
  const token = await getFreshToken();

  const db = new Database(DB_PATH, { readonly: true });
  const picks = db.prepare('SELECT * FROM picks WHERE pick_date = ? ORDER BY rank ASC').all(args.date);
  if (picks.length === 0) { console.error(`No picks for ${args.date}`); process.exit(1); }

  console.log(`\n━━━ TRADE CARDS — ${args.date} ━━━\n`);

  const cards = [];
  for (const p of picks) {
    const card = await buildCard(p, args.date, token);
    cards.push(card);
    if (card.error) {
      console.log(`#${p.rank} ${p.ticker}  spot=$${card.spot?.toFixed(2)}  ⚠ ${card.error}\n`);
      continue;
    }
    const s = card.setup;
    const rrText = s.invalidationDownsidePct
      ? `R:R ≈ ${(parseFloat(s.targetUpsidePct) / parseFloat(s.invalidationDownsidePct)).toFixed(1)}`
      : 'R:R n/a';
    console.log(`#${card.rank}  ${card.ticker.padEnd(6)} score=${card.score.toFixed(2)}   spot=$${card.spot?.toFixed(2)}`);
    console.log(`     BUY  $${s.strike} CALL  exp ${s.exp}  (${s.dte}D, ${s.bucket} bucket)`);
    console.log(`     ${s.strikeRationale} — ${s.otmPct}% OTM`);
    console.log(`     Target:        $${s.target}   (+${s.targetUpsidePct}% from spot)`);
    console.log(`     Invalidation:  ${s.invalidation ? '$' + s.invalidation + '   (-' + s.invalidationDownsidePct + '% from spot)' : '— (no clean floor)'}`);
    console.log(`     ${rrText}\n`);
    await new Promise(r => setTimeout(r, 250));
  }

  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
