#!/usr/bin/env node
// Replay the system at an instant on a past day: 0DTE boards (now + 15 min earlier) + session bars → day type, trinity, 9 steps, card.
// usage: node replay.mjs --date 2026-10-01 --time 10:40 [--symbols SPXW,SPY,QQQ] [--no-contract] [--every 30]  (times in ET)
import { heatmapAt, atlasHistory, usage, account } from './feeds/skylit.js';
import { PRICE_SYMBOL } from './map/board.js';
import { runPass } from './loop/run.js';
import { pickContract } from './execution/contract.js';
import { renderHeader, renderSymbol } from './card/render.js';
import { etToUnix, iso } from './lib/time.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? (process.argv[i + 1]?.startsWith('--') ? true : process.argv[i + 1]) ?? true : d; };
const date = arg('date'); if (!date) { console.error('need --date YYYY-MM-DD'); process.exit(1); }
const symbols = String(arg('symbols', 'SPXW,SPY,QQQ')).split(',');
const noContract = process.argv.includes('--no-contract');
const every = Number(arg('every', 0)); // minutes; if set, sweep from --time to --until
const until = arg('until', null);

const open = etToUnix(date, '09:30');
const pxSyms = [...new Set(symbols.map((s) => PRICE_SYMBOL[s] ?? s))];
const daily = {}, fullBars = {};
for (const px of pxSyms) {
  daily[px] = await atlasHistory(px, 'D', open - 15 * 86400, open + 86400);
  fullBars[px] = await atlasHistory(px, '1', open, etToUnix(date, '16:00'));
}
const byMap = (arr) => Object.fromEntries(arr.map((s) => [s.symbol, s]));

async function at(hhmm) {
  const t = etToUnix(date, hhmm);
  if (t > Math.floor(Date.now() / 1000) - 90) { console.log(`\n(${date} ${hhmm} ET is in the future — stopping here; re-run after the close for the rest of the day)`); return null; }
  const [cur, prev] = await Promise.all([
    heatmapAt(symbols, iso(t), { expirations: date }),
    heatmapAt(symbols, iso(t - 15 * 60), { expirations: date }).catch(() => []),
  ]);
  const bars = Object.fromEntries(pxSyms.map((px) => [px, fullBars[px].filter((b) => b.t >= open && b.t <= t)]));
  const out = runPass({ symbols, boards: byMap(cur), prevBoards: byMap(prev), bars, daily, date });
  console.log(renderHeader({ when: `${date} ${hhmm} ET`, day: out.day, tri: out.tri, usage }));
  for (const sym of symbols) {
    const r = out.results[sym]; if (!r) continue;
    let contract = null;
    if (r.decision === 'CARD' && !noContract) contract = await pickContract({ symbol: sym, direction: r.direction, spot: out.ctx[sym].board.spot, date });
    console.log(renderSymbol(r, out.ctx[sym], contract));
  }
  return out;
}

const start = String(arg('time', '10:00'));
if (every > 0 && until) {
  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  for (let m = toMin(start); m <= toMin(until); m += every) { await at(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`); }
} else {
  await at(start);
}
const acct = await account().catch(() => null);
console.log(`\ncalls ${usage.calls} · credits left ${acct?.creditsBalance ?? usage.creditsRemaining ?? '?'}`);
