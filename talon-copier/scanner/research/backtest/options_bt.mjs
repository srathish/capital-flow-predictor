#!/usr/bin/env node
// OPTIONS walk-forward for the 7 random stocks. At each weekly entry: structure→direction,
// buy an ATM ~1-month option (the contract we'd actually enter), price it with Black-Scholes
// on the real underlying path (bounded P&L, real theta), exit on a fixed hold or the
// structural target/stop. Reports option P&L% (not artifact-prone R). validate_real.mjs
// checks BS vs real prices in the recent window.
import { resolveFromRoot, readJson, log } from '../../lib/util.mjs';
const OHLC = readJson(resolveFromRoot('research/backtest/ohlc_cache.json')) || {};
const STRUCT = readJson(resolveFromRoot('research/backtest/struct_cache.json')) || {};
const SEVEN = ['HIMS', 'MU', 'MARA', 'AAPL', 'WMT', 'PYPL', 'BMNR'];
const iso = (d) => d.toISOString().slice(0, 10);
const WEEKS = [];
for (let d = new Date('2025-11-17T00:00:00Z'); d <= new Date('2026-08-10T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 7)) {
  const mon = new Date(d), fri = new Date(d), to = new Date(d);
  fri.setUTCDate(mon.getUTCDate() - 3); to.setUTCDate(mon.getUTCDate() + 12); // allow up to ~2wk hold
  WEEKS.push({ entry: iso(fri), from: iso(mon), to: iso(to) });
}
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const sum = (a) => a.reduce((s, x) => s + x, 0);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(1) + '%';
const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

// Black-Scholes
const normCdf = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2); let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
function bs(type, S, K, T, sig, r = 0.04) { if (T <= 0) return Math.max(type === 'C' ? S - K : K - S, 0); const sq = sig * Math.sqrt(T); const d1 = (Math.log(S / K) + (r + sig * sig / 2) * T) / sq, d2 = d1 - sq; return type === 'C' ? S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2) : K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1); }
function realizedVol(closes) { const r = []; for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1])); if (r.length < 5) return 0.4; const m = mean(r); return Math.max(Math.sqrt(mean(r.map((x) => (x - m) ** 2)) * 252), 0.12); }
function thirdFriday(y, m) { const fr = []; for (let day = 1; day <= 31; day++) { const dd = new Date(Date.UTC(y, m - 1, day)); if (dd.getUTCMonth() !== m - 1) break; if (dd.getUTCDay() === 5) fr.push(dd); } return fr[2]; }
function pickExpiry(entry) { const [y, m] = entry.split('-').map(Number); for (let k = 0; k < 3; k++) { const mm = m + k, yy = y + Math.floor((mm - 1) / 12), mo = ((mm - 1) % 12) + 1; const tf = iso(thirdFriday(yy, mo)); if (daysBetween(entry, tf) >= 25) return tf; } return null; }
function atmStrike(spot) { const inc = spot < 25 ? 0.5 : spot < 50 ? 1 : spot < 100 ? 2.5 : spot < 200 ? 5 : 10; return Math.round(spot / inc) * inc; }
const barsIn = (t, from, to) => (OHLC[t] || []).filter((b) => b.d >= from && b.d <= to && b.c != null).sort((a, b) => a.d < b.d ? -1 : 1);
const closesTo = (t, date, k) => (OHLC[t] || []).filter((b) => b.d <= date && b.c != null).sort((a, b) => a.d < b.d ? -1 : 1).slice(-k).map((b) => b.c);
function levels(st, dir) { const spot = st.spot, long = dir === 'long', maxG = Math.max(...st.g.map((n) => Math.abs(n.m)), 0.01), sig = 0.2 * maxG; const wall = st.g.filter((n) => n.m > sig && (long ? n.k > spot * 1.003 : n.k < spot * 0.997)).sort((a, b) => long ? a.k - b.k : b.k - a.k)[0]; const supp = st.g.filter((n) => n.m > sig && (long ? n.k < spot * 0.997 : n.k > spot * 1.003)).sort((a, b) => long ? b.k - a.k : a.k - b.k)[0]; return { target: wall ? wall.k : (long ? spot * 1.04 : spot * 0.96), inval: supp ? supp.k : (long ? spot * 0.96 : spot * 1.04) }; }
const regimeOf = (w) => { const b = barsIn('SPY', w.from, w.entry.slice(0, 8) + '99'); const bb = barsIn('SPY', w.from, w.to); if (bb.length < 2) return '?'; const r = (bb[Math.min(4, bb.length - 1)].c - bb[0].o) / bb[0].o * 100; return r > 1 ? 'UP' : r < -1 ? 'DOWN' : 'FLAT'; };
const regimes = {}; for (const w of WEEKS) regimes[w.entry] = regimeOf(w);

