// backtest.mjs — walk-forward evaluation. For each past date we replay the Skylit
// surface as-of then (via the timestamp param), run the deterministic scan, and
// resolve whether each ranked setup's magnet was actually reached — comparing the
// top-of-rank cohort against a low-rank control. This answers the core research
// question: does flow_through_score rank real edge, stepping forward from July?
import path from 'node:path';
import fs from 'node:fs';
import { ingest, effectiveScanDate } from './stage0-ingest.mjs';
import { scan } from './stage1-scan.mjs';
import { resolveMagnetReach } from './lib/resolve.mjs';
import { FlowProvider } from './providers/flow-uw.mjs';
import { resolveFromRoot, readJson, writeJson, ensureDir, log } from './lib/util.mjs';
import { priorSessions, forwardSessions, isTradingDayET } from './lib/time.mjs';

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

export async function backtestScore({ config, dates, symbols = null, theme = null, horizonDays = 5, stopPct = 0.05, topK = 10, controlK = 10, refresh = false }) {
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
        const res = resolveMagnetReach(s.magnet.strike, s.spot, ohlc, runDate, { horizonDays, stopPct });
        rows.push({
          date: runDate, ticker: s.ticker, group: s.group, rank: s.rank, score: s.score,
          spot: s.spot, magnet: s.magnet.strike, magnet_dist_pct: s.magnet.dist_pct,
          persistence_days: s.persistence_days ?? 0,
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
  const summary = { horizonDays, stopPct, topK, controlK, dates: dates.length, resolved: rows.length, top: summarize('top'), control: summarize('control') };
  const edge = (summary.top.reach_rate != null && summary.control.reach_rate != null) ? summary.top.reach_rate - summary.control.reach_rate : null;
  summary.reach_edge_top_minus_control = edge;

  const outFile = resolveFromRoot(path.join('data/backtest', `score_${dates[0]}_${dates[dates.length - 1]}.json`));
  writeJson(outFile, { generatedAt: new Date().toISOString(), summary, rows });
  return { summary, rows, outFile };
}

export function renderBacktestReport(summary) {
  const pct = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');
  const L = [];
  L.push(`# Walk-forward score backtest`);
  L.push(`horizon ${summary.horizonDays}d · stop ${(summary.stopPct * 100).toFixed(0)}% · ${summary.dates} dates · ${summary.resolved} setups resolved`);
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
