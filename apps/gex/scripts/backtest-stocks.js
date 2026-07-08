/**
 * backtest-stocks — walk-forward test of the Skylit grader on individual stocks
 * using Skylit's historical /api/data endpoint (retention ~90 days back).
 *
 * For each business day D in the window and each ticker in the basket:
 *   1. Fetch Skylit snapshot at 09:35 ET on D
 *   2. Grade the map
 *   3. If grade ≥ min-grade, record prediction { entry, stop, target }
 *   4. Walk forward D+1..D+HOLD_DAYS: fetch that day's 09:35 ET snapshot,
 *      check whether Skylit's CurrentSpot crossed target or stop.
 *   5. Aggregate hit rate by grade tier.
 *
 * All fetches use the same Skylit /api/data endpoint the web UI uses for
 * historical playback — same GEX + VEX numbers you see in the browser.
 *
 * Checkpoints trades to disk after every 25 completions so a network blip
 * doesn't burn the whole run.
 *
 * Usage:
 *   node scripts/backtest-stocks.js
 *   node scripts/backtest-stocks.js --tickers=AAPL,MSFT,NVDA
 *   node scripts/backtest-stocks.js --min-grade=A --hold-days=5
 *   node scripts/backtest-stocks.js --days-back=60 --concurrency=4
 */

import './_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initAuth } from '../src/heatseeker/auth.js';
import { fetchHistoricalSnapshot } from '../src/heatseeker/client.js';
import { gradeSnapshot } from '../src/grader/seven-rules.js';
import { createLogger } from '../src/utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const log = createLogger('BacktestStocks');

// ---------- Config / CLI ----------

// Load the full 378-ticker Skylit universe from scanner/data/symbols.json.
// Fallback = mega-cap sample if the file isn't present.
function loadUniverse() {
  const candidates = [
    path.join(__dirname, '..', 'scanner', 'data', 'symbols.json'),
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
      }
      return fs.readFileSync(p, 'utf-8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    } catch (_) {}
  }
  return ['AAPL','MSFT','NVDA','META','GOOG','AMZN','TSLA','AMD','AVGO','NFLX'];
}
const DEFAULT_TICKERS = loadUniverse();

function parseArgs() {
  const a = {
    tickers: null,
    minGrade: 'B',
    daysBack: 55,
    holdDays: 5,
    concurrency: 5,
    verbose: false,
  };
  for (const x of process.argv.slice(2)) {
    if (x.startsWith('--tickers=')) a.tickers = x.slice(10).split(',').map(t => t.trim().toUpperCase());
    else if (x.startsWith('--min-grade=')) a.minGrade = x.slice(12);
    else if (x.startsWith('--days-back=')) a.daysBack = Number(x.slice(12));
    else if (x.startsWith('--hold-days=')) a.holdDays = Number(x.slice(12));
    else if (x.startsWith('--concurrency=')) a.concurrency = Number(x.slice(14));
    else if (x === '--verbose') a.verbose = true;
  }
  return a;
}

const GRADE_RANK = { 'A+': 4, 'A': 3, 'B': 2, 'C': 1 };

// ---------- Business-day helpers ----------

function isWeekend(date) {
  const d = date.getUTCDay();
  return d === 0 || d === 6;
}

// N business days before `date`, skipping weekends. Naïve (no holiday calendar);
// missing days just show up as HTTP 400 from Skylit and are skipped.
function subtractBusinessDays(date, n) {
  const d = new Date(date);
  let remaining = n;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (!isWeekend(d)) remaining--;
  }
  return d;
}

function addBusinessDays(date, n) {
  const d = new Date(date);
  let remaining = n;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!isWeekend(d)) remaining--;
  }
  return d;
}

function ymd(date) { return date.toISOString().slice(0, 10); }

// Skylit is US Eastern; 09:35 ET at market open is 13:35 UTC (EDT) or 14:35 (EST).
// We're in July → EDT. Use 13:35Z for consistency.
function tsAt0935Et(dateYmd) { return `${dateYmd}T13:35:00Z`; }

// ---------- Concurrent pipeline ----------

