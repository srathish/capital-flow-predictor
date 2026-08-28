#!/usr/bin/env node
// predict5.mjs — iterations 7-9 on the Jul 1–Aug 21 validation window (saved to disk):
//  A) large-cap up-gappers bucketed by gap/implied multiple — does EXTREME beat matter?
//  B) small-cap fade — the consistent signal so far; full stats
//  C) day-2: reaction-day close → next close, for large-cap up-gappers (the "buy the close" leg)
//  D) sympathy: on Technology cluster days, did a fixed software-peer basket outperform SPY same day?
import fs from 'node:fs';
import { uw, rows, num, pxSeries } from '/Users/saiyeeshrathish/uw-research-mcp/src/uw.mjs';
const pct = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%');
const CACHE = '/private/tmp/claude-501/-Users-saiyeeshrathish-the-final-plan/e7cbbf32-4460-49ca-941f-3e63bb200cf5/scratchpad/val_cache.json';

function weekdays(from, to) {
  const out = [];
  for (let t = Date.parse(from + 'T12:00Z'); t <= Date.parse(to + 'T12:00Z'); t += 86400e3) {
    const dt = new Date(t);
    if (dt.getUTCDay() > 0 && dt.getUTCDay() < 6) out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}
let res;
if (fs.existsSync(CACHE)) {
  res = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  console.log(`loaded cache: ${res.length} reporter outcomes`);
} else {
  const reps = [];
  for (const d of weekdays('2026-07-01', '2026-08-21')) {
    for (const when of ['afterhours', 'premarket']) {
      const j = await uw(`/api/earnings/${when}?date=${d}&limit=200`).catch(() => null);
      for (const e of rows(j)) {
        const sym = e.symbol || e.ticker, imp = num(e.expected_move_perc);
        if (sym && imp != null && imp >= 0.04)
          reps.push({ sym, d, when, imp, sector: e.sector || '?', mcap: num(e.marketcap) });
      }
    }
  }
  res = [];
  let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < reps.length) {
      const r = reps[i++];
      try {
        const px = pxSeries(await uw(`/api/stock/${encodeURIComponent(r.sym)}/ohlc/1d?limit=600`));
        const isAH = r.when === 'afterhours';
        const bi = px.findLastIndex((p) => (isAH ? p.date <= r.d : p.date < r.d));
        const base = px[bi], rx = px[bi + 1], nx = px[bi + 2];
        if (!base || !rx || num(rx.open) == null) continue;
        res.push({ ...r, gap: num(rx.open) / base.close - 1, drift: rx.close / num(rx.open) - 1, day2: nx ? nx.close / rx.close - 1 : null, rxDate: rx.date });
      } catch { /* skip */ }
    }
  }));
  fs.writeFileSync(CACHE, JSON.stringify(res));
  console.log(`collected ${res.length} reporter outcomes (cached)`);
}

const stats = (g, f = (x) => x.drift) => {
  const v = g.map(f).filter((x) => x != null);
  if (!v.length) return 'n=0';
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  const med = v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)];
  return `n=${v.length}  avg ${pct(avg)}  median ${pct(med)}  pos-rate ${Math.round((v.filter((x) => x > 0).length / v.length) * 100)}%`;
};
const big = (x) => x.mcap != null && x.mcap >= 5e9;
const upBeat = res.filter((x) => x.gap > x.imp);

console.log('\nA) LARGE-CAP up-gappers by gap/implied multiple (o→c drift):');
console.log(`   1.0–1.5×: ${stats(upBeat.filter((x) => big(x) && x.gap / x.imp < 1.5))}`);
console.log(`   ≥1.5×:    ${stats(upBeat.filter((x) => big(x) && x.gap / x.imp >= 1.5))}`);

console.log('\nB) SMALL-CAP (<$5B) up-gappers — fade check (o→c drift):');
const smUp = upBeat.filter((x) => !big(x));
console.log(`   all:      ${stats(smUp)}`);
console.log(`   gap ≥10%: ${stats(smUp.filter((x) => x.gap >= 0.10))}`);
console.log(`   gap ≥15%: ${stats(smUp.filter((x) => x.gap >= 0.15))}`);

console.log('\nC) DAY-2 (reaction close → next close) for LARGE-CAP up-gappers:');
console.log(`   all:                 ${stats(upBeat.filter(big), (x) => x.day2)}`);
console.log(`   that CONTINUED day1: ${stats(upBeat.filter((x) => big(x) && x.drift > 0), (x) => x.day2)}`);
console.log(`   that FADED day1:     ${stats(upBeat.filter((x) => big(x) && x.drift < 0), (x) => x.day2)}`);

console.log('\nD) SYMPATHY — software peer basket on Technology cluster days vs SPY:');
const byDaySector = new Map();
for (const x of upBeat.filter(big)) {
  const k = x.rxDate + '|' + x.sector;
  byDaySector.set(k, (byDaySector.get(k) || 0) + 1);
}
const techDays = [...new Set(upBeat.filter((x) => big(x) && x.sector === 'Technology' && byDaySector.get(x.rxDate + '|Technology') >= 2).map((x) => x.rxDate))].sort();
console.log(`   tech cluster days: ${techDays.join(', ')}`);
const PEERS = ['NOW', 'ADBE', 'PANW', 'ZS', 'DDOG', 'WDAY', 'HUBS', 'TEAM'];
const series = {};
for (const p of [...PEERS, 'SPY']) series[p] = pxSeries(await uw(`/api/stock/${p}/ohlc/1d?limit=600`).catch(() => null));
const dayRet = (px, d) => {
  const i = px.findIndex((r) => r.date === d);
  return i > 0 ? px[i].close / px[i - 1].close - 1 : null;
};
const rel = [];
for (const d of techDays) {
  const spy = dayRet(series.SPY, d);
  const prs = PEERS.map((p) => dayRet(series[p], d)).filter((x) => x != null);
  if (spy == null || !prs.length) continue;
  const avg = prs.reduce((a, b) => a + b, 0) / prs.length;
  rel.push({ d, excess: avg - spy });
  console.log(`   ${d}: peers ${pct(avg)} vs SPY ${pct(spy)} → excess ${pct(avg - spy)}`);
}
if (rel.length) {
  const avgEx = rel.reduce((a, x) => a + x.excess, 0) / rel.length;
  console.log(`   avg excess across ${rel.length} cluster days: ${pct(avgEx)}  pos-rate ${Math.round((rel.filter((x) => x.excess > 0).length / rel.length) * 100)}%`);
}
