#!/usr/bin/env node
// User question (2026-10-21): a safer way to use $200k than buy-and-hold. Compares simple portfolios Jan 2022 → Oct 2026 (includes the 2022 bear market).
// Prices from UW daily candles (price only) + approximate yields added daily: SPY 1.3%, AGG 3.5%, TLT 4%, GLD 0; cash = 3-month T-bill (approx by year).
import fs from 'node:fs';
import { UW_API_KEY } from '../feeds/env.js';
const get = async (T) => { const f = new URL(`../.cache/daily_uw_${T}.json`, import.meta.url); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const m = new Map(); let end = '2026-10-16';
  for (let k = 0; k < 8; k++) { await new Promise((x) => setTimeout(x, 200)); const r = await fetch(`https://api.unusualwhales.com/api/stock/${T}/ohlc/1d?limit=500&end_date=${end}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }); const j = await r.json();
    const rows = (j.data ?? []).filter((x) => x.market_time === 'r' || !x.market_time); if (!rows.length) break; for (const x of rows) m.set(x.date, +x.close); const first = rows.map((x) => x.date).sort()[0]; if (first <= '2022-01-03') break; end = new Date(Date.parse(first) - 864e5).toISOString().slice(0, 10); }
  const b = [...m.entries()].map(([d, c]) => ({ d, c })).filter((x) => x.d >= '2022-01-03').sort((a, b) => a.d.localeCompare(b.d)); fs.writeFileSync(f, JSON.stringify(b)); return b; };
const P = {}; for (const T of ['SPY', 'AGG', 'TLT', 'GLD', 'IREN', 'NBIS']) P[T] = new Map((await get(T)).map((x) => [x.d, x.c]));
const YLD = { SPY: 0.013, AGG: 0.035, TLT: 0.04, GLD: 0, IREN: 0, NBIS: 0 }, TBILL = { 2022: 0.02, 2023: 0.051, 2024: 0.05, 2025: 0.042, 2026: 0.037 };
const days = [...P.SPY.keys()].filter((d) => P.AGG.has(d) && P.TLT.has(d) && P.GLD.has(d)).sort();
const ret = (T, i) => (T === 'CASH' ? TBILL[days[i].slice(0, 4)] / 252 : P[T].get(days[i]) / P[T].get(days[i - 1]) - 1 + YLD[T] / 252);
function port(w, label) { // rebalanced quarterly
  let hold = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, 200000 * v])), pk = 200000, mdd = 0, mddAt = '', worstYr = {}, q = days[0].slice(0, 7);
  for (let i = 1; i < days.length; i++) { for (const k of Object.keys(hold)) hold[k] *= 1 + ret(k, i); const eq = Object.values(hold).reduce((a, b) => a + b, 0); if (eq > pk) pk = eq; if (eq / pk - 1 < mdd) { mdd = eq / pk - 1; mddAt = days[i]; }
    const y = days[i].slice(0, 4); worstYr[y] ??= { s: eq }; worstYr[y].e = eq;
    const qq = days[i].slice(0, 5) + String(Math.ceil(+days[i].slice(5, 7) / 3)); if (qq !== q) { q = qq; hold = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, eq * v])); } }
  const eq = Object.values(hold).reduce((a, b) => a + b, 0), yrs = (Date.parse(days.at(-1)) - Date.parse(days[0])) / 864e5 / 365.25;
  const y2022 = worstYr['2022'] ? worstYr['2022'].e / 200000 - 1 : NaN;
  return `${label.padEnd(44)} $200,000 → $${Math.round(eq).toLocaleString().padStart(9)}  ${((eq / 200000) ** (1 / yrs) * 100 - 100).toFixed(1).padStart(5)}%/yr | worst drop ${(mdd * 100).toFixed(0).padStart(4)}% ($${Math.round(-mdd * 200000 / 1000)}k on $200k) | 2022 ${(y2022 * 100).toFixed(0)}%`;
}
console.log(`Jan 3 2022 → ${days.at(-1)} (${days.length} trading days), rebalanced quarterly, yields approximated (see header)\n`);
for (const [w, l] of [[{ SPY: 1 }, '100% S&P 500 (SPY)'], [{ SPY: 0.8, CASH: 0.2 }, '80% SPY / 20% T-bills'], [{ SPY: 0.6, CASH: 0.4 }, '60% SPY / 40% T-bills'], [{ SPY: 0.6, AGG: 0.4 }, '60% SPY / 40% bonds (AGG)'],
  [{ SPY: 0.6, AGG: 0.25, GLD: 0.15 }, '60% SPY / 25% bonds / 15% gold'], [{ SPY: 0.5, CASH: 0.35, GLD: 0.15 }, '50% SPY / 35% T-bills / 15% gold'], [{ CASH: 1 }, '100% T-bills (money market)'], [{ IREN: 0.5, NBIS: 0.5 }, 'For contrast: 50% IREN / 50% NBIS']]) console.log(port(w, l));
