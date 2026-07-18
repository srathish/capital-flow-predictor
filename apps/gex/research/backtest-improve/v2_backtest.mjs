// Backtest-driven improvement — STEP 2: measure the REAL v2 baseline + sweep.
// v2 exit ≈ structural exit (pnl to exitTs) with a +CAP% profit cap: a fire that
// ever peaks >= cap books +cap; else it books its structural-exit gain. This is
// computable directly from mfe_pct (peak) + pnl (exit) already in the CSV.
// HOLD-aware skips can't be modeled without the surface → cap-always is a faithful
// lower-bound proxy for v2 (noted). Clause 0: hypothesis-gen only, no live code.
//
// Honesty: every candidate is set on TRAIN (early days) and judged on TEST (late
// days). A lift that only shows in-sample is noise. Metric = mean %-return/fire.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSV = path.join(HERE, '..', 'uw', 'studies', 'outputs', 'repriced_fires.csv');
const raw = fs.readFileSync(CSV, 'utf8').trim().split('\n');
const cols = raw[0].split(',');
const rows = raw.slice(1).map(line => { const v = line.split(','); const o = {}; cols.forEach((c, i) => o[c] = v[i]); return o; });
const num = (x) => { if (x === undefined || x === '') return null; const n = +x; return Number.isFinite(n) ? n : null; };
const bool = (x) => x === 'True';
// pnl_* columns are $/contract = (exit-entry)*100 (policy_simulator.py:214).
// Capital-normalized %-return = pnl$ / entry = (exit-entry)/entry*100, bounded >= -100%.
const pnlRaw = (r) => {
  if (bool(r.confirmed)) { const c = num(r.pnl_confirm), e = num(r.entry_confirm); if (c !== null && e) return c / e; }
  const a = num(r.pnl_atfire), e = num(r.entry_atfire); return (a !== null && e) ? a / e : null;
};

// v2 exit P&L (%) for a given cap threshold
const v2 = (r, cap) => { const peak = num(r.mfe_pct), ex = pnlRaw(r); if (ex === null) return null; return (peak !== null && peak >= cap) ? cap : ex; };

const exp = (arr, cap) => { const x = arr.map(r => v2(r, cap)).filter(v => v !== null); return x.length ? x.reduce((s, v) => s + v, 0) / x.length : null; };
const fmt = (v) => v === null ? '  n/a' : (v >= 0 ? '+' : '') + v.toFixed(1);

// baseline = the system's fire set: G7 gate passes AND nflags<=1
const isBase = (r) => bool(r.g7_gate) && num(r.nflags) !== null && num(r.nflags) <= 1;
const base = rows.filter(isBase);

// temporal OOS split by day
const days = [...new Set(rows.map(r => r.day))].sort();
const cut = days[Math.floor(days.length * 0.6)];
const tr = (r) => r.day < cut, te = (r) => r.day >= cut;
console.log(`${rows.length} fires | baseline (g7 & nflags<=1) = ${base.length} | split @ ${cut} (train<cut, test>=cut)`);
console.log(`baseline days: train ${base.filter(tr).length} fires / test ${base.filter(te).length} fires\n`);

const CAP = 45;
console.log(`== v2 BASELINE expectancy (%-ret/fire), cap=+${CAP}% ==`);
console.log(`  ALL baseline   train ${fmt(exp(base.filter(tr), CAP))}%   test ${fmt(exp(base.filter(te), CAP))}%   (naive/no-cap test ${fmt(exp(base.filter(te), 1e9))}%)`);
for (const st of ['BULL_REVERSE', 'BEAR_RUG', 'BEAR_CONTINUE']) {
  const s = base.filter(r => r.state === st);
  console.log(`  ${st.padEnd(13)}  train ${fmt(exp(s.filter(tr), CAP))}%   test ${fmt(exp(s.filter(te), CAP))}%   (n_te=${s.filter(te).length})`);
}

