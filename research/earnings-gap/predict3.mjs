#!/usr/bin/env node
// predict3.mjs — iterations 4+5.
// IT4: GAP-CONTINUATION — for Aug 4–21 reporters (VALIDATION SET, before this week):
//      when the reaction-day OPEN gaps beyond the implied move, does open→close drift
//      continue in the gap direction? Then APPLY the fitted rule to this week (TEST SET).
// IT5: MOMENTUM — top 5d price gainers ($10B+ universe from UW screener as of 8/21)
//      → forward 8/21→now, vs universe mean. Plus market_top_net_impact on 8/21.
import { uw, rows, num, pxSeries } from '/Users/saiyeeshrathish/uw-research-mcp/src/uw.mjs';
const pct = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%');

// ---------- collect reporters for a date range ------------------------------------------
async function reporters(dates) {
  const out = [];
  for (const d of dates) {
    for (const when of ['afterhours', 'premarket']) {
      const j = await uw(`/api/earnings/${when}?date=${d}&limit=200`).catch(() => null);
      for (const e of rows(j)) {
        const sym = e.symbol || e.ticker, imp = num(e.expected_move_perc);
        if (sym && imp != null && imp >= 0.04) out.push({ sym, d, when, imp });
      }
    }
  }
  return out;
}
function weekdays(from, to) {
  const out = [];
  for (let t = Date.parse(from + 'T12:00Z'); t <= Date.parse(to + 'T12:00Z'); t += 86400e3) {
    const dt = new Date(t);
    if (dt.getUTCDay() > 0 && dt.getUTCDay() < 6) out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

// gap + drift for one reporter: base close → reaction OPEN (gap), reaction open→close (drift)
async function gapDrift(r) {
  const px = pxSeries(await uw(`/api/stock/${encodeURIComponent(r.sym)}/ohlc/1d?limit=600`));
  const isAH = r.when === 'afterhours';
  const bi = px.findLastIndex((p) => (isAH ? p.date <= r.d : p.date < r.d));
  const base = px[bi], rx = px[bi + 1];
  if (!base || !rx || num(rx.open) == null) return null;
  const gap = num(rx.open) / base.close - 1;
  const drift = rx.close / num(rx.open) - 1;
  return { ...r, gap, drift, rxDate: rx.date };
}

// ---------- IT4 validation: Aug 4–21 ----------------------------------------------------
const val = await reporters(weekdays('2026-08-04', '2026-08-21'));
console.log(`IT4 validation set: ${val.length} reporters (implied ≥4%), Aug 4–21`);
const res = [];
let i = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (i < val.length) { const r = val[i++]; const g = await gapDrift(r).catch(() => null); if (g) res.push(g); }
}));
const beatGap = res.filter((x) => Math.abs(x.gap) > x.imp);
const upBeat = beatGap.filter((x) => x.gap > 0), dnBeat = beatGap.filter((x) => x.gap < 0);
const rest = res.filter((x) => Math.abs(x.gap) <= x.imp);
const stats = (g, dir) => {
  if (!g.length) return 'n=0';
  const drift = g.map((x) => (dir === 'signed' ? Math.sign(x.gap) * x.drift : x.drift));
  const avg = drift.reduce((a, b) => a + b, 0) / drift.length;
  const win = drift.filter((x) => x > 0).length;
  return `n=${g.length}  avg drift(gap-dir) ${pct(avg)}  continue-rate ${Math.round((win / g.length) * 100)}%`;
};
console.log(`  gap BEYOND implied, UP:   ${stats(upBeat, 'signed')}`);
console.log(`  gap BEYOND implied, DOWN: ${stats(dnBeat, 'signed')}`);
console.log(`  gap inside implied:       ${stats(rest, 'signed')}`);

// ---------- IT4 test: apply to this week -------------------------------------------------
const wk = await reporters(weekdays('2026-08-24', '2026-08-26'));
const wres = [];
i = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (i < wk.length) { const r = wk[i++]; const g = await gapDrift(r).catch(() => null); if (g) wres.push(g); }
}));
const wBeat = wres.filter((x) => Math.abs(x.gap) > x.imp);
console.log(`\nIT4 test set (this week, reaction day realized): gap-beyond-implied names:`);
for (const x of wBeat.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)))
  console.log(`   ${x.sym.padEnd(6)} ${x.rxDate} gap ${pct(x.gap)} (imp ${pct(x.imp)}) → open→close drift ${pct(x.drift)} ${Math.sign(x.drift) === Math.sign(x.gap) ? 'CONTINUED' : 'faded'}`);
console.log(`   summary: ${stats(wBeat, 'signed')}`);

// ---------- IT5: real momentum as of 8/21 ------------------------------------------------
const uni = rows(await uw(`/api/screener/stocks?date=2026-08-21&min_marketcap=10000000000&min_volume=1000000&order=net_premium&order_direction=desc`).catch(() => null))
  .map((s) => ({ sym: s.ticker || s.symbol })).filter((s) => s.sym);
console.log(`\nIT5 universe (>$10B, >1M vol, by |net premium| 8/21): ${uni.length} names`);
const moms = [];
i = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (i < uni.length) {
    const s = uni[i++];
    try {
      const px = pxSeries(await uw(`/api/stock/${encodeURIComponent(s.sym)}/ohlc/1d?limit=30`));
      const fri = px.findLastIndex((p) => p.date <= '2026-08-21');
      if (fri < 5) continue;
      const r5 = px[fri].close / px[fri - 5].close - 1;
      const now = px[px.length - 1];
      if (now.date <= '2026-08-21') continue;
      moms.push({ sym: s.sym, r5, fwd: now.close / px[fri].close - 1 });
    } catch { /* skip */ }
  }
}));
moms.sort((a, b) => b.r5 - a.r5);
const top10 = moms.slice(0, 10), all = moms;
const avg = (g, f) => (g.length ? g.reduce((a, x) => a + f(x), 0) / g.length : null);
console.log(`  top-10 by 5d return into 8/21: avg fwd ${pct(avg(top10, (x) => x.fwd))} | universe avg fwd ${pct(avg(all, (x) => x.fwd))} (n=${all.length})`);
for (const x of top10) console.log(`   ${x.sym.padEnd(6)} 5d into 8/21 ${pct(x.r5)} → fwd ${pct(x.fwd)}`);

const tni = rows(await uw(`/api/market/top-net-impact?date=2026-08-21&limit=10`).catch(() => null));
console.log(`\n  market_top_net_impact on 8/21: ${tni.map((x) => x.ticker || x.symbol || JSON.stringify(x).slice(0, 30)).join(', ') || 'unavailable'}`);
