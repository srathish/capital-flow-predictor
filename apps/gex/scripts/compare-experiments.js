#!/usr/bin/env node
/**
 * Read all experiment summaries and print a unified comparison matrix.
 * Includes both the fixed-30m (legacy) metric and the realistic target-based metric.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const root = '/Users/saiyeeshrathish/gexester vexster/data/replay-experiments';
if (!existsSync(root)) {
  console.error('No experiments dir');
  process.exit(1);
}

const summaries = [];
for (const dir of readdirSync(root)) {
  const p = join(root, dir, 'summary.json');
  if (!existsSync(p)) continue;
  try { summaries.push(JSON.parse(readFileSync(p, 'utf-8'))); } catch {}
}

// Sort by target_total_bps (realistic) desc, fall back to legacy
summaries.sort((a, b) => (b.target_total_bps ?? -1e9) - (a.target_total_bps ?? -1e9));

console.log('Comparison (sorted by target-based total bps — realistic exit policy):');
console.log();
console.log('  experiment                | accepts | target_win | target_avg | target_total | tp/stp/eod  | legacy_30m_win | legacy_30m_avg');
console.log('  ──────────────────────────┼─────────┼────────────┼────────────┼──────────────┼─────────────┼────────────────┼───────────────');

const pad = (s, w) => String(s).padEnd(w);
for (const s of summaries) {
  const target = s.target_total_bps != null
    ? `${pad(s.target_win_pct + '%', 10)} | ${pad(s.target_avg_bps + ' bps', 10)} | ${pad((s.target_total_bps || 0).toFixed(0) + ' bps', 12)} | ${pad(`${s.tp_hits}/${s.stops}/${s.eods}`, 11)}`
    : `${'—'.padEnd(10)} | ${'—'.padEnd(10)} | ${'—'.padEnd(12)} | ${'—'.padEnd(11)}`;
  console.log(`  ${pad(s.experiment, 25)} | ${pad(s.accepts, 7)} | ${target} | ${pad(s.win_pct_30m + '%', 14)} | ${s.avg_bps_30m} bps`);
}

console.log();
console.log('Best by metric:');
const byTarget = [...summaries].filter(s => s.target_total_bps != null).sort((a, b) => b.target_total_bps - a.target_total_bps)[0];
const byTargetAvg = [...summaries].filter(s => s.target_avg_bps != null).sort((a, b) => b.target_avg_bps - a.target_avg_bps)[0];
const byVolume = [...summaries].sort((a, b) => b.accepts - a.accepts)[0];
if (byTarget) console.log(`  highest target total bps:  ${byTarget.experiment} (${byTarget.target_total_bps} bps, n=${byTarget.accepts})`);
if (byTargetAvg) console.log(`  highest target avg bps:    ${byTargetAvg.experiment} (${byTargetAvg.target_avg_bps} bps, n=${byTargetAvg.accepts})`);
if (byVolume) console.log(`  highest volume:            ${byVolume.experiment} (n=${byVolume.accepts})`);
