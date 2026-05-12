#!/usr/bin/env node
/**
 * Refine picks — re-ranks the existing scan_results with multi-timeframe quality filters.
 *
 * Quality filters (must ALL pass):
 *   - spot >= $5                          (no penny stocks)
 *   - total surface |gamma| >= 5,000,000  (real options activity across the whole surface)
 *   - at least 2 buckets populated (so the signal isn't from a single timeframe)
 *   - at least one of {swing, leaps} populated (must have directional/institutional read,
 *     not just front-month hedge flow)
 *
 * Confidence factor:
 *   conf = 1 - exp(-total_gamma / 50_000_000)
 *   Roughly: 5M total → 10% conf, 25M → 40%, 100M → 86%, 250M+ → 99%.
 *
 * Usage:
 *   node scanner/scripts/refine-picks.js --date=2026-05-06 [--top=10]
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'scanner.db');

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}
if (!args.date) { console.error('Usage: --date=YYYY-MM-DD [--top=N]'); process.exit(1); }
const TOP_N = parseInt(args.top || '10', 10);

const MIN_SPOT             = 5;
const MIN_TOTAL_GAMMA      = 5_000_000;

function refine(row) {
  const c = JSON.parse(row.components_json || '{}');
  const reasons = [];
  if (!row.spot || row.spot < MIN_SPOT) reasons.push(`spot<$${MIN_SPOT}`);
  const totalGamma = c.total_gamma || 0;
  if (totalGamma < MIN_TOTAL_GAMMA) reasons.push(`surface γ<${MIN_TOTAL_GAMMA/1e6}M`);
  const buckets = [c.front, c.mid, c.swing, c.leaps].filter(Boolean);
  if (buckets.length < 2) reasons.push('only 1 bucket populated');
  if (!c.swing && !c.leaps) reasons.push('no swing/leaps coverage');
  if (reasons.length) return { eligible: false, reasons };

  // Confidence — ramps up to 1.0 as total surface gamma grows
  const confidence = 1 - Math.exp(-totalGamma / 50_000_000);
  const refinedScore = row.score * confidence;

  return {
    eligible: true,
    refinedScore: Math.round(refinedScore * 100) / 100,
    rawScore: row.score,
    confidence: Math.round(confidence * 100) / 100,
    components: c,
  };
}

const db = new Database(DB_PATH, { readonly: false });
const rows = db.prepare('SELECT * FROM scan_results WHERE pick_date = ?').all(args.date);
console.log(`Loaded ${rows.length} scan results for ${args.date}`);

const ranked = [];
const rejected = [];
for (const row of rows) {
  const r = refine(row);
  if (r.eligible) ranked.push({ ...row, ...r });
  else rejected.push({ ticker: row.ticker, reasons: r.reasons });
}
ranked.sort((a, b) => b.refinedScore - a.refinedScore);

console.log(`Eligible: ${ranked.length}  Rejected: ${rejected.length}`);
console.log(`\n━━━ TOP ${TOP_N} REFINED PICKS — ${args.date} ━━━`);
console.log(`(bucket scores: + = bullish, − = bearish, weighted by γ volume within bucket)\n`);

const fmtBucket = (b, label) => b
  ? `${label}=${b.score >= 0 ? '+' : ''}${b.score.toFixed(0).padStart(4)} (γ${(b.totalVol/1e6).toFixed(1)}M)`
  : `${label}=  —          `;

const top = ranked.slice(0, TOP_N);
top.forEach((r, i) => {
  const c = r.components;
  console.log(`#${(i+1).toString().padStart(2)}  ${r.ticker.padEnd(6)} score=${r.refinedScore.toFixed(2).padStart(7)}  raw=${r.rawScore.toFixed(1).padStart(6)} conf=${r.confidence.toFixed(2)}  spot=$${r.spot?.toFixed(2).padStart(8)}  surfγ=${(c.total_gamma/1e6).toFixed(0)}M`);
  console.log(`     ${fmtBucket(c.front, 'FRONT ')}  ${fmtBucket(c.mid, 'MID   ')}  ${fmtBucket(c.swing, 'SWING ')}  ${fmtBucket(c.leaps, 'LEAPS ')}`);
});

console.log(`\n━━━ Refined Bottom 5 (bearish setups) ━━━`);
ranked.slice(-5).reverse().forEach(r => {
  const c = r.components;
  console.log(`  ${r.ticker.padEnd(6)} score=${r.refinedScore.toFixed(2).padStart(7)}  spot=$${r.spot?.toFixed(2)}`);
  console.log(`     ${fmtBucket(c.front, 'FRONT ')}  ${fmtBucket(c.mid, 'MID   ')}  ${fmtBucket(c.swing, 'SWING ')}  ${fmtBucket(c.leaps, 'LEAPS ')}`);
});

console.log(`\n━━━ Rejection summary ━━━`);
const reasonCounts = {};
for (const r of rejected) for (const reason of r.reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
for (const [k, v] of Object.entries(reasonCounts).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${k.padEnd(30)} ${v}`);
}

// Persist
db.prepare('DELETE FROM picks WHERE pick_date = ?').run(args.date);
const insert = db.prepare(`
  INSERT INTO picks (pick_date, ticker, rank, score, score_30d, score_90d, spot, exp_30d, exp_90d, components_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
top.forEach((r, i) => {
  insert.run(args.date, r.ticker, i + 1, r.refinedScore, r.score_30d, r.score_90d, r.spot, r.exp_30d, r.exp_90d, JSON.stringify(r.components));
});
console.log(`\nPersisted top ${top.length} to picks table.`);

db.close();
