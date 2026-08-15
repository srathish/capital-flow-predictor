// backtest.mjs — walk-forward evaluation. For each past date we replay the Skylit
// surface as-of then (via the timestamp param), run the deterministic scan, and
// resolve whether each ranked setup's magnet was actually reached — comparing the
// top-of-rank cohort against a low-rank control. This answers the core research
// question: does flow_through_score rank real edge, stepping forward from July?
import path from 'node:path';
import fs from 'node:fs';
import { ingest, effectiveScanDate } from './stage0-ingest.mjs';
import { scan } from './stage1-scan.mjs';
import { planTicker, planFromStructure } from './stage2-plan.mjs';
import { gateCard } from './stage3-gate.mjs';
import { resolveMagnetReach, resolveCard } from './lib/resolve.mjs';
import { FlowProvider } from './providers/flow-uw.mjs';
import { GexProvider } from './providers/gex-skylit.mjs';
import { RateLimiter, resolveFromRoot, readJson, writeJson, ensureDir, log } from './lib/util.mjs';
import { priorSessions, forwardSessions, isTradingDayET, tradingDaysBetween } from './lib/time.mjs';

// Trading sessions in [from,to], sampled every `every`.
export function sessionsInRange(from, to, every = 1) {
  const cur = isTradingDayET(from) ? from : forwardSessions(from, 1)[0];
  if (!cur || cur > to) return [];
  const out = [];
  let i = 0;
  for (const s of [cur, ...forwardSessions(cur, 400)]) { if (s > to) break; if (i % every === 0) out.push(s); i++; }
  return out;
}

