#!/usr/bin/env node
// Offline strategy tester — runs against the cached structure+OHLC (no pulls). Tests a small
// PRE-SPECIFIED set of direction rules with fixed structure-derived levels + the validated
// management (close-basis stop + 1.25R cap + 2-scale). Judged by REGIME: an edge must be
// positive in down/flat weeks, not just bull. Iterate strategies here freely.
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
const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);

// bars for a name within [from,to]
const barsIn = (t, from, to) => (OHLC[t] || []).filter((b) => b.d >= from && b.d <= to && b.c != null).sort((a, b) => a.d < b.d ? -1 : 1);
// closes up to (<=) date
const closesTo = (t, date, k) => (OHLC[t] || []).filter((b) => b.d <= date && b.c != null).sort((a, b) => a.d < b.d ? -1 : 1).slice(-k).map((b) => b.c);

// structure-derived levels for a direction (fallback to fixed % when a node is absent)
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
  return { target, runner, inval, hasWall: !!wall, hasMag: !!mag, hasSupp: !!supp };
}

function resolve(dir, bars, { target, runner, inval }, { stopBasis = 'close', cap = 1.25 } = {}) {
  if (!bars.length) return null;
  const long = dir === 'long';
  const entry = bars[0].o;
  const risk = Math.abs(entry - inval);
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
  return Math.max(realized, -cap); // disaster cap
}

// direction rules (return 'long'|'short'|null=flat)
const STRATS = {
  long_all: () => 'long',
  trend: (st, t, entry) => { const c = closesTo(t, entry, 20); if (c.length < 20) return null; return st.spot > mean(c) ? 'long' : 'short'; },
  trend_strong: (st, t, entry) => { const c = closesTo(t, entry, 20); if (c.length < 20) return null; const sma = mean(c), mom = st.spot / c[c.length - 6] - 1; if (st.spot > sma && mom > 0) return 'long'; if (st.spot < sma && mom < 0) return 'short'; return null; },
  struct: (st) => { const spot = st.spot, maxG = Math.max(...st.g.map((n) => Math.abs(n.m)), 0.01), sig = 0.2 * maxG; const wallUp = st.g.some((n) => n.m > sig && n.k > spot * 1.003), suppDn = st.g.some((n) => n.m > sig && n.k < spot * 0.997); const wallDn = st.g.some((n) => n.m > sig && n.k < spot * 0.997), suppUp = st.g.some((n) => n.m > sig && n.k > spot * 1.003); if (wallUp && suppDn) return 'long'; if (wallDn && suppUp && st.spot < mean(st.g.filter(n=>n.m>sig).map(n=>n.k))) return 'short'; return 'long'; },
  trend_and_struct: (st, t, entry) => { const c = closesTo(t, entry, 20); if (c.length < 20) return null; const dir = st.spot > mean(c) ? 'long' : 'short'; const lv = levels(st, dir); return lv.hasWall ? dir : null; },
};

// regime per week = SPY resolve-window return
function regimeOf(w) { const b = barsIn('SPY', w.from, w.to); if (b.length < 2) return '?'; const r = (b[b.length - 1].c - b[0].o) / b[0].o * 100; return r > 1 ? 'UP' : r < -1 ? 'DOWN' : 'FLAT'; }
const regimes = {}; for (const w of WEEKS) regimes[w.entry] = regimeOf(w);
const rc = { UP: 0, FLAT: 0, DOWN: 0, '?': 0 }; for (const w of WEEKS) rc[regimes[w.entry]]++;

const validSetups = [];
for (const w of WEEKS) for (const t of UNIVERSE) { const st = STRUCT[`${t}|${w.entry}`]; if (st && st.spot && barsIn(t, w.from, w.to).length >= 2) validSetups.push({ t, w, st }); }
log(`\n════ WALK-FORWARD BACKTEST ════`);
log(`weeks ${WEEKS.length} (UP ${rc.UP} / FLAT ${rc.FLAT} / DOWN ${rc.DOWN}) · valid setups ${validSetups.length} · cache ${Object.keys(STRUCT).length}\n`);
if (!validSetups.length) { log('cache not ready yet — re-run when collect.mjs finishes.'); process.exit(0); }

log('strategy         n     meanR   totR   hit    UP(n)        FLAT(n)      DOWN(n)');
for (const [name, dirFn] of Object.entries(STRATS)) {
  const rows = [];
  for (const s of validSetups) {
    const dir = dirFn(s.st, s.t, s.w.entry);
    if (!dir) continue;
    const lv = levels(s.st, dir);
    const R = resolve(dir, barsIn(s.t, s.w.from, s.w.to), lv, { stopBasis: 'close', cap: 1.25 });
    if (R == null) continue;
    rows.push({ R, reg: regimes[s.w.entry] });
  }
  const by = (rg) => rows.filter((r) => r.reg === rg).map((r) => r.R);
  const all = rows.map((r) => r.R);
  const cell = (rg) => { const a = by(rg); return `${fmt(mean(a))}(${a.length})`.padEnd(12); };
  log(`${name.padEnd(16)} ${String(all.length).padStart(4)}  ${fmt(mean(all)).padStart(6)}  ${fmt(sum(all)).padStart(6)}  ${(all.filter((x) => x > 0).length / all.length * 100).toFixed(0).padStart(3)}%  ${cell('UP')} ${cell('FLAT')} ${cell('DOWN')}`);
}
log('\n(An edge that "works really well" must be positive in FLAT and DOWN, not just UP.)');
