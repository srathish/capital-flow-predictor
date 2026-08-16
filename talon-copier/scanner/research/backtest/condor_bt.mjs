#!/usr/bin/env node
// PREMIUM-SELLER test. Buying options on this system has no edge (theta + rich IV kill it;
// buyers −3.3% on real prices). The mirror: options are overpriced → SELL them. GEX thesis:
// price pins between gamma walls → sell an iron condor with short strikes AT the walls, harvest
// theta + the variance premium, defined risk caps the tail. BS uses realized vol which UNDER-
// states the credit a seller really collects → this backtest is CONSERVATIVE for the seller.
import { resolveFromRoot, readJson, log } from '../../lib/util.mjs';
const OHLC = readJson(resolveFromRoot('research/backtest/ohlc_cache.json')) || {};
const STRUCT = readJson(resolveFromRoot('research/backtest/struct_cache.json')) || {};
const SEVEN = ['HIMS', 'MU', 'MARA', 'AAPL', 'WMT', 'PYPL', 'BMNR'];
const iso = (d) => d.toISOString().slice(0, 10);
const WEEKS = [];
for (let d = new Date('2025-11-17T00:00:00Z'); d <= new Date('2026-08-10T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 7)) {
  const mon = new Date(d), fri = new Date(d), to = new Date(d);
  fri.setUTCDate(mon.getUTCDate() - 3); to.setUTCDate(mon.getUTCDate() + 24); // allow hold to ~expiry
  WEEKS.push({ entry: iso(fri), from: iso(mon), to: iso(to) });
}
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const sum = (a) => a.reduce((s, x) => s + x, 0);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(1) + '%';
const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
const normCdf = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2); let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
function bs(type, S, K, T, sig, r = 0.04) { if (T <= 0) return Math.max(type === 'C' ? S - K : K - S, 0); const sq = sig * Math.sqrt(T); const d1 = (Math.log(S / K) + (r + sig * sig / 2) * T) / sq, d2 = d1 - sq; return type === 'C' ? S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2) : K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1); }
function realizedVol(c) { const r = []; for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1])); if (r.length < 5) return 0.4; const m = mean(r); return Math.max(Math.sqrt(mean(r.map((x) => (x - m) ** 2)) * 252), 0.12); }
function thirdFriday(y, m) { const fr = []; for (let day = 1; day <= 31; day++) { const dd = new Date(Date.UTC(y, m - 1, day)); if (dd.getUTCMonth() !== m - 1) break; if (dd.getUTCDay() === 5) fr.push(dd); } return fr[2]; }
function pickExpiry(entry) { const [y, m] = entry.split('-').map(Number); for (let k = 0; k < 3; k++) { const mm = m + k, yy = y + Math.floor((mm - 1) / 12), mo = ((mm - 1) % 12) + 1; const tf = iso(thirdFriday(yy, mo)); if (daysBetween(entry, tf) >= 22) return tf; } return null; }
const inc = (s) => s < 25 ? 0.5 : s < 50 ? 1 : s < 100 ? 2.5 : s < 200 ? 5 : 10;
const roundK = (x, i) => Math.round(x / i) * i;
const barsIn = (t, from, to) => (OHLC[t] || []).filter((b) => b.d >= from && b.d <= to && b.c != null).sort((a, b) => a.d < b.d ? -1 : 1);
const closesTo = (t, date, k) => (OHLC[t] || []).filter((b) => b.d <= date && b.c != null).sort((a, b) => a.d < b.d ? -1 : 1).slice(-k).map((b) => b.c);
// nearest positive-gamma wall above / below spot (the pin strikes)
function walls(st) { const spot = st.spot, sig = 0.2 * Math.max(...st.g.map((n) => Math.abs(n.m)), 0.01);
  const up = st.g.filter((n) => n.m > sig && n.k > spot * 1.012).sort((a, b) => a.k - b.k)[0];
  const dn = st.g.filter((n) => n.m > sig && n.k < spot * 0.988).sort((a, b) => b.k - a.k)[0];
  return { call: up ? up.k : spot * 1.04, put: dn ? dn.k : spot * 0.96 }; }
const regimeOf = (w) => { const bb = barsIn('SPY', w.from, w.to); if (bb.length < 2) return '?'; const r = (bb[Math.min(4, bb.length - 1)].c - bb[0].o) / bb[0].o * 100; return r > 1 ? 'UP' : r < -1 ? 'DOWN' : 'FLAT'; };
const regimes = {}; for (const w of WEEKS) regimes[w.entry] = regimeOf(w);

