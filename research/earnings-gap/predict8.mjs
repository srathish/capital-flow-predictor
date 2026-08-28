#!/usr/bin/env node
// predict8.mjs — iteration 12: composite LONG rule. Fit on validation (Jul 1–Aug 21,
// n≈997 large-cap reporters), 4 pre-registered composites only, then OOS test on THIS
// WEEK's large-cap reporters: flagged vs unflagged realized reactions.
import fs from 'node:fs';
import { uw, rows, num, pxSeries } from '/Users/saiyeeshrathish/uw-research-mcp/src/uw.mjs';
const pct = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%');
const SP = '/private/tmp/claude-501/-Users-saiyeeshrathish-the-final-plan/e7cbbf32-4460-49ca-941f-3e63bb200cf5/scratchpad';
const val = JSON.parse(fs.readFileSync(SP + '/feat_cache.json', 'utf8'));

const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
const rvVals = val.map((x) => x.rv12q_vs_implied).filter((x) => x != null);
const rvT1 = q(rvVals, 1 / 3);
const cdVals = val.map((x) => x.cum_dir_delta).filter((x) => x != null);
const cdMed = q(cdVals, 0.5);
const bbVals = val.map((x) => x.bull_bear).filter((x) => x != null);
const bbT2 = q(bbVals, 2 / 3);
console.log(`thresholds from validation: rv12q_vs_implied T1=${rvT1.toFixed(3)}, cum_dir_delta med=${cdMed.toFixed(0)}, bull_bear T2=${bbT2.toFixed(3)}`);

const RULES = {
  C1_fear_overpriced: (x) => x.rv12q_vs_implied != null && x.rv12q_vs_implied <= rvT1,
  C2_fear_plus_delta: (x) => x.rv12q_vs_implied != null && x.rv12q_vs_implied <= rvT1 && x.cum_dir_delta != null && x.cum_dir_delta > 0,
  C3_delta_plus_bull: (x) => x.cum_dir_delta != null && x.cum_dir_delta > cdMed && x.bull_bear != null && x.bull_bear >= bbT2,
  C4_all_three: (x) => x.rv12q_vs_implied != null && x.rv12q_vs_implied <= rvT1 && x.cum_dir_delta != null && x.cum_dir_delta > 0 && x.bull_bear != null && x.bull_bear > 0,
};
const stats = (g) => {
  if (!g.length) return 'n=0';
  const v = g.map((x) => x.rx);
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  const up = Math.round((v.filter((x) => x > 0).length / v.length) * 100);
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - avg) ** 2, 0) / v.length);
  return `n=${g.length}  avg rx ${pct(avg)}  up-rate ${up}%  (t≈${(avg / (sd / Math.sqrt(v.length))).toFixed(1)})`;
};
console.log('\nvalidation (baseline: ' + stats(val.filter((x) => x.rx != null)) + '):');
for (const [name, fn] of Object.entries(RULES)) console.log(`  ${name.padEnd(20)} ${stats(val.filter((x) => x.rx != null && fn(x)))}`);

// ---------- OOS: this week ----------------------------------------------------------------
const sessions = [
  ['2026-08-25', 'afterhours'], ['2026-08-26', 'premarket'],
  ['2026-08-26', 'afterhours'], ['2026-08-27', 'premarket'],
];
const wk = [];
for (const [d, when] of sessions) {
  const j = await uw(`/api/earnings/${when}?date=${d}&limit=200`).catch(() => null);
  for (const e of rows(j)) {
    const sym = e.symbol || e.ticker, imp = num(e.expected_move_perc), mcap = num(e.marketcap);
    if (sym && imp != null && mcap != null && mcap >= 5e9) wk.push({ sym, d, when, imp });
  }
}
function preDate(r) {
  if (r.when === 'afterhours') return r.d;
  let t = Date.parse(r.d + 'T12:00Z') - 86400e3;
  while (new Date(t).getUTCDay() === 0 || new Date(t).getUTCDay() === 6) t -= 86400e3;
  return new Date(t).toISOString().slice(0, 10);
}
const FEAT = (s) => ({
  cum_dir_delta: num(s.cum_dir_delta),
  bull_bear: (() => { const b = num(s.bullish_premium), r = num(s.bearish_premium); return b != null && r != null && b + r > 0 ? (b - r) / (b + r) : null; })(),
  rv12q_vs_implied: (() => { const a = num(s.rv_1d_last_12q), b = num(s.iv30d); return a != null && b > 0 ? a / b : null; })(),
});
const wres = [];
let i = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (i < wk.length) {
    const r = wk[i++];
    try {
      const s = rows(await uw(`/api/screener/stocks?ticker=${encodeURIComponent(r.sym)}&date=${preDate(r)}`))[0];
      if (!s) continue;
      const px = pxSeries(await uw(`/api/stock/${encodeURIComponent(r.sym)}/ohlc/1d?limit=600`));
      const isAH = r.when === 'afterhours';
      const bi = px.findLastIndex((p) => (isAH ? p.date <= r.d : p.date < r.d));
      const base = px[bi], rx = px[bi + 1];
      let realized = null;
      if (base && rx) realized = rx.close / base.close - 1;
      else if (base) {
        const m1 = rows(await uw(`/api/stock/${encodeURIComponent(r.sym)}/ohlc/1m?limit=1`))[0];
        if (num(m1?.close) != null) realized = num(m1.close) / base.close - 1;
      }
      if (realized == null) continue;
      wres.push({ sym: r.sym, d: r.d, rx: realized, ...FEAT(s) });
    } catch { /* skip */ }
  }
}));
console.log(`\nOOS — this week's large-cap reporters: n=${wres.length}, baseline ${stats(wres)}`);
for (const [name, fn] of Object.entries(RULES)) {
  const flagged = wres.filter((x) => fn(x)), rest = wres.filter((x) => !fn(x));
  console.log(`\n  ${name}: FLAGGED ${stats(flagged)}   | unflagged ${stats(rest)}`);
  for (const x of flagged.sort((a, b) => b.rx - a.rx)) console.log(`     ${x.sym.padEnd(6)} ${x.d} → ${pct(x.rx)}`);
}
