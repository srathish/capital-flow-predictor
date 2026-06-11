#!/usr/bin/env node
/**
 * Wave 8 — drill into MONDAY-FADE, the anti-decay signal.
 *
 * Wave 7 finding: Mondays = 66.7% win rate, +14.07% cum, epoch 3 +8.2%.
 *
 * Wave 8 questions:
 *   1. Per-ticker Monday-fade breakdown
 *   2. Monday-fade with various stops/TPs
 *   3. Monday-fade with regime/volatility filters
 *   4. Monday-LONG vs Monday-SHORT asymmetry
 *   5. Monday-only vs Monday+Thursday combo (was Thu +5.46%)
 *   6. First-Monday-of-month, post-holiday-Monday effects
 *   7. SPX vs SPY vs QQQ Monday-fade
 *   8. 0DTE option P&L on Monday-fade
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
      if (!tk || !tk.spotPrice || !Array.isArray(tk.gammaValues)) continue;
      frames.push({ ts: f.timestamp, spot: tk.spotPrice, strikes: tk.strikes, gamma: tk.gammaValues });
    }
    out[t] = frames;
  }
  return out;
}

function computeRegime(frame) {
  let total = 0, signed = 0;
  for (let i = 0; i < frame.strikes.length; i++) {
    const g = frame.gamma[i]?.[0] ?? 0;
    total += Math.abs(g);
    signed += g;
  }
  return total > 0 ? signed / total : 0;
}

function precomputeForTicker(frames) {
  const recent15 = new Array(frames.length).fill(0);
  const regimes = frames.map(f => computeRegime(f));
  for (let i = 0; i < frames.length; i++) {
    recent15[i] = (frames[i].spot - frames[Math.max(0, i - 15)].spot) / frames[Math.max(0, i - 15)].spot;
  }
  return { frames, recent15, regimes };
}

function inSession(ts, h0, h1) {
  const d = new Date(ts);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return h >= h0 && h < h1;
}

function dayOfWeek(dateStr) {
  return new Date(dateStr).getUTCDay();
}

function simulate(byDayTicker, signalFn, options = {}) {
  const { stopPct = null, takePct = null, tickerFilter = null, dayFilter = null } = options;
  const trades = [];
  for (const [date, byTicker] of Object.entries(byDayTicker)) {
    if (dayFilter && !dayFilter(date)) continue;
    for (const ticker of TICKERS) {
      if (tickerFilter && ticker !== tickerFilter) continue;
      const p = byTicker[ticker]; if (!p) continue;
      const cost = FLIP_COST[ticker];
      let cooldownUntil = null;
      for (let i = 0; i < p.frames.length; i++) {
        const direction = signalFn(p, i, ticker, date);
        if (direction === 0) continue;
        if (cooldownUntil && p.frames[i].ts <= cooldownUntil) continue;
        const entrySpot = p.frames[i].spot;
        const maxExit = p.frames.length - 1;
        let exitIdx = maxExit;
        let peakRet = 0;
        for (let j = i + 1; j <= maxExit; j++) {
          const ret = (p.frames[j].spot - entrySpot) / entrySpot * direction;
          if (ret > peakRet) peakRet = ret;
          if (stopPct != null && ret <= -stopPct) { exitIdx = j; break; }
          if (takePct != null && ret >= takePct) { exitIdx = j; break; }
        }
        const moveReturn = (p.frames[exitIdx].spot - entrySpot) / entrySpot;
        const pnl = direction * moveReturn - cost;
        // Compute 0DTE option leverage at entry
        const entryDate = new Date(p.frames[i].ts);
        const closeDate = new Date(p.frames[i].ts.slice(0, 10) + 'T20:00:00Z');
        const hoursLeft = (closeDate - entryDate) / 3600000;
        const lev = hoursLeft <= 0.1 ? 50 : Math.min(50, 5 + 18 / Math.sqrt(hoursLeft));
        const optionMove = Math.max(-1.0, lev * direction * moveReturn);
        const optionPnL = optionMove - 0.01; // 1% round-trip
        trades.push({ date, ticker, ts: p.frames[i].ts, direction, pnl, optionPnL, lev });
        cooldownUntil = new Date(new Date(p.frames[i].ts).getTime() + (exitIdx - i) * 60000).toISOString();
      }
    }
  }
  return trades;
}

function summarize(trades) {
  if (!trades.length) return null;
  const cum = trades.reduce((a, t) => a + t.pnl, 0);
  const avg = cum / trades.length;
  const wins = trades.filter(t => t.pnl > 0).length;
  const variance = trades.reduce((a, t) => a + (t.pnl - avg) ** 2, 0) / trades.length;
  const sharpe = variance > 0 ? avg / Math.sqrt(variance) : 0;
  const optCum = trades.reduce((a, t) => a + t.optionPnL, 0);
  const optWins = trades.filter(t => t.optionPnL > 0).length;
  return { n: trades.length, winRate: wins / trades.length, avgPnL: avg, cumPnL: cum, sharpe, optionCumPnL: optCum, optionWinRate: optWins / trades.length };
}

function byEpoch(trades, epochs) {
  return epochs.map(e => {
    const t = trades.filter(tr => e.dates.has(tr.date));
    return { label: e.label, ...(summarize(t) || { n: 0, cumPnL: 0, winRate: 0, optionCumPnL: 0 }) };
  });
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(REPLAY_DIR).filter(f => /^gex-replay-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const allDates = files.map(f => f.match(/(\d{4}-\d{2}-\d{2})/)[1]);
  console.log(`▶ Wave 8: Monday-fade drilldown on ${allDates.length} days\n`);

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
  const mondays = days.filter(d => dayOfWeek(d) === 1);
  console.log(`Loaded ${days.length} days (${mondays.length} Mondays)\n`);

  const epochSize = Math.ceil(days.length / 3);
  const epochs = [
    { label: 'Dec25', dates: new Set(days.slice(0, epochSize)) },
    { label: 'JanFeb26', dates: new Set(days.slice(epochSize, epochSize * 2)) },
    { label: 'MarMay26', dates: new Set(days.slice(epochSize * 2)) },
  ];

  const isMon = (d) => dayOfWeek(d) === 1;
  const fadeMorning = (p, i) => {
    if (!inSession(p.frames[i].ts, 13.5, 16.0)) return 0;
    return -Math.sign(p.recent15[i] || 0);
  };

  // ── A. Monday fade per ticker ──
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  A. Per-ticker Monday fade (morning, hold EOD)');
  console.log('══════════════════════════════════════════════════════════════════');
  for (const ticker of TICKERS) {
    const trades = simulate(byDayTicker, fadeMorning, { dayFilter: isMon, tickerFilter: ticker });
    const s = summarize(trades);
    if (!s) continue;
    const eps = byEpoch(trades, epochs);
    console.log(`  ${ticker}: n=${s.n}, win=${(s.winRate*100).toFixed(1)}%, cum=${(s.cumPnL*100).toFixed(2)}%, sharpe=${s.sharpe.toFixed(3)}, ` +
      `eps=[${eps.map(e => `${(e.cumPnL*100).toFixed(1)}%`).join(', ')}], ` +
      `0DTE: cum=${(s.optionCumPnL*100).toFixed(1)}%, win=${(s.optionWinRate*100).toFixed(1)}%`);
  }

  // ── B. Monday LONG only vs SHORT only ──
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  B. Monday LONG-only vs SHORT-only');
  console.log('══════════════════════════════════════════════════════════════════');
  const fadeMondayLongOnly = (p, i) => { const d = fadeMorning(p, i); return d === 1 ? 1 : 0; };
  const fadeMondaySrtOnly = (p, i) => { const d = fadeMorning(p, i); return d === -1 ? -1 : 0; };
  const longT = simulate(byDayTicker, fadeMondayLongOnly, { dayFilter: isMon });
  const srtT = simulate(byDayTicker, fadeMondaySrtOnly, { dayFilter: isMon });
  const longS = summarize(longT), srtS = summarize(srtT);
  if (longS) console.log(`  LONG only:  n=${longS.n}, win=${(longS.winRate*100).toFixed(1)}%, cum=${(longS.cumPnL*100).toFixed(2)}%, 0DTE=${(longS.optionCumPnL*100).toFixed(1)}%`);
  if (srtS) console.log(`  SHORT only: n=${srtS.n}, win=${(srtS.winRate*100).toFixed(1)}%, cum=${(srtS.cumPnL*100).toFixed(2)}%, 0DTE=${(srtS.optionCumPnL*100).toFixed(1)}%`);

  // ── C. Monday + stops/TPs ──
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  C. Monday fade + risk management');
  console.log('══════════════════════════════════════════════════════════════════');
  for (const stop of [null, 0.005, 0.01]) {
    for (const tp of [null, 0.01, 0.02]) {
      const t = simulate(byDayTicker, fadeMorning, { dayFilter: isMon, stopPct: stop, takePct: tp });
      const s = summarize(t); if (!s) continue;
      const eps = byEpoch(t, epochs);
      const sLabel = stop == null ? 'none' : `${(stop*100).toFixed(1)}%`;
      const tLabel = tp == null ? 'none' : `${(tp*100).toFixed(1)}%`;
      console.log(`  stop=${sLabel.padEnd(4)} TP=${tLabel.padEnd(4)} : n=${s.n}, win=${(s.winRate*100).toFixed(1)}%, cum=${(s.cumPnL*100).toFixed(2)}%, 0DTE=${(s.optionCumPnL*100).toFixed(1)}%, eps=[${eps.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);
    }
  }

  // ── D. Monday + regime conditioning ──
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  D. Monday fade + regime gating');
  console.log('══════════════════════════════════════════════════════════════════');
  const monPos = (p, i) => {
    if (!isMon(p.frames[i].ts.slice(0, 10))) return 0;
    if (!inSession(p.frames[i].ts, 13.5, 16.0)) return 0;
    if (p.regimes[i] <= 0.1) return 0;
    return -Math.sign(p.recent15[i] || 0);
  };
  const monNeg = (p, i) => {
    if (!isMon(p.frames[i].ts.slice(0, 10))) return 0;
    if (!inSession(p.frames[i].ts, 13.5, 16.0)) return 0;
    if (p.regimes[i] >= -0.1) return 0;
    return -Math.sign(p.recent15[i] || 0);
  };
  const monPosT = simulate(byDayTicker, monPos);
  const monNegT = simulate(byDayTicker, monNeg);
  const monPosS = summarize(monPosT), monNegS = summarize(monNegT);
  if (monPosS) console.log(`  Monday + pos regime: n=${monPosS.n}, win=${(monPosS.winRate*100).toFixed(1)}%, cum=${(monPosS.cumPnL*100).toFixed(2)}%, 0DTE=${(monPosS.optionCumPnL*100).toFixed(1)}%, eps=[${byEpoch(monPosT, epochs).map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);
  if (monNegS) console.log(`  Monday + neg regime: n=${monNegS.n}, win=${(monNegS.winRate*100).toFixed(1)}%, cum=${(monNegS.cumPnL*100).toFixed(2)}%, 0DTE=${(monNegS.optionCumPnL*100).toFixed(1)}%, eps=[${byEpoch(monNegT, epochs).map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);

  // ── E. First-of-month Monday vs other Mondays ──
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  E. First Monday of month vs other Mondays');
  console.log('══════════════════════════════════════════════════════════════════');
  const isFirstMondayOfMonth = (d) => {
    if (!isMon(d)) return false;
    const day = new Date(d).getUTCDate();
    return day <= 7;
  };
  const fT = simulate(byDayTicker, fadeMorning, { dayFilter: isFirstMondayOfMonth });
  const fS = summarize(fT);
  const otherMonT = simulate(byDayTicker, fadeMorning, { dayFilter: (d) => isMon(d) && !isFirstMondayOfMonth(d) });
  const otherMonS = summarize(otherMonT);
  if (fS) console.log(`  First Monday: n=${fS.n}, win=${(fS.winRate*100).toFixed(1)}%, cum=${(fS.cumPnL*100).toFixed(2)}%, 0DTE=${(fS.optionCumPnL*100).toFixed(1)}%`);
  if (otherMonS) console.log(`  Other Mondays: n=${otherMonS.n}, win=${(otherMonS.winRate*100).toFixed(1)}%, cum=${(otherMonS.cumPnL*100).toFixed(2)}%, 0DTE=${(otherMonS.optionCumPnL*100).toFixed(1)}%`);

  // ── F. Monday + Thursday combo (Thu was 2nd best day) ──
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  F. Monday + Thursday combo (vs Monday alone, Thursday alone)');
  console.log('══════════════════════════════════════════════════════════════════');
  const monThu = (d) => isMon(d) || dayOfWeek(d) === 4;
  const t1 = simulate(byDayTicker, fadeMorning, { dayFilter: isMon });
  const s1 = summarize(t1);
  const e1 = byEpoch(t1, epochs);
  const t2 = simulate(byDayTicker, fadeMorning, { dayFilter: (d) => dayOfWeek(d) === 4 });
  const s2 = summarize(t2);
  const e2 = byEpoch(t2, epochs);
  const t3 = simulate(byDayTicker, fadeMorning, { dayFilter: monThu });
  const s3 = summarize(t3);
  const e3 = byEpoch(t3, epochs);
  console.log(`  Monday only:     n=${s1.n}, win=${(s1.winRate*100).toFixed(1)}%, cum=${(s1.cumPnL*100).toFixed(2)}%, 0DTE=${(s1.optionCumPnL*100).toFixed(1)}%, eps=[${e1.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);
  console.log(`  Thursday only:   n=${s2.n}, win=${(s2.winRate*100).toFixed(1)}%, cum=${(s2.cumPnL*100).toFixed(2)}%, 0DTE=${(s2.optionCumPnL*100).toFixed(1)}%, eps=[${e2.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);
  console.log(`  Mon + Thu combo: n=${s3.n}, win=${(s3.winRate*100).toFixed(1)}%, cum=${(s3.cumPnL*100).toFixed(2)}%, 0DTE=${(s3.optionCumPnL*100).toFixed(1)}%, eps=[${e3.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);

  // ── G. Monday-fade SPLIT by initial move magnitude ──
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  G. Monday fade by initial move magnitude');
  console.log('══════════════════════════════════════════════════════════════════');
  for (const minMag of [0.001, 0.002, 0.003, 0.005]) {
    const fn = (p, i) => {
      if (!inSession(p.frames[i].ts, 13.5, 16.0)) return 0;
      if (Math.abs(p.recent15[i]) < minMag) return 0;
      return -Math.sign(p.recent15[i] || 0);
    };
    const t = simulate(byDayTicker, fn, { dayFilter: isMon });
    const s = summarize(t); if (!s) continue;
    const eps = byEpoch(t, epochs);
    console.log(`  |move| > ${(minMag*100).toFixed(2)}%: n=${s.n}, win=${(s.winRate*100).toFixed(1)}%, cum=${(s.cumPnL*100).toFixed(2)}%, 0DTE=${(s.optionCumPnL*100).toFixed(1)}%, eps=[${eps.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);
  }

  // ── H. Final Monday-fade trade log dump ──
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  H. Monday-fade detailed trade log (per ticker, with 0DTE estimate)');
  console.log('══════════════════════════════════════════════════════════════════');
  const allMondayTrades = simulate(byDayTicker, fadeMorning, { dayFilter: isMon });
  for (const ticker of TICKERS) {
    console.log(`\n  ${ticker}:`);
    const t = allMondayTrades.filter(x => x.ticker === ticker);
    t.sort((a, b) => a.date.localeCompare(b.date));
    let cum = 0, cumOpt = 0;
    for (const tr of t) {
      cum += tr.pnl;
      cumOpt += tr.optionPnL;
      console.log(`    ${tr.date} dir=${tr.direction === 1 ? 'LONG ' : 'SHORT'}  pnl=${(tr.pnl*100).toFixed(2).padStart(6)}% (cum ${(cum*100).toFixed(2).padStart(7)}%)   0DTE=${(tr.optionPnL*100).toFixed(1).padStart(6)}% (cum ${(cumOpt*100).toFixed(1).padStart(7)}%)  lev=${tr.lev.toFixed(1)}`);
    }
  }

  console.log('\n');
}

main();
