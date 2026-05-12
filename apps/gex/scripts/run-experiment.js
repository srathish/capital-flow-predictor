#!/usr/bin/env node
/**
 * Experiment harness: clone calibrated_thresholds.json with overrides, run replay,
 * backfill outcomes, print a one-line summary. Multiple experiments = a sweep.
 *
 * Usage:
 *   npm run experiment -- --name=loosen-rr --override='{"rr_gating":{"reject_below":1.5,"reduced_size":1.5,"full_size":2.5}}'
 *   npm run experiment -- --name=tighter-bias --override='{"bias_score_weights":{"pattern_signal":0.40}}'
 *   npm run experiment -- --restore=iter1_baseline
 *
 * Each named run leaves:
 *   config/checkpoints/<name>.json     — the thresholds used
 *   data/replay-experiments/<name>/    — separate replay DB so prior experiments stay intact
 *   data/replay-experiments/<name>/summary.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const liveConfig = join(root, 'config', 'calibrated_thresholds.json');
const checkpointDir = join(root, 'config', 'checkpoints');
const experimentRoot = join(root, 'data', 'replay-experiments');

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    args[m[1]] = m[2] ?? true;
  }
  return args;
}

function deepMerge(base, override) {
  const out = { ...base };
  for (const k of Object.keys(override)) {
    if (override[k] !== null && typeof override[k] === 'object' && !Array.isArray(override[k])) {
      out[k] = deepMerge(base[k] || {}, override[k]);
    } else {
      out[k] = override[k];
    }
  }
  return out;
}

const args = parseArgs();

if (args.restore) {
  const path = join(checkpointDir, `${args.restore}.json`);
  if (!existsSync(path)) {
    console.error(`No checkpoint named ${args.restore}`);
    process.exit(1);
  }
  cpSync(path, liveConfig);
  console.log(`Restored config from checkpoint: ${args.restore}`);
  process.exit(0);
}

if (args.list) {
  console.log('Checkpoints:');
  for (const f of require('fs').readdirSync(checkpointDir)) {
    if (f.endsWith('.json')) console.log('  -', f.replace('.json', ''));
  }
  console.log('\nExperiments:');
  if (existsSync(experimentRoot)) {
    for (const d of require('fs').readdirSync(experimentRoot)) {
      const summary = join(experimentRoot, d, 'summary.json');
      if (existsSync(summary)) {
        const s = JSON.parse(readFileSync(summary, 'utf-8'));
        console.log(`  ${d.padEnd(30)} accepts=${s.accepts}  win@30m=${s.win_pct_30m}%  avg=${s.avg_bps_30m}bps`);
      }
    }
  }
  process.exit(0);
}

if (!args.name) {
  console.error('Usage: --name=<exp> --override=\'<json>\' OR --restore=<checkpoint> OR --list');
  process.exit(1);
}

const baseConfig = JSON.parse(readFileSync(liveConfig, 'utf-8'));
let override = {};
if (args.override) {
  try { override = JSON.parse(args.override); }
  catch (e) { console.error('--override must be valid JSON:', e.message); process.exit(1); }
}
const expConfig = deepMerge(baseConfig, override);
expConfig.version = `experiment_${args.name}`;
expConfig.calibrated_at = new Date().toISOString();

const expDir = join(experimentRoot, args.name);
const expDataDir = join(expDir, 'data');
if (existsSync(expDir)) rmSync(expDir, { recursive: true, force: true });
mkdirSync(expDataDir, { recursive: true });

// 1. Save config snapshot
const expConfigPath = join(expDir, 'thresholds.json');
writeFileSync(expConfigPath, JSON.stringify(expConfig, null, 2));
writeFileSync(join(checkpointDir, `${args.name}.json`), JSON.stringify(expConfig, null, 2));

// 2. Swap live config to experiment config for the replay run
const liveBackup = JSON.parse(readFileSync(liveConfig, 'utf-8'));
writeFileSync(liveConfig, JSON.stringify(expConfig, null, 2));

console.log(`▶ experiment "${args.name}"`);
console.log(`  override: ${JSON.stringify(override)}`);
console.log(`  data dir: ${expDataDir}`);

try {
  execSync(`DATA_DIR='${expDataDir}' node scripts/run-replay.js --last=60 --reset`, {
    cwd: root, stdio: 'inherit',
  });
  execSync(`DATA_DIR='${expDataDir}' node scripts/backfill-outcomes.js`, {
    cwd: root, stdio: 'inherit',
  });
  // Target-based exit simulation (the realistic exit-policy baseline)
  execSync(`DATA_DIR='${expDataDir}' node scripts/simulate-target-exits.js`, {
    cwd: root, stdio: 'pipe', // suppress per-trade output, we'll pull aggregates from the DB
  });
} finally {
  // Restore live config no matter what
  writeFileSync(liveConfig, JSON.stringify(liveBackup, null, 2));
}

// 3. Pull headline numbers from the experiment DB
const Database = (await import('better-sqlite3')).default;
const db = new Database(join(expDataDir, 'gexester.db'), { readonly: true });
const totals = db.prepare(`SELECT COUNT(*) decisions, SUM(CASE WHEN decision='would_enter' THEN 1 ELSE 0 END) accepts FROM decision_log`).get();
const acc = db.prepare(`
  SELECT COUNT(*) n,
    ROUND(SUM(CASE WHEN dout.ret_15m > 0 THEN 1 ELSE 0 END)*100.0/COUNT(*), 1) win_pct_15m,
    ROUND(SUM(CASE WHEN dout.ret_30m > 0 THEN 1 ELSE 0 END)*100.0/COUNT(*), 1) win_pct_30m,
    ROUND(SUM(CASE WHEN dout.ret_60m > 0 THEN 1 ELSE 0 END)*100.0/COUNT(*), 1) win_pct_60m,
    ROUND(AVG(dout.ret_15m)*10000, 2) avg_bps_15m,
    ROUND(AVG(dout.ret_30m)*10000, 2) avg_bps_30m,
    ROUND(AVG(dout.ret_60m)*10000, 2) avg_bps_60m
  FROM decision_log dl JOIN decision_outcomes dout USING (decision_id)
  WHERE dl.decision='would_enter'
`).get();

// Target-based exit metrics (realistic exit policy)
const target = db.prepare(`
  SELECT
    COUNT(*) n,
    ROUND(SUM(CASE WHEN realized_ret > 0 THEN 1 ELSE 0 END)*100.0/COUNT(*), 1) target_win_pct,
    ROUND(AVG(realized_bps), 2) target_avg_bps,
    ROUND(SUM(realized_bps), 1) target_total_bps,
    SUM(CASE WHEN exit_reason = 'target' THEN 1 ELSE 0 END) tp_hits,
    SUM(CASE WHEN exit_reason = 'stop' THEN 1 ELSE 0 END) stops,
    SUM(CASE WHEN exit_reason = 'eod' THEN 1 ELSE 0 END) eods
  FROM simulated_outcomes
`).get();
db.close();

const summary = {
  experiment: args.name,
  override,
  decisions: totals.decisions,
  accepts: totals.accepts,
  ...acc,
  // Target-based exit metrics
  target_win_pct: target.target_win_pct,
  target_avg_bps: target.target_avg_bps,
  target_total_bps: target.target_total_bps,
  tp_hits: target.tp_hits,
  stops: target.stops,
  eods: target.eods,
};
writeFileSync(join(expDir, 'summary.json'), JSON.stringify(summary, null, 2));

console.log('\n─── SUMMARY ───');
console.log(`  experiment: ${args.name}`);
console.log(`  decisions: ${totals.decisions.toLocaleString()}`);
console.log(`  accepts:   ${totals.accepts}  (${(totals.accepts/totals.decisions*100).toFixed(3)}%)`);
console.log(`  fixed-30m direction-correctness: ${acc.win_pct_30m}% wins, ${acc.avg_bps_30m} bps avg`);
console.log(`  TARGET-BASED REAL EXITS:`);
console.log(`    win%=${target.target_win_pct}% avg=${target.target_avg_bps} bps  total=${target.target_total_bps} bps`);
console.log(`    targets=${target.tp_hits}  stops=${target.stops}  eods=${target.eods}`);
