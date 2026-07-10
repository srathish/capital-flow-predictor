/**
 * grade-universe — score every ticker in Skylit's ~378-ticker universe
 * against Giul's 7-rule A+ map framework. Output goes to stdout as a
 * ranked table of the best bullish + bearish setups for the target expiry.
 *
 * Usage:
 *   node scripts/grade-universe.js                 # nearest Friday, both directions
 *   node scripts/grade-universe.js --expiry=2026-07-17
 *   node scripts/grade-universe.js --top=15
 *   node scripts/grade-universe.js --ticker=MSFT   # single-ticker deep card
 *   node scripts/grade-universe.js --tickers=MSFT,AAPL,NVDA  # short list
 *   node scripts/grade-universe.js --min-grade=A   # only show A / A+
 *
 * Required env (same as plays-tracker):
 *   CLERK_SESSION_ID / CLERK_CLIENT_COOKIE / CLERK_CLIENT_UAT   for Skylit auth
 *   UNUSUAL_WHALES_API_KEY (or UW_API_KEY)                       for weekly OHLC
 */

import './_env-bootstrap.js';   // multi-location .env loader — MUST be first import
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initAuth } from '../src/heatseeker/auth.js';
import { fetchSnapshot } from '../src/heatseeker/client.js';
import { gradeSnapshot } from '../src/grader/seven-rules.js';
import { getOptionQuote } from '../src/uw/quotes.js';
import { createLogger } from '../src/utils/logger.js';

const log = createLogger('GradeUniverse');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONCURRENCY = Number(process.env.GRADE_CONCURRENCY || 6);

// ---------- CLI ----------

function parseArgs() {
  const args = { expiry: null, top: 20, tickers: null, singleTicker: null, minGrade: 'C' };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--expiry=')) args.expiry = a.slice(9);
    else if (a.startsWith('--top=')) args.top = Number(a.slice(6));
    else if (a.startsWith('--ticker=')) args.singleTicker = a.slice(9).toUpperCase();
    else if (a.startsWith('--tickers=')) args.tickers = a.slice(10).split(',').map(t => t.trim().toUpperCase());
    else if (a.startsWith('--min-grade=')) args.minGrade = a.slice(12);
  }
  return args;
}

// ---------- Universe loader ----------

function loadUniverse(cliList) {
  if (cliList?.length) return cliList;
  const candidates = [
    path.join(__dirname, '..', 'scanner', 'data', 'symbols.json'),
    path.join(__dirname, '..', '..', 'gex', 'scanner', 'data', 'symbols.json'),
    '/tmp/skylit_universe.txt',
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      if (p.endsWith('.json')) {
        const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const syms = j.symbols || j;
        return Array.isArray(syms)
          ? syms.map(s => typeof s === 'string' ? s : s.name || s.symbol).filter(Boolean)
          : Object.keys(syms);
      } else {
        return fs.readFileSync(p, 'utf-8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      }
    } catch (_) {}
  }
  // Fallback: mega-cap subset so the command still works with no config
  return ['SPY', 'QQQ', 'SPXW', 'AAPL', 'MSFT', 'NVDA', 'META', 'GOOG', 'AMZN', 'TSLA'];
}

// ---------- Weekly range (rule 6) ----------

async function fetchWeeklyRange(ticker) {
  const key = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(
      `https://api.unusualwhales.com/api/stock/${ticker}/ohlc/1w?limit=1`,
      { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(6_000) }
    );
    if (!r.ok) return null;
    const j = await r.json();
    const row = Array.isArray(j?.data) ? j.data[0] : null;
    if (!row) return null;
    return { high: Number(row.high), low: Number(row.low) };
  } catch { return null; }
}

// ---------- Parallel scan ----------