// iron condor: short at walls, long wings `W` beyond. exit = fixed hold OR at ~expiry. Return on risk.
function condor(t, w, holdDays, tpFrac, ivMult = 1, mode = 'gex', side = 'both') {
  const st = STRUCT[`${t}|${w.entry}`]; if (!st || !st.spot) return null;
  const bars = barsIn(t, w.from, w.to); if (bars.length < holdDays + 1) return null;
  const expiry = pickExpiry(w.entry); if (!expiry) return null;
  const spot = st.spot, i = inc(spot), W = 2 * i, sig = realizedVol(closesTo(t, w.entry, 22)) * ivMult;
  let scBase, spBase;
  if (mode === 'pct') { scBase = spot * 1.04; spBase = spot * 0.96; }       // arbitrary fixed strikes
  else { const wl = walls(st); scBase = wl.call; spBase = wl.put; }          // GEX gamma walls
  const sc = Math.max(roundK(scBase, i), roundK(spot + i, i)), lc = sc + W;
  const sp = Math.min(roundK(spBase, i), roundK(spot - i, i)), lp = sp - W;
  let sd = side;
  if (side === 'trend') { const c = closesTo(t, w.entry, 20); if (c.length < 20) return null; sd = st.spot > mean(c) ? 'put' : 'call'; }
  const callSp = (S, T) => bs('C', S, sc, T, sig) - bs('C', S, lc, T, sig);
  const putSp = (S, T) => bs('P', S, sp, T, sig) - bs('P', S, lp, T, sig);
  const price = (S, T) => sd === 'both' ? callSp(S, T) + putSp(S, T) : sd === 'put' ? putSp(S, T) : callSp(S, T);
  const Ten = daysBetween(bars[0].d, expiry) / 365;
  const credit = price(bars[0].o, Ten); if (!(credit > 0.05) || credit >= W) return null;
  const maxRisk = W - credit;
  // walk to exit: take-profit when condor value <= (1-tpFrac)*credit, else hold `holdDays`
  let ei = Math.min(holdDays, bars.length - 1);
  for (let k = 1; k <= ei; k++) { const T = Math.max(daysBetween(bars[k].d, expiry) / 365, 0); if (price(bars[k].c, T) <= credit * (1 - tpFrac)) { ei = k; break; } }
  const exitB = bars[ei], closeCost = price(exitB.c, Math.max(daysBetween(exitB.d, expiry) / 365, 0));
  const pnl = credit - closeCost;
  return { t, reg: regimes[w.entry], ret: pnl / maxRisk * 100, pnl, credit, maxRisk };
}

log(`\n════ PREMIUM-SELLER (iron condor at GEX walls) — 7 random stocks, ${WEEKS.length} weeks ════`);
log('return = P&L / max-risk per trade. BS uses realized vol → UNDERstates credit → conservative for seller.\n');
log('config                  n    mean%   median%  win%   totalΣ%   ex-top5  UP        FLAT      DOWN');
for (const [cfg, hold, tp, ivm, mode, side] of [['condor both IVx1.08', 15, 0.5, 1.08, 'gex', 'both'], ['put-spread  IVx1.08', 15, 0.5, 1.08, 'gex', 'put'], ['call-spread IVx1.08', 15, 0.5, 1.08, 'gex', 'call'], ['TREND-SKEW  IVx1.08', 15, 0.5, 1.08, 'gex', 'trend'], ['condor both IVx1.15', 15, 0.5, 1.15, 'gex', 'both'], ['TREND-SKEW  IVx1.15', 15, 0.5, 1.15, 'gex', 'trend'], ['TREND-SKEW pct IVx1.08', 15, 0.5, 1.08, 'pct', 'trend']]) {
  const rows = [];
  for (const w of WEEKS) for (const t of SEVEN) { const r = condor(t, w, hold, tp, ivm, mode, side); if (r) rows.push(r); }
  const R = rows.map((r) => r.ret).sort((a, b) => b - a); const cut = Math.ceil(R.length * 0.05);
  const cell = (rg) => { const a = rows.filter((r) => r.reg === rg).map((r) => r.ret); return `${fmt(mean(a))}(${a.length})`.padEnd(10); };
  log(`${cfg.padEnd(23)} ${String(rows.length).padStart(4)}  ${fmt(mean(R)).padStart(7)} ${fmt(median(R)).padStart(7)}  ${(R.filter((x) => x > 0).length / R.length * 100).toFixed(0).padStart(3)}%  ${fmt(sum(R)).padStart(8)}  ${fmt(mean(R.slice(cut))).padStart(6)}  ${cell('UP')} ${cell('FLAT')} ${cell('DOWN')}`);
}
log('\n(Seller wants positive median + high win%. The tail = weeks price blows through a wall; defined risk caps it. ex-top5 removes the best 5% — if still positive, not just lucky.)');
