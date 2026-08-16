#!/usr/bin/env node
// Does a SPECIFIC GEX SETUP predict big moves? (the user's point: mechanical/aggregate/
// participate-everything washes out the real edge, which is SELECTIVE high-conviction
// setups). Test: (a) does a negative-gamma-squeeze score predict the forward |move|?
// (b) does a big vanna magnet predict directional move toward it? (c) do the winners
// cluster on these? IV-independent move test first (cleanest), then straddle P&L.
import { resolveFromRoot, readJson, log } from '../../lib/util.mjs';
const OHLC = readJson(resolveFromRoot('research/backtest/ohlc_cache.json')) || {};
const STRUCT = readJson(resolveFromRoot('research/backtest/struct_cache.json')) || {};
const SEVEN = ['HIMS', 'MU', 'MARA', 'AAPL', 'WMT', 'PYPL', 'BMNR'];
const iso = (d) => d.toISOString().slice(0, 10);
const WEEKS = [];
for (let d = new Date('2025-11-17T00:00:00Z'); d <= new Date('2026-08-10T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 7)) {
  const mon = new Date(d), fri = new Date(d), to = new Date(d);
  fri.setUTCDate(mon.getUTCDate() - 3); to.setUTCDate(mon.getUTCDate() + 12);
  WEEKS.push({ entry: iso(fri), from: iso(mon), to: iso(to) });
}
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const pearson = (xs, ys) => { const n = xs.length; if (n < 3) return 0; const mx = mean(xs), my = mean(ys); let nu = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { nu += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; } return dx && dy ? nu / Math.sqrt(dx * dy) : 0; };
const barsIn = (t, from, to) => (OHLC[t] || []).filter((b) => b.d >= from && b.d <= to && b.c != null).sort((a, b) => a.d < b.d ? -1 : 1);

// SETUP scores from aggregate structure
function scores(st) {
  const spot = st.spot, maxG = Math.max(...st.g.map((n) => Math.abs(n.m)), 0.01), maxV = Math.max(...st.v.map((n) => Math.abs(n.m)), 0.01);
  // squeeze: largest NEGATIVE gamma node within ±4% of spot (dealers short gamma near price → chase)
  const negNear = st.g.filter((n) => n.m < 0 && Math.abs(n.k - spot) / spot <= 0.04);
  const squeeze = negNear.length ? Math.max(...negNear.map((n) => -n.m)) / maxG : 0;
  // is the gamma KING itself negative & near spot? (strongest squeeze)
  const king = st.g.reduce((a, b) => Math.abs(b.m) > Math.abs(a.m) ? b : a);
  const kingNegNear = (king.m < 0 && Math.abs(king.k - spot) / spot <= 0.04) ? -king.m / maxG : 0;
  // vanna magnet: largest positive vanna ABOVE spot, and how far (melt-up target)
  const vAbove = st.v.filter((n) => n.m > 0 && n.k > spot).sort((a, b) => b.m - a.m)[0];
  const vanna = vAbove ? vAbove.m / maxV : 0;
  const vannaDist = vAbove ? (vAbove.k - spot) / spot : 0;
  return { squeeze, kingNegNear, vanna, vannaDist };
}
// forward move over the resolve window (Monday open → last close), signed and abs
function fwd(t, w) { const b = barsIn(t, w.from, w.to); if (b.length < 4) return null; const ret = (b[b.length - 1].c - b[0].o) / b[0].o; return { ret, abs: Math.abs(ret) }; }

const rows = [];
for (const w of WEEKS) for (const t of SEVEN) { const st = STRUCT[`${t}|${w.entry}`]; if (!st || !st.spot) continue; const f = fwd(t, w); if (!f) continue; rows.push({ t, entry: w.entry, ...scores(st), ...f }); }
log(`\n════ DOES A GEX SETUP PREDICT THE MOVE? — ${rows.length} stock-weeks ════\n`);

log('── correlations with forward |move| (positive = setup predicts bigger moves) ──');
log(`  squeeze (neg-gamma near spot)  corr=${pearson(rows.map((r) => r.squeeze), rows.map((r) => r.abs)).toFixed(3)}`);
log(`  king-neg-near-spot             corr=${pearson(rows.map((r) => r.kingNegNear), rows.map((r) => r.abs)).toFixed(3)}`);
log(`  vanna magnet above (size)      corr=${pearson(rows.map((r) => r.vanna), rows.map((r) => r.abs)).toFixed(3)}`);

const terc = (key, val) => { const s = [...rows].sort((a, b) => a[key] - b[key]); const t = Math.floor(s.length / 3); return [['LOW', s.slice(0, t)], ['MID', s.slice(t, 2 * t)], ['HIGH', s.slice(2 * t)]].map(([n, g]) => `${n} |move| ${(mean(g.map((r) => r.abs)) * 100).toFixed(1)}% (dir ${(mean(g.map((r) => r[val])) * 100).toFixed(1)}%)`); };
log('\n── forward |move| by SQUEEZE tercile ──');
for (const line of terc('squeeze', 'ret')) log('  ' + line);
log('── forward move by VANNA-magnet tercile (dir = signed, toward magnet=+) ──');
for (const line of terc('vanna', 'ret')) log('  ' + line);

log('\n── the 12 BIGGEST forward moves — did they have a GEX setup? ──');
for (const r of [...rows].sort((a, b) => b.abs - a.abs).slice(0, 12)) log(`  ${r.t.padEnd(5)} ${r.entry} |move| ${(r.abs * 100).toFixed(0)}% (${r.ret > 0 ? '+' : '-'})  squeeze ${r.squeeze.toFixed(2)} kingNeg ${r.kingNegNear.toFixed(2)} vanna ${r.vanna.toFixed(2)}`);
log('\n── mean squeeze score: big-move weeks (top 20%) vs calm weeks (bottom 20%) ──');
const bysz = [...rows].sort((a, b) => b.abs - a.abs); const q = Math.floor(rows.length * 0.2);
log(`  big-move weeks   squeeze ${mean(bysz.slice(0, q).map((r) => r.squeeze)).toFixed(3)}  kingNeg ${mean(bysz.slice(0, q).map((r) => r.kingNegNear)).toFixed(3)}`);
log(`  calm weeks       squeeze ${mean(bysz.slice(-q).map((r) => r.squeeze)).toFixed(3)}  kingNeg ${mean(bysz.slice(-q).map((r) => r.kingNegNear)).toFixed(3)}`);
