#!/usr/bin/env node
/**
 * Single-command live runner — orchestrates the full session:
 *   1. Spawns ingestion (src/index.js) in background to write live snapshots to ./data/gexester.db
 *   2. Waits until 9:31 ET (or starts immediately if past)
 *   3. Runs the morning brief at 9:31 ET
 *   4. Runs the intraday monitor through close (16:00 ET) — waits real time between checkpoints
 *   5. Cleans up (kills ingestion) when monitor exits
 *
 * Usage:
 *   npm run live-day            (live channel)
 *   npm run live-day -- --test  (test channel)
 */

import { spawn } from 'child_process';
import { resolve } from 'path';

const args = process.argv.slice(2);
const testFlag = args.includes('--test');

// Today's date in ET
const todayEt = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const open931Et = new Date(`${todayEt}T09:31:00-04:00`).getTime();
const closeEt = new Date(`${todayEt}T16:00:00-04:00`).getTime();
const now = Date.now();

console.log(`━━━ gexester-vexster · LIVE DAY ${todayEt} ${testFlag ? '· TEST CHANNEL' : '· LIVE CHANNEL'} ━━━`);
console.log(`Open  9:31 ET = ${new Date(open931Et).toISOString()}`);
console.log(`Close 16:00 ET = ${new Date(closeEt).toISOString()}`);
console.log(`Now            = ${new Date(now).toISOString()}`);

if (now > closeEt) {
  console.error(`Already past close — nothing to do. Re-run tomorrow before 9:31 ET.`);
  process.exit(1);
}

// 1. Spawn ingestion (always running through close)
const ingestProc = spawn('node', ['src/index.js'], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, DATA_DIR: './data' },
});
ingestProc.on('exit', code => console.log(`[ingest] exited with code ${code}`));
console.log(`[ingest] started (pid ${ingestProc.pid})`);

// Cleanup helper
const cleanup = () => {
  if (!ingestProc.killed) {
    console.log('[ingest] stopping...');
    ingestProc.kill('SIGTERM');
  }
};
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

// Helper: spawn a command and await its exit
function runStep(name, cmd, cmdArgs) {
  return new Promise((res, rej) => {
    console.log(`\n━━━ ${name} ━━━`);
    const p = spawn(cmd, cmdArgs, {
      stdio: 'inherit',
      env: { ...process.env, DATA_DIR: './data' },
    });
    p.on('exit', code => {
      if (code === 0) res();
      else rej(new Error(`${name} exited with code ${code}`));
    });
    p.on('error', rej);
  });
}

async function main() {
  // 2. Wait until 9:31 ET if before
  if (now < open931Et) {
    const waitMs = open931Et - now;
    console.log(`\nWaiting ${Math.round(waitMs / 1000)}s until 9:31 ET to run brief...`);
    await new Promise(r => setTimeout(r, waitMs));
  } else {
    console.log(`\nAlready past 9:31 ET — running brief immediately.`);
  }

  // Give ingestion a couple of seconds to write the 9:31 frame
  await new Promise(r => setTimeout(r, 5000));

  // 3. Morning brief
  const briefArgs = ['scripts/morning-brief.js', `--date=${todayEt}`, '--at-open', '--discord'];
  if (testFlag) briefArgs.push('--test');
  await runStep('MORNING BRIEF', 'node', briefArgs);

  // 4. Intraday monitor (live mode — waits real time between checkpoints)
  const monitorArgs = ['scripts/intraday-monitor.js', `--date=${todayEt}`, '--discord', '--live'];
  if (testFlag) monitorArgs.push('--test');
  await runStep('INTRADAY MONITOR', 'node', monitorArgs);

  console.log('\n━━━ session complete ━━━');
}

main()
  .catch(err => {
    console.error(`\n[fatal] ${err.message}`);
  })
  .finally(() => {
    cleanup();
    process.exit(0);
  });
