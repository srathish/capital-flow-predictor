#!/usr/bin/env node
// Deep scrutiny of the walk-forward result. The regime table can be fooled; this checks
// median (not just mean), long/short split, per-week consistency, avg winner/loser, the
// biggest trades (artifact check), close-vs-intra stop within the trend rule, and a
// week-stratified permutation of trend vs long_all. Also: does STANDING ASIDE in downtrends
// work as well as SHORTING (safer)?
import { resolveFromRoot, readJson, log } from '../../lib/util.mjs';
const OHLC = readJson(resolveFromRoot('research/backtest/ohlc_cache.json')) || {};
const STRUCT = readJson(resolveFromRoot('research/backtest/struct_cache.json')) || {};
const iso = (d) => d.toISOString().slice(0, 10);
const WEEKS = [];
for (let d = new Date('2025-11-17T00:00:00Z'); d <= new Date('2026-08-10T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 7)) {
  const monday = new Date(d), fri = new Date(d), to = new Date(d);
  fri.setUTCDate(monday.getUTCDate() - 3); to.setUTCDate(monday.getUTCDate() + 4);
  WEEKS.push({ entry: iso(fri), from: iso(monday), to: iso(to) });
}
const UNIVERSE = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'AVGO', 'TSLA', 'AMD', 'TSM', 'MU', 'QCOM', 'AMAT', 'LRCX', 'COIN', 'HOOD', 'SOFI', 'PLTR', 'NET', 'SHOP', 'NKE', 'DIS', 'WMT', 'HD', 'MCD', 'XOM', 'CVX', 'JPM', 'BAC', 'FCX', 'SPY', 'QQQ', 'IWM', 'SMH', 'XBI'];
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const sum = (a) => a.reduce((s, x) => s + x, 0);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
const barsIn = (t, from, to) => (OHLC[t] || []).filter((b) => b.d >= from && b.d <= to && b.c != null).sort((a, b) => a.d < b.d ? -1 : 1);
const closesTo = (t, date, k) => (OHLC[t] || []).filter((b) => b.d <= date && b.c != null).sort((a, b) => a.d < b.d ? -1 : 1).slice(-k).map((b) => b.c);

function levels(st, dir) {
  const spot = st.spot, long = dir === 'long';
  const maxG = Math.max(...st.g.map((n) => Math.abs(n.m)), 0.01), sig = 0.2 * maxG;
  const wall = st.g.filter((n) => n.m > sig && (long ? n.k > spot * 1.003 : n.k < spot * 0.997)).sort((a, b) => long ? a.k - b.k : b.k - a.k)[0];
  const mag = st.v.filter((n) => n.m > 0 && (long ? n.k > spot : n.k < spot)).sort((a, b) => Math.abs(b.m) - Math.abs(a.m))[0];
  const supp = st.g.filter((n) => n.m > sig && (long ? n.k < spot * 0.997 : n.k > spot * 1.003)).sort((a, b) => long ? b.k - a.k : a.k - b.k)[0];
  const target = wall ? wall.k : (long ? spot * 1.03 : spot * 0.97);
  let runner = mag ? mag.k : (long ? spot * 1.06 : spot * 0.94);
  if (long ? runner <= target : runner >= target) runner = long ? target * 1.03 : target * 0.97;
  const inval = supp ? supp.k : (long ? spot * 0.97 : spot * 1.03);
  return { target, runner, inval, hasWall: !!wall };
}
function resolve(dir, bars, { target, runner, inval }, { stopBasis = 'close', cap = 1.25 } = {}) {
  if (!bars.length) return null;
  const long = dir === 'long', entry = bars[0].o, risk = Math.abs(entry - inval);
  if (!risk || (long ? inval >= entry : inval <= entry)) return null;
  const signed = (px) => (long ? px - entry : entry - px) / risk;
  let rr = [{ px: target, w: 0.5 }, { px: runner, w: 0.5 }].filter((r) => long ? r.px > entry : r.px < entry);
  const ws = sum(rr.map((r) => r.w)) || 1; rr = rr.map((r) => ({ ...r, w: r.w / ws })).sort((a, b) => long ? a.px - b.px : b.px - a.px);
  if (!rr.length) return Math.max(signed(bars[bars.length - 1].c), -cap);
  let realized = 0, remaining = 1; const pend = [...rr];
  for (const b of bars) {
    while (pend.length && (long ? b.h >= pend[0].px : b.l <= pend[0].px)) { const g = pend.shift(); realized += g.w * signed(g.px); remaining -= g.w; }
    if (remaining <= 1e-9) break;
    const stop = stopBasis === 'close' ? (long ? b.c < inval : b.c > inval) : (long ? b.l <= inval : b.h >= inval);
    if (stop) { realized += remaining * -1; remaining = 0; break; }
  }
  if (remaining > 1e-9) realized += remaining * signed(bars[bars.length - 1].c);
  return Math.max(realized, -cap);
}
const trendDir = (st, t, entry) => { const c = closesTo(t, entry, 20); if (c.length < 20) return null; return st.spot > mean(c) ? 'long' : 'short'; };
const regimeOf = (w) => { const b = barsIn('SPY', w.from, w.to); if (b.length < 2) return '?'; const r = (b[b.length - 1].c - b[0].o) / b[0].o * 100; return r > 1 ? 'UP' : r < -1 ? 'DOWN' : 'FLAT'; };
const regimes = {}; for (const w of WEEKS) regimes[w.entry] = regimeOf(w);

