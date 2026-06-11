#!/usr/bin/env node
/**
 * Wave 7 — find what works RECENTLY (epoch 3: Mar-May 2026).
 *
 * Fade strategy decays. Maybe market regime shifted to momentum-driven. This
 * wave looks for:
 *
 *   1. Signals with POSITIVE epoch 3 P&L (even if epochs 1-2 lost)
 *   2. Day-of-week effects (Monday vs Friday, etc.)
 *   3. Follow-momentum variants in MOST RECENT epoch
 *   4. Volatility-regime filters (proxy by abs of overnight gap)
 *   5. Portfolio combinations: combine fade with momentum to diversify
 *   6. Per-ticker × per-session epoch-3 breakdown
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

function computeRegimeScore(frame) {
  let total = 0, signed = 0;
  for (let i = 0; i < frame.strikes.length; i++) {
    const g = frame.gamma[i]?.[0] ?? 0;
    total += Math.abs(g);
    signed += g;
  }
  return total > 0 ? signed / total : 0;
}

function precomputeForTicker(frames) {
  const recent5 = new Array(frames.length).fill(0);
  const recent15 = new Array(frames.length).fill(0);
  const recent30 = new Array(frames.length).fill(0);
  const regimes = frames.map(f => computeRegimeScore(f));
  for (let i = 0; i < frames.length; i++) {
    recent5[i] = (frames[i].spot - frames[Math.max(0, i - 5)].spot) / frames[Math.max(0, i - 5)].spot;
    recent15[i] = (frames[i].spot - frames[Math.max(0, i - 15)].spot) / frames[Math.max(0, i - 15)].spot;
    recent30[i] = (frames[i].spot - frames[Math.max(0, i - 30)].spot) / frames[Math.max(0, i - 30)].spot;
  }
  return { frames, recent5, recent15, recent30, regimes };
}

function inSession(ts, h0, h1) {
  const d = new Date(ts);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return h >= h0 && h < h1;
}

function dayOfWeek(date) {
  return new Date(date).getUTCDay(); // 0=Sun, 1=Mon ... 5=Fri
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
        for (let j = i + 1; j <= maxExit; j++) {
          const ret = (p.frames[j].spot - entrySpot) / entrySpot * direction;
          if (stopPct != null && ret <= -stopPct) { exitIdx = j; break; }
          if (takePct != null && ret >= takePct) { exitIdx = j; break; }
        }
        const moveReturn = (p.frames[exitIdx].spot - entrySpot) / entrySpot;
        const pnl = direction * moveReturn - cost;
        trades.push({ date, ticker, pnl, direction });
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
  return { n: trades.length, winRate: wins / trades.length, avgPnL: avg, cumPnL: cum, sharpe };
}

function byEpoch(trades, epochs) {
  return epochs.map(e => {
    const t = trades.filter(tr => e.dates.has(tr.date));
    return { label: e.label, ...(summarize(t) || { n: 0, cumPnL: 0, winRate: 0 }) };
  });
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(REPLAY_DIR).filter(f => /^gex-replay-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const allDates = files.map(f => f.match(/(\d{4}-\d{2}-\d{2})/)[1]);
  console.log(`▶ Wave 7: epoch-3 hunt on ${allDates.length} days\n`);
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
  console.log(`Loaded ${days.length} days\n`);

  const epochSize = Math.ceil(days.length / 3);
  const epochs = [
    { label: 'Dec25', dates: new Set(days.slice(0, epochSize)) },
    { label: 'JanFeb26', dates: new Set(days.slice(epochSize, epochSize * 2)) },
    { label: 'MarMay26', dates: new Set(days.slice(epochSize * 2)) },
  ];

  // ─── A. Day-of-week effects on the fade strategy ───
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  A. Fade by day-of-week (morning fade, hold EOD)');
  console.log('══════════════════════════════════════════════════════════════════');
  const fadeMorning = (p, i) => {
    if (!inSession(p.frames[i].ts, 13.5, 16.0)) return 0;
    return -Math.sign(p.recent15[i] || 0);
  };
  const dows = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5]];
  for (const [label, dow] of dows) {
    const trades = simulate(byDayTicker, fadeMorning, { dayFilter: (d) => dayOfWeek(d) === dow });
    const s = summarize(trades);
    if (!s) continue;
    const eps = byEpoch(trades, epochs);
    console.log(`  ${label}: n=${s.n}, win=${(s.winRate*100).toFixed(1)}%, cum=${(s.cumPnL*100).toFixed(2)}%, eps=[${eps.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);
  }

  // ─── B. Look for signals POSITIVE in epoch 3 specifically ───
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  B. Hunt: signals with POSITIVE epoch-3 P&L (n≥10)');
  console.log('══════════════════════════════════════════════════════════════════');

  // Build a battery of candidate signals
  const candidates = [];
  // Pure momentum (the OPPOSITE of fade)
  for (const lb of ['recent5', 'recent15', 'recent30']) {
    candidates.push({ id: `mom_${lb}`, fn: (p, i) => Math.sign(p[lb][i] || 0) });
    candidates.push({ id: `mom_${lb}_strong`, fn: (p, i) => Math.abs(p[lb][i]) < 0.002 ? 0 : Math.sign(p[lb][i]) });
    candidates.push({ id: `mom_${lb}_2x`, fn: (p, i) => Math.abs(p[lb][i]) < 0.005 ? 0 : Math.sign(p[lb][i]) });
  }
  // Session momentum
  const sessions = [['open', 13.5, 14.0], ['morn', 14.0, 15.5], ['lunch', 15.5, 17.5], ['aft', 17.5, 19.0], ['pwr', 19.0, 20.0]];
  for (const [lbl, h0, h1] of sessions) {
    candidates.push({ id: `${lbl}_mom`, fn: (p, i) => inSession(p.frames[i].ts, h0, h1) ? Math.sign(p.recent15[i] || 0) : 0 });
    candidates.push({ id: `${lbl}_fade`, fn: (p, i) => inSession(p.frames[i].ts, h0, h1) ? -Math.sign(p.recent15[i] || 0) : 0 });
  }
  // Regime gates
  for (const r of [0.1, 0.2, 0.3, 0.5]) {
    candidates.push({ id: `regime>+${r}_long`, fn: (p, i) => p.regimes[i] > r ? 1 : 0 });
    candidates.push({ id: `regime>+${r}_short`, fn: (p, i) => p.regimes[i] > r ? -1 : 0 });
    candidates.push({ id: `regime<-${r}_long`, fn: (p, i) => p.regimes[i] < -r ? 1 : 0 });
    candidates.push({ id: `regime<-${r}_short`, fn: (p, i) => p.regimes[i] < -r ? -1 : 0 });
  }
  // Per-ticker momentum
  for (const ticker of TICKERS) {
    candidates.push({ id: `${ticker}_mom_15`, fn: (p, i, tk) => tk === ticker ? Math.sign(p.recent15[i] || 0) : 0 });
    candidates.push({ id: `${ticker}_fade_15`, fn: (p, i, tk) => tk === ticker ? -Math.sign(p.recent15[i] || 0) : 0 });
  }

  // Run all and filter for positive epoch 3
  const ep3Winners = [];
  for (const c of candidates) {
    const trades = simulate(byDayTicker, c.fn);
    const eps = byEpoch(trades, epochs);
    const ep3 = eps[2];
    const overall = summarize(trades);
    if (!ep3 || ep3.n < 10) continue;
    if (ep3.cumPnL > 0.005) { // meaningful positive
      ep3Winners.push({ id: c.id, overall, eps });
    }
  }
  // Sort by epoch 3 cum P&L
  ep3Winners.sort((a, b) => b.eps[2].cumPnL - a.eps[2].cumPnL);
  for (let i = 0; i < Math.min(20, ep3Winners.length); i++) {
    const r = ep3Winners[i];
    console.log(`  ${r.id.padEnd(28)} overall n=${String(r.overall.n).padStart(4)} cum=${(r.overall.cumPnL*100).toFixed(2).padStart(7)}% | ep3 n=${String(r.eps[2].n).padStart(3)} win=${(r.eps[2].winRate*100).toFixed(1)}% cum=${(r.eps[2].cumPnL*100).toFixed(2)}% | eps=[${r.eps.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);
  }

  // ─── C. The 'flip' strategy: fade in epochs 1-2, momentum in epoch 3 ───
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  C. ALL three tickers — best per-ticker per-epoch fade/momentum');
  console.log('══════════════════════════════════════════════════════════════════');
  for (const ticker of TICKERS) {
    console.log(`\n  ${ticker}:`);
    // Test fade
    const fadeTrades = simulate(byDayTicker, (p, i) => inSession(p.frames[i].ts, 13.5, 16.0) ? -Math.sign(p.recent15[i] || 0) : 0, { tickerFilter: ticker });
    const fadeEps = byEpoch(fadeTrades, epochs);
    const fadeAll = summarize(fadeTrades);
    console.log(`    FADE morning: n=${fadeAll.n}, cum=${(fadeAll.cumPnL*100).toFixed(2)}%, eps=[${fadeEps.map(e => `${(e.cumPnL*100).toFixed(1)}%(w${(e.winRate*100).toFixed(0)})`).join(', ')}]`);

    // Test momentum
    const momTrades = simulate(byDayTicker, (p, i) => inSession(p.frames[i].ts, 13.5, 16.0) ? Math.sign(p.recent15[i] || 0) : 0, { tickerFilter: ticker });
    const momEps = byEpoch(momTrades, epochs);
    const momAll = summarize(momTrades);
    console.log(`    MOMENTUM morn: n=${momAll.n}, cum=${(momAll.cumPnL*100).toFixed(2)}%, eps=[${momEps.map(e => `${(e.cumPnL*100).toFixed(1)}%(w${(e.winRate*100).toFixed(0)})`).join(', ')}]`);
  }

  // ─── D. PORTFOLIO: combine fade + momentum across tickers ───
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  D. PORTFOLIO: take BOTH fade and momentum signals (diversified)');
  console.log('══════════════════════════════════════════════════════════════════');
  // Run fade with simulate, run momentum separately, combine
  const fadeTrades = simulate(byDayTicker, (p, i) => inSession(p.frames[i].ts, 13.5, 16.0) ? -Math.sign(p.recent15[i] || 0) : 0);
  const momTrades = simulate(byDayTicker, (p, i) => inSession(p.frames[i].ts, 13.5, 16.0) ? Math.sign(p.recent15[i] || 0) : 0);
  // Combined: half-size each
  const combinedTrades = [...fadeTrades.map(t => ({ ...t, pnl: t.pnl / 2 })), ...momTrades.map(t => ({ ...t, pnl: t.pnl / 2 }))];
  const combinedS = summarize(combinedTrades);
  const combinedEps = byEpoch(combinedTrades, epochs);
  console.log(`  Combined (half-size each): n=${combinedS.n}, cum=${(combinedS.cumPnL*100).toFixed(2)}%, win=${(combinedS.winRate*100).toFixed(1)}%, eps=[${combinedEps.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);

  // ─── E. Volatility regime: gap-based filter ───
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  E. Volatility-conditional fade (high-vol vs low-vol days)');
  console.log('══════════════════════════════════════════════════════════════════');
  // Define "high vol" as days where SPY's 30-min open range > 0.5%
  const dayVolMap = {};
  for (const [date, byTicker] of Object.entries(byDayTicker)) {
    const p = byTicker.SPY;
    if (!p || p.frames.length < 30) continue;
    let high = -Infinity, low = Infinity;
    for (let i = 0; i < 30; i++) {
      if (p.frames[i].spot > high) high = p.frames[i].spot;
      if (p.frames[i].spot < low) low = p.frames[i].spot;
    }
    dayVolMap[date] = (high - low) / low;
  }
  const fadeAllDay = (p, i) => inSession(p.frames[i].ts, 13.5, 16.0) ? -Math.sign(p.recent15[i] || 0) : 0;
  for (const [label, filter] of [
    ['high vol (>0.5% range)', (d) => dayVolMap[d] > 0.005],
    ['mid vol (0.3-0.5%)', (d) => dayVolMap[d] > 0.003 && dayVolMap[d] <= 0.005],
    ['low vol (<0.3% range)', (d) => dayVolMap[d] <= 0.003],
  ]) {
    const t = simulate(byDayTicker, fadeAllDay, { dayFilter: filter });
    const s = summarize(t);
    const eps = byEpoch(t, epochs);
    if (!s) continue;
    console.log(`  ${label}: n=${s.n}, win=${(s.winRate*100).toFixed(1)}%, cum=${(s.cumPnL*100).toFixed(2)}%, eps=[${eps.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);
  }

  // ─── F. Trinity confluence (all 3 tickers agree) momentum/fade ───
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  F. Trinity confluence: only trade when all 3 tickers agree on 15-min direction');
  console.log('══════════════════════════════════════════════════════════════════');
  // For each (date, frame), check if SPX, SPY, QQQ all have same 15-min direction. If so, FADE that.
  const trinityFade = (p, i, ticker, date) => {
    const a = Math.sign(byDayTicker[date]?.SPXW?.recent15[i] || 0);
    const b = Math.sign(byDayTicker[date]?.SPY?.recent15[i] || 0);
    const c = Math.sign(byDayTicker[date]?.QQQ?.recent15[i] || 0);
    if (a === 0 || b === 0 || c === 0) return 0;
    if (a !== b || b !== c) return 0;
    if (!inSession(p.frames[i].ts, 13.5, 16.0)) return 0;
    return -a;
  };
  const trinityFadeTrades = simulate(byDayTicker, trinityFade);
  const tfs = summarize(trinityFadeTrades);
  const tfe = byEpoch(trinityFadeTrades, epochs);
  if (tfs) console.log(`  TRINITY FADE (all 3 agree): n=${tfs.n}, win=${(tfs.winRate*100).toFixed(1)}%, cum=${(tfs.cumPnL*100).toFixed(2)}%, eps=[${tfe.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);

  const trinityMom = (p, i, ticker, date) => {
    const a = Math.sign(byDayTicker[date]?.SPXW?.recent15[i] || 0);
    const b = Math.sign(byDayTicker[date]?.SPY?.recent15[i] || 0);
    const c = Math.sign(byDayTicker[date]?.QQQ?.recent15[i] || 0);
    if (a === 0 || b === 0 || c === 0) return 0;
    if (a !== b || b !== c) return 0;
    if (!inSession(p.frames[i].ts, 13.5, 16.0)) return 0;
    return a;
  };
  const trinityMomTrades = simulate(byDayTicker, trinityMom);
  const tms = summarize(trinityMomTrades);
  const tme = byEpoch(trinityMomTrades, epochs);
  if (tms) console.log(`  TRINITY MOMENTUM (all 3 agree): n=${tms.n}, win=${(tms.winRate*100).toFixed(1)}%, cum=${(tms.cumPnL*100).toFixed(2)}%, eps=[${tme.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);

  console.log('\n');
}

main();