// GEX/VEX structural reads (aggregate nodes + week-over-week gamma-king migration)
const weekIdx = Object.fromEntries(WEEKS.map((w, i) => [w.entry, i]));
const gKing = (st) => (st?.g?.length ? st.g.reduce((a, b) => Math.abs(b.m) > Math.abs(a.m) ? b : a) : null);
function kingMig(t, entry) { const i = weekIdx[entry]; if (i < 1) return null; const cur = gKing(STRUCT[`${t}|${entry}`]), prev = gKing(STRUCT[`${t}|${WEEKS[i - 1].entry}`]); if (!cur || !prev) return null; return cur.k > prev.k * 1.003 ? 'up' : cur.k < prev.k * 0.997 ? 'down' : 'flat'; }

const dirRules = {
  long_all: () => 'long',
  trend: (st, t, entry) => { const c = closesTo(t, entry, 20); if (c.length < 20) return null; return st.spot > mean(c) ? 'long' : 'short'; },
  // pure GEX signal: trade the direction the gamma king is migrating
  king_mig: (st, t, entry) => { const m = kingMig(t, entry); return m === 'up' ? 'long' : m === 'down' ? 'short' : null; },
  // doctrine: king migrating up + a positive support floor below = flow-through long; mirror = short
  gexvex: (st, t, entry) => { const m = kingMig(t, entry); if (!m || !st.g?.length) return null; const spot = st.spot, sig = 0.2 * Math.max(...st.g.map((n) => Math.abs(n.m)), 0.01); const suppBelow = st.g.some((n) => n.m > sig && n.k < spot * 0.997); if (m === 'up' && suppBelow) return 'long'; if (m === 'down' && !suppBelow) return 'short'; return null; },
  // GEX direction + momentum agreement (both must point the same way)
  gex_and_trend: (st, t, entry) => { const m = kingMig(t, entry); const c = closesTo(t, entry, 20); if (!m || c.length < 20) return null; const tr = st.spot > mean(c) ? 'long' : 'short'; const gx = m === 'up' ? 'long' : m === 'down' ? 'short' : null; return gx && gx === tr ? tr : null; },
};

// one option trade → P&L% for a given exit policy
function trade(t, w, dir, exit) {
  const st = STRUCT[`${t}|${w.entry}`]; if (!st || !st.spot) return null;
  const bars = barsIn(t, w.from, w.to); if (bars.length < 2) return null;
  const expiry = pickExpiry(w.entry); if (!expiry) return null;
  const long = dir === 'long', type = long ? 'C' : 'P';
  const K = atmStrike(st.spot);
  const ivHist = closesTo(t, w.entry, 22); const sig = realizedVol(ivHist);
  const entryDate = bars[0].d, entryS = bars[0].o;
  const Tentry = daysBetween(entryDate, expiry) / 365;
  const entryPx = bs(type, entryS, K, Tentry, sig); if (!(entryPx > 0.02)) return null;
  const lv = levels(st, dir);
  // find exit bar
  let ei = bars.length - 1;
  if (exit.type === 'fixed') ei = Math.min(exit.days, bars.length - 1);
  else { // structural: target hit (intraday) or close beyond inval; else max hold
    ei = Math.min(exit.max, bars.length - 1);
    for (let i = 1; i < bars.length; i++) { const b = bars[i];
      const tHit = long ? b.h >= lv.target : b.l <= lv.target;
      const sHit = long ? b.c < lv.inval : b.c > lv.inval;
      if (tHit || sHit || i >= exit.max) { ei = i; break; } }
  }
  const exitBar = bars[ei], exitS = exitBar.c, Texit = Math.max(daysBetween(exitBar.d, expiry) / 365, 0);
  const exitPx = bs(type, exitS, K, Texit, sig);
  const pnl = (exitPx - entryPx) / entryPx * 100;
  return { t, entry: w.entry, dir, reg: regimes[w.entry], K, type, entryPx, exitPx, pnl, holdD: ei };
}

