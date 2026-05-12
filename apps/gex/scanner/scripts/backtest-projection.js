#!/usr/bin/env node
/**
 * Backtest projection settings (replicated from raw /api/data).
 *
 * For each ticker × setting combo:
 *   1. Fetch raw gamma surface from /api/data at the prediction date
 *   2. For each expiration, take top_n strikes by |gamma|
 *   3. At horizon expiration (slice closest to +30/+60/+90 days), find strongest above-spot node
 *   4. That's the "projection target"
 *
 * Compare projection targets to actual spot at +30D/+60D/+90D.
 *
 * Settings tested:
 *   top_n ∈ {3, 5, 10, 20}   (top N strikes per expiration to consider)
 *   exp_count ∈ {5, 10, 25}  (how many expirations to scan for the horizon match)
 *
 * Usage:
 *   node scanner/scripts/backtest-projection.js --pick-date=2026-02-06 [--n=25]
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
const PICK_DATE = args['pick-date'] || '2026-02-06';
const N_TICKERS = parseInt(args.n || '25', 10);
const HORIZONS = [30, 60, 90];

const SETTINGS = [];
for (const top_n of [3, 5, 10, 20]) {
  for (const exp_count of [5, 10, 25]) {
    for (const skip_opex of [false, true]) {
      SETTINGS.push({ top_n, exp_count, skip_opex });
    }
  }
}

// 3rd Friday of any month = monthly OpEx
function isThirdFriday(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.getUTCDay() === 5 && d.getUTCDate() >= 15 && d.getUTCDate() <= 21;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T17:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

async function fetchData(symbol, dateObj, token) {
  const ts = dateObj.toISOString();
  const url = `https://app.skylit.ai/api/data?symbol=${encodeURIComponent(symbol)}&max_strikes=92&max_expirations=25&timestamp=${ts}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Origin: 'https://app.skylit.ai' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Replicate Atlas projection: top_n strikes per expiration, find horizon expiration,
// pick strongest above-spot node.
function projectionTarget(j, pickDate, horizonDays, top_n, exp_count, skip_opex) {
  const spot = j.CurrentSpot;
  let expirations = (j.Expirations || []).slice(0, exp_count);
  if (skip_opex) expirations = expirations.filter(e => !isThirdFriday(e));
  const allExps = j.Expirations || [];
  const strikes = j.Strikes || [];
  const gamma2d = j.GammaValues || [];
  if (!spot || !expirations.length) return null;

  // Find expiration closest to horizon (within filtered set)
  const baseMs = new Date(`${pickDate}T00:00:00Z`).getTime();
  let bestExp = null, bestDist = Infinity;
  for (const exp of expirations) {
    const dte = (new Date(`${exp}T00:00:00Z`).getTime() - baseMs) / 86400000;
    const dist = Math.abs(dte - horizonDays);
    if (dist < bestDist) { bestDist = dist; bestExp = exp; }
  }
  if (!bestExp) return null;
  const bestExpIdx = allExps.indexOf(bestExp);
  if (bestExpIdx === -1) return null;

  // Build all (strike, |gamma|) at that expiration, take top_n by |gamma|
  const nodes = [];
  for (let si = 0; si < strikes.length; si++) {
    const k = strikes[si];
    const g = gamma2d[si]?.[bestExpIdx] ?? 0;
    if (g === 0 || !isFinite(g)) continue;
    nodes.push({ k, g, abs: Math.abs(g) });
  }
  nodes.sort((a, b) => b.abs - a.abs);
  const topNodes = nodes.slice(0, top_n);

  // Among top_n, find strongest ABOVE spot
  const above = topNodes.filter(n => n.k > spot);
  if (!above.length) return null;
  above.sort((a, b) => b.abs - a.abs);
  return { strike: above[0].k, gamma: above[0].g, exp: expirations[bestExpIdx] };
}

async function main() {
  if (!initAuth()) { console.error('Auth not configured'); process.exit(1); }
  const token = await getFreshToken();

  const db = new Database(DB_PATH, { readonly: true });
  const all = db.prepare('SELECT * FROM scan_results WHERE pick_date = ? ORDER BY score DESC').all(PICK_DATE);
  const liquid = all.filter(r => r.spot >= 5);
  // Stratified sample: top, mid, bottom thirds
  const t = Math.floor(liquid.length / 3);
  const stride = (segment) => Math.max(1, Math.floor(segment.length / Math.floor(N_TICKERS / 3)));
  const top = liquid.slice(0, t);
  const mid = liquid.slice(t, 2*t);
  const bot = liquid.slice(2*t);
  const sample = [
    ...top.filter((_, i) => i % stride(top) === 0).slice(0, Math.floor(N_TICKERS / 3)),
    ...mid.filter((_, i) => i % stride(mid) === 0).slice(0, Math.floor(N_TICKERS / 3)),
    ...bot.filter((_, i) => i % stride(bot) === 0).slice(0, N_TICKERS - 2 * Math.floor(N_TICKERS / 3)),
  ];
  const tickers = [...new Set(sample.map(s => s.ticker))].slice(0, N_TICKERS);
  console.log(`Sample: ${tickers.length} tickers from ${PICK_DATE}`);
  console.log(`Tickers: ${tickers.join(', ')}\n`);

  // 1. Fetch raw GEX once per ticker (cached for setting variations)
  console.log(`Fetching raw /api/data for ${tickers.length} tickers...`);
  const rawData = {};
  const pickDateObj = new Date(`${PICK_DATE}T17:00:00Z`);
  for (const ticker of tickers) {
    try {
      rawData[ticker] = await fetchData(ticker, pickDateObj, token);
    } catch (e) {
      rawData[ticker] = null;
    }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('\n');

  // 2. Fetch actual spot at each horizon
  console.log(`Fetching actual spots at +${HORIZONS.join(', +')}D...`);
  const actuals = {};
  for (const ticker of tickers) {
    const spotAtPick = rawData[ticker]?.CurrentSpot ?? null;
    actuals[ticker] = { atPick: spotAtPick };
    for (const h of HORIZONS) {
      try {
        const j = await fetchData(ticker, addDays(PICK_DATE, h), token);
        actuals[ticker][`+${h}d`] = j.CurrentSpot;
      } catch (e) { actuals[ticker][`+${h}d`] = null; }
      await new Promise(r => setTimeout(r, 150));
    }
    process.stdout.write('.');
  }
  console.log('\n');

  // 3. Compute projection target for each setting × ticker (no extra fetches — all from rawData)
  console.log(`Computing projections across ${SETTINGS.length} setting combos...\n`);

  const settingResults = SETTINGS.map(s => ({
    setting: s,
    label: `t=${s.top_n.toString().padStart(2)} e=${s.exp_count.toString().padStart(2)} ${s.skip_opex ? 'no-opex' : 'all-exp '}`,
    rows: [],
  }));

  for (let si = 0; si < SETTINGS.length; si++) {
    const setting = SETTINGS[si];
    for (const ticker of tickers) {
      const j = rawData[ticker];
      if (!j) continue;
      const row = { ticker, atPick: actuals[ticker].atPick };
      for (const h of HORIZONS) {
        const proj = projectionTarget(j, PICK_DATE, h, setting.top_n, setting.exp_count, setting.skip_opex);
        const actual = actuals[ticker][`+${h}d`];
        row[`target_${h}`] = proj?.strike;
        row[`actual_${h}`] = actual;
        if (proj?.strike && actual) {
          row[`abs_err_${h}_pct`] = Math.abs(proj.strike - actual) / actual * 100;
        }
      }
      settingResults[si].rows.push(row);
    }
  }

  // 4. Aggregate metrics
  console.log(`━━━ MAPE — Mean Absolute % Error: |projection − actual| / actual ━━━`);
  console.log(`(lower = projection target was closer to where price actually went)\n`);
  console.log(`Setting                +30D MAPE  +60D MAPE  +90D MAPE   n`);
  console.log('-'.repeat(60));
  const aggs = settingResults.map(sr => {
    const errs = h => sr.rows.map(r => r[`abs_err_${h}_pct`]).filter(e => e != null && isFinite(e));
    const mean = a => a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
    const e30 = errs(30), e60 = errs(60), e90 = errs(90);
    return {
      label: sr.label, setting: sr.setting,
      mape: { 30: mean(e30), 60: mean(e60), 90: mean(e90) },
      n: Math.max(e30.length, e60.length, e90.length),
    };
  });
  for (const a of aggs) {
    const f = v => v == null ? '   —    ' : v.toFixed(1).padStart(6) + '%';
    console.log(`${a.label.padEnd(15)}    ${f(a.mape[30])}   ${f(a.mape[60])}   ${f(a.mape[90])}    ${a.n}`);
  }

  // Best per horizon
  console.log(`\n━━━ Best settings per horizon ━━━`);
  for (const h of HORIZONS) {
    const valid = aggs.filter(a => a.mape[h] != null).sort((a,b) => a.mape[h] - b.mape[h]);
    if (!valid.length) continue;
    console.log(`+${h}D: best = ${valid[0].label}  → ${valid[0].mape[h].toFixed(1)}% MAPE  (worst: ${valid[valid.length-1].label} ${valid[valid.length-1].mape[h].toFixed(1)}%)`);
  }

  // Directional accuracy
  console.log(`\n━━━ Directional accuracy ━━━`);
  console.log(`(when projection target > spot, did price actually go up at horizon?)\n`);
  console.log(`Setting          +30D  hit%   +90D  hit%`);
  console.log('-'.repeat(50));
  for (const sr of settingResults) {
    const dirs = (h) => {
      let bullishProj = 0, hits = 0;
      for (const r of sr.rows) {
        const target = r[`target_${h}`];
        const actual = r[`actual_${h}`];
        const atPick = r.atPick;
        if (!target || !actual || !atPick) continue;
        if (target > atPick) {
          bullishProj++;
          if (actual > atPick) hits++;
        }
      }
      return { bullishProj, hits, pct: bullishProj === 0 ? null : hits / bullishProj * 100 };
    };
    const d30 = dirs(30), d90 = dirs(90);
    const f = (d) => d.pct == null ? '  —' : `${d.hits}/${d.bullishProj} (${d.pct.toFixed(0)}%)`;
    console.log(`${sr.label.padEnd(15)}    ${f(d30).padEnd(15)}   ${f(d90).padEnd(15)}`);
  }

  // Best directional setting
  console.log(`\n━━━ Best directional accuracy at +90D ━━━`);
  const dirAt = (sr, h) => {
    let bp = 0, hits = 0;
    for (const r of sr.rows) {
      const t = r[`target_${h}`], a = r[`actual_${h}`], ap = r.atPick;
      if (!t || !a || !ap || t <= ap) continue;
      bp++; if (a > ap) hits++;
    }
    return { bp, hits, pct: bp === 0 ? -1 : hits / bp };
  };
  const dirSorted = settingResults
    .map(sr => ({ ...sr, ...dirAt(sr, 90) }))
    .filter(x => x.bp >= 5)
    .sort((a, b) => b.pct - a.pct);
  for (const x of dirSorted.slice(0, 5)) {
    console.log(`  ${x.label}  →  ${x.hits}/${x.bp} = ${(x.pct*100).toFixed(0)}%`);
  }

  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
