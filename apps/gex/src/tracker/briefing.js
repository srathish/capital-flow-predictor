/**
 * Morning briefing + EOD summary printers for the standalone plays-tracker.
 *
 * Morning brief: compares prior-day close snapshot to a freshly-fetched
 * current snapshot for SPXW/SPY/QQQ. Highlights the overnight positioning
 * shifts that would fire the `overnight_carryover` pattern — negative-gamma
 * nodes forming above spot, vanna field flipping, King movements. Prints to
 * stdout only; does NOT open plays (fire-loop handles that automatically).
 *
 * EOD summary: after market close, prints every fire + close for the day
 * with best-mark % gain. Fed from the local SQLite tracked_plays table.
 */

import { fetchSnapshot } from '../heatseeker/client.js';
import { openDb } from '../store/db.js';
import { getTodaysPlays } from './plays.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Briefing');

const TICKERS = ['SPXW', 'SPY', 'QQQ'];

// ---------- shared helpers ----------

function pctChange(a, b) {
  if (!a || !b) return null;
  return (b - a) / a;
}

function fmtPct(v, digits = 2) {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(digits)}%`;
}

function fmtMoney(v) {
  if (v == null) return '—';
  return `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function fmtM(v) {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}$${(v / 1e6).toFixed(1)}M`;
}

function computeKings(snap) {
  const strikes = snap.strikes || [];
  if (!strikes.length) return null;
  let king = null;
  let vexKing = null;
  for (const s of strikes) {
    const g = Number(s.gamma) || 0;
    const v = Number(s.vanna) || 0;
    if (!king || Math.abs(g) > Math.abs(king.gamma)) king = { strike: Number(s.strike), gamma: g };
    if (!vexKing || Math.abs(v) > Math.abs(vexKing.vanna)) vexKing = { strike: Number(s.strike), vanna: v };
  }
  return { king, vexKing };
}

function biggestNegativeAboveSpot(snap) {
  const strikes = snap.strikes || [];
  const spot = snap.spot;
  let worst = null;
  for (const s of strikes) {
    const strike = Number(s.strike);
    const g = Number(s.gamma) || 0;
    if (strike <= spot) continue;
    if (strike > spot * 1.01) continue; // within 1%
    if (g >= 0) continue;
    if (!worst || g < worst.gamma) worst = { strike, gamma: g };
  }
  return worst;
}

// ---------- Prior-close snapshot from SQLite ----------

function loadPriorCloseFromDb(ticker) {
  try {
    const db = openDb();
    // Most recent snapshot from a trading_day strictly before today (localtime).
    const row = db.prepare(`
      SELECT * FROM snapshots
      WHERE ticker = ?
        AND trading_day < date('now', 'localtime')
      ORDER BY ts_ms DESC
      LIMIT 1
    `).get(ticker);
    if (!row) return null;
    const nodes = db.prepare(`
      SELECT strike, gamma
      FROM node_snapshots
      WHERE ticker = ? AND ts_ms = ?
      ORDER BY strike ASC
    `).all(ticker, row.ts_ms);
    return {
      ts_ms: row.ts_ms,
      trading_day: row.trading_day,
      spot: Number(row.spot),
      strikes: nodes.map(n => ({ strike: Number(n.strike), gamma: Number(n.gamma), vanna: null })),
    };
  } catch (err) {
    log.warn(`prior-close load for ${ticker} failed: ${err.message}`);
    return null;
  }
}

// ---------- Morning brief ----------

export async function printMorningBrief() {
  console.log('');
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log('  MORNING BRIEF — overnight positioning delta');
  const nowStr = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  console.log(`  ${nowStr} ET`);
  console.log('  ═══════════════════════════════════════════════════════════');

  for (const ticker of TICKERS) {
    console.log('');
    let now = null;
    try {
      now = await fetchSnapshot(ticker);
    } catch (err) {
      console.log(`  ${ticker}: fresh snapshot failed (${err.message})`);
      continue;
    }
    if (!now || !now.spot) {
      console.log(`  ${ticker}: no fresh snapshot`);
      continue;
    }

    const prior = loadPriorCloseFromDb(ticker);
    const nowKings = computeKings(now);
    const worstNegAbove = biggestNegativeAboveSpot(now);

    console.log(`  ${ticker}`);
    console.log(`    spot now      ${fmtMoney(now.spot)}`);
    if (prior) {
      const delta = pctChange(prior.spot, now.spot);
      console.log(`    spot prev     ${fmtMoney(prior.spot)}  (${prior.trading_day})`);
      console.log(`    overnight     ${fmtPct(delta, 2)}`);
    } else {
      console.log(`    spot prev     — (no prior snapshot in local DB yet)`);
    }
    if (nowKings) {
      const distPct = pctChange(now.spot, nowKings.king.strike);
      console.log(
        `    GAMMA king    ${fmtMoney(nowKings.king.strike)} (${fmtPct(distPct, 2)})  ${fmtM(nowKings.king.gamma)}`
      );
      const vDistPct = pctChange(now.spot, nowKings.vexKing.strike);
      console.log(
        `    VANNA king    ${fmtMoney(nowKings.vexKing.strike)} (${fmtPct(vDistPct, 2)})  ${fmtM(nowKings.vexKing.vanna)}`
      );
    }
    if (worstNegAbove) {
      const distPct = pctChange(now.spot, worstNegAbove.strike);
      console.log(
        `    biggest -gamma above spot  ${fmtMoney(worstNegAbove.strike)} (${fmtPct(distPct, 2)})  ${fmtM(worstNegAbove.gamma)}`
      );
      console.log(`    ↑ this is a potential BEAR_TRAPDOOR/RUG setup — fire-loop will detect if it persists`);
    } else {
      console.log(`    no notable -gamma cluster above spot`);
    }
  }

  console.log('');
  console.log('  ───────────────────────────────────────────────────────────');
  console.log('  Fire-loop and refresh-loop are running. Watch this terminal');
  console.log('  for state-change fires. Ctrl-C to stop.');
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log('');
}

// ---------- EOD summary ----------

/**
 * Fetch the contract's TRUE day high from UW 1-min candles (close basis).
 * Returns { dayHigh, highAfterExit } or null. Report-only; failures are
 * swallowed so the summary always prints.
 */
async function fetchDayHigh(optionSymbol, day, exitTsMs) {
  try {
    const key = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
    if (!key) return null;
    const r = await fetch(
      `https://api.unusualwhales.com/api/option-contract/${optionSymbol}/intraday?date=${day}`,
      { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) }
    );
    if (!r.ok) return null;
    const rows = (await r.json())?.data || [];
    let dayHigh = null, highAfterExit = null;
    for (const c of rows) {
      const close = Number(c.close) || 0;
      if (close <= 0) continue;
      const ts = Date.parse(c.start_time);
      if (dayHigh == null || close > dayHigh) dayHigh = close;
      if (exitTsMs && ts > exitTsMs && (highAfterExit == null || close > highAfterExit)) {
        highAfterExit = close;
      }
    }
    return { dayHigh, highAfterExit };
  } catch {
    return null;
  }
}

