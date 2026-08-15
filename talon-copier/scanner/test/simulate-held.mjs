// simulate-held.mjs — turn the daily LLM views into HELD positions. One position per
// ticker: open on a directional read, HOLD through same-direction / no-trade days,
// exit only on target, structural stop (close beyond invalidation), or a genuine flip
// to the opposite read. Reuses the saved forward views + OHLC — no new LLM calls.
import { readJson, resolveFromRoot } from '../lib/util.mjs';

const T = process.argv[2] || 'MU';
const file = process.argv[3] || `data/backtest/forward_${T}_2026-07-01_2026-08-14.json`;
const fwd = readJson(resolveFromRoot(file));
const ohlc = readJson(resolveFromRoot(`data/backtest/ohlc/${T}.json`))?.ohlc || [];
const byDate = {}; for (const o of ohlc) byDate[o.date] = o;

const MODE = process.argv[4] || 'trend'; // 'flip' (target+stop+verdict-flip) | 'trend' (ride: migration-flip + trailing stop, no fixed target)
const TRAIL = 0.06;
let pos = null;
const trades = [];
const tdays = (a, b) => ohlc.filter((o) => o.date > a && o.date <= b).length;
function open(dir, row, bar) { pos = { dir, entry: bar.close, target: row.plan.target, stop: row.plan.invalidation, entryDate: row.date, contract: row.plan.contract, hw: bar.close, lw: bar.close }; }
function close(exitDate, exitPx, reason) {
  const pl = pos.dir === 'long' ? (exitPx - pos.entry) / pos.entry : (pos.entry - exitPx) / pos.entry;
  trades.push({ dir: pos.dir, entryDate: pos.entryDate, entry: pos.entry, exitDate, exit: exitPx, pl_pct: pl * 100, reason, days: tdays(pos.entryDate, exitDate), contract: pos.contract });
  pos = null;
}

for (const row of fwd.rows) {
  if (row.error) continue;
  const bar = byDate[row.date];
  if (pos && bar && MODE === 'flip') {
    if (pos.dir === 'long') {
      if (bar.high >= pos.target) close(row.date, pos.target, 'target');
      else if (bar.close < pos.stop) close(row.date, bar.close, 'stop');
    } else {
      if (bar.low <= pos.target) close(row.date, pos.target, 'target');
      else if (bar.close > pos.stop) close(row.date, bar.close, 'stop');
    }
    if (pos && (row.verdict === 'long' || row.verdict === 'short') && row.verdict !== pos.dir) close(row.date, bar.close, 'flip');
  } else if (pos && bar && MODE === 'trend') {
    // ride: update high/low water, trail, exit on structural regime flip. No fixed target.
    if (pos.dir === 'long') pos.hw = Math.max(pos.hw, bar.high); else pos.lw = Math.min(pos.lw, bar.low);
    if (pos.dir === 'long' && bar.close < pos.hw * (1 - TRAIL)) close(row.date, bar.close, 'trail');
    else if (pos.dir === 'short' && bar.close > pos.lw * (1 + TRAIL)) close(row.date, bar.close, 'trail');
    else if (pos && ((pos.dir === 'long' && row.migration === 'down_bearish') || (pos.dir === 'short' && row.migration === 'up_bullish'))) close(row.date, bar.close, 'struct-flip');
    // else HOLD through same/opposite daily verdict noise — only structure/trail exits
  }
  // 3) open if flat on a directional read
  if (!pos && (row.verdict === 'long' || row.verdict === 'short') && row.plan && bar) open(row.verdict, row, bar);
}
if (pos) { const last = fwd.rows.filter((r) => byDate[r.date]).slice(-1)[0]; const b = byDate[last.date]; close(last.date, b.close, 'mark(open)'); }

const dailyDirectional = fwd.rows.filter((r) => r.verdict === 'long' || r.verdict === 'short').length;
console.log(`# ${T} — daily views collapsed into HELD positions`);
console.log(`${fwd.rows.length} daily sessions · ${dailyDirectional} directional daily cards → ${trades.length} held trades\n`);
console.log('| dir | entry date | entry | exit date | exit | days | P&L% | why |');
console.log('|---|---|--:|---|--:|--:|--:|---|');
let net = 0, win = 0;
for (const t of trades) {
  net += t.pl_pct; if (t.pl_pct > 0) win++;
  console.log(`| ${t.dir === 'long' ? '🟢 L' : '🔴 S'} | ${t.entryDate} | ${t.entry.toFixed(0)} | ${t.exitDate} | ${t.exit.toFixed(0)} | ${t.days} | ${t.pl_pct >= 0 ? '+' : ''}${t.pl_pct.toFixed(1)}% | ${t.reason} |`);
}
console.log(`\n**${trades.length} trades · ${win} green (${trades.length ? (100 * win / trades.length).toFixed(0) : 0}%) · net underlying ${net >= 0 ? '+' : ''}${net.toFixed(1)}% · avg hold ${trades.length ? (trades.reduce((a, b) => a + b.days, 0) / trades.length).toFixed(1) : 0}d**`);
console.log('_(underlying move captured per trade, not option P&L — options amplify)_');
