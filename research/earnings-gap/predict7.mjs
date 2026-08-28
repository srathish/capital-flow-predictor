#!/usr/bin/env node
// predict7.mjs — iteration 11: UW screener HISTORICAL positioning features vs reaction.
// For every large-cap reporter (validation Jul 1–Aug 21 from cache + this week), pull the
// screener row AS OF the last pre-print close and test each positioning feature against the
// full 1-day reaction. Terciles on validation; read out this week's names for whatever holds.
import fs from 'node:fs';
import { uw, rows, num } from '/Users/saiyeeshrathish/uw-research-mcp/src/uw.mjs';
const pct = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%');
const SP = '/private/tmp/claude-501/-Users-saiyeeshrathish-the-final-plan/e7cbbf32-4460-49ca-941f-3e63bb200cf5/scratchpad';

const cache = JSON.parse(fs.readFileSync(SP + '/val_cache.json', 'utf8'));
const bigVal = cache.filter((x) => x.mcap != null && x.mcap >= 5e9);
console.log(`validation large-cap reporters: ${bigVal.length}`);

// pre-print screener date: AH report on d → same-day close (pre-print); premarket on d → previous weekday
function preDate(r) {
  if (r.when === 'afterhours') return r.d;
  let t = Date.parse(r.d + 'T12:00Z') - 86400e3;
  while (new Date(t).getUTCDay() === 0 || new Date(t).getUTCDay() === 6) t -= 86400e3;
  return new Date(t).toISOString().slice(0, 10);
}
const FEATS = {
  cum_dir_delta: (s) => num(s.cum_dir_delta),
  bull_bear: (s) => { const b = num(s.bullish_premium), r = num(s.bearish_premium); return b != null && r != null && b + r > 0 ? (b - r) / (b + r) : null; },
  net_call_prem: (s) => num(s.net_call_premium),
  put_call_ratio: (s) => num(s.put_call_ratio),
  call_oi_vs_avg: (s) => { const a = num(s.call_open_interest), b = num(s.avg_30_day_call_oi); return a != null && b > 0 ? a / b : null; },
  ask_side_call_pct: (s) => { const a = num(s.call_volume_ask_side), b = num(s.call_volume_bid_side); return a != null && b != null && a + b > 0 ? a / (a + b) : null; },
  iv_rank: (s) => num(s.iv_rank),
  variance_risk_prem: (s) => num(s.variance_risk_premium),
  gex_ratio: (s) => num(s.gex_ratio),
  rv12q_vs_implied: (s) => { const a = num(s.rv_1d_last_12q), b = num(s.iv30d); return a != null && b > 0 ? a / b : null; },
};

async function fetchFeat(list) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < list.length) {
      const r = list[i++];
      try {
        const s = rows(await uw(`/api/screener/stocks?ticker=${encodeURIComponent(r.sym)}&date=${preDate(r)}`))[0];
        if (!s) continue;
        const f = {};
        for (const [k, fn] of Object.entries(FEATS)) f[k] = fn(s);
        const rx = (1 + r.gap) * (1 + r.drift) - 1; // full 1d reaction
        out.push({ sym: r.sym, d: r.d, rx, ...f });
      } catch { /* skip */ }
    }
  }));
  return out;
}
const CACHE2 = SP + '/feat_cache.json';
let val;
if (fs.existsSync(CACHE2)) { val = JSON.parse(fs.readFileSync(CACHE2, 'utf8')); console.log(`loaded feature cache: ${val.length}`); }
else { val = await fetchFeat(bigVal); fs.writeFileSync(CACHE2, JSON.stringify(val)); console.log(`features fetched: ${val.length}`); }

console.log('\nfeature terciles (validation): avg reaction / up-rate  [low | mid | high]');
for (const k of Object.keys(FEATS)) {
  const g = val.filter((x) => x[k] != null && x.rx != null).sort((a, b) => a[k] - b[k]);
  if (g.length < 30) { console.log(`  ${k.padEnd(20)} n<30`); continue; }
  const t = Math.floor(g.length / 3);
  const buck = [g.slice(0, t), g.slice(t, 2 * t), g.slice(2 * t)];
  const line = buck.map((b) => {
    const avg = b.reduce((a, x) => a + x.rx, 0) / b.length;
    const up = Math.round((b.filter((x) => x.rx > 0).length / b.length) * 100);
    return `${pct(avg)}/${up}%`;
  }).join('  |  ');
  console.log(`  ${k.padEnd(20)} n=${g.length}  ${line}`);
}
// magnitude check for variance_risk_premium: does high VRP → realized << implied?
const vg = val.filter((x) => x.variance_risk_prem != null).sort((a, b) => a.variance_risk_prem - b.variance_risk_prem);
if (vg.length >= 30) {
  const t = Math.floor(vg.length / 3);
  const mag = [vg.slice(0, t), vg.slice(2 * t)].map((b) => pct(b.reduce((a, x) => a + Math.abs(x.rx), 0) / b.length));
  console.log(`\n  |reaction| by variance_risk_premium: low-VRP ${mag[0]} vs high-VRP ${mag[1]}`);
}
