#!/usr/bin/env node
// Validate the BS-modeled option P&L against REAL prices (get_historic_chains via
// FlowProvider.getOptionHistory) for recent trades where real data exists. If real IV >
// realized-vol IV (it usually is), the BS backtest OVERSTATED returns → the negative
// conclusion is conservative. Reports BS-vs-real P&L + IV error per validated trade.
import { loadEnvKeysFrom, resolveFromRoot, readJson, log } from '../../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { FlowProvider } = await import('../../providers/flow-uw.mjs');
const flow = new FlowProvider();
const OHLC = readJson(resolveFromRoot('research/backtest/ohlc_cache.json')) || {};
const STRUCT = readJson(resolveFromRoot('research/backtest/struct_cache.json')) || {};
const SEVEN = ['HIMS', 'MU', 'MARA', 'AAPL', 'WMT', 'PYPL', 'BMNR'];
const iso = (d) => d.toISOString().slice(0, 10);
const WEEKS = [];
for (let d = new Date('2026-05-25T00:00:00Z'); d <= new Date('2026-08-10T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 7)) {
  const mon = new Date(d), fri = new Date(d), to = new Date(d);
  fri.setUTCDate(mon.getUTCDate() - 3); to.setUTCDate(mon.getUTCDate() + 12);
  WEEKS.push({ entry: iso(fri), from: iso(mon), to: iso(to) });
}
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(1) + '%';
const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
const normCdf = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2); let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
function bs(type, S, K, T, sig, r = 0.04) { if (T <= 0) return Math.max(type === 'C' ? S - K : K - S, 0); const sq = sig * Math.sqrt(T); const d1 = (Math.log(S / K) + (r + sig * sig / 2) * T) / sq, d2 = d1 - sq; return type === 'C' ? S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2) : K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1); }
function realizedVol(c) { const r = []; for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1])); if (r.length < 5) return 0.4; const m = mean(r); return Math.max(Math.sqrt(mean(r.map((x) => (x - m) ** 2)) * 252), 0.12); }
function thirdFriday(y, m) { const fr = []; for (let day = 1; day <= 31; day++) { const dd = new Date(Date.UTC(y, m - 1, day)); if (dd.getUTCMonth() !== m - 1) break; if (dd.getUTCDay() === 5) fr.push(dd); } return fr[2]; }
function pickExpiry(entry) { const [y, m] = entry.split('-').map(Number); for (let k = 0; k < 3; k++) { const mm = m + k, yy = y + Math.floor((mm - 1) / 12), mo = ((mm - 1) % 12) + 1; const tf = iso(thirdFriday(yy, mo)); if (daysBetween(entry, tf) >= 25) return tf; } return null; }
function atmStrike(spot) { const inc = spot < 25 ? 0.5 : spot < 50 ? 1 : spot < 100 ? 2.5 : spot < 200 ? 5 : 10; return Math.round(spot / inc) * inc; }
const occOf = (t, exp, cp, K) => { const [y, m, d] = exp.split('-'); return `${t}${y.slice(2)}${m}${d}${cp}${String(Math.round(K * 1000)).padStart(8, '0')}`; };
const barsIn = (t, from, to) => (OHLC[t] || []).filter((b) => b.d >= from && b.d <= to && b.c != null).sort((a, b) => a.d < b.d ? -1 : 1);
const closesTo = (t, date, k) => (OHLC[t] || []).filter((b) => b.d <= date && b.c != null).sort((a, b) => a.d < b.d ? -1 : 1).slice(-k).map((b) => b.c);
const near = (rows, date) => { let best = null; for (const r of rows) if (r.date <= date && (!best || r.date > best.date)) best = r; return best || rows.find((r) => r.date >= date) || null; };

const V = [];
for (const w of WEEKS) for (const t of SEVEN) {
  const st = STRUCT[`${t}|${w.entry}`]; if (!st || !st.spot) continue;
  const bars = barsIn(t, w.from, w.to); if (bars.length < 6) continue;
  const expiry = pickExpiry(w.entry); if (!expiry) continue;
  const K = atmStrike(st.spot), type = 'C'; // validate calls (long_all)
  const sig = realizedVol(closesTo(t, w.entry, 22));
  const entryB = bars[0], exitB = bars[Math.min(10, bars.length - 1)];
  const bsEntry = bs(type, entryB.o, K, daysBetween(entryB.d, expiry) / 365, sig);
  const bsExit = bs(type, exitB.c, K, Math.max(daysBetween(exitB.d, expiry) / 365, 0), sig);
  if (!(bsEntry > 0.02)) continue;
  const occ = occOf(t, expiry, type, K);
  let real; try { real = await flow.getOptionHistory(occ); } catch { real = []; }
  if (!real || real.length < 2) continue;
  const re = near(real, entryB.d), rx = near(real, exitB.d);
  if (!re || !rx || !(re.mid > 0.02)) continue;
  V.push({ t, entry: w.entry, occ, bsPnl: (bsExit - bsEntry) / bsEntry * 100, realPnl: (rx.mid - re.mid) / re.mid * 100, bsIV: sig * 100, realIV: (re.iv || 0) * 100, bsEntry, realEntry: re.mid });
}
log(`\n════ BS-vs-REAL VALIDATION (calls, recent weeks) — ${V.length} contracts matched ════`);
log('ticker entry       BS-P&L   real-P&L   BS-IV  realIV   BS-entry$ real-entry$');
for (const v of V) log(`  ${v.t.padEnd(5)} ${v.entry}  ${fmt(v.bsPnl).padStart(8)} ${fmt(v.realPnl).padStart(8)}   ${v.bsIV.toFixed(0)}%   ${v.realIV.toFixed(0)}%    ${v.bsEntry.toFixed(2)}      ${v.realEntry.toFixed(2)}`);
if (V.length) {
  log(`\nMEAN  BS-P&L ${fmt(mean(V.map((v) => v.bsPnl)))}   real-P&L ${fmt(mean(V.map((v) => v.realPnl)))}   (Δ ${fmt(mean(V.map((v) => v.bsPnl)) - mean(V.map((v) => v.realPnl)))})`);
  log(`MEAN  BS-IV ${mean(V.map((v) => v.bsIV)).toFixed(0)}%   real-IV ${mean(V.map((v) => v.realIV)).toFixed(0)}%   → realized-vol ${mean(V.map((v) => v.bsIV)) < mean(V.map((v) => v.realIV)) ? 'UNDER-prices (backtest optimistic)' : 'over-prices'}`);
  log(`MEAN  BS-entry$ ${mean(V.map((v) => v.bsEntry)).toFixed(2)}   real-entry$ ${mean(V.map((v) => v.realEntry)).toFixed(2)}`);
}
