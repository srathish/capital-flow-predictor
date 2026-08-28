#!/usr/bin/env node
// predict_week.mjs — could past UW data have predicted this week's moves (Aug 24-27 2026)?
// RULE 1: earnings-asymmetry — flag reporters whose historical avg |1d reaction| (prior
// reports only) EXCEEDS the current implied move. Prediction: realized |move| beats implied.
// Scored against ALL reporters of the week (flagged vs unflagged) — no cherry-picking.
import { uw, rows, num, pxSeries } from '/Users/saiyeeshrathish/uw-research-mcp/src/uw.mjs';

const pct = (x) => (x == null ? '  —  ' : ((x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%').padStart(6));

// ---- collect the week's reporters ------------------------------------------------------
const sessions = [
  ['2026-08-24', 'afterhours'], ['2026-08-25', 'premarket'],
  ['2026-08-25', 'afterhours'], ['2026-08-26', 'premarket'],
  ['2026-08-26', 'afterhours'], ['2026-08-27', 'premarket'],
];
const reporters = [];
for (const [d, when] of sessions) {
  const j = await uw(`/api/earnings/${when}?date=${d}&limit=200`).catch(() => null);
  for (const e of rows(j)) {
    const sym = e.symbol || e.ticker;
    const imp = num(e.expected_move_perc);
    if (!sym || imp == null) continue;
    reporters.push({ sym, d, when, imp, sector: e.sector || '?' });
  }
}
console.log(`reporters with implied move this week: ${reporters.length}`);

// ---- per ticker: history (prior reactions) + realized move -----------------------------
const out = [];
let i = 0;
async function work() {
  while (i < reporters.length) {
    const r = reporters[i++];
    try {
      const ern = rows(await uw(`/api/earnings/${encodeURIComponent(r.sym)}`));
      // prior reports STRICTLY BEFORE this week's report — the only history a trader had
      const prior = ern
        .map((e) => ({ d: String(e.report_date || '').slice(0, 10), m: num(e.post_earnings_move_1d), imp: num(e.expected_move_perc) }))
        .filter((e) => e.d && e.d < r.d && e.m != null)
        .sort((a, b) => (a.d < b.d ? -1 : 1));
      if (prior.length < 3) continue; // need a real sample
      const hist = prior.slice(-8);
      const avgAbs = hist.reduce((a, e) => a + Math.abs(e.m), 0) / hist.length;

      // realized reaction: prior close before the print → latest close after it
      const px = pxSeries(await uw(`/api/stock/${encodeURIComponent(r.sym)}/ohlc/1d?limit=600`));
      const isAH = r.when === 'afterhours';
      // AH on day D: base = close of D, reaction shows in D+1. premarket on D: base = close of D-1.
      const baseIdx = px.findLastIndex((p) => (isAH ? p.date <= r.d : p.date < r.d));
      const base = px[baseIdx], after = px[baseIdx + 1];
      let realized = null, live = false;
      if (base && after) realized = after.close / base.close - 1;
      else if (base) {
        const m1 = rows(await uw(`/api/stock/${encodeURIComponent(r.sym)}/ohlc/1m?limit=1`))[0];
        if (num(m1?.close) != null) { realized = num(m1.close) / base.close - 1; live = true; }
      }
      if (realized == null) continue;
      out.push({ ...r, n: hist.length, avgAbs, flag: avgAbs > r.imp, realized, beat: Math.abs(realized) > r.imp, live });
    } catch { /* skip */ }
  }
}
await Promise.all(Array.from({ length: 8 }, work));

// ---- score -----------------------------------------------------------------------------
const flagged = out.filter((o) => o.flag), rest = out.filter((o) => !o.flag);
const hit = (g) => (g.length ? g.filter((o) => o.beat).length / g.length : null);
const avgMove = (g) => (g.length ? g.reduce((a, o) => a + Math.abs(o.realized), 0) / g.length : null);
const avgImp = (g) => (g.length ? g.reduce((a, o) => a + o.imp, 0) / g.length : null);

console.log(`\nscored: ${out.length} reporters (history≥3 + realized move)`);
console.log(`\nRULE 1 — asymmetry flag (hist avg |reaction| > implied), all pre-print data:`);
console.log(`  FLAGGED   n=${flagged.length}  beat-implied rate ${hit(flagged) != null ? (hit(flagged) * 100).toFixed(0) + '%' : '—'}  avg |realized| ${pct(avgMove(flagged))} vs avg implied ${pct(avgImp(flagged))}`);
console.log(`  unflagged n=${rest.length}  beat-implied rate ${hit(rest) != null ? (hit(rest) * 100).toFixed(0) + '%' : '—'}  avg |realized| ${pct(avgMove(rest))} vs avg implied ${pct(avgImp(rest))}`);

console.log(`\nflagged names (sorted by realized):`);
for (const o of flagged.sort((a, b) => Math.abs(b.realized) - Math.abs(a.realized)))
  console.log(`  ${o.sym.padEnd(6)} ${o.d} ${o.when.padEnd(10)} hist ${pct(o.avgAbs)} vs imp ${pct(o.imp)} → realized ${pct(o.realized)} ${o.beat ? 'BEAT' : 'no'}${o.live ? ' (live px)' : ''}`);
console.log(`\nbiggest unflagged movers (the misses):`);
for (const o of rest.sort((a, b) => Math.abs(b.realized) - Math.abs(a.realized)).slice(0, 8))
  console.log(`  ${o.sym.padEnd(6)} ${o.d} ${o.when.padEnd(10)} hist ${pct(o.avgAbs)} vs imp ${pct(o.imp)} → realized ${pct(o.realized)}${o.live ? ' (live px)' : ''}`);
