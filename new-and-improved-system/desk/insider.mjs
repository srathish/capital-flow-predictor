#!/usr/bin/env node
// INSIDER-BUY BOOK — paper tracker for the best strategy found (shadow/insider_book.mjs; 2022–26 backtest +3.3–4.0% per trade
// unhedged, Sharpe ~1.0, positive every year). Never sends orders. UW only — 0 Skylit credits.
//   Rule: an open-market insider purchase (Form 4 code P) ≥ $100k, filed for a stock in the desk universe → BUY $10k at the
//         next session's OPEN, SELL at the CLOSE 20 sessions later. One position per stock at a time.
//   node desk/insider.mjs            → new buys for the next open, open positions, closed-trade scorecard vs SPY
// State: desk/journal/insider_book.json
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';
import { universe, sessionDate, prevTD, tdRange, addDays, refreshDaily, loadDaily } from './common.mjs';

const J = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), 'journal'), SF = path.join(J, 'insider_book.json');
const state = fs.existsSync(SF) ? JSON.parse(fs.readFileSync(SF, 'utf8')) : { positions: [], since: null };
const D = sessionDate(), uni = new Set(universe()), SIZE = 10000;
const uwq = async (p) => { const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null); return r?.ok ? r.json().catch(() => null) : null; };
async function uwBars(sym, from) { // daily bars from UW (free) for marking and exits
  const j = await uwq(`/stock/${sym}/ohlc/1d?limit=200`); return (j?.data ?? []).filter((b) => b.market_time === 'r' || !b.market_time).map((b) => ({ d: b.date ?? b.start_time?.slice(0, 10), o: +b.open, c: +b.close })).filter((b) => b.d >= from).sort((a, b) => a.d.localeCompare(b.d));
}
if (!state.since) state.since = prevTD(D);

// 1) new filings since the last run (filed before today's open), universe only, ≥ $100k
const filings = [];
for (let p = 0; p < 3; p++) { const j = await uwq(`/insider/transactions?transaction_codes[]=P&limit=500&page=${p}`); const d = j?.data ?? []; filings.push(...d); if (d.length < 500 || d.at(-1).filing_date < addDays(D, -10)) break; }
const fresh = {};
for (const r of filings) {
  if (r.transaction_code !== 'P' || !uni.has(r.ticker) || r.filing_date < state.since || r.filing_date >= D) continue;
  const v = Math.abs(r.amount) * +r.price; if (v < 1e5) continue;
  (fresh[r.ticker] ??= []).push({ who: r.owner_name, title: r.officer_title ?? (r.is_director ? 'director' : ''), v, f: r.filing_date });
}
const openSyms = new Set(state.positions.filter((p) => !p.exit).map((p) => p.sym));
const hold = tdRange(D, 20), exitDay = hold.at(-1);
const newBuys = Object.entries(fresh).filter(([s]) => !openSyms.has(s)).map(([s, xs]) => ({ sym: s, entryDay: D, exitDay, value: Math.round(xs.reduce((a, x) => a + x.v, 0)), who: xs.map((x) => `${x.who}${x.title ? ` (${x.title})` : ''}`).slice(0, 3).join('; '), filed: xs.map((x) => x.f).sort().at(-1) }));
for (const b of newBuys) state.positions.push({ ...b, entry: null, exit: null });
state.since = D;

// 2) fill entries / exits from UW daily bars once those sessions have happened
const spyB = await uwBars('SPY', addDays(D, -60));
for (const p of state.positions) {
  if (p.entry != null && p.exit != null) continue;
  const b = await uwBars(p.sym, p.entryDay); if (!b.length) continue;
  const e = b.find((x) => x.d === p.entryDay); if (e && p.entry == null) { p.entry = e.o; p.spyEntry = spyB.find((x) => x.d === p.entryDay)?.o ?? null; }
  const x = b.find((y) => y.d === p.exitDay); if (x && p.entry != null) { p.exit = x.c; p.spyExit = spyB.find((y) => y.d === p.exitDay)?.c ?? null; }
  p.mark = b.at(-1)?.c ?? p.mark; p.markDay = b.at(-1)?.d ?? p.markDay;
}
fs.mkdirSync(J, { recursive: true }); fs.writeFileSync(SF, JSON.stringify(state, null, 1));

const $ = (v) => (v >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(v)).toLocaleString();
const cost = (px) => (px < 20 ? 0.002 : 0.001);
console.log(`# Insider-buy book · session ${D}\n`);
console.log(`## Buy at the open (${D}), $${SIZE.toLocaleString()} each, sell at the close ${exitDay}`);
if (!newBuys.length) console.log('none — no new qualifying insider purchases filed since the last run');
for (const b of newBuys) console.log(`- **${b.sym}** — insiders bought $${(b.value / 1e6).toFixed(2)}M (filed ${b.filed}): ${b.who}`);
const open = state.positions.filter((p) => p.exit == null && p.entry != null), closed = state.positions.filter((p) => p.exit != null);
console.log(`\n## Open (${open.length})`);
for (const p of open) { const r = p.mark / p.entry - 1; console.log(`- ${p.sym}: in $${p.entry} on ${p.entryDay} → ${p.mark} (${p.markDay}) ${(r * 100).toFixed(1)}% · exit ${p.exitDay}`); }
if (closed.length) {
  const R = closed.map((p) => ({ r: p.exit / p.entry - 1 - cost(p.entry), s: p.spyEntry && p.spyExit ? p.spyExit / p.spyEntry - 1 : 0 }));
  const m = R.reduce((a, x) => a + x.r, 0) / R.length, ms = R.reduce((a, x) => a + x.s, 0) / R.length;
  console.log(`\n## Closed (${closed.length}) — avg ${(m * 100).toFixed(2)}%/trade after costs vs SPY ${(ms * 100).toFixed(2)}% · total ${$(R.reduce((a, x) => a + x.r * SIZE, 0))} · win ${Math.round(R.filter((x) => x.r > 0).length / R.length * 100)}%`);
  console.log('Backtest expectation: +3.3%/trade (2025–26), win ~55%. Judge after 30+ closed trades.');
} else console.log('\nNo closed trades yet — the first exits come 20 sessions after the first entries. Backtest expectation: +3.3%/trade, win ~55%.');
