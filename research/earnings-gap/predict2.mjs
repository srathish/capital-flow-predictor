#!/usr/bin/env node
// predict2.mjs — iterations 2+3.
// IT2: did pre-print options flow (5d net premium, ask-side %) predict reaction DIRECTION
//      for this week's reporters? (expected: no tell)
// IT3: as of FRIDAY 8/21 close, UW screener historical mode: top momentum + flow names →
//      forward return 8/21 close → now. Control: S&P 500 large-cap screen same date.
import { uw, rows, num, pxSeries } from '/Users/saiyeeshrathish/uw-research-mcp/src/uw.mjs';
const pct = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%');

// ---------- IT2: flow tell on the week's big reporters ----------------------------------
const sessions = [
  ['2026-08-25', 'afterhours'], ['2026-08-26', 'premarket'],
  ['2026-08-26', 'afterhours'], ['2026-08-27', 'premarket'],
];
const reps = [];
for (const [d, when] of sessions) {
  const j = await uw(`/api/earnings/${when}?date=${d}&limit=200`).catch(() => null);
  for (const e of rows(j)) {
    const sym = e.symbol || e.ticker, imp = num(e.expected_move_perc);
    if (sym && imp != null && imp >= 0.05) reps.push({ sym, d, when, imp }); // liquid-ish movers
  }
}
let i = 0; const it2 = [];
async function work2() {
  while (i < reps.length) {
    const r = reps[i++];
    try {
      const ov = rows(await uw(`/api/stock/${encodeURIComponent(r.sym)}/options-volume?limit=15`))
        .map((x) => ({ ...x, date: String(x.date || '').slice(0, 10) }))
        .filter((x) => x.date < r.d || (r.when === 'afterhours' && x.date === r.d)) // strictly pre-print info? print is AH so day-of flow is pre-print
        .sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-5);
      if (ov.length < 3) continue;
      const net = ov.reduce((a, x) => a + (num(x.net_call_premium) || 0) + (num(x.net_put_premium) || 0), 0);
      const px = pxSeries(await uw(`/api/stock/${encodeURIComponent(r.sym)}/ohlc/1d?limit=600`));
      const isAH = r.when === 'afterhours';
      const bi = px.findLastIndex((p) => (isAH ? p.date <= r.d : p.date < r.d));
      const base = px[bi], after = px[bi + 1];
      let realized = null;
      if (base && after) realized = after.close / base.close - 1;
      else if (base) {
        const m1 = rows(await uw(`/api/stock/${encodeURIComponent(r.sym)}/ohlc/1m?limit=1`))[0];
        if (num(m1?.close) != null) realized = num(m1.close) / base.close - 1;
      }
      if (realized == null || Math.abs(realized) < 0.02) continue; // only real moves
      it2.push({ sym: r.sym, net, realized, agree: Math.sign(net) === Math.sign(realized) });
    } catch { /* skip */ }
  }
}
await Promise.all(Array.from({ length: 8 }, work2));
const agree = it2.filter((x) => x.agree).length;
console.log(`IT2 — pre-print 5d net premium sign vs reaction sign (moves >2%): ${agree}/${it2.length} agree = ${it2.length ? Math.round((agree / it2.length) * 100) : '—'}% (coin flip = 50%)`);
for (const x of it2.sort((a, b) => Math.abs(b.realized) - Math.abs(a.realized)).slice(0, 10))
  console.log(`   ${x.sym.padEnd(6)} net ${(x.net / 1e6).toFixed(1).padStart(7)}M → realized ${pct(x.realized)} ${x.agree ? 'AGREE' : 'wrong'}`);

// ---------- IT3: Friday 8/21 screener → forward returns ---------------------------------
async function screen(params, label) {
  const j = await uw(`/api/screener/stocks?date=2026-08-21&${params}`).catch(() => null);
  const names = rows(j).map((s) => ({ sym: s.ticker || s.symbol, close: num(s.close) })).filter((s) => s.sym);
  return { label, names };
}
const [mom, ctrl] = await Promise.all([
  // momentum + flow leaders as of 8/21: 3-day net premium positive, big 3-day price %, liquid
  screen('min_marketcap=10000000000&min_net_premium=5000000&order=perc_3_day_total&order_direction=desc&min_volume=10000&max_change=1', 'momentum+flow top (8/21)'),
  screen('min_marketcap=100000000000&is_s_p_500=true&order=marketcap&order_direction=desc', 'mega-cap control (8/21)'),
]);
async function fwd(names, topN) {
  const out = [];
  let k = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (k < Math.min(topN, names.length)) {
      const s = names[k++];
      try {
        const px = pxSeries(await uw(`/api/stock/${encodeURIComponent(s.sym)}/ohlc/1d?limit=30`));
        const fri = px.findLast((p) => p.date <= '2026-08-21');
        const now = px[px.length - 1];
        if (fri && now && now.date > '2026-08-21') out.push({ sym: s.sym, ret: now.close / fri.close - 1 });
      } catch { /* skip */ }
    }
  }));
  return out;
}
for (const g of [mom, ctrl]) {
  const f = await fwd(g.names, 15);
  const avg = f.length ? f.reduce((a, x) => a + x.ret, 0) / f.length : null;
  console.log(`\nIT3 — ${g.label}: n=${f.length}, avg fwd 8/21→now ${pct(avg)}`);
  for (const x of f.sort((a, b) => b.ret - a.ret)) console.log(`   ${x.sym.padEnd(6)} ${pct(x.ret)}`);
}
