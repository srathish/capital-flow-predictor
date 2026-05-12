#!/usr/bin/env node
/**
 * Daily Report — Talon-equivalent output combining:
 *   Phase 1: Breadth count, letter grades, multiple progressive targets,
 *            Actionable vs OTE Watch buckets, flow-ratio confluence
 *   Phase 2: Sector themes, risk watch (SPXW/SPY/QQQ/IWM), earnings filter
 *   Phase 3: Bull/bear case template
 *
 * Reads picks/scan_results from scanner DB (must run scan-day + refine-picks first).
 * Re-fetches GEX surface to extract precise targets/invalidation.
 * Optionally posts to Discord.
 *
 * Usage:
 *   node scanner/scripts/daily-report.js --date=2026-05-06 [--discord]
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';
import { initAuth, getFreshToken } from '../../src/heatseeker/auth.js';
import { postEmbed, COLORS } from '../../src/discord/webhook.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'scanner.db');
const SECTORS_PATH = join(__dirname, '..', 'data', 'sectors.json');

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}
const PICK_DATE = args.date;
if (!PICK_DATE) { console.error('Usage: --date=YYYY-MM-DD [--discord]'); process.exit(1); }

const SCANNER_WEBHOOK = process.env.DISCORD_SCANNER_WEBHOOK_URL || process.env.DISCORD_BRIEF_WEBHOOK_URL;
const POLYGON_KEY     = process.env.POLYGON_API_KEY || '';
const RISK_TICKERS    = ['SPXW', 'SPY', 'QQQ', 'IWM'];

// ─── Phase 1 helpers ─────────────────────────────────────────────────────────

// Letter grade buckets
function gradeFor(score) {
  if (score >= 50) return { letter: 'A+', tier: 5 };
  if (score >= 30) return { letter: 'A',  tier: 4 };
  if (score >= 15) return { letter: 'B+', tier: 3 };
  if (score >= 5)  return { letter: 'B',  tier: 2 };
  if (score >= -5) return { letter: 'C',  tier: 1 };
  if (score >= -15) return { letter: 'D', tier: 0 };
  return { letter: 'F', tier: -1 };
}

// Find multiple progressive targets (top barneys above spot, sorted by strike asc)
// + closest pika floor below spot for invalidation
function structureFromGex(j, horizonDays, predDate) {
  const spot = j.CurrentSpot;
  const expirations = j.Expirations || [];
  const strikes = j.Strikes || [];
  const gamma2d = j.GammaValues || [];
  if (!spot) return null;

  const baseMs = new Date(`${predDate}T00:00:00Z`).getTime();
  // Pick expiration closest to horizon
  let bestExpIdx = -1, bestDist = Infinity;
  for (let ei = 0; ei < expirations.length; ei++) {
    const dte = (new Date(`${expirations[ei]}T00:00:00Z`).getTime() - baseMs) / 86400000;
    const dist = Math.abs(dte - horizonDays);
    if (dist < bestDist) { bestDist = dist; bestExpIdx = ei; }
  }
  if (bestExpIdx === -1) return null;

  // Collect non-zero nodes at that expiration
  const nodes = [];
  for (let si = 0; si < strikes.length; si++) {
    const k = strikes[si], g = gamma2d[si]?.[bestExpIdx] ?? 0;
    if (g === 0 || !isFinite(g)) continue;
    nodes.push({ strike: k, gamma: g, abs: Math.abs(g), sign: g > 0 ? 'pika' : 'barney', side: k > spot ? 'above' : (k < spot ? 'below' : 'at') });
  }

  // Targets: top 4 |gamma| nodes ABOVE spot, sorted by strike ASC (closest first).
  // Each target must be at least 0.5% above spot (filter noise targets right at spot).
  const minTargetDist = spot * 0.005;
  const above = nodes
    .filter(n => n.side === 'above' && (n.strike - spot) >= minTargetDist)
    .sort((a,b) => b.abs - a.abs)
    .slice(0, 4);
  above.sort((a,b) => a.strike - b.strike);

  // Invalidation: CLOSEST pika floor below spot WITH meaningful distance.
  // Skip floors within 1.5% of spot (noise stops). Walk down to next pika.
  const minInvalDist = spot * 0.015;
  const pikaBelow = nodes
    .filter(n => n.side === 'below' && n.sign === 'pika' && (spot - n.strike) >= minInvalDist)
    .sort((a,b) => b.strike - a.strike);  // sorted by strike DESC = closest first
  const invalidation = pikaBelow[0] ?? null;

  // OTE entry zone: closest pika floor (same as invalidation level, but typed as "entry")
  const oteEntry = invalidation;

  return { spot, exp: expirations[bestExpIdx], targets: above, invalidation, oteEntry };
}

// Actionable vs OTE Watch: based on distance from spot to OTE entry
function bucketFor(spot, oteEntry) {
  if (!oteEntry) return 'NO_FLOOR';
  const distPct = (spot - oteEntry.strike) / spot * 100;
  if (distPct < 0) return 'BELOW_OTE';      // spot already under entry — broken
  if (distPct <= 2) return 'ACTIONABLE';     // within 2% of OTE — chase
  return 'OTE_WATCH';                        // wait for pullback
}

// Flow-ratio: call premium $ / put premium $ over last N days, with retry + status logging
async function flowRatio(symbol, dateStr, days, token, attempt = 0) {
  const endMs = new Date(`${dateStr}T20:00:00Z`).getTime();
  const startMs = endMs - days * 86400000;
  const start = Math.floor(startMs / 1000);
  const end = Math.floor(endMs / 1000);
  const url = `https://app.skylit.ai/fs/api/underlying/${symbol}/flow-bars?start=${start}&end=${end}&bucket=30min&single_leg_only=true&max_dte=30&abs_min_flow_score=0`;
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Origin: 'https://app.skylit.ai', Referer: `https://app.skylit.ai/atlas?symbol=${symbol}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      if (attempt < 1) { await new Promise(r => setTimeout(r, 600)); return flowRatio(symbol, dateStr, days, token, attempt + 1); }
      return { error: `HTTP ${r.status}`, status: 'http_error' };
    }
    const bars = await r.json();
    if (!Array.isArray(bars)) return { error: 'non-array response', status: 'bad_response' };
    if (bars.length === 0) return { error: 'no flow data', status: 'empty' };
    let totalCall = 0, totalPut = 0;
    for (const b of bars) { totalCall += b.call_premium || 0; totalPut += b.put_premium || 0; }
    if (totalCall === 0 && totalPut === 0) return { error: 'zero flow', status: 'zero' };
    if (totalPut === 0) return { ratio: 99, callPremium: totalCall, putPremium: 0, bars: bars.length, status: 'ok_calls_only' };
    return { ratio: totalCall / totalPut, callPremium: totalCall, putPremium: totalPut, bars: bars.length, status: 'ok' };
  } catch (e) {
    if (attempt < 1) { await new Promise(r => setTimeout(r, 600)); return flowRatio(symbol, dateStr, days, token, attempt + 1); }
    return { error: e.message, status: 'exception' };
  }
}

// ─── Phase 2 helpers ─────────────────────────────────────────────────────────

// Theme classification
const SECTORS = JSON.parse(readFileSync(SECTORS_PATH, 'utf-8'));
function themesFor(ticker) {
  const out = [];
  for (const [theme, tickers] of Object.entries(SECTORS.themes)) {
    if (tickers.includes(ticker)) out.push(theme);
  }
  return out.length ? out : ['Other'];
}

// Earnings filter via Polygon API
async function checkEarnings(ticker, predDate) {
  const start = new Date(`${predDate}T00:00:00Z`);
  const end   = new Date(`${predDate}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 21);
  const url = `https://api.polygon.io/vX/reference/earnings?ticker=${ticker}&date.gte=${start.toISOString().slice(0,10)}&date.lte=${end.toISOString().slice(0,10)}&apiKey=${POLYGON_KEY}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return { hasEarnings: null, status: `HTTP ${r.status}` };
    const j = await r.json();
    const next = (j.results || [])[0];
    if (!next) return { hasEarnings: false, status: 'ok_no_earnings' };
    const earningsDate = next.event_date || next.date;
    const days = Math.round((new Date(earningsDate) - start) / 86400000);
    return { hasEarnings: true, days, date: earningsDate, status: 'ok' };
  } catch (e) { return { hasEarnings: null, status: `error: ${e.message}` }; }
}

// Risk watch — fetch GEX for SPXW/SPY/QQQ/IWM, surface key levels
async function riskWatch(predDate, token) {
  const ts = new Date(`${predDate}T17:00:00Z`).toISOString();
  const out = [];
  for (const sym of RISK_TICKERS) {
    try {
      const url = `https://app.skylit.ai/api/data?symbol=${sym}&max_strikes=92&max_expirations=10&timestamp=${ts}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://app.skylit.ai' }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) continue;
      const j = await r.json();
      // 30D-ish view of SPY/QQQ structure
      const struct = structureFromGex(j, 30, predDate);
      if (!struct) continue;
      out.push({ ticker: sym, spot: struct.spot, exp: struct.exp,
        targets: struct.targets.map(t => t.strike),
        floor: struct.invalidation?.strike,
      });
    } catch (e) {}
  }
  return out;
}

// ─── Phase 3 — narrative templates ───────────────────────────────────────────

function bullCase(ctx) {
  const { breadth, topThemes, actionable, oteWatch, risk } = ctx;
  const themes = topThemes.slice(0, 5).map(([t, n]) => t).join(', ');
  const sqqq = risk.find(r => r.ticker === 'IWM') || risk[0];
  const lines = [
    `Breadth is ${breadth.bullPct}% bullish (${breadth.bullish}/${breadth.total} stocks). ${breadth.bullPct >= 60 ? 'Strong tape — rotation can extend.' : 'Mixed tape — selective entries only.'}`,
    `Strongest themes: ${themes || '(none)'}.`,
    `Best actionable now: ${actionable.slice(0, 3).map(p => p.ticker).join(', ') || '(none — wait for OTE)'}`,
    `High-quality watches near OTE: ${oteWatch.slice(0, 3).map(p => p.ticker).join(', ') || '(none)'}`,
  ];
  return lines;
}

function bearCase(ctx) {
  const { breadth, bottomPicks, risk } = ctx;
  const qqq = risk.find(r => r.ticker === 'QQQ');
  const spy = risk.find(r => r.ticker === 'SPY');
  const lines = [
    `${breadth.bearish} stocks bearish (${100 - breadth.bullPct}%) — ${breadth.bearish >= 30 ? 'meaningful share, do not chase highs' : 'minor share, breadth supports longs'}`,
    qqq ? `QQQ ${qqq.spot}: floor ${qqq.floor || '—'}, watch break below for risk-off` : '',
    spy ? `SPY ${spy.spot}: floor ${spy.floor || '—'}, key level for trend` : '',
    `Bearish setups (avoid longs): ${bottomPicks.slice(0, 3).map(p => p.ticker).join(', ') || '(none flagged)'}`,
  ].filter(Boolean);
  return lines;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function fetchGexFull(symbol, dateStr, token) {
  const ts = new Date(`${dateStr}T17:00:00Z`).toISOString();
  const url = `https://app.skylit.ai/api/data?symbol=${encodeURIComponent(symbol)}&max_strikes=92&max_expirations=25&timestamp=${ts}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://app.skylit.ai' }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function main() {
  console.log(`━━━ DAILY REPORT — ${PICK_DATE} ━━━\n`);
  if (!initAuth()) { console.error('Auth not configured'); process.exit(1); }
  const token = await getFreshToken();
  const db = new Database(DB_PATH);

  // 1) Load all scan results for breadth count, picks for top setups
  const allResults = db.prepare('SELECT * FROM scan_results WHERE pick_date = ?').all(PICK_DATE);
  if (allResults.length === 0) { console.error(`No scan_results for ${PICK_DATE}. Run scan-day first.`); process.exit(1); }
  const picks = db.prepare('SELECT * FROM picks WHERE pick_date = ? ORDER BY rank').all(PICK_DATE);
  if (picks.length === 0) { console.error(`No picks for ${PICK_DATE}. Run refine-picks first.`); process.exit(1); }

  // 2) BREADTH
  const eligible = allResults.filter(r => r.spot && r.spot >= 5);
  const bullish = eligible.filter(r => r.score > 5).length;
  const neutral = eligible.filter(r => r.score >= -5 && r.score <= 5).length;
  const bearish = eligible.filter(r => r.score < -5).length;
  const total = eligible.length;
  const bullPct = Math.round(bullish / total * 100);
  const breadth = { bullish, neutral, bearish, total, bullPct };
  console.log(`MARKET PULSE: ${bullish} bullish · ${neutral} neutral · ${bearish} bearish (n=${total})`);
  console.log(`              Bullish breadth: ${bullPct}%\n`);

  // 3) Top picks — enrich each with structure, flow, earnings
  console.log(`Enriching ${picks.length} picks with structure / flow / earnings...`);
  const enriched = [];
  for (const p of picks) {
    process.stdout.write(`  ${p.ticker} `);
    try {
      const j = await fetchGexFull(p.ticker, PICK_DATE, token);
      // 30D and 90D structure
      const s30 = structureFromGex(j, 30, PICK_DATE);
      const s90 = structureFromGex(j, 90, PICK_DATE);
      // Flow ratio over last 5 trading days
      const flow = await flowRatio(p.ticker, PICK_DATE, 5, token);
      // Earnings within 21d
      const earnings = await checkEarnings(p.ticker, PICK_DATE);
      const grade = gradeFor(p.score);
      const themes = themesFor(p.ticker);
      const bucket = bucketFor(s30?.spot, s30?.oteEntry);
      enriched.push({ ...p, s30, s90, flow, earnings, grade, themes, bucket });
      process.stdout.write('✓');
    } catch (e) {
      process.stdout.write('✗');
      enriched.push({ ...p, error: e.message });
    }
    console.log();
    await new Promise(r => setTimeout(r, 250));
  }

  // 4) Actionable vs OTE Watch buckets — preserve rank order
  const actionable = enriched.filter(e => e.bucket === 'ACTIONABLE').sort((a,b) => a.rank - b.rank);
  const oteWatch   = enriched.filter(e => e.bucket === 'OTE_WATCH').sort((a,b) => a.rank - b.rank);
  const noFloor    = enriched.filter(e => e.bucket === 'NO_FLOOR' || e.bucket === 'BELOW_OTE').sort((a,b) => a.rank - b.rank);

  // Status diagnostics — surface silent failures
  const flowStatus = {};
  for (const e of enriched) {
    const s = e.flow?.status || (e.flow?.error ? 'error' : 'no_data');
    flowStatus[s] = (flowStatus[s] || 0) + 1;
  }
  const earnStatus = {};
  for (const e of enriched) {
    const s = e.earnings?.status || 'unknown';
    earnStatus[s] = (earnStatus[s] || 0) + 1;
  }
  console.log(`\nFlow API status: ${Object.entries(flowStatus).map(([k,v]) => `${k}=${v}`).join(', ')}`);
  console.log(`Earnings API status: ${Object.entries(earnStatus).map(([k,v]) => `${k}=${v}`).join(', ')}`);

  // 5) Sector theme aggregation
  const themeCount = {};
  for (const e of enriched) for (const t of (e.themes || [])) themeCount[t] = (themeCount[t] || 0) + 1;
  const topThemes = Object.entries(themeCount).sort((a,b) => b[1]-a[1]);

  // 6) Bottom picks (bearish setups)
  const bottomPicks = allResults.filter(r => r.spot >= 5).sort((a,b) => a.score - b.score).slice(0, 5);

  // 7) Risk watch
  console.log(`\nFetching risk watch (SPXW/SPY/QQQ/IWM)...`);
  const risk = await riskWatch(PICK_DATE, token);
  console.log(`  Got ${risk.length}/4 risk tickers`);

  // 8) Narrative
  const ctx = { breadth, topThemes, actionable, oteWatch, risk, bottomPicks };
  const bull = bullCase(ctx);
  const bear = bearCase(ctx);

  // ─── Render console output ────────────────────────────────────────────────
  console.log(`\n━━━ ACTIONABLE NOW (${actionable.length}) ━━━`);
  if (actionable.length === 0) console.log('(none — all picks need pullback to OTE)');
  for (const e of actionable) renderPick(e);

  console.log(`\n━━━ OTE WATCHES (${oteWatch.length}) — wait for pullback ━━━`);
  for (const e of oteWatch) renderPick(e);

  if (noFloor.length) {
    console.log(`\n━━━ Other picks (${noFloor.length}) ━━━`);
    for (const e of noFloor) renderPick(e);
  }

  console.log(`\n━━━ TOP SECTOR THEMES ━━━`);
  for (const [theme, n] of topThemes.slice(0, 8)) console.log(`  ${theme.padEnd(25)} ${n} picks`);

  console.log(`\n━━━ RISK WATCH ━━━`);
  for (const r of risk) {
    const tgt = r.targets.length ? r.targets.join(', ') : '—';
    console.log(`  ${r.ticker.padEnd(5)} spot=$${r.spot?.toFixed(2)}  floor=${r.floor || '—'}  targets above=${tgt}`);
  }

  console.log(`\n━━━ BULL CASE ━━━`);
  for (const l of bull) console.log(`  • ${l}`);
  console.log(`\n━━━ BEAR CASE ━━━`);
  for (const l of bear) console.log(`  • ${l}`);

  // ─── Optional Discord post ─────────────────────────────────────────────────
  if (args.discord) {
    if (!SCANNER_WEBHOOK) { console.error('\nNo DISCORD_SCANNER_WEBHOOK_URL — skipping Discord post'); }
    else { await postToDiscord({ ctx, actionable, oteWatch, noFloor, topThemes, risk, bull, bear, breadth, flowStatus, earnStatus }); }
  }

  db.close();
}

function renderPick(e) {
  if (e.error) { console.log(`  ${e.ticker.padEnd(6)} ERROR: ${e.error}`); return; }
  const tgts = (e.s30?.targets || []).map(t => t.strike).join(', ') || '—';
  const inv  = e.s30?.invalidation?.strike;
  const flow = e.flow?.ratio != null
    ? `flow ${e.flow.ratio.toFixed(2)}x`
    : `flow — (${e.flow?.status || 'no_data'})`;
  const earn = e.earnings?.hasEarnings ? `⚠ earnings T-${e.earnings.days}d` : '';
  const themes = (e.themes || []).slice(0, 2).join('/');
  console.log(`  #${e.rank.toString().padStart(2)} ${e.ticker.padEnd(6)} ${e.grade.letter.padEnd(2)} ${e.score.toFixed(1).padStart(6)}  spot=$${e.spot?.toFixed(2).padStart(8)}  ${themes}`);
  console.log(`     30D ${e.s30?.exp || '—'}: targets ${tgts}, inval ${inv || '—'}  ·  ${flow}  ${earn}`);
}

async function postToDiscord({ ctx, actionable, oteWatch, noFloor, topThemes, risk, bull, bear, breadth }) {
  const headerColor = breadth.bullPct >= 60 ? COLORS.positive : (breadth.bullPct <= 40 ? COLORS.negative : COLORS.warning);

  // Embed 1: market pulse
  await postEmbed({
    source: 'scanner',
    url: SCANNER_WEBHOOK,
    title: `📊 Daily Scan — ${PICK_DATE}`,
    description: `**${breadth.bullPct}% bullish breadth** · ${breadth.bullish}/${breadth.total} bullish · ${breadth.bearish} bearish\n\n**Top themes**: ${topThemes.slice(0,5).map(([t,n]) => `${t} (${n})`).join(' · ')}`,
    fields: [
      { name: '🟢 Bull case', value: bull.map(l => `• ${l}`).join('\n').slice(0, 1024), inline: false },
      { name: '🔴 Bear case', value: bear.map(l => `• ${l}`).join('\n').slice(0, 1024), inline: false },
    ],
    color: headerColor,
    footer: 'gex-vex scanner · daily report',
  });
  await new Promise(r => setTimeout(r, 1100));

  // Embed 2: actionable picks
  if (actionable.length) {
    const fields = actionable.slice(0, 8).map(e => ({
      name: `#${e.rank} ${e.ticker} · ${e.grade.letter} · spot $${e.spot?.toFixed(2)}`,
      value: pickFieldText(e),
      inline: false,
    }));
    await postEmbed({
      source: 'scanner',
      url: SCANNER_WEBHOOK,
      title: `🎯 ACTIONABLE NOW (${actionable.length})`,
      description: 'Spot near OTE — chase-able entries',
      fields,
      color: COLORS.positive,
      footer: 'gex-vex scanner',
    });
    await new Promise(r => setTimeout(r, 1100));
  }

  // Embed 3: OTE watches
  if (oteWatch.length) {
    const fields = oteWatch.slice(0, 8).map(e => ({
      name: `#${e.rank} ${e.ticker} · ${e.grade.letter} · spot $${e.spot?.toFixed(2)}`,
      value: pickFieldText(e),
      inline: false,
    }));
    await postEmbed({
      source: 'scanner',
      url: SCANNER_WEBHOOK,
      title: `📡 OTE WATCHES (${oteWatch.length})`,
      description: 'Strong setups — wait for pullback to OTE',
      fields,
      color: COLORS.warning,
      footer: 'gex-vex scanner',
    });
    await new Promise(r => setTimeout(r, 1100));
  }

  // Embed 4: setups without clean structure (NO_FLOOR / BELOW_OTE) — surface so they're not lost
  if (noFloor.length) {
    const fields = noFloor.slice(0, 8).map(e => ({
      name: `#${e.rank} ${e.ticker} · ${e.grade.letter} · spot $${e.spot?.toFixed(2)}`,
      value: pickFieldText(e),
      inline: false,
    }));
    await postEmbed({
      source: 'scanner',
      url: SCANNER_WEBHOOK,
      title: `🔍 SETUPS — NEEDS STRUCTURE CHECK (${noFloor.length})`,
      description: 'Strong score but no clean pika floor for invalidation — review GEX manually before trading',
      fields,
      color: COLORS.default,
      footer: 'gex-vex scanner',
    });
    await new Promise(r => setTimeout(r, 1100));
  }

  // Embed 5: risk watch
  if (risk.length) {
    const fields = risk.map(r => ({
      name: r.ticker,
      value: `spot **$${r.spot?.toFixed(2)}** · floor **${r.floor || '—'}** · targets ${r.targets.length ? r.targets.join(', ') : '—'}`,
      inline: true,
    }));
    await postEmbed({
      source: 'scanner',
      url: SCANNER_WEBHOOK,
      title: `⚠️ RISK WATCH`,
      description: 'Index-level GEX — break below floor = risk-off',
      fields,
      color: COLORS.neutral,
      footer: 'gex-vex scanner',
    });
  }
}

function pickFieldText(e) {
  const tgts = (e.s30?.targets || []).map(t => `${t.strike}`).join(', ') || '—';
  const inv = e.s30?.invalidation?.strike;
  const flow = e.flow?.ratio != null
    ? `Flow **${e.flow.ratio.toFixed(2)}x**`
    : `Flow — (${e.flow?.status || 'no_data'})`;
  const earn = e.earnings?.hasEarnings ? `⚠️ Earnings T-${e.earnings.days}d` : '';
  const themes = (e.themes || []).slice(0, 2).join(' · ');
  return [
    `Score **${e.score.toFixed(1)}** · ${themes}`,
    `30D exp ${e.s30?.exp || '—'} · Targets ${tgts} · Inval ${inv || '—'}`,
    `${flow} ${earn}`,
  ].join('\n').slice(0, 1024);
}

main().catch(e => { console.error(e); process.exit(1); });
