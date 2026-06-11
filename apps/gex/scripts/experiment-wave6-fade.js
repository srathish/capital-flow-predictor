#!/usr/bin/env node
/**
 * Wave 6 — drill down on the FADE signal.
 *
 * Wave 5 found: M.fade_15min EOD wins +16.18% over 72 days but the edge is
 * decaying (Dec25 +8.22%, JanFeb +7.28%, MarMay +0.68%).
 *
 * Wave 6 questions:
 *   1. Per-ticker — is fade primarily a SPX/SPY/QQQ thing or all 3?
 *   2. Magnitude filter — fade only when initial move > X%?
 *   3. Stop loss — can we cap the tail losses?
 *   4. Per-epoch best — what works in Mar-May 26 specifically?
 *   5. Direction asymmetry — fade-UP vs fade-DOWN
 *   6. Open + hold variant: at frame 30 (10:00 ET), fade the morning move
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
      frames.push({ ts: f.timestamp, spot: tk.spotPrice, strikes: tk.strikes, gamma: tk.gammaValues, vanna: tk.vannaValues });
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
  const recent15 = new Array(frames.length).fill(0);
  const recent5 = new Array(frames.length).fill(0);
  const recent30 = new Array(frames.length).fill(0);
  const regimes = frames.map(f => computeRegimeScore(f));
  for (let i = 0; i < frames.length; i++) {
    recent5[i] = (frames[i].spot - frames[Math.max(0, i - 5)].spot) / frames[Math.max(0, i - 5)].spot;
    recent15[i] = (frames[i].spot - frames[Math.max(0, i - 15)].spot) / frames[Math.max(0, i - 15)].spot;
    recent30[i] = (frames[i].spot - frames[Math.max(0, i - 30)].spot) / frames[Math.max(0, i - 30)].spot;
  }
  return { frames, recent5, recent15, recent30, regimes };
}

function simulate(byDayTicker, signalFn, options = {}) {
  const { stopPct = null, takePct = null, tickerFilter = null } = options;
  const trades = [];
  for (const [date, byTicker] of Object.entries(byDayTicker)) {
    for (const ticker of TICKERS) {
      if (tickerFilter && ticker !== tickerFilter) continue;
      const p = byTicker[ticker];
      if (!p) continue;
      const cost = FLIP_COST[ticker];
      let cooldownUntil = null;
      for (let i = 0; i < p.frames.length; i++) {
        const direction = signalFn(p, i, ticker, date);
        if (direction === 0) continue;
        if (cooldownUntil && p.frames[i].ts <= cooldownUntil) continue;
        const entrySpot = p.frames[i].spot;
        const maxExitIdx = p.frames.length - 1;
        let exitIdx = maxExitIdx;
        for (let j = i + 1; j <= maxExitIdx; j++) {
          const ret = (p.frames[j].spot - entrySpot) / entrySpot * direction;
          if (stopPct != null && ret <= -stopPct) { exitIdx = j; break; }
          if (takePct != null && ret >= takePct) { exitIdx = j; break; }
        }
        const moveReturn = (p.frames[exitIdx].spot - entrySpot) / entrySpot;
        const pnl = direction * moveReturn - cost;
        trades.push({ date, ticker, pnl, direction, magnitude: Math.abs(p.recent15[i]) });
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
  return { n: trades.length, winRate: wins / trades.length, avgPnL: avg, cumPnL: cum, sharpe, best: Math.max(...trades.map(t => t.pnl)), worst: Math.min(...trades.map(t => t.pnl)) };
}

function summarizeByEpoch(trades, epochs) {
  return epochs.map(ep => {
    const t = trades.filter(tr => ep.dates.has(tr.date));
    return { label: ep.label, ...(summarize(t) || { n: 0, cumPnL: 0, winRate: 0 }) };
  });
}

// Signal: fade 15-min momentum (the baseline winner)
const fadeBaseline = (p, i) => -Math.sign(p.recent15[i] || 0);

// Signal: fade only if magnitude > threshold
const fadeMagnitude = (threshold) => (p, i) => {
  const r = p.recent15[i];
  if (Math.abs(r) < threshold) return 0;
  return -Math.sign(r);
};

// Signal: fade based on different lookback
const fadeWindow = (lookbackArr) => (p, i) => {
  const r = lookbackArr[i];
  return -Math.sign(r || 0);
};

// Open-and-hold variant: fade at frame N
const fadeAtFrame = (frameIdx) => (p, i) => {
  if (i !== frameIdx) return 0;
  return -Math.sign(p.recent15[i] || 0);
};

function inSession(ts, h0, h1) {
  const d = new Date(ts);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return h >= h0 && h < h1;
}

const fadeSession = (h0, h1) => (p, i) => {
  if (!inSession(p.frames[i].ts, h0, h1)) return 0;
  return -Math.sign(p.recent15[i] || 0);
};

// Fade with regime gate
const fadePosRegime = (minR) => (p, i) => {
  if (p.regimes[i] <= minR) return 0;
  return -Math.sign(p.recent15[i] || 0);
};

const fadeNegRegime = (maxR) => (p, i) => {
  if (p.regimes[i] >= -maxR) return 0;
  return -Math.sign(p.recent15[i] || 0);
};

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(REPLAY_DIR).filter(f => /^gex-replay-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const allDates = files.map(f => f.match(/(\d{4}-\d{2}-\d{2})/)[1]);
  console.log(`▶ Wave 6: fade-signal deep dive on ${allDates.length} days\n`);
  console.log('Precomputing...');
  const t0 = Date.now();
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
  console.log(`Loaded ${days.length} days in ${Math.round((Date.now() - t0) / 1000)}s\n`);

  const epochSize = Math.ceil(days.length / 3);
  const epochs = [
    { label: 'Dec25', dates: new Set(days.slice(0, epochSize)) },
    { label: 'JanFeb26', dates: new Set(days.slice(epochSize, epochSize * 2)) },
    { label: 'MarMay26', dates: new Set(days.slice(epochSize * 2)) },
  ];

  // ─── A. Per-ticker breakdown of baseline fade ───
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  A. Per-ticker breakdown of M.fade_15min EOD');
  console.log('══════════════════════════════════════════════════════════════════');
  for (const ticker of TICKERS) {
    const trades = simulate(byDayTicker, fadeBaseline, { tickerFilter: ticker });
    const s = summarize(trades);
    const eps = summarizeByEpoch(trades, epochs);
    console.log(`  ${ticker}: n=${s.n}, win=${(s.winRate*100).toFixed(1)}%, cum=${(s.cumPnL*100).toFixed(2)}%, sharpe=${s.sharpe.toFixed(3)}`);
    for (const ep of eps) {
      console.log(`    ${ep.label.padEnd(10)} n=${String(ep.n).padStart(3)} cum=${(ep.cumPnL*100).toFixed(2).padStart(6)}% win=${(ep.winRate*100).toFixed(1)}%`);
    }
  }

  // ─── B. Magnitude-filtered fade ───
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  B. Fade only if initial move magnitude > X%');
  console.log('══════════════════════════════════════════════════════════════════');
  for (const minMag of [0.001, 0.002, 0.003, 0.005]) {
    const trades = simulate(byDayTicker, fadeMagnitude(minMag));
    const s = summarize(trades);
    const eps = summarizeByEpoch(trades, epochs);
    if (!s) continue;
    console.log(`  fade if |recent15min| > ${(minMag*100).toFixed(2)}%: n=${s.n}, win=${(s.winRate*100).toFixed(1)}%, cum=${(s.cumPnL*100).toFixed(2)}%, sharpe=${s.sharpe.toFixed(3)}, eps=[${eps.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);
  }

  // ─── C. Stop-loss managed fade ───
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  C. Fade with stop-loss');
  console.log('══════════════════════════════════════════════════════════════════');
  for (const stop of [0.003, 0.005, 0.01]) {
    const trades = simulate(byDayTicker, fadeBaseline, { stopPct: stop });
    const s = summarize(trades);
    const eps = summarizeByEpoch(trades, epochs);
    if (!s) continue;
    console.log(`  stop ${(stop*100).toFixed(2)}%: n=${s.n}, win=${(s.winRate*100).toFixed(1)}%, cum=${(s.cumPnL*100).toFixed(2)}%, sharpe=${s.sharpe.toFixed(3)}, eps=[${eps.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);
  }

  // ─── D. Take-profit managed fade ───
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  D. Fade with take-profit');
  console.log('══════════════════════════════════════════════════════════════════');
  for (const tp of [0.002, 0.003, 0.005, 0.01]) {
    const trades = simulate(byDayTicker, fadeBaseline, { takePct: tp });
    const s = summarize(trades);
    const eps = summarizeByEpoch(trades, epochs);
    if (!s) continue;
    console.log(`  TP ${(tp*100).toFixed(2)}%: n=${s.n}, win=${(s.winRate*100).toFixed(1)}%, cum=${(s.cumPnL*100).toFixed(2)}%, sharpe=${s.sharpe.toFixed(3)}, eps=[${eps.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);
  }

  // ─── E. Stop + TP combo ───
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  E. Fade with stop AND take-profit');
  console.log('══════════════════════════════════════════════════════════════════');
  for (const stop of [0.003, 0.005]) {
    for (const tp of [0.003, 0.005, 0.01]) {
      const trades = simulate(byDayTicker, fadeBaseline, { stopPct: stop, takePct: tp });
      const s = summarize(trades);
      const eps = summarizeByEpoch(trades, epochs);
      if (!s) continue;
      console.log(`  stop ${(stop*100).toFixed(2)}% + TP ${(tp*100).toFixed(2)}%: n=${s.n}, win=${(s.winRate*100).toFixed(1)}%, cum=${(s.cumPnL*100).toFixed(2)}%, sharpe=${s.sharpe.toFixed(3)}, eps=[${eps.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);
    }
  }

  // ─── F. Session-specific fade ───
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  F. Session-restricted fade');
  console.log('══════════════════════════════════════════════════════════════════');
  const sessionWindows = [
    ['9:30-10:30', 13.5, 14.5],
    ['10:00-11:30', 14.0, 15.5],
    ['10:30-12:00', 14.5, 16.0],
    ['11:30-13:30', 15.5, 17.5],
    ['13:30-15:00', 17.5, 19.0],
    ['9:30-12:00', 13.5, 16.0],
  ];
  for (const [label, h0, h1] of sessionWindows) {
    const trades = simulate(byDayTicker, fadeSession(h0, h1));
    const s = summarize(trades);
    const eps = summarizeByEpoch(trades, epochs);
    if (!s) continue;
    console.log(`  ${label.padEnd(12)}: n=${s.n}, win=${(s.winRate*100).toFixed(1)}%, cum=${(s.cumPnL*100).toFixed(2)}%, sharpe=${s.sharpe.toFixed(3)}, eps=[${eps.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);
  }

  // ─── G. Fade by lookback ───
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  G. Fade by different lookback windows');
  console.log('══════════════════════════════════════════════════════════════════');
  for (const [label, getArr] of [
    ['fade_5min', (p) => p.recent5],
    ['fade_15min', (p) => p.recent15],
    ['fade_30min', (p) => p.recent30],
  ]) {
    const trades = simulate(byDayTicker, (p, i) => -Math.sign(getArr(p)[i] || 0));
    const s = summarize(trades);
    const eps = summarizeByEpoch(trades, epochs);
    if (!s) continue;
    console.log(`  ${label.padEnd(12)}: n=${s.n}, win=${(s.winRate*100).toFixed(1)}%, cum=${(s.cumPnL*100).toFixed(2)}%, eps=[${eps.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);
  }

  // ─── H. Fade at specific frame (open-and-hold variants) ───
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  H. Fade at specific frame index (single trade per day)');
  console.log('══════════════════════════════════════════════════════════════════');
  for (const fi of [10, 20, 30, 60, 90]) {
    const trades = simulate(byDayTicker, fadeAtFrame(fi));
    const s = summarize(trades);
    const eps = summarizeByEpoch(trades, epochs);
    if (!s) continue;
    console.log(`  fade at frame ${String(fi).padStart(3)} (≈${(9.5 + fi/60).toFixed(1)}h ET): n=${s.n}, win=${(s.winRate*100).toFixed(1)}%, cum=${(s.cumPnL*100).toFixed(2)}%, eps=[${eps.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);
  }

  // ─── I. Per-ticker fade with best filters ───
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  I. Per-ticker fade at frame 30 (10:00 ET) with stop+TP');
  console.log('══════════════════════════════════════════════════════════════════');
  for (const ticker of TICKERS) {
    for (const stop of [0.005, 0.01]) {
      for (const tp of [0.005, 0.01]) {
        const trades = simulate(byDayTicker, fadeAtFrame(30), { tickerFilter: ticker, stopPct: stop, takePct: tp });
        const s = summarize(trades);
        const eps = summarizeByEpoch(trades, epochs);
        if (!s) continue;
        console.log(`  ${ticker} stop ${(stop*100).toFixed(2)}% + TP ${(tp*100).toFixed(2)}%: n=${s.n}, win=${(s.winRate*100).toFixed(1)}%, cum=${(s.cumPnL*100).toFixed(2)}%, eps=[${eps.map(e => (e.cumPnL*100).toFixed(1) + '%').join(', ')}]`);
      }
    }
  }

  console.log('\n');
}

main();