async function ohlcCached(flow, ticker, dir) {
  const file = path.join(dir, `${ticker}.json`);
  const cached = readJson(file);
  if (cached && cached.ohlc) return cached.ohlc;
  const ohlc = await flow.getDailyOHLC(ticker, { limit: 60 });
  writeJson(file, { ticker, pulledAt: new Date().toISOString(), ohlc });
  return ohlc;
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const rate = (a, f) => (a.length ? a.filter(f).length / a.length : null);

export async function backtestScore({ config, dates, symbols = null, theme = null, horizonDays = null, stopPct = 0.05, topK = 10, controlK = 10, refresh = false }) {
  const weekly = config.weekly && config.weekly.enabled;
  const flow = new FlowProvider();
  const ohlcDir = ensureDir(resolveFromRoot(path.join('data/backtest/ohlc')));
  const rows = [];

  for (const date of dates) {
    const runDate = effectiveScanDate(date);
    try {
      await ingest({ config, date: runDate, symbols, theme, refresh, withFlow: false });
      const { out } = await scan({ config, date: runDate });
      const scored = out.tickers.filter((t) => t.score != null && t.magnet).sort((a, b) => b.score - a.score);
      if (scored.length < 2) { log(`[backtest] ${runDate}: <2 scored, skip`); continue; }
      const top = scored.slice(0, topK).map((r, i) => ({ ...r, group: 'top', rank: i + 1 }));
      const control = scored.slice(-controlK).map((r, i) => ({ ...r, group: 'control', rank: scored.length - controlK + i + 1 }));
      for (const s of [...top, ...control]) {
        const ohlc = await ohlcCached(flow, s.ticker, ohlcDir);
        // Horizon = trading days to the REAL Skylit weekly expiry the scan picked for
        // this ticker's king (where its gamma is biggest, floored by travel time).
        const kexp = weekly ? s.suggested_weekly_expiry : null;
        const kh = kexp ? tradingDaysBetween(runDate, kexp) : (horizonDays || 5);
        const res = resolveMagnetReach(s.magnet.strike, s.spot, ohlc, runDate, { horizonDays: kh, stopPct });
        rows.push({
          date: runDate, ticker: s.ticker, group: s.group, rank: s.rank, score: s.score,
          spot: s.spot, magnet: s.magnet.strike, magnet_dist_pct: s.magnet.dist_pct,
          persistence_days: s.persistence_days ?? 0,
          weeks: s.suggested_weeks ?? null, weekly_expiry: kexp, horizon: kh,
          reached: res.reached, days_to_reach: res.days_to_reach, stopped_out: res.stopped_out,
          mfe_pct: res.mfe_pct, mae_pct: res.mae_pct, bars: res.bars,
        });
      }
      log(`[backtest] ${runDate}: ${top.length} top + ${control.length} control resolved`);
    } catch (e) {
      if (e.message === 'AUTH') { log('[backtest] AUTH failure — Skylit session dead, stopping'); break; }
      log(`[backtest] ${runDate} failed: ${e.message}`);
    }
  }

  const byGroup = (g) => rows.filter((r) => r.group === g && r.bars > 0);
  const summarize = (g) => {
    const a = byGroup(g);
    return {
      n: a.length,
      reach_rate: rate(a, (r) => r.reached),
      stop_rate: rate(a, (r) => r.stopped_out),
      avg_mfe_pct: mean(a.map((r) => r.mfe_pct)),
      avg_mae_pct: mean(a.map((r) => r.mae_pct)),
      avg_days_to_reach: mean(a.filter((r) => r.reached).map((r) => r.days_to_reach)),
      reach_rate_persisted: rate(a.filter((r) => r.persistence_days >= 2), (r) => r.reached),
    };
  };
  const avgHorizon = rows.length ? rows.reduce((a, r) => a + (r.horizon || 0), 0) / rows.length : null;
  const summary = { mode: weekly ? 'king-weekly' : 'fixed', avg_horizon_days: avgHorizon, stopPct, topK, controlK, dates: dates.length, resolved: rows.length, top: summarize('top'), control: summarize('control') };
  const edge = (summary.top.reach_rate != null && summary.control.reach_rate != null) ? summary.top.reach_rate - summary.control.reach_rate : null;
  summary.reach_edge_top_minus_control = edge;

  const outFile = resolveFromRoot(path.join('data/backtest', `score_${dates[0]}_${dates[dates.length - 1]}.json`));
  writeJson(outFile, { generatedAt: new Date().toISOString(), summary, rows });
  return { summary, rows, outFile };
}

// Full-pipeline card backtest: for each date, run the LLM planner + flow gate on the
// named tickers, then resolve each real trade card (entry→target, close-basis stop,
// time-stop) against forward OHLC. Shows whether the SYSTEM (not just the magnet)
// caught the moves. Needs a real LLM (pass anthropicLLM).
export async function backtestCards({ config, dates, symbols, llm, gate = true }) {
  const flow = new FlowProvider();
  const ohlcDir = ensureDir(resolveFromRoot('data/backtest/ohlc'));
  const results = [];
  for (const date of dates) {
    const runDate = effectiveScanDate(date);
    try {
      await ingest({ config, date: runDate, symbols, withFlow: gate });
      const { ranked } = await scan({ config, date: runDate });
      const setups = ranked.filter((m) => symbols.includes(m.ticker));
      const flowBy = {};
      if (gate && flow.available) {
        for (const m of setups) { try { flowBy[m.ticker] = await flow.getFlow(m.ticker, { asOfDate: runDate, lookbackSessions: config.flow_gate.lookback_sessions }); } catch { /* unvalidated */ } }
      }
      for (const m of setups) {
        const card = await planTicker(m, { config, targetExpiry: null, runDate, llm });
        if (gate) { const v = gateCard(card, flowBy[m.ticker] || null, config); card.validation = v; card.final_confidence = v.confidence_after; card.sizing_budget_usd = v.sizing_budget_usd; card.vetoed = v.vetoed; }
        let resolution = null;
        if (card.status === 'ok' && card.plan.direction !== 'no_trade') {
          const ohlc = await ohlcCached(flow, m.ticker, ohlcDir);
          resolution = resolveCard({ ...card.plan, ticker: m.ticker }, ohlc, runDate);
        }
        results.push({
          date: runDate, ticker: m.ticker, score: m.flow_through_score, status: card.status,
          plan: card.plan || null, validation: card.validation || null,
          final_confidence: card.final_confidence ?? null, sizing_budget_usd: card.sizing_budget_usd ?? null,
          vetoed: !!card.vetoed, resolution, errors: card.errors || null,
        });
      }
      log(`[cards] ${runDate}: ${setups.length} setups planned`);
    } catch (e) {
      if (e.message === 'AUTH') { log('[cards] AUTH dead — stopping'); break; }
      log(`[cards] ${runDate} failed: ${e.message}`);
    }
  }
  const outFile = resolveFromRoot(path.join('data/backtest', `cards_${dates[0]}_${dates[dates.length - 1]}.json`));
  writeJson(outFile, { generatedAt: new Date().toISOString(), symbols, results });
  return { results, outFile };
}

// Structure-driven forward test on ONE ticker: every session, assemble the full
// structure and let the LLM decide (long/short/no_trade) — the "assemble, decipher
// daily" architecture as THE planner (no score gate). Resolves each directional call
// vs actual price. History/profile cached per date for replay.
export async function forwardTestStructure({ config, ticker, dates, llm }) {
  const rl = new RateLimiter(config.ingest.rate_limit);
  const gex = new GexProvider({ maxStrikes: config.ingest.max_strikes, maxExpirations: config.ingest.max_expirations, eodHHMM: config.ingest.skylit_eod_hhmm, limiter: rl });
  await gex.init();
  const flow = new FlowProvider();
  const ohlc = await ohlcCached(flow, ticker, ensureDir(resolveFromRoot('data/backtest/ohlc')));
  const rows = [];
  for (const date of dates) {
    const runDate = effectiveScanDate(date);
    let profile = null, history = null;
    try {
      const pf = resolveFromRoot(`data/raw/${runDate}/${ticker}.json`);
      const hf = resolveFromRoot(`data/raw/${runDate}/${ticker}.history.json`);
      const pc = readJson(pf); profile = pc?.profile || await gex.getProfile(ticker, { date: runDate });
      if (!pc?.profile && profile) writeJson(pf, { ticker, runDate, profile });
      const hc = readJson(hf); history = hc?.history || await gex.getHistory(ticker, { asOfDate: runDate, sessions: config.ingest.history_sessions });
      if (!hc?.history && history) writeJson(hf, { ticker, asOfDate: runDate, history });
    } catch (e) { if (e.message === 'AUTH') { log('[fwd] AUTH dead — stopping'); break; } rows.push({ date: runDate, error: String(e.message).slice(0, 60) }); continue; }
    if (!profile) { rows.push({ date: runDate, error: 'no profile' }); continue; }

    const r = await planFromStructure(profile, history, { config, runDate, llm });
    const s = r.structure || {};
    let resolution = null;
    if (r.status === 'ok' && r.plan.direction !== 'no_trade') resolution = resolveCard({ ...r.plan, ticker }, ohlc, runDate);
    rows.push({
      date: runDate, spot: Math.round(profile.spot * 100) / 100,
      king: s.gamma?.king ? `${s.gamma.king.strike}${s.gamma.king.sign === 'neg' ? '−' : '+'}` : null,
      migration: s.gamma?.king_migration?.direction || null,
      verdict: r.status === 'ok' ? r.plan.direction : 'discarded',
      plan: r.status === 'ok' ? r.plan : null, resolution, errors: r.errors || null,
    });
    log(`[fwd] ${runDate} ${ticker} → ${rows[rows.length - 1].verdict}`);
  }
  const outFile = resolveFromRoot(path.join('data/backtest', `forward_${ticker}_${dates[0]}_${dates[dates.length - 1]}.json`));
  writeJson(outFile, { generatedAt: new Date().toISOString(), ticker, rows });
  return { ticker, rows, outFile };
}

export function renderForwardReport(ticker, rows) {
  const oc = { target: '✅ hit', invalidation: '❌ stop', time_stop: '⏱ time', expiry: '⌛ exp', never_triggered: '– notrig', open: '… open' };
  const L = [];
  L.push(`# Forward test (structure-driven, LLM decides daily) — ${ticker}\n`);
  L.push('| date | spot | king | migration | verdict | contract | trig→target | outcome | MFE |');
  L.push('|---|--:|---|---|---|---|---|---|--:|');
  let nl = 0, ns = 0, nt = 0, win = 0, res = 0;
  for (const r of rows) {
    if (r.error) { L.push(`| ${r.date} | | | | err: ${r.error} | | | | |`); continue; }
    const p = r.plan, rr = r.resolution;
    if (r.verdict === 'no_trade') { nt++; L.push(`| ${r.date} | ${r.spot} | ${r.king || '—'} | ${r.migration || '—'} | ⏸ no-trade | | | | |`); continue; }
    if (r.verdict === 'discarded') { L.push(`| ${r.date} | ${r.spot} | ${r.king || '—'} | ${r.migration || '—'} | 🗑 disc | | | | |`); continue; }
    if (r.verdict === 'long') nl++; else ns++;
    if (rr && ['target', 'invalidation', 'time_stop', 'expiry'].includes(rr.status)) { res++; if (rr.status === 'target') win++; }
    const emo = r.verdict === 'long' ? '🟢 LONG' : '🔴 SHORT';
    L.push(`| ${r.date} | ${r.spot} | ${r.king || '—'} | ${r.migration || '—'} | ${emo} | ${p.contract.expiry.slice(5)} $${p.contract.strike}${p.contract.type[0].toUpperCase()} | ${p.entry_trigger}→${p.target} | ${rr ? (oc[rr.status] || rr.status) : '—'} | ${rr && rr.mfe_pct != null ? (rr.mfe_pct * 100).toFixed(1) + '%' : '—'} |`);
  }
  L.push(`\n**${rows.length} sessions · ${nl} long · ${ns} short · ${nt} no-trade · ${res} resolved, ${win} hit target (${res ? (100 * win / res).toFixed(0) : 0}%)**`);
  return L.join('\n') + '\n';
}

const ICON = { target: '✅ TARGET', invalidation: '❌ stopped', time_stop: '⏱ time-stop', expiry: '⌛ expiry', never_triggered: '– no trigger', open: '… open', 'n/a': '·' };

export function renderCardsReport(results, symbols) {
  const pct = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');
  const L = [];
  L.push(`# Full-system card backtest — ${symbols.join(', ')}`);
  L.push(`_did the system's actual trade plans catch the moves?_\n`);
  let totCards = 0, totWin = 0, totTraded = 0;
  for (const t of symbols) {
    const rows = results.filter((r) => r.ticker === t).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!rows.length) continue;
    L.push(`\n## ${t}`);
    L.push(`| scan date | call | target expiry / strike | entry→target | stop | flow | outcome | MFE | days |`);
    L.push(`|---|---|---|---|--:|---|---|--:|--:|`);
    for (const r of rows) {
      if (r.status !== 'ok' || !r.plan) { L.push(`| ${r.date} | — | (discarded: ${(r.errors || []).join('; ').slice(0, 40)}) | | | | 🗑 | | |`); continue; }
      const p = r.plan;
      if (p.direction === 'no_trade') { L.push(`| ${r.date} | no-trade | — | | | | ⏸ | | |`); continue; }
      totCards++;
      const res = r.resolution || {};
      const oc = ICON[res.status] || res.status || '…';
      const won = res.status === 'target';
      if (res.triggered || res.status === 'never_triggered') totTraded++;
      if (won) totWin++;
      const veto = r.vetoed ? ' 🚫veto' : '';
      L.push(`| ${r.date} | ${p.direction} | ${p.contract.expiry} $${p.contract.strike} | ${fmt(p.entry_trigger)}→${fmt(p.target)} | ${fmt(p.invalidation)} | ${r.validation?.state || '—'}${veto} | ${oc} | ${pct(res.mfe_pct)} | ${res.days_to_resolution ?? '—'} |`);
    }
  }
  L.push(`\n---\n**${totCards} directional cards · ${totWin} hit target (${totCards ? (100 * totWin / totCards).toFixed(0) : 0}%) · avg MFE ${pct(avgBy(results, (r) => r.resolution?.mfe_pct))}**`);
  return L.join('\n') + '\n';
}
function fmt(x) { return x == null ? '—' : (+x).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function avgBy(arr, f) { const v = arr.map(f).filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }

// Daily signal timeline — the two-tier architecture. The deterministic JS scan runs
// EVERY session and tracks each ticker's bullish setup (king node score + whether it
// is BUILDING via persistence). On the days the king is strong enough (get_in: score
// >= threshold & persistence >= minP), it makes the LLM call to decide buy/no-trade,
// gates it on flow, and resolves the outcome vs actual price. So we see the whole
// chain per ticker: node builds → LLM says buy → did it hit — and how many days
// before the move it fired.
export async function backtestSignal({ config, dates, symbols, threshold, minPersistence, llm = null, gate = true }) {
  const flow = new FlowProvider();
  const ohlcDir = ensureDir(resolveFromRoot('data/backtest/ohlc'));
  const rows = [];
  for (const date of dates) {
    const runDate = effectiveScanDate(date);
    try {
      await ingest({ config, date: runDate, symbols, withFlow: gate && !!llm });
      const { ranked, out } = await scan({ config, date: runDate });
      for (const t of symbols) {
        const r = out.tickers.find((x) => x.ticker === t);
        const score = r && r.score != null ? r.score : null;
        const persist = r?.persistence_days ?? 0;
        const km = r?.king_migration;
        // Get-in fires two ways: a stable, primed wall (score + persistence) OR a
        // bullishly MIGRATING king (climbs strikes → low persistence but very bullish).
        const bullKing = km && km.direction === 'up_bullish' && (km.pct_change ?? 0) >= (config.signal?.king_migration_trigger ?? 0.05);
        const primed = score != null && score >= threshold && persist >= minPersistence;
        const gi = score != null && (primed || bullKing);
        const row = {
          date: runDate, ticker: t, spot: r?.spot ?? null, score,
          magnet: r?.magnet?.strike ?? null, magnet_norm: r?.magnet?.magnet_norm ?? null, dist_pct: r?.magnet?.dist_pct ?? null,
          king_strike: r?.king?.strike ?? null, king_sign: r?.king?.sign ?? null, king_pos: r?.king?.position ?? null,
          king_mig_dir: km?.direction ?? null, king_mig_pct: km?.pct_change ?? null,
          persistence_days: persist, weekly_expiry: r?.suggested_weekly_expiry ?? null,
          no_setup: r?.dropped ?? (score == null ? 'no-magnet' : null),
          get_in: gi, get_in_reason: gi ? (primed ? 'score+persist' : 'king↑') : null,
          llm_verdict: null, card: null, validation: null, resolution: null, vetoed: false,
        };
        // The LLM is called ONLY on the strong/building candidates — the get-in days.
        if (gi && llm) {
          const m = ranked.find((x) => x.ticker === t);
          if (m) {
            const cardR = await planTicker(m, { config, targetExpiry: null, runDate, llm });
            if (gate && cardR.status === 'ok' && cardR.plan.direction !== 'no_trade') {
              let fl = null; try { fl = await flow.getFlow(t, { asOfDate: runDate, lookbackSessions: config.flow_gate.lookback_sessions }); } catch { /* unvalidated */ }
              const v = gateCard(cardR, fl, config); cardR.validation = v; cardR.final_confidence = v.confidence_after; cardR.sizing_budget_usd = v.sizing_budget_usd; cardR.vetoed = v.vetoed;
            }
            row.llm_verdict = cardR.status === 'ok' ? cardR.plan.direction : 'discarded';
            row.card = cardR.plan || null; row.validation = cardR.validation || null; row.vetoed = !!cardR.vetoed;
            row.final_confidence = cardR.final_confidence ?? null; row.sizing_budget_usd = cardR.sizing_budget_usd ?? null;
            if (cardR.status === 'ok' && cardR.plan.direction !== 'no_trade' && !cardR.vetoed) {
              const ohlc = await ohlcCached(flow, t, ohlcDir);
              row.resolution = resolveCard({ ...cardR.plan, ticker: t }, ohlc, runDate);
            }
          }
        }
        rows.push(row);
      }
      log(`[signal] ${runDate} done${llm ? ' (LLM on get-in days)' : ''}`);
    } catch (e) { if (e.message === 'AUTH') { log('[signal] AUTH dead — stopping'); break; } log(`[signal] ${runDate} failed: ${e.message}`); }
  }
  const priceByTicker = {};
  for (const t of symbols) { try { priceByTicker[t] = await ohlcCached(flow, t, ohlcDir); } catch { priceByTicker[t] = []; } }
  const outFile = resolveFromRoot(path.join('data/backtest', `signal_${dates[0]}_${dates[dates.length - 1]}.json`));
  writeJson(outFile, { generatedAt: new Date().toISOString(), threshold, minPersistence, used_llm: !!llm, rows });
  return { rows, priceByTicker, outFile };
}

function spark(vals) {
  const cs = '▁▂▃▄▅▆▇█';
  const v = vals.filter((x) => x != null);
  if (!v.length) return '';
  const mn = Math.min(...v), mx = Math.max(...v), rng = (mx - mn) || 1;
  return vals.map((x) => (x == null ? ' ' : cs[Math.round((x - mn) / rng * 7)])).join('');
}

const OC = { target: '✅ TARGET', invalidation: '❌ stopped', time_stop: '⏱ time-stop', expiry: '⌛ expiry', never_triggered: '– no-trigger', open: '… open' };

export function renderSignalReport(rows, priceByTicker, symbols, threshold, minPersistence) {
  const L = [];
  L.push(`# Daily signal timeline — node builds → LLM buys → did it hit?`);
  L.push(`_JS scores every session; the LLM is called only on get-in days (score ≥ ${threshold} AND persistence ≥ ${minPersistence}d). oldest → newest_\n`);
  L.push('_legend:  king$ (dominant-node drift) · score ▁▂▃▅▇ · build ▲ score-primed / K king-migration get-in · buy 🟢 LLM long / ⏸ no-trade / 🚫 flow-veto_\n');
  for (const t of symbols) {
    const tr = rows.filter((r) => r.ticker === t).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!tr.length) continue;
    const first = tr[0].date, last = tr[tr.length - 1].date;
    const ohlc = (priceByTicker[t] || []).filter((o) => o.date >= first && o.date <= last);
    const startSpot = tr.find((r) => r.spot != null)?.spot ?? ohlc[0]?.close;
    let peak = { high: -Infinity, date: null };
    for (const o of ohlc) if (o.high > peak.high) peak = { high: o.high, date: o.date };
    const movePct = startSpot && peak.high > -Infinity ? (peak.high - startSpot) / startSpot * 100 : null;
    L.push(`\n## ${t} — $${startSpot?.toFixed(2)} → peak $${peak.high > -Infinity ? peak.high.toFixed(2) : '—'} (${peak.date || '—'})  ${movePct == null ? '' : (movePct >= 0 ? '+' : '') + movePct.toFixed(1) + '%'}`);
    L.push('```');
    L.push('king$ ' + spark(tr.map((r) => r.king_strike)));
    L.push('score ' + spark(tr.map((r) => r.score)));
    L.push('build ' + tr.map((r) => (r.get_in ? (r.get_in_reason === 'king↑' ? 'K' : '▲') : (r.score == null ? '·' : ' '))).join(''));
    L.push('buy   ' + tr.map((r) => { if (!r.get_in || r.llm_verdict == null) return ' '; if (r.vetoed) return '🚫'; if (r.llm_verdict === 'long') return '🟢'; if (r.llm_verdict === 'no_trade') return '⏸'; return '·'; }).join(''));
    L.push('```');
    // King-node migration: where the dominant gamma wall is drifting (↑ bullish / ↓ bearish).
    const ks = tr.map((r) => r.king_strike).filter((x) => x != null);
    if (ks.length >= 4) {
      const h = Math.floor(ks.length / 2);
      const early = ks.slice(0, h).reduce((a, b) => a + b, 0) / h;
      const late = ks.slice(h).reduce((a, b) => a + b, 0) / (ks.length - h);
      const chg = (late - early) / early;
      const dir = chg > 0.01 ? `↑ **bullish migration**` : chg < -0.01 ? `↓ **bearish migration**` : `~ flat`;
      const lastKing = tr.filter((r) => r.king_strike != null).slice(-1)[0];
      L.push(`King node: ${ks[0]} → ${ks[ks.length - 1]}  ${dir} (${(chg * 100).toFixed(1)}%)${lastKing ? ` · now ${lastKing.king_sign}-gamma ${lastKing.king_pos} spot` : ''}`);
    }
    const buys = tr.filter((r) => r.card && r.card.direction === 'long' && !r.vetoed);
    if (buys.length) {
      const fb = buys[0], res = fb.resolution || {};
      const before = peak.date && fb.date <= peak.date;
      const lead = (before && peak.date) ? tradingDaysBetween(fb.date, peak.date) : null;
      L.push(`**First BUY ${fb.date}** → LONG ${fb.card.contract.expiry} $${fb.card.contract.strike}C · entry ${fmt(fb.card.entry_trigger)}→target ${fmt(fb.card.target)} · stop<${fmt(fb.card.invalidation)} · conf ${fb.final_confidence}/5${fb.validation?.state ? ` (flow ${fb.validation.state})` : ''}`);
      L.push(`  outcome: **${OC[res.status] || res.status || '…'}**${res.mfe_pct != null ? ` · MFE ${(res.mfe_pct * 100).toFixed(1)}%` : ''}${res.days_to_resolution ? ` in ${res.days_to_resolution}d` : ''} · ${before ? `fired **${lead}d before the peak** ✅` : 'fired after the peak ⚠️'}`);
      const wins = buys.filter((b) => b.resolution?.status === 'target').length;
      L.push(`  ${buys.length} BUY day(s) · ${wins} hit target`);
    } else {
      const gid = tr.filter((r) => r.get_in);
      L.push(gid.length ? `LLM saw ${gid.length} get-in day(s) but issued no BUY (all no-trade / veto)` : `no get-in day fired (peak score ${Math.max(...tr.map((r) => r.score || 0)).toFixed(3)})`);
    }
  }
  return L.join('\n') + '\n';
}