async function pMap(items, mapper, concurrency = CONCURRENCY) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = new Array(concurrency).fill(0).map(async () => {
    while (idx < items.length) {
      const my = idx++;
      try { results[my] = await mapper(items[my], my); }
      catch (err) { results[my] = { error: err.message }; }
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------- Formatting ----------

const RANK = { 'A+': 4, 'A': 3, 'B': 2, 'C': 1 };
function meetsMin(grade, min) {
  return RANK[grade] >= (RANK[min] || 1);
}

function fmtMoney(v) { return v == null ? '—' : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`; }
function fmtPct(v) { return v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`; }

function printRankedTable(rows, direction, top) {
  if (rows.length === 0) {
    console.log(`  no ${direction} candidates`);
    return;
  }
  const header = ['grade', 'ticker', 'spot', 'KING', 'king_γ', 'playType', 'target', 'type', 'AP', 'blocker', 'expiry'];
  const widths = header.map(h => h.length);
  const cells = rows.slice(0, top).map(r => {
    const kingStr = r.king ? `$${r.king.strike}` : '—';
    const kingGamma = r.king ? (r.king.gamma > 0 ? '+' : '') + (r.king.gamma / 1e3).toFixed(0) + 'K' : '—';
    const playStr = r.playType || '—';
    const tgtStr = r.targetNode ? `$${r.targetNode.strike}` : '—';
    const typeStr = r.targetType ? r.targetType.replace(/_/g, ' ') : '—';
    const ap = r.airPocketCount != null ? `${r.airPocketCount}gk` : '—';
    const blocker = r.blocker ? `$${r.blocker.strike}(${(r.blocker.relSig*100).toFixed(0)}%)` : '—';
    return [r.grade, r.ticker, fmtMoney(r.spot), kingStr, kingGamma, playStr, tgtStr, typeStr, ap, blocker, r.expiryUsed || '—'];
  });
  for (const row of cells) {
    for (let i = 0; i < row.length; i++) widths[i] = Math.max(widths[i], String(row[i] || '').length);
  }
  const line = (arr) => '  ' + arr.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
  console.log(line(header));
  console.log('  ' + widths.map(w => '─'.repeat(w)).join('  '));
  for (const row of cells) console.log(line(row));
}

function printSingleTickerCard(res) {
  console.log('');
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log(`  ${res.ticker}  ·  grade ${res.grade}  ·  direction ${res.direction.toUpperCase()}`);
  console.log('  ═══════════════════════════════════════════════════════════');
  console.log(`  spot          ${fmtMoney(res.spot)}`);
  console.log(`  expiry used   ${res.expiryUsed}`);
  console.log(`  score         ${res.score} / 100`);
  if (res.king) {
    const dist = res.king.distancePct != null
      ? fmtPct((res.king.strike - res.spot) / res.spot)
      : fmtPct((res.king.strike - res.spot) / res.spot);
    const gStr = res.king.gamma > 0 ? '+' : '';
    console.log(`  KING          $${res.king.strike}  (${dist}, ${(res.king.relSig * 100).toFixed(1)}% of surface, gamma ${gStr}${(res.king.gamma / 1e3).toFixed(0)}K)`);
  }
  if (res.playType) {
    console.log(`  play type     ${res.playType.replace(/_/g, ' ')}`);
  }
  if (res.buyNode) {
    const label = res.direction === 'bull' ? 'buy-off node' : 'short-off node';
    console.log(`  ${label.padEnd(14)} $${res.buyNode.strike}  (${(res.buyNode.relSig * 100).toFixed(1)}% of surface)`);
  }
  if (res.targetNode) {
    console.log(`  target node   $${res.targetNode.strike}  (${fmtPct(res.targetNode.distancePct)} away, ${(res.targetNode.relSig * 100).toFixed(1)}% sig)`);
  }
  console.log(`  air pocket    ${res.airPocketCount} gatekeepers between spot and target`);
  if (res.blocker) {
    console.log(`  ⚠ MAJOR blocker at $${res.blocker.strike} (${(res.blocker.relSig*100).toFixed(0)}% of surface — bigger than air pocket)`);
  }
  console.log('');
  if (res.reasons?.length) console.log(`  ✓ ${res.reasons.join(' · ')}`);
  if (res.downgrades?.length) console.log(`  ⚠ ${res.downgrades.join(' · ')}`);
  if (res.alternate) {
    console.log('');
    const alt = res.alternate;
    console.log(`  Also-considered ${alt.direction} setup:  grade ${alt.grade}${alt.targetNode ? ` · target $${alt.targetNode.strike}` : ''}`);
  }
  if (res.otherExpiries?.length) {
    console.log('');
    console.log('  Other expiries considered:');
    for (const e of res.otherExpiries) {
      console.log(`    ${e.expiration}  ${e.direction} ${e.grade} (score ${e.score})`);
    }
  }
  console.log('');
}

// ---------- Main ----------

async function main() {
  const args = parseArgs();

  // Single-ticker inline: still needs auth + one snapshot.
  if (args.singleTicker) {
    const authOk = await initAuth();
    if (!authOk) { log.error('Skylit auth failed. Run cfp-jobs skylit-login.'); process.exit(1); }
    const [snap, weeklyRange] = await Promise.all([
      fetchSnapshot(args.singleTicker),
      fetchWeeklyRange(args.singleTicker),
    ]);
    if (!snap) { console.log(`  no snapshot for ${args.singleTicker}`); process.exit(1); }
    const result = gradeSnapshot(snap, { targetExpiry: args.expiry, weeklyRange });
    printSingleTickerCard(result);
    return;
  }

  const universe = loadUniverse(args.tickers);
  console.log(`\n  Grading ${universe.length} tickers` +
    (args.expiry ? ` · expiry ${args.expiry}` : ' · nearest weekly OpEx') +
    ` · concurrency ${CONCURRENCY}\n`);

  const authOk = await initAuth();
  if (!authOk) { log.error('Skylit auth failed. Run cfp-jobs skylit-login.'); process.exit(1); }

  const startMs = Date.now();
  let done = 0;
  const results = await pMap(universe, async (ticker) => {
    let snap = null;
    let weeklyRange = null;
    try {
      [snap, weeklyRange] = await Promise.all([
        fetchSnapshot(ticker),
        fetchWeeklyRange(ticker),
      ]);
    } catch (err) {
      done++;
      return { ticker, error: err.message };
    }
    done++;
    if (done % 25 === 0) log.info(`${done}/${universe.length}`);
    if (!snap) return { ticker, error: 'no_snapshot' };
    try {
      return gradeSnapshot(snap, { targetExpiry: args.expiry, weeklyRange });
    } catch (err) {
      return { ticker, error: err.message };
    }
  });

  const scanned = results.filter(r => !r.error && r.grade);
  const bullQ = scanned.filter(r => r.direction === 'bull' && meetsMin(r.grade, args.minGrade))
    .sort((a, b) => RANK[b.grade] - RANK[a.grade] || b.score - a.score);
  const bearQ = scanned.filter(r => r.direction === 'bear' && meetsMin(r.grade, args.minGrade))
    .sort((a, b) => RANK[b.grade] - RANK[a.grade] || b.score - a.score);

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n  Scanned ${scanned.length}/${universe.length} in ${elapsed}s\n`);

  console.log('  ─── BULLISH ────────────────────────────────────────────────');
  printRankedTable(bullQ, 'bullish', args.top);
  console.log('');
  console.log('  ─── BEARISH ────────────────────────────────────────────────');
  printRankedTable(bearQ, 'bearish', args.top);
  console.log('');

  // Distribution summary
  const dist = { 'A+': 0, 'A': 0, 'B': 0, 'C': 0 };
  for (const r of scanned) dist[r.grade] = (dist[r.grade] || 0) + 1;
  console.log(`  Grade distribution:  A+ ${dist['A+']}   A ${dist['A']}   B ${dist['B']}   C ${dist['C']}\n`);
}

main().catch(err => { log.error('fatal:', err); process.exit(1); });
