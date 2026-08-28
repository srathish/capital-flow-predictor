#!/usr/bin/env node
// predict6.mjs — iteration 10: PRE-EARNINGS DRIFT. Does the 1-week move INTO the print
// (UW pre_earnings_move_1w, known pre-print) predict reaction direction/beat?
// Tested across every historical report UW has for this week's reporters (large n),
// then read out for this week's big names.
import { uw, rows, num } from '/Users/saiyeeshrathish/uw-research-mcp/src/uw.mjs';
const pct = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%');

const sessions = [
  ['2026-08-25', 'afterhours'], ['2026-08-26', 'premarket'],
  ['2026-08-26', 'afterhours'], ['2026-08-27', 'premarket'],
];
const syms = new Set();
for (const [d, when] of sessions) {
  const j = await uw(`/api/earnings/${when}?date=${d}&limit=200`).catch(() => null);
  for (const e of rows(j)) {
    const s = e.symbol || e.ticker;
    if (s && num(e.expected_move_perc) != null) syms.add(s);
  }
}
const tickers = [...syms];
console.log(`tickers: ${tickers.length}`);

// historical panel: every past report with pre_1w + post_1d + implied
const hist = [];
const thisWeek = [];
let i = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (i < tickers.length) {
    const t = tickers[i++];
    try {
      const ern = rows(await uw(`/api/earnings/${encodeURIComponent(t)}`));
      for (const e of ern) {
        const d = String(e.report_date || '').slice(0, 10);
        const pre = num(e.pre_earnings_move_1w), post = num(e.post_earnings_move_1d), imp = num(e.expected_move_perc);
        if (d >= '2026-08-25' && d <= '2026-08-27') { thisWeek.push({ t, d, pre, imp }); continue; }
        if (pre == null || post == null) continue;
        hist.push({ t, d, pre, post, imp, agree: Math.sign(pre) === Math.sign(post), beat: imp != null ? Math.abs(post) > imp : null });
      }
    } catch { /* skip */ }
  }
}));
console.log(`historical report panel: n=${hist.length}`);

const buckets = [
  ['pre_1w > +5% (ran into print)', hist.filter((h) => h.pre > 0.05)],
  ['pre_1w +0–5%', hist.filter((h) => h.pre > 0 && h.pre <= 0.05)],
  ['pre_1w −5–0%', hist.filter((h) => h.pre <= 0 && h.pre > -0.05)],
  ['pre_1w < −5% (dumped into print)', hist.filter((h) => h.pre <= -0.05)],
];
console.log('\npre-earnings 1w drift vs reaction (all past reports of this week\'s reporters):');
for (const [label, g] of buckets) {
  if (!g.length) { console.log(`  ${label}: n=0`); continue; }
  const avgPost = g.reduce((a, h) => a + h.post, 0) / g.length;
  const upRate = g.filter((h) => h.post > 0).length / g.length;
  console.log(`  ${label.padEnd(34)} n=${String(g.length).padStart(4)}  avg reaction ${pct(avgPost)}  up-rate ${Math.round(upRate * 100)}%`);
}
const agree = hist.filter((h) => h.agree).length;
console.log(`  momentum-sign agreement overall: ${Math.round((agree / hist.length) * 100)}% (50 = coin flip)`);

console.log('\nthis week\'s big names — what the pre-print drift said:');
for (const w of thisWeek.filter((x) => ['CRM', 'CRWD', 'OKTA', 'VEEV', 'SNPS', 'NVDA', 'ANF'].includes(x.t)))
  console.log(`  ${w.t.padEnd(5)} ${w.d} pre-1w ${pct(w.pre)} (implied ${pct(w.imp)})`);
