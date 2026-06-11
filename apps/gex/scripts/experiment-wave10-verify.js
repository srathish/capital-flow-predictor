#!/usr/bin/env node
/**
 * Wave 10 — VERIFY the bare Mon+Thu strategy without direction filter.
 *
 * Wave 9 applied LONG-only filter and earned only +3.16%, but wave 8 reported
 * the BARE Mon+Thu (no direction filter) at +19.52%. We need to confirm which
 * is correct and produce a clean trade log.
 *
 * Hypothesis: BARE strategy works because the "first fade signal of the morning"
 * adaptively picks direction based on the initial 15-min move. Filtering to
 * LONG-only forces us to skip profitable early SHORTs and enter late.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPLAY_DIR = '/Users/saiyeeshrathish/gex-data-replay-reader/data';
const OUT_DIR = join(__dirname, 'out');
const TICKERS = ['SPXW', 'SPY', 'QQQ'];
const FLIP_COST = { SPXW: 0.0008, SPY: 0.0005, QQQ: 0.0005 };

function loadReplay(path) {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  const out = {};
  for (const t of TICKERS) {
    const frames = [];
    for (const f of raw.frames) {
      const tk = f.tickers[t];
      if (!tk || !tk.spotPrice) continue;
      frames.push({ ts: f.timestamp, spot: tk.spotPrice });
    }
    out[t] = frames;
  }
  return out;
}

function precomputeForTicker(frames) {
  const recent15 = new Array(frames.length).fill(0);
  for (let i = 0; i < frames.length; i++) {
    recent15[i] = (frames[i].spot - frames[Math.max(0, i - 15)].spot) / frames[Math.max(0, i - 15)].spot;
  }
  return { frames, recent15 };
}

function inSession(ts, h0, h1) {
  const d = new Date(ts);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return h >= h0 && h < h1;
}
function dayOfWeek(d) { return new Date(d).getUTCDay(); }

function simulate(byDayTicker, signalFn, options = {}) {
  const { tickerFilter = null, dayFilter = null } = options;
  const trades = [];
  for (const [date, byTicker] of Object.entries(byDayTicker)) {
    if (dayFilter && !dayFilter(date)) continue;
    for (const ticker of TICKERS) {
      if (tickerFilter && ticker !== tickerFilter) continue;
      const p = byTicker[ticker]; if (!p) continue;
      const cost = FLIP_COST[ticker];
      let cooldownUntil = null;
      for (let i = 0; i < p.frames.length; i++) {
        const direction = signalFn(p, i);
        if (direction === 0) continue;
        if (cooldownUntil && p.frames[i].ts <= cooldownUntil) continue;
        const entrySpot = p.frames[i].spot;
        const exitIdx = p.frames.length - 1;
        const moveReturn = (p.frames[exitIdx].spot - entrySpot) / entrySpot;
        const pnl = direction * moveReturn - cost;
        const entryDate = new Date(p.frames[i].ts);
        const closeDate = new Date(p.frames[i].ts.slice(0, 10) + 'T20:00:00Z');
        const hoursLeft = (closeDate - entryDate) / 3600000;
        const lev = hoursLeft <= 0.1 ? 50 : Math.min(50, 5 + 18 / Math.sqrt(hoursLeft));
        const optionMove = Math.max(-1.0, lev * direction * moveReturn);
        const optionPnL = optionMove - 0.01;
        trades.push({ date, ticker, ts: p.frames[i].ts, direction, pnl, optionPnL, lev, moveReturn, dow: dayOfWeek(date) });
        cooldownUntil = new Date(new Date(p.frames[i].ts).getTime() + (exitIdx - i) * 60000).toISOString();
      }
    }
  }
  return trades;
}

function summarize(trades) {
  if (!trades.length) return null;
  const cum = trades.reduce((a, t) => a + t.pnl, 0);
  const wins = trades.filter(t => t.pnl > 0).length;
  const variance = trades.reduce((a, t) => a + Math.pow(t.pnl - cum / trades.length, 2), 0) / trades.length;
  const sharpe = variance > 0 ? (cum / trades.length) / Math.sqrt(variance) : 0;
  const optCum = trades.reduce((a, t) => a + t.optionPnL, 0);
  const optWins = trades.filter(t => t.optionPnL > 0).length;
  return { n: trades.length, winRate: wins / trades.length, cumPnL: cum, sharpe, optionCumPnL: optCum, optionWinRate: optWins / trades.length };
}

function byQuarter(trades) {
  const m = new Map();
  for (const t of trades) {
    const [y, mo] = t.date.split('-');
    const q = `${y}-Q${Math.ceil(parseInt(mo, 10) / 3)}`;
    if (!m.has(q)) m.set(q, []);
    m.get(q).push(t);
  }
  return [...m.entries()].sort();
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(REPLAY_DIR).filter(f => /^gex-replay-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const allDates = files.map(f => f.match(/(\d{4}-\d{2}-\d{2})/)[1]);
  console.log(`▶ Wave 10: BARE Mon+Thu verification on ${allDates.length} days\n`);
  console.log('Precomputing...');
  const byDayTicker = {};
  for (const date of allDates) {
    const path = join(REPLAY_DIR, `gex-replay-${date}.json`);
    if (!existsSync(path)) continue;
    try {
      const replay = loadReplay(path);
      byDayTicker[date] = {};
      for (const ticker of TICKERS) {
        const frames = replay[ticker];
        if (!frames || frames.length < 40) continue;
        byDayTicker[date][ticker] = precomputeForTicker(frames);
      }
    } catch (e) {}
  }
  const days = Object.keys(byDayTicker).sort();
  const mondays = days.filter(d => dayOfWeek(d) === 1).length;
  const thursdays = days.filter(d => dayOfWeek(d) === 4).length;
  console.log(`Loaded ${days.length} days (${mondays} Mondays, ${thursdays} Thursdays)\n`);

  const fadeMorning = (p, i) => {
    if (!inSession(p.frames[i].ts, 13.5, 16.0)) return 0;
    return -Math.sign(p.recent15[i] || 0);
  };
  const isMonThu = (d) => dayOfWeek(d) === 1 || dayOfWeek(d) === 4;

  // ── Bare strategy ──
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  BARE MON+THU MORNING FADE (no direction filter)');
  console.log('══════════════════════════════════════════════════════════════════');
  const bareTrades = simulate(byDayTicker, fadeMorning, { dayFilter: isMonThu });
  const bareS = summarize(bareTrades);
  console.log(`\n  Overall: n=${bareS.n}, win=${(bareS.winRate*100).toFixed(1)}%, cum=${(bareS.cumPnL*100).toFixed(2)}%, ` +
    `0DTE cum=${(bareS.optionCumPnL*100).toFixed(1)}%, Sharpe=${bareS.sharpe.toFixed(3)}`);

  // Per-ticker
  console.log(`\n  Per ticker:`);
  for (const ticker of TICKERS) {
    const t = bareTrades.filter(x => x.ticker === ticker);
    const s = summarize(t);
    console.log(`    ${ticker}: n=${s.n}, win=${(s.winRate*100).toFixed(1)}%, cum=${(s.cumPnL*100).toFixed(2)}%, 0DTE=${(s.optionCumPnL*100).toFixed(1)}%`);
  }

  // Per quarter
  console.log(`\n  Per quarter:`);
  for (const [q, t] of byQuarter(bareTrades)) {
    const s = summarize(t);
    console.log(`    ${q}: n=${s.n}, win=${(s.winRate*100).toFixed(1)}%, cum=${(s.cumPnL*100).toFixed(2)}%, 0DTE=${(s.optionCumPnL*100).toFixed(1)}%`);
  }

  // Direction breakdown
  console.log(`\n  Direction breakdown:`);
  const longTrades = bareTrades.filter(t => t.direction === 1);
  const shortTrades = bareTrades.filter(t => t.direction === -1);
  const longS = summarize(longTrades);
  const shortS = summarize(shortTrades);
  console.log(`    LONG entries  (morning opened DOWN, faded UP):  n=${longS.n}, win=${(longS.winRate*100).toFixed(1)}%, cum=${(longS.cumPnL*100).toFixed(2)}%, 0DTE=${(longS.optionCumPnL*100).toFixed(1)}%`);
  console.log(`    SHORT entries (morning opened UP, faded DOWN):   n=${shortS.n}, win=${(shortS.winRate*100).toFixed(1)}%, cum=${(shortS.cumPnL*100).toFixed(2)}%, 0DTE=${(shortS.optionCumPnL*100).toFixed(1)}%`);

  // Full trade log
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  FULL TRADE LOG (Mon+Thu BARE, all 3 tickers)');
  console.log('══════════════════════════════════════════════════════════════════');
  bareTrades.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
  let cum = 0, cumOpt = 0;
  console.log(`  ${'date'.padEnd(12)} ${'dow'.padEnd(4)} ${'ticker'.padEnd(6)} ${'dir'.padEnd(5)} ${'pnl%'.padStart(7)}  ${'cum%'.padStart(7)}  ${'0DTE%'.padStart(7)}  ${'cumOpt%'.padStart(9)}`);
  for (const t of bareTrades) {
    cum += t.pnl;
    cumOpt += t.optionPnL;
    const dowLabel = t.dow === 1 ? 'Mon' : 'Thu';
    const dirLabel = t.direction === 1 ? 'LONG' : 'SHRT';
    console.log(`  ${t.date.padEnd(12)} ${dowLabel.padEnd(4)} ${t.ticker.padEnd(6)} ${dirLabel.padEnd(5)} ${(t.pnl*100).toFixed(2).padStart(6)}%  ${(cum*100).toFixed(2).padStart(6)}%  ${(t.optionPnL*100).toFixed(1).padStart(6)}%  ${(cumOpt*100).toFixed(1).padStart(8)}%`);
  }

  // Write CSV
  const csvPath = join(OUT_DIR, 'wave10-bare-strategy.csv');
  const headers = ['date', 'dow', 'ticker', 'direction', 'pnl', 'optionPnL', 'lev'];
  const lines = [headers.join(',')];
  for (const t of bareTrades) {
    lines.push(headers.map(h => typeof t[h] === 'number' ? t[h].toFixed(6) : String(t[h] ?? '')).join(','));
  }
  writeFileSync(csvPath, lines.join('\n'));

  // Final spec
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  PRODUCTION SPEC');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(`
  THE STRATEGY:
    On Mondays AND Thursdays:
      1. Wait until 9:30 ET market open
      2. At each minute, compute 15-min spot return
      3. On the FIRST frame where 15-min return != 0:
         a. If return < 0 (morning DOWN): enter LONG (buy 0DTE/1DTE ATM call)
         b. If return > 0 (morning UP): enter SHORT (buy 0DTE/1DTE ATM put)
      4. Hold to end of session (15:55-16:00 ET)
      5. No stop, no take-profit. Hold to expiration.
      6. Maximum one position per ticker per day.

  TICKERS:
    All three: SPXW, SPY, QQQ. Same signal on each.

  EXPECTED:
    n=${bareS.n} trades (${(bareS.n / (mondays + thursdays)).toFixed(1)} per Mon/Thu day-ticker)
    Win rate: ${(bareS.winRate*100).toFixed(1)}%
    Underlying cum: ${(bareS.cumPnL*100).toFixed(2)}%
    0DTE option cum: ${(bareS.optionCumPnL*100).toFixed(1)}%
    Sharpe: ${bareS.sharpe.toFixed(3)}
  `);
}

main();
