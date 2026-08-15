// option-pnl.mjs — re-price the structure-driven HELD trades with the LLM-selected
// contract's REAL option prices (UW historic). Shows the actual option P&L (convexity)
// the "underlying %" was hiding. Entry = entry-day option mid; exit = exit-day last.
import { loadEnvKeysFrom, readJson, resolveFromRoot } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { FlowProvider, occSymbol } = await import('../providers/flow-uw.mjs');

const flow = new FlowProvider();
const T = process.argv[2] || 'SNDK';
const MODE = process.argv[3] || 'trend';
const FROM = process.argv[4] || '2026-07-01';
const TO = process.argv[5] || '2026-08-14';
const TRAIL = 0.06;
const fwd = readJson(resolveFromRoot(`data/backtest/forward_${T}_${FROM}_${TO}.json`));
const ohlc = readJson(resolveFromRoot(`data/backtest/ohlc/${T}.json`))?.ohlc || [];
const byDate = {}; for (const o of ohlc) byDate[o.date] = o;

let pos = null; const trades = [];
const open = (dir, row, bar) => { pos = { dir, entry: bar.close, hw: bar.close, lw: bar.close, entryDate: row.date, contract: row.plan.contract }; };
const close = (exitDate, exitPx, reason) => { const pl = pos.dir === 'long' ? (exitPx - pos.entry) / pos.entry : (pos.entry - exitPx) / pos.entry; trades.push({ ...pos, exitDate, exitU: exitPx, plU: pl * 100, reason }); pos = null; };
for (const row of fwd.rows) {
  if (row.error) continue; const bar = byDate[row.date];
  if (pos && bar && MODE === 'trend') {
    if (pos.dir === 'long') pos.hw = Math.max(pos.hw, bar.high); else pos.lw = Math.min(pos.lw, bar.low);
    if (pos.dir === 'long' && bar.close < pos.hw * (1 - TRAIL)) close(row.date, bar.close, 'trail');
    else if (pos.dir === 'short' && bar.close > pos.lw * (1 + TRAIL)) close(row.date, bar.close, 'trail');
    else if (pos && ((pos.dir === 'long' && row.migration === 'down_bearish') || (pos.dir === 'short' && row.migration === 'up_bullish'))) close(row.date, bar.close, 'struct-flip');
  }
  if (!pos && (row.verdict === 'long' || row.verdict === 'short') && row.plan && bar) open(row.verdict, row, bar);
}
if (pos) { const last = fwd.rows.filter((r) => byDate[r.date]).slice(-1)[0]; close(last.date, byDate[last.date].close, 'mark'); }

const cache = {};
const priceAt = (h, d) => h.find((r) => r.date === d) || h.filter((r) => r.date <= d).slice(-1)[0] || null;
for (const t of trades) {
  const occ = occSymbol(T, t.contract.expiry, t.contract.type, t.contract.strike);
  if (!cache[occ]) { try { cache[occ] = await flow.getOptionHistory(occ); } catch { cache[occ] = []; } }
  const h = cache[occ]; t.occ = occ;
  const e = priceAt(h, t.entryDate), x = priceAt(h, t.exitDate);
  t.entryPx = e ? (e.mid ?? e.last) : null; t.exitPx = x ? (x.last ?? x.mid) : null;
  t.plOpt = (t.entryPx && t.exitPx && t.entryPx > 0) ? (t.exitPx - t.entryPx) / t.entryPx * 100 : null;
}

console.log(`# ${T} held trades — REAL option P&L (contract the LLM actually chose)\n`);
console.log('| dir | contract | entry | in→out (underlying) | opt entry | opt exit | OPTION P&L |');
console.log('|---|---|---|---|--:|--:|--:|');
let net = 0, priced = 0;
for (const t of trades) {
  net += (t.plOpt ?? 0); if (t.plOpt != null) priced++;
  console.log(`| ${t.dir === 'long' ? '🟢' : '🔴'} | ${t.contract.expiry.slice(5)} $${t.contract.strike}${t.contract.type[0].toUpperCase()} | ${t.entryDate.slice(5)} | ${t.entry.toFixed(0)}→${t.exitU.toFixed(0)} (${t.plU >= 0 ? '+' : ''}${t.plU.toFixed(1)}%) | ${t.entryPx ?? '—'} | ${t.exitPx ?? '—'} | ${t.plOpt == null ? '—' : (t.plOpt >= 0 ? '+' : '') + t.plOpt.toFixed(0) + '%'} |`);
}
const avg = priced ? net / priced : 0;
console.log(`\n**${trades.length} trades · ${priced} priced · equal-premium net = mean option return ${avg >= 0 ? '+' : ''}${avg.toFixed(0)}%**`);
console.log('_(buy equal $ premium per trade; a far-OTM lotto that fizzles loses its premium, one that hits pays 10-40x)_');