async function pMap(items, mapper, concurrency) {
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

// ---------- Outcome via walk-forward Skylit snapshots ----------
//
// For each subsequent business day (up to HOLD_DAYS), fetch the 09:35 ET snap
// and use Skylit's own CurrentSpot as the price. Skylit's spot updates through
// the trading day, and using the same data source keeps the test end-to-end
// Skylit-canonical.
//
// A tighter test would sample intraday (10:30, 12:00, 14:00, 15:30) — but that
// quintuples the API cost. First pass: one snapshot per next day.

async function walkForwardOutcome({ ticker, direction, entryPrice, stopStrike, targetStrike, startDate, holdDays }) {
  const isBull = direction === 'bull';
  let mfe = 0, mae = 0;

  for (let day = 1; day <= holdDays; day++) {
    const d = addBusinessDays(startDate, day);
    const ts = tsAt0935Et(ymd(d));
    let snap = null;
    try { snap = await fetchHistoricalSnapshot(ticker, ts); }
    catch (err) {
      if (String(err.message).includes('AUTH_EXPIRED')) throw err;
      continue;
    }
    if (!snap || snap.spot == null) continue;
    const price = snap.spot;

    const moveBps = ((price - entryPrice) / entryPrice) * 10000 * (isBull ? 1 : -1);
    if (moveBps > mfe) mfe = moveBps;
    if (moveBps < mae) mae = moveBps;

    const targetHit = isBull ? price >= targetStrike : price <= targetStrike;
    if (targetHit) return { outcome: 'win', daysToOutcome: day, exitPrice: price, mfeBps: Math.round(mfe), maeBps: Math.round(mae) };
    const stopHit = isBull ? price <= stopStrike : price >= stopStrike;
    if (stopHit) return { outcome: 'loss', daysToOutcome: day, exitPrice: price, mfeBps: Math.round(mfe), maeBps: Math.round(mae) };
  }

  return { outcome: 'timeout', daysToOutcome: holdDays, exitPrice: null, mfeBps: Math.round(mfe), maeBps: Math.round(mae) };
}

// ---------- Main loop ----------

async function main() {
  const args = parseArgs();
  const tickers = args.tickers || DEFAULT_TICKERS;
  const today = new Date();
  const oldest = subtractBusinessDays(today, args.daysBack + args.holdDays + 1);

  const days = [];
  const cursor = new Date(oldest);
  for (let i = 0; i < args.daysBack; i++) {
    // Advance one business day at a time so we don't have to compute a full range up-front.
    let d;
    if (i === 0) d = new Date(cursor);
    else { cursor.setUTCDate(cursor.getUTCDate() + 1); while (isWeekend(cursor)) cursor.setUTCDate(cursor.getUTCDate() + 1); d = new Date(cursor); }
    days.push(d);
  }

  const outPath = path.join(process.cwd(), 'scripts/out/backtest-stocks-trades.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  console.log(`\n  Skylit stock backtest`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  tickers        ${tickers.length}`);
  console.log(`  window         ${ymd(days[0])} → ${ymd(days[days.length-1])} (${days.length} business days)`);
  console.log(`  hold-days      ${args.holdDays} (walk-forward)`);
  console.log(`  min-grade      ${args.minGrade}`);
  console.log(`  concurrency    ${args.concurrency}`);
  console.log(`  output         ${outPath}`);
  console.log(`  ─────────────────────────────────────────\n`);

  const authOk = await initAuth();
  if (!authOk) { log.error('Skylit auth failed. Run cfp-jobs skylit-login.'); process.exit(1); }

  // Build the full (day × ticker) work list.
  const jobs = [];
  for (const d of days) {
    for (const t of tickers) jobs.push({ date: d, ticker: t });
  }

  const trades = [];
  let done = 0;
  const startMs = Date.now();
  const checkpointEvery = 25;

  await pMap(jobs, async (job) => {
    done++;
    if (done % 20 === 0) {
      const elapsed = (Date.now() - startMs) / 1000;
      const rate = done / elapsed;
      const eta = Math.round((jobs.length - done) / rate);
      log.info(`${done}/${jobs.length}  trades=${trades.length}  eta=${eta}s`);
    }

    const dateStr = ymd(job.date);
    const ts = tsAt0935Et(dateStr);
    let snap;
    try { snap = await fetchHistoricalSnapshot(job.ticker, ts); }
    catch (err) {
      if (String(err.message).includes('AUTH_EXPIRED')) throw err;
      return;
    }
    if (!snap || snap.spot == null) return;

    // Grade against the nearest weekly (grader picks natural expiry).
    let graded;
    try { graded = gradeSnapshot(snap); }
    catch (err) { log.warn(`grade ${job.ticker} ${dateStr}: ${err.message}`); return; }

    if (!graded.grade || GRADE_RANK[graded.grade] < GRADE_RANK[args.minGrade]) return;
    if (graded.direction === 'none') return;
    if (!graded.plan?.stopStrike || !graded.plan?.targets?.[0]?.strike) return;

    const entryPrice = graded.plan.entryPrice;
    const stopStrike = graded.plan.stopStrike;
    const targetStrike = graded.plan.targets[0].strike;

    const outcome = await walkForwardOutcome({
      ticker: job.ticker,
      direction: graded.direction,
      entryPrice, stopStrike, targetStrike,
      startDate: job.date,
      holdDays: args.holdDays,
    });

    const trade = {
      date: dateStr,
      ticker: job.ticker,
      grade: graded.grade,
      direction: graded.direction,
      pattern: graded.patternName,
      spot: snap.spot,
      expiry: graded.expiryUsed,
      entry: entryPrice,
      stop: stopStrike,
      target: targetStrike,
      rr: graded.rr,
      ...outcome,
    };
    trades.push(trade);

    if (args.verbose) {
      console.log(`  ${dateStr} ${job.ticker.padEnd(5)} ${graded.grade.padEnd(2)} ${graded.direction.padEnd(4)} ` +
        `spot=$${snap.spot?.toFixed(2)} entry=$${entryPrice} tgt=$${targetStrike} stop=$${stopStrike} rr=${graded.rr?.toFixed(2)} ` +
        `→ ${outcome.outcome.padEnd(7)} in ${outcome.daysToOutcome}d`);
    }

    if (trades.length % checkpointEvery === 0) {
      fs.writeFileSync(outPath, JSON.stringify(trades, null, 2));
    }
  }, args.concurrency);

  fs.writeFileSync(outPath, JSON.stringify(trades, null, 2));

  // ---------- Aggregates ----------
  const byGrade = {};
  for (const t of trades) {
    const g = byGrade[t.grade] ||= { total: 0, win: 0, loss: 0, timeout: 0, sumMfe: 0, sumMae: 0, sumRr: 0 };
    g.total++;
    g[t.outcome] = (g[t.outcome] || 0) + 1;
    g.sumMfe += t.mfeBps || 0;
    g.sumMae += t.maeBps || 0;
    g.sumRr += t.rr || 0;
  }

  console.log(`\n  ${trades.length} trades across ${jobs.length} snapshot attempts\n`);
  console.log('  Outcomes by grade:');
  console.log('  grade   n     win    loss   timeout   winRate   decisionRate   avgMFE    avgMAE    avgRR');
  console.log('  ─────  ────  ─────  ─────  ────────  ────────  ─────────────  ────────  ────────  ────────');
  for (const grade of ['A+', 'A', 'B']) {
    const g = byGrade[grade];
    if (!g) continue;
    const decided = (g.win || 0) + (g.loss || 0);
    const wr = decided ? (((g.win || 0) / decided) * 100).toFixed(1) : '0.0';
    const dr = g.total ? ((decided / g.total) * 100).toFixed(1) : '0.0';
    const avgMfe = g.total ? (g.sumMfe / g.total).toFixed(0) : '0';
    const avgMae = g.total ? (g.sumMae / g.total).toFixed(0) : '0';
    const avgRr = g.total ? (g.sumRr / g.total).toFixed(2) : '0.00';
    console.log(`  ${grade.padEnd(5)}  ${String(g.total).padEnd(4)}  ${String(g.win || 0).padEnd(5)}  ${String(g.loss || 0).padEnd(5)}  ${String(g.timeout || 0).padEnd(8)}  ${wr.padEnd(6)}%   ${dr.padEnd(11)}%   ${avgMfe.padEnd(6)}bps ${avgMae.padEnd(6)}bps ${avgRr}`);
  }

  // Direction split
  console.log('\n  Outcomes by direction:');
  const byDir = {};
  for (const t of trades) {
    const d = byDir[t.direction] ||= { total: 0, win: 0, loss: 0 };
    d.total++;
    if (t.outcome === 'win') d.win++;
    else if (t.outcome === 'loss') d.loss++;
  }
  for (const dir of Object.keys(byDir)) {
    const d = byDir[dir];
    const decided = d.win + d.loss;
    const wr = decided ? ((d.win / decided) * 100).toFixed(1) : '0.0';
    console.log(`    ${dir.padEnd(5)}  n=${d.total}  win=${d.win} loss=${d.loss}  winRate=${wr}%`);
  }

  // Pattern split
  console.log('\n  Outcomes by pattern:');
  const byPat = {};
  for (const t of trades) {
    const key = t.pattern || 'no_pattern';
    const p = byPat[key] ||= { total: 0, win: 0, loss: 0 };
    p.total++;
    if (t.outcome === 'win') p.win++;
    else if (t.outcome === 'loss') p.loss++;
  }
  for (const pat of Object.keys(byPat)) {
    const p = byPat[pat];
    const decided = p.win + p.loss;
    const wr = decided ? ((p.win / decided) * 100).toFixed(1) : '0.0';
    console.log(`    ${pat.padEnd(20)}  n=${p.total}  win=${p.win} loss=${p.loss}  winRate=${wr}%`);
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n  Done in ${elapsed}s. Trades → ${outPath}\n`);
}

main().catch(err => { log.error('fatal:', err); process.exit(1); });
