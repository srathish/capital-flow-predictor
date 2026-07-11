// Exit-rule backtest (RESEARCH ONLY — no live-code changes).
// Replays every logged fire against alternative exit rules using the REAL
// per-minute option-mark path (UW /option-contract/{sym}/intraday, close basis).
//
// Fidelity guardrails so this measures RECOVERABLE gain, not hindsight:
//   - exits trigger off candle CLOSE only (no intra-bar high look-ahead)
//   - peak is tracked on close basis too (a real trailing stop checked each min)
//   - entry = the DB's recorded entry_mark; sim starts at the first candle >= fire ts
//   - realized = (exit_close - entry)/entry, same cost basis for every rule
//
// Baseline = what the live system actually realized (close_mark at its exit).
import '../../scripts/_env-bootstrap.js';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const db = new Database(path.join(HERE, '..', '..', 'data', 'gexester.db'), { readonly: true });

async function candles(sym, day) {
  const f = path.join(CACHE, `${sym}_${day}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${sym}/intraday?date=${day}`,
    { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) { fs.writeFileSync(f, '[]'); return []; }
  const rows = ((await r.json())?.data || [])
    .map(c => ({ ts: Date.parse(c.start_time), close: Number(c.close) || 0 }))
    .filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  fs.writeFileSync(f, JSON.stringify(rows));
  return rows;
}

// Simulate one exit rule over the post-entry close path. Returns realized fraction.
// rule: {arm, giveback, stop}  — arm at peak>=arm, exit on giveback from peak, hard stop at -stop.
function sim(pathC, entry, rule) {
  let peak = entry, armed = false;
  for (const c of pathC) {
    const price = c.close;
    const g = (price - entry) / entry;
    if (price > peak) peak = price;
    if (!armed && (peak - entry) / entry >= rule.arm) armed = true;
    if (rule.stop != null && g <= -rule.stop) return g;                       // hard stop
    if (armed && price <= peak * (1 - rule.giveback)) return g;               // trail
  }
  const last = pathC.length ? pathC[pathC.length - 1].close : entry;          // EOD exit
  return (last - entry) / entry;
}

const RULES = {
  'live (actual)': null,
  'trail arm0 gb25': { arm: 0.00, giveback: 0.25, stop: 0.60 },
  'trail arm15 gb25': { arm: 0.15, giveback: 0.25, stop: 0.60 },
  'trail arm15 gb33': { arm: 0.15, giveback: 0.33, stop: 0.60 },
  'trail arm25 gb30': { arm: 0.25, giveback: 0.30, stop: 0.60 },
  'trail arm40 gb30': { arm: 0.40, giveback: 0.30, stop: 0.60 },
  'live arm50 gb15': { arm: 0.50, giveback: 0.15, stop: 0.60 }, // the deployed trail params
};

const fires = db.prepare(
  `SELECT trading_day d, ticker, state, option_symbol sym, entry_mark entry, best_mark best,
          best_pct_gain bestpct, status, close_mark closem, fire_ts_ms fts
   FROM tracked_plays WHERE entry_mark > 0 ORDER BY fire_ts_ms`).all();

const agg = {}; for (const k of Object.keys(RULES)) agg[k] = [];
const todayRows = [];
const DAY_FILTER = process.argv[2] || null; // optional: only detail one day

for (const f of fires) {
  const c = await candles(f.sym, f.d);
  const pathC = c.filter(x => x.ts >= f.fts);
  if (pathC.length < 2) continue;
  const liveRealized = f.closem != null ? (f.closem - f.entry) / f.entry : (f.best - f.entry) / f.entry;
  const rec = { f, liveRealized, rules: {} };
  for (const [name, rule] of Object.entries(RULES)) {
    const val = rule == null ? liveRealized : sim(pathC, f.entry, rule);
    rec.rules[name] = val; agg[name].push(val);
  }
  if (f.d === '2026-07-10') todayRows.push(rec);
}

const pct = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;

console.log(`\nEXIT-RULE BACKTEST — ${fires.length} logged fires, real per-minute UW marks (close basis)\n`);
console.log('TODAY (2026-07-10) per-fire realized under each rule:');
const cols = Object.keys(RULES);
console.log('time  tkr  state'.padEnd(30) + cols.map(c => c.replace('trail ', '').padStart(11)).join(''));
for (const r of todayRows) {
  const t = new Date(r.f.fts).toISOString().slice(11, 16);
  const label = `${t} ${r.f.ticker.padEnd(4)} ${r.f.state.slice(0, 12)}`.padEnd(30);
  console.log(label + cols.map(c => pct(r.rules[c]).padStart(11)).join(''));
}
console.log('\nAGGREGATE avg realized (ALL ' + agg['live (actual)'].length + ' fires, all logged days):');
for (const c of cols) {
  const m = mean(agg[c]);
  const wins = agg[c].filter(x => x > 0.15).length;
  console.log(`  ${c.padEnd(20)} avg ${pct(m).padStart(6)}   >+15% winners ${wins}/${agg[c].length}`);
}
const base = mean(agg['live (actual)']);
console.log('\nvs live baseline:');
for (const c of cols) if (c !== 'live (actual)') {
  const d = mean(agg[c]) - base;
  console.log(`  ${c.padEnd(20)} ${d >= 0 ? '+' : ''}${(d * 100).toFixed(0)} pts/trade`);
}