export function renderBacktestReport(summary) {
  const pct = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');
  const L = [];
  L.push(`# Walk-forward score backtest`);
  L.push(`${summary.mode} horizon (avg ${summary.avg_horizon_days == null ? '—' : summary.avg_horizon_days.toFixed(1)}d, king-distance driven) · stop ${(summary.stopPct * 100).toFixed(0)}% · ${summary.dates} dates · ${summary.resolved} setups resolved`);
  L.push('');
  L.push(`| cohort | n | magnet reach rate | stop rate | avg MFE | avg MAE | avg days→reach | reach rate (persisted≥2d) |`);
  L.push(`|---|--:|--:|--:|--:|--:|--:|--:|`);
  for (const [k, s] of [['TOP-rank', summary.top], ['control (low-rank)', summary.control]]) {
    L.push(`| ${k} | ${s.n} | ${pct(s.reach_rate)} | ${pct(s.stop_rate)} | ${pct(s.avg_mfe_pct)} | ${pct(s.avg_mae_pct)} | ${s.avg_days_to_reach == null ? '—' : s.avg_days_to_reach.toFixed(1)} | ${pct(s.reach_rate_persisted)} |`);
  }
  L.push('');
  L.push(`**Reach edge (top − control): ${pct(summary.reach_edge_top_minus_control)}** ${summary.reach_edge_top_minus_control > 0 ? '→ score ranks edge' : '→ no edge from score'}`);
  return L.join('\n') + '\n';
}