console.log(`\n== EXIT sweep: which cap maximizes v2 baseline expectancy? ==`);
for (const cap of [20, 30, 45, 60, 80, 120, 1e9]) {
  console.log(`  cap=+${String(cap === 1e9 ? '∞' : cap).padStart(3)}%   train ${fmt(exp(base.filter(tr), cap))}%   test ${fmt(exp(base.filter(te), cap))}%`);
}

// ENTRY-FILTER sweep: each candidate KEEPS a subset of baseline. Threshold set on
// train, applied to test. Report lift vs baseline in BOTH halves + retained N.
console.log(`\n== ENTRY-FILTER sweep (set on train, judged on test) — lift vs baseline, cap=+${CAP}% ==`);
const baseTr = exp(base.filter(tr), CAP), baseTe = exp(base.filter(te), CAP);
const median = (arr, f) => { const x = arr.map(f).filter(v => v !== null).sort((a, b) => a - b); return x[Math.floor(x.length / 2)]; };
const cands = [];
// categorical drops
cands.push(['drop BEAR_CONTINUE', r => r.state !== 'BEAR_CONTINUE']);
cands.push(['drop BEAR_RUG (BULL only)', r => r.state !== 'BEAR_RUG' && r.state !== 'BEAR_CONTINUE']);
cands.push(['nflags==0 only', r => num(r.nflags) === 0]);
cands.push(['drop pin=True', r => !bool(r.pin)]);
cands.push(['drop flow_extreme', r => !bool(r.flow_extreme)]);
cands.push(['flow_agree5 aligned', r => { const fa = num(r.flow_agree5); return fa === null ? true : (num(r.dir) > 0 ? fa > 0.5 : fa < 0.5); }]);
cands.push(['drop opex', r => !bool(r.opex)]);
cands.push(['drop afternoon flag', r => !bool(r.flag_afternoon)]);
cands.push(['trend_day only', r => bool(r.trend_day)]);
cands.push(['chop only (not trend)', r => !bool(r.trend_day)]);
// continuous median splits (threshold from TRAIN)
for (const [nm, f] of [['d_wall_bps', r => num(r.d_wall_bps)], ['d_flip_bps', r => num(r.d_flip_bps)], ['prem_pct', r => num(r.prem_pct)], ['entry_iv', r => num(r.entry_iv)], ['breakeven_bps', r => num(r.breakeven_bps)], ['hr', r => num(r.hr)], ['vixd15', r => num(r.vixd15)]]) {
  const m = median(base.filter(tr), f);
  if (m === undefined) continue;
  cands.push([`${nm} > ${(+m).toFixed(2)} (train-med)`, r => { const v = f(r); return v === null ? false : v > m; }]);
  cands.push([`${nm} <= ${(+m).toFixed(2)} (train-med)`, r => { const v = f(r); return v === null ? false : v <= m; }]);
}

const results = cands.map(([nm, f]) => {
  const kTr = base.filter(r => tr(r) && f(r)), kTe = base.filter(r => te(r) && f(r));
  return { nm, nTr: kTr.length, nTe: kTe.length, liftTr: (exp(kTr, CAP) ?? 0) - baseTr, liftTe: (exp(kTe, CAP) ?? 0) - baseTe, expTe: exp(kTe, CAP) };
}).filter(x => x.nTe >= 30);   // need forward-ish sample on test
results.sort((a, b) => b.liftTe - a.liftTe);
console.log(`  baseline exp: train ${fmt(baseTr)}%  test ${fmt(baseTe)}%\n`);
console.log(`  candidate                          n_te  liftTrain  liftTest  expTest   VERDICT`);
for (const r of results) {
  const both = r.liftTr > 0 && r.liftTe > 0;
  console.log(`  ${r.nm.padEnd(34)} ${String(r.nTe).padStart(4)}  ${fmt(r.liftTr).padStart(8)}%  ${fmt(r.liftTe).padStart(7)}%  ${fmt(r.expTe).padStart(6)}%   ${both ? 'lift both halves' : r.liftTr > 0 ? 'train-only (noise?)' : ''}`);
}
