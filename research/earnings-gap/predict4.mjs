#!/usr/bin/env node
// predict4.mjs — iteration 6: CLUSTER-CONDITIONAL continuation.
// Rule under test: reaction-day open, among reporters gapping UP beyond implied:
//   CLUSTER = ≥2 large-cap ($5B+) same-sector names doing it the SAME day
//   vs isolated/small gappers. Validation: Jul 1 – Aug 21 (pre-this-week).
//   Test: this week (8/24–8/27 reaction days).
import { uw, rows, num, pxSeries } from '/Users/saiyeeshrathish/uw-research-mcp/src/uw.mjs';
const pct = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%');

function weekdays(from, to) {
  const out = [];
  for (let t = Date.parse(from + 'T12:00Z'); t <= Date.parse(to + 'T12:00Z'); t += 86400e3) {
    const dt = new Date(t);
    if (dt.getUTCDay() > 0 && dt.getUTCDay() < 6) out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}
async function reporters(dates) {
  const out = [];
  for (const d of dates) {
    for (const when of ['afterhours', 'premarket']) {
      const j = await uw(`/api/earnings/${when}?date=${d}&limit=200`).catch(() => null);
      for (const e of rows(j)) {
        const sym = e.symbol || e.ticker, imp = num(e.expected_move_perc);
        if (sym && imp != null && imp >= 0.04)
          out.push({ sym, d, when, imp, sector: e.sector || '?', mcap: num(e.marketcap) });
      }
    }
  }
  return out;
}
async function gapDrift(r) {
  const px = pxSeries(await uw(`/api/stock/${encodeURIComponent(r.sym)}/ohlc/1d?limit=600`));
  const isAH = r.when === 'afterhours';
  const bi = px.findLastIndex((p) => (isAH ? p.date <= r.d : p.date < r.d));
  const base = px[bi], rx = px[bi + 1];
  if (!base || !rx || num(rx.open) == null) return null;
  return { ...r, gap: num(rx.open) / base.close - 1, drift: rx.close / num(rx.open) - 1, rxDate: rx.date };
}
async function collect(dates) {
  const reps = await reporters(dates);
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < reps.length) { const r = reps[i++]; const g = await gapDrift(r).catch(() => null); if (g) out.push(g); }
  }));
  return out;
}
function classify(res) {
  const upBeat = res.filter((x) => x.gap > x.imp); // UP beyond implied only
  const big = (x) => x.mcap != null && x.mcap >= 5e9;
  const byDaySector = new Map();
  for (const x of upBeat.filter(big)) {
    const k = x.rxDate + '|' + x.sector;
    byDaySector.set(k, (byDaySector.get(k) || 0) + 1);
  }
  const cluster = upBeat.filter((x) => big(x) && byDaySector.get(x.rxDate + '|' + x.sector) >= 2);
  const bigIso = upBeat.filter((x) => big(x) && byDaySector.get(x.rxDate + '|' + x.sector) < 2);
  const small = upBeat.filter((x) => !big(x));
  return { cluster, bigIso, small };
}
const stats = (g) => {
  if (!g.length) return 'n=0';
  const avg = g.reduce((a, x) => a + x.drift, 0) / g.length;
  const med = g.map((x) => x.drift).sort((a, b) => a - b)[Math.floor(g.length / 2)];
  return `n=${g.length}  avg o→c drift ${pct(avg)}  median ${pct(med)}  continue-rate ${Math.round((g.filter((x) => x.drift > 0).length / g.length) * 100)}%`;
};

console.log('validating on Jul 1 – Aug 21 (pre-this-week)…');
const val = classify(await collect(weekdays('2026-07-01', '2026-08-21')));
console.log(`  CLUSTER (≥2 large-cap same-sector up-gappers, same day): ${stats(val.cluster)}`);
console.log(`  large-cap ISOLATED up-gappers:                           ${stats(val.bigIso)}`);
console.log(`  small-cap up-gappers:                                    ${stats(val.small)}`);
console.log(`  cluster days:`, [...new Set(val.cluster.map((x) => x.rxDate + ' ' + x.sector))].join(' | ') || 'none');

console.log('\ntest: this week (reaction days 8/25–8/27)…');
const wk = classify(await collect(weekdays('2026-08-24', '2026-08-26')));
console.log(`  CLUSTER: ${stats(wk.cluster)}`);
for (const x of wk.cluster.sort((a, b) => b.drift - a.drift))
  console.log(`   ${x.sym.padEnd(6)} ${x.rxDate} [${x.sector}] gap ${pct(x.gap)} → drift ${pct(x.drift)}`);
console.log(`  large-cap isolated: ${stats(wk.bigIso)}`);
console.log(`  small-cap:          ${stats(wk.small)}`);
