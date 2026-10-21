#!/usr/bin/env node
// User question (2026-10-21): $200k, every week sell cash-secured weekly puts on every stock that went DOWN the prior week. How much?
// Data: .cache/lottery_mon (≈42 stocks/week, Monday quotes for 5%/10% OTM weekly puts, bid/ask; Dec 2024 → Oct 2026). Settle at the Friday close.
import fs from 'node:fs';
import { loadBars } from './earnings_fly_collect.mjs';
const C = new URL('../.cache/', import.meta.url), START = 200000, FEE = 0.65;
const weeks = fs.readdirSync(new URL('lottery_mon/', C)).filter((f) => f.endsWith('.json')).sort();
const barsCache = new Map(), bars = (T) => { if (!barsCache.has(T)) barsCache.set(T, loadBars(T)); return barsCache.get(T); };
const closeOnOrBefore = (B, d) => { let x = null; for (const b of B) { if (b.d <= d) x = b; else break; } return x; };
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
function run(sel, leg, label) {
  let eq = START, pk = START, mdd = 0, worstW = 0, worstName = '', wins = 0, losses = 0, assigned = 0, n = 0, names = 0; const curve = [];
  for (const f of weeks) {
    const j = JSON.parse(fs.readFileSync(new URL(`lottery_mon/${f}`, C), 'utf8')), t0 = j.t0, cand = [];
    for (const p of Object.values(j.picks)) {
      const B = bars(p.t); if (!B) continue; const lg = (p.legs ?? []).find((x) => x.tag === leg); if (!lg || !(lg.bid > 0)) continue;
      const fri0 = closeOnOrBefore(B, addDays(t0, -3)), fri1 = closeOnOrBefore(B, addDays(t0, -10)), settle = closeOnOrBefore(B, lg.e);
      if (!fri0 || !fri1 || !settle || settle.d < addDays(lg.e, -3) || settle.d <= t0) continue;
      const wr = fri0.c / fri1.c - 1; if (!sel(wr)) continue;
      cand.push({ t: p.t, k: lg.k, bid: lg.bid, S: settle.c, wr });
    }
    if (!cand.length) { curve.push([t0, eq]); continue; }
    const alloc = eq / cand.length; let pnl = 0, wk = [];
    for (const c of cand) { const q = Math.floor(alloc / (c.k * 100)); if (q < 1) continue; const loss = Math.max(0, c.k - c.S), p = q * 100 * (c.bid - loss) - q * FEE; pnl += p; n++; if (p > 0) wins++; else losses++; if (loss > 0) assigned++; wk.push([c.t, p]); }
    names += cand.length; eq += pnl; pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1);
    if (pnl / (eq - pnl) < worstW) { worstW = pnl / (eq - pnl); worstName = `${t0}: ${wk.sort((a, b) => a[1] - b[1]).slice(0, 3).map((x) => x[0] + ' ' + Math.round(x[1] / 1000) + 'k').join(', ')}`; }
    curve.push([t0, eq]);
  }
  const yrs = (Date.parse(weeks.at(-1).slice(0, 10)) - Date.parse(weeks[0].slice(0, 10))) / 864e5 / 365.25 + 7 / 365.25;
  return { label, end: eq, ret: eq / START - 1, cagr: (eq / START) ** (1 / yrs) - 1, mdd, worstW, worstName, trades: n, wins, assigned, perWeek: names / weeks.length, curve };
}
const R = [
  run((r) => r < 0, 'P5', 'Down last week → sell 5% OTM put'),
  run((r) => r < -0.05, 'P5', 'Down ≥5% last week → sell 5% OTM put'),
  run((r) => r < 0, 'P10', 'Down last week → sell 10% OTM put'),
  run(() => true, 'P5', 'Every stock (no filter) → sell 5% OTM put'),
  run((r) => r > 0, 'P5', 'UP last week → sell 5% OTM put (comparison)'),
];
const spy = loadBars('SPY'), s0 = closeOnOrBefore(spy, weeks[0].slice(0, 10)), s1 = closeOnOrBefore(spy, R[0].curve.at(-1)[0] > spy.at(-1).d ? spy.at(-1).d : '2026-10-16');
console.log(`Weeks ${weeks.length} (${weeks[0].slice(0, 10)} → ${weeks.at(-1).slice(0, 10)}), start $${START.toLocaleString()}, cash-secured, equal split each week, commission $${FEE}/contract, no interest on idle cash\n`);
for (const r of R) console.log(`${r.label.padEnd(46)} end $${Math.round(r.end).toLocaleString().padStart(9)} (${(r.ret * 100).toFixed(1)}%, ${(r.cagr * 100).toFixed(1)}%/yr) | max drawdown ${(r.mdd * 100).toFixed(1)}% | worst week ${(r.worstW * 100).toFixed(1)}% | trades ${r.trades}, ${(r.wins / r.trades * 100).toFixed(0)}% winners, ${r.assigned} assigned | ~${r.perWeek.toFixed(0)} names/week`);
console.log(`\nWorst week (down-last-week, 5%): ${R[0].worstName}`);
console.log(`SPY buy-and-hold same window: ${((s1.c / s0.c - 1) * 100).toFixed(1)}% (${s0.d} → ${s1.d})`);
const yr = {}; for (const [d, e] of R[0].curve) yr[d.slice(0, 4)] = e; console.log('Down-last-week 5% equity by year-end:', Object.entries(yr).map(([y, e]) => `${y} $${Math.round(e).toLocaleString()}`).join(' | '));
fs.writeFileSync(new URL('./results_sell_puts_dips.json', import.meta.url), JSON.stringify(R.map(({ curve, ...x }) => ({ ...x, curve }))));