// build the trend book (close-basis)
function book(dirFn, opt) {
  const rows = [];
  for (const w of WEEKS) for (const t of UNIVERSE) {
    const st = STRUCT[`${t}|${w.entry}`]; if (!st || !st.spot) continue;
    const bars = barsIn(t, w.from, w.to); if (bars.length < 2) continue;
    const dir = dirFn(st, t, w.entry); if (!dir) continue;
    const R = resolve(dir, bars, levels(st, dir), opt); if (R == null) continue;
    rows.push({ t, entry: w.entry, dir, reg: regimes[w.entry], R });
  }
  return rows;
}
const T = book(trendDir, { stopBasis: 'close', cap: 1.25 });
const Ti = book(trendDir, { stopBasis: 'intra', cap: 1.25 });
const L = book(() => 'long', { stopBasis: 'close', cap: 1.25 });

log(`\n════ SCRUTINY — trend (tape gate), close-basis stop, ${T.length} trades ════`);
const R = T.map((r) => r.R), wins = R.filter((x) => x > 0), loss = R.filter((x) => x <= 0);
log(`mean ${fmt(mean(R))}  median ${fmt(median(R))}  hit ${(wins.length / R.length * 100).toFixed(0)}%  avgWin ${fmt(mean(wins))}  avgLoss ${fmt(mean(loss))}  totR ${fmt(sum(R))}`);
const lo = T.filter((r) => r.dir === 'long'), sh = T.filter((r) => r.dir === 'short');
log(`LONG  n=${lo.length} mean ${fmt(mean(lo.map((r) => r.R)))} tot ${fmt(sum(lo.map((r) => r.R)))}   SHORT n=${sh.length} mean ${fmt(mean(sh.map((r) => r.R)))} tot ${fmt(sum(sh.map((r) => r.R)))}`);
log(`stop basis:  close mean ${fmt(mean(T.map((r) => r.R)))}   intraday mean ${fmt(mean(Ti.map((r) => r.R)))}`);

log('\n── per-week meanR (consistency; * = down SPY week) ──');
let neg = 0;
for (const w of WEEKS) { const rs = T.filter((r) => r.entry === w.entry).map((r) => r.R); if (!rs.length) continue; const m = mean(rs); if (m < 0) neg++; log(`  ${w.entry} ${regimes[w.entry] === 'DOWN' ? '*' : ' '} n=${String(rs.length).padStart(2)} mean ${fmt(m)}`); }
log(`  → ${neg}/${WEEKS.filter((w) => T.some((r) => r.entry === w.entry)).length} weeks negative`);

log('\n── biggest winners / losers (artifact eyeball) ──');
const sorted = [...T].sort((a, b) => b.R - a.R);
for (const r of sorted.slice(0, 6)) log(`  WIN  ${r.t.padEnd(5)} ${r.entry} ${r.dir.padEnd(5)} R ${fmt(r.R)}`);
for (const r of sorted.slice(-6)) log(`  LOSS ${r.t.padEnd(5)} ${r.entry} ${r.dir.padEnd(5)} R ${fmt(r.R)}`);

// standing-aside vs shorting in downtrends
const flat = book((st, t, entry) => { const d = trendDir(st, t, entry); return d === 'long' ? 'long' : null; }, { stopBasis: 'close', cap: 1.25 });
log(`\n── SHORT vs STAND-ASIDE in downtrends ──`);
log(`  trend (long+short):  n=${T.length} mean ${fmt(mean(T.map((r) => r.R)))} tot ${fmt(sum(T.map((r) => r.R)))}`);
log(`  long-or-flat:        n=${flat.length} mean ${fmt(mean(flat.map((r) => r.R)))} tot ${fmt(sum(flat.map((r) => r.R)))}`);

// permutation: trend vs long_all on the SAME setups (paired: for setups where they differ in direction)
const key = (r) => `${r.t}|${r.entry}`;
const Lm = new Map(L.map((r) => [key(r), r.R]));
const paired = T.filter((r) => Lm.has(key(r))).map((r) => ({ dT: r.R, dL: Lm.get(key(r)) }));
const diffs = paired.map((p) => p.dT - p.dL); const obs = mean(diffs);
let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
let ge = 0, N = 20000; for (let p = 0; p < N; p++) { let s = 0; for (const dd of diffs) s += (rnd() < 0.5 ? -dd : dd); if (s / diffs.length >= Math.abs(obs)) ge++; }
log(`\n── trend vs long_all (paired, ${paired.length} setups): Δmean ${fmt(obs)}  p=${(ge / N).toFixed(4)} ${ge / N <= 0.05 ? '***' : ge / N <= 0.1 ? '*' : ''}`);