export async function printEodSummary({ tradingDay } = {}) {
  const day = tradingDay || new Date().toISOString().slice(0, 10);
  const db = openDb();
  const rows = getTodaysPlays({ db, tradingDay: day });

  console.log('');
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log('  EOD SUMMARY — ' + day);
  console.log('  ═══════════════════════════════════════════════════════════');

  if (rows.length === 0) {
    console.log('  No plays today.');
    console.log('  ═══════════════════════════════════════════════════════════');
    console.log('');
    return;
  }

  // Bucket by fire event (same fire_ts_ms + ticker + state = one fire)
  const buckets = new Map();
  for (const r of rows) {
    const key = `${r.fire_ts_ms}|${r.ticker}|${r.state}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }

  let n_fires = 0;
  let n_plays = 0;
  let n_winners = 0;
  const bestGains = [];

  for (const [key, plays] of [...buckets].sort((a, b) => a[1][0].fire_ts_ms - b[1][0].fire_ts_ms)) {
    const [ts, ticker, state] = key.split('|');
    const t = new Date(Number(ts)).toLocaleTimeString('en-US', { hour12: false });
    console.log(`\n  ${t}  ${ticker}  ${state}  ·  ${plays.length} contract${plays.length === 1 ? '' : 's'}`);
    n_fires += 1;
    for (const r of plays) {
      n_plays += 1;
      const gain = r.best_pct_gain != null ? r.best_pct_gain : null;
      if (gain != null && gain > 0.15) n_winners += 1;
      if (gain != null) bestGains.push(gain);
      const arrow = gain != null && gain > 0.15 ? '↑' : gain != null && gain < -0.05 ? '↓' : '·';
      // TRUE day high of the contract (incl. after our exit) — exit-quality read.
      const dh = await fetchDayHigh(r.option_symbol, day, r.close_ts_ms);
      let dayHighStr = '';
      if (dh?.dayHigh != null && r.entry_mark > 0) {
        const dhPct = (dh.dayHigh - r.entry_mark) / r.entry_mark;
        dayHighStr = `  dayHigh ${fmtMoney(dh.dayHigh)} (${fmtPct(dhPct, 0)})`;
        if (dh.highAfterExit != null && r.close_mark != null && dh.highAfterExit > r.close_mark * 1.1) {
          dayHighStr += ` ⚠ ran to ${fmtMoney(dh.highAfterExit)} after exit`;
        }
      }
      console.log(
        `    ${arrow} ${r.option_type === 'put' ? 'PUT ' : 'CALL'} $${r.strike}  ` +
        `entry ${fmtMoney(r.entry_mark)}  best ${fmtMoney(r.best_mark)}  ` +
        `(${fmtPct(gain, 0)})  ${r.status.toUpperCase()}` + dayHighStr
      );
    }
  }

  const avgGain = bestGains.length ? bestGains.reduce((s, g) => s + g, 0) / bestGains.length : null;
  const maxGain = bestGains.length ? Math.max(...bestGains) : null;

  console.log('');
  console.log('  ───────────────────────────────────────────────────────────');
  console.log(`  ${n_fires} fire${n_fires === 1 ? '' : 's'} · ${n_plays} play${n_plays === 1 ? '' : 's'} · ${n_winners} winner${n_winners === 1 ? '' : 's'} (>15%)`);
  console.log(`  best gain: ${fmtPct(maxGain, 0)}   avg gain: ${fmtPct(avgGain, 0)}`);
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log('');
}
