// Backtest-driven improvement — STEP 1: understand the baseline.
// Loads repriced_fires.csv, reports P&L conventions + expectancy by the axes
// that define the current system (state, G7 gate, nflags). Hypothesis-gen only
// (Clause 0). Expectancy = mean %-return per fire (house rule: not win rate).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSV = path.join(HERE, '..', 'uw', 'studies', 'outputs', 'repriced_fires.csv');
const raw = fs.readFileSync(CSV, 'utf8').trim().split('\n');
const cols = raw[0].split(',');
const rows = raw.slice(1).map(line => {
  const v = line.split(',');
  const o = {};
  cols.forEach((c, i) => { o[c] = v[i]; });
  return o;
});
const num = (x) => { if (x === undefined || x === '') return null; const n = +x; return Number.isFinite(n) ? n : null; };
const bool = (x) => x === 'True';

// pick the realized outcome the system would actually get:
// confirmed fires use the confirm entry; else the at-fire entry. Both are %-return to exit.
function pnl(r) {
  const c = num(r.pnl_confirm), a = num(r.pnl_atfire);
  return bool(r.confirmed) && c !== null ? c : a;
}
const stat = (arr) => {
  const x = arr.filter(v => v !== null).sort((a, b) => a - b);
  if (!x.length) return { n: 0 };
  const mean = x.reduce((s, v) => s + v, 0) / x.length;
  const med = x[Math.floor(x.length / 2)];
  const win = x.filter(v => v > 0).length / x.length;
  return { n: x.length, mean: +mean.toFixed(1), med: +med.toFixed(1), win: +(win * 100).toFixed(0) };
};
const report = (label, subset) => {
  const s = stat(subset.map(pnl));
  console.log(`  ${label.padEnd(34)} n=${String(s.n).padStart(4)}  exp=${String(s.mean).padStart(7)}%  med=${String(s.med).padStart(6)}%  win=${String(s.win).padStart(3)}%`);
};

console.log(`LOADED ${rows.length} fires, ${cols.length} cols. days ${rows[0].day}..${rows[rows.length-1].day}`);
console.log(`\n== outcome conventions ==`);
console.log(`  confirmed fires: ${rows.filter(r => bool(r.confirmed)).length}/${rows.length}`);
console.log(`  has pnl_atfire: ${rows.filter(r => num(r.pnl_atfire)!==null).length}  has pnl_confirm: ${rows.filter(r => num(r.pnl_confirm)!==null).length}`);

console.log(`\n== EXPECTANCY (%-return/fire), whole set ==`);
report('ALL fires', rows);
console.log(`\n== by STATE ==`);
for (const st of [...new Set(rows.map(r => r.state))]) report(st, rows.filter(r => r.state === st));
console.log(`\n== by G7 gate (final entry gate) ==`);
report('g7_gate=True', rows.filter(r => bool(r.g7_gate)));
report('g7_gate=False', rows.filter(r => !bool(r.g7_gate)));
report('final_sys=True', rows.filter(r => bool(r.final_sys)));
console.log(`\n== by nflags (red-flag count — the baseline gate) ==`);
for (const nf of [0, 1, 2, 3, 4]) report(`nflags=${nf}`, rows.filter(r => num(r.nflags) === nf));
report('nflags<=1 (baseline)', rows.filter(r => num(r.nflags) <= 1));
report('nflags>=2', rows.filter(r => num(r.nflags) >= 2));
console.log(`\n== BASELINE CANDIDATE = g7_gate & nflags<=1, by state ==`);
const base = rows.filter(r => bool(r.g7_gate) && num(r.nflags) <= 1);
report('baseline ALL', base);
for (const st of [...new Set(base.map(r => r.state))]) report('baseline '+st, base.filter(r => r.state === st));