log(`\n════ OPTIONS WALK-FORWARD — 7 random stocks, ${WEEKS.length} weeks, BS-modeled ATM ~1mo ════`);
log(`stocks: ${SEVEN.join(' ')}   (regimes: UP ${Object.values(regimes).filter(r => r === 'UP').length} / FLAT ${Object.values(regimes).filter(r => r === 'FLAT').length} / DOWN ${Object.values(regimes).filter(r => r === 'DOWN').length})\n`);
const exits = { 'fixed 5d': { type: 'fixed', days: 5 }, 'fixed 10d': { type: 'fixed', days: 10 }, 'struct(max10)': { type: 'struct', max: 10 } };
log('dir        exit          n    mean%   median%  win%   totalΣ%    UP        FLAT      DOWN');
for (const [dn, dirFn] of Object.entries(dirRules)) {
  for (const [en, ex] of Object.entries(exits)) {
    const rows = [];
    for (const w of WEEKS) for (const t of SEVEN) { const dir = dirFn(STRUCT[`${t}|${w.entry}`] || {}, t, w.entry); if (!dir) continue; const r = trade(t, w, dir, ex); if (r) rows.push(r); }
    const P = rows.map((r) => r.pnl);
    const cell = (rg) => { const a = rows.filter((r) => r.reg === rg).map((r) => r.pnl); return `${fmt(mean(a))}(${a.length})`.padEnd(10); };
    log(`${dn.padEnd(10)} ${en.padEnd(13)} ${String(rows.length).padStart(3)}  ${fmt(mean(P)).padStart(7)} ${fmt(median(P)).padStart(7)}  ${(P.filter((x) => x > 0).length / P.length * 100).toFixed(0).padStart(3)}%  ${fmt(sum(P)).padStart(8)}  ${cell('UP')} ${cell('FLAT')} ${cell('DOWN')}`);
  }
}
log('\n(mean% = avg option P&L per trade after theta; totalΣ% = sum if equal-$ per trade. Positive across regimes = real.)');

function detail(dn, dirFn, en, ex) {
  const rows = [];
  for (const w of WEEKS) for (const t of SEVEN) { const dir = dirFn(STRUCT[`${t}|${w.entry}`] || {}, t, w.entry); if (!dir) continue; const r = trade(t, w, dir, ex); if (r) rows.push(r); }
  log(`\n── DETAIL: ${dn} / ${en} (n=${rows.length}) ──`);
  for (const t of SEVEN) { const a = rows.filter((r) => r.t === t).map((r) => r.pnl); log(`  ${t.padEnd(5)} n=${String(a.length).padStart(2)} mean ${fmt(mean(a)).padStart(7)} median ${fmt(median(a)).padStart(7)} win ${(a.filter((x) => x > 0).length / a.length * 100).toFixed(0)}% totΣ ${fmt(sum(a))}`); }
  const P = [...rows.map((r) => r.pnl)].sort((a, b) => b - a); const cut = Math.ceil(P.length * 0.05);
  log(`  TAIL: mean ALL ${fmt(mean(P))} | mean ex-top5% ${fmt(mean(P.slice(cut)))} | ex-top10% ${fmt(mean(P.slice(cut * 2)))}`);
  for (const r of [...rows].sort((a, b) => b.pnl - a.pnl).slice(0, 6)) log(`    TOP ${r.t.padEnd(5)} ${r.entry} ${r.dir} ${fmt(r.pnl)}`);
}
detail('gexvex', dirRules.gexvex, 'struct(max10)', exits['struct(max10)']);
detail('gex_and_trend', dirRules.gex_and_trend, 'struct(max10)', exits['struct(max10)']);

// permutation: does GEX/VEX direction beat long_all on the SAME trades (struct exit)?
function bookOf(dirFn, ex) { const r = []; for (const w of WEEKS) for (const t of SEVEN) { const d = dirFn(STRUCT[`${t}|${w.entry}`] || {}, t, w.entry); if (!d) continue; const x = trade(t, w, d, ex); if (x) r.push({ key: `${t}|${w.entry}`, pnl: x.pnl }); } return r; }
function permVs(dirFn, label) {
  const gv = bookOf(dirFn, exits['struct(max10)']);
  const la = new Map(bookOf(dirRules.long_all, exits['struct(max10)']).map((x) => [x.key, x.pnl]));
  const paired = gv.filter((x) => la.has(x.key)).map((x) => x.pnl - la.get(x.key));
  const obs = mean(paired);
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let ge = 0, N = 20000; for (let p = 0; p < N; p++) { let s = 0; for (const d of paired) s += (rnd() < 0.5 ? -d : d); if (s / paired.length >= Math.abs(obs)) ge++; }
  log(`  ${label} vs long_all (same ${paired.length} trades): Δmean ${fmt(obs)}  p=${(ge / N).toFixed(3)} ${ge / N <= 0.05 ? '***' : ge / N <= 0.1 ? '*' : ''}`);
}
log('\n── PERMUTATION (struct exit) ──');
permVs(dirRules.gexvex, 'gexvex');
permVs(dirRules.gex_and_trend, 'gex_and_trend');
permVs(dirRules.king_mig, 'king_mig');
permVs(dirRules.trend, 'trend');
log('\n── REAL-PRICE HAIRCUT: validation showed BS is ~+9.7pt optimistic vs real prices.');
log('   Subtract ~10pt from every mean% above for a real-price estimate (struct means ~+8-11% → ~breakeven real).');
