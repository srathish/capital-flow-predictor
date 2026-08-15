// stage1-scan.mjs — Node scan & ranking (deterministic, NO LLM).
// Reads Stage 0 cache, applies the liquidity screen, scores every ticker with the
// flow_through_score, and ranks. Two-pass for feasibility: pre-score without
// persistence, shortlist, then pull Skylit history (via `timestamp`) only for the
// shortlist to add persistence_mult (a multiplier, so it only reorders the shortlist).
// Writes data/scans/{date}_scan.json with a row for EVERY ticker (incl. dropped+reason).
import path from 'node:path';
import fs from 'node:fs';
import { scoreTicker } from './lib/metrics.mjs';
import { GexProvider } from './providers/gex-skylit.mjs';
import { RateLimiter, resolveFromRoot, readJson, writeJson, ensureDir, log } from './lib/util.mjs';
import { effectiveScanDate } from './stage0-ingest.mjs';
import { isMonthlyOpex } from './lib/time.mjs';

// Liquidity screen. Returns {ok, status, reason, metrics}. When UW flow is absent we
// cannot evaluate liquidity, so we annotate 'unknown' and DO NOT drop (lets a
// GEX-only backtest run). When present, config.liquidity.enforce gates dropping.
export function liquidityCheck(record, config) {
  const L = config.liquidity;
  const liq = record.liquidity;
  if (!liq) return { ok: true, status: 'unknown', reason: null, metrics: null };
  const fails = [];
  if (L.min_options_volume != null && (liq.options_volume ?? 0) < L.min_options_volume) fails.push(`vol ${liq.options_volume}<${L.min_options_volume}`);
  if (L.min_oi_atm != null && (liq.total_oi ?? 0) < L.min_oi_atm) fails.push(`oi ${liq.total_oi}<${L.min_oi_atm}`);
  // NOTE: representative bid/ask spread requires an ATM chain quote (future refinement).
  const ok = fails.length === 0;
  return { ok: ok || !L.enforce, status: ok ? 'pass' : (L.enforce ? 'fail' : 'soft-fail'), reason: ok ? null : `liquidity: ${fails.join(', ')}`, metrics: liq };
}

async function historyCached(gex, runDate, ticker, config, rawDir, refresh) {
  const file = path.join(rawDir, `${ticker}.history.json`);
  if (!refresh && fs.existsSync(file)) { const c = readJson(file); if (c && c.history) return c.history; }
  if (!gex) return null;
  const history = await gex.getHistory(ticker, { asOfDate: runDate, sessions: config.ingest.history_sessions });
  writeJson(file, { ticker, asOfDate: runDate, history });
  return history;
}

export async function scan({ config, date, expiry = null, gexProvider = null, refresh = false, quietHistory = true }) {
  const runDate = effectiveScanDate(date);
  const rawDir = resolveFromRoot(path.join(config.ingest.cache_dir, runDate));
  const manifest = readJson(path.join(rawDir, '_manifest.json'));
  if (!manifest) throw new Error(`no Stage 0 manifest for ${runDate} — run ingest first`);

  // Load every ingested record.
  const records = [];
  for (const t of manifest.ok) { const r = readJson(path.join(rawDir, `${t}.json`)); if (r && r.profile) records.push(r); }

  const rows = [];   // one row per ticker (auditable), incl. dropped
  const scored = []; // tickers that produced a magnet + score

  for (const rec of records) {
    const liq = liquidityCheck(rec, config);
    if (!liq.ok) { rows.push({ ticker: rec.ticker, spot: rec.profile.spot, dropped: liq.reason, liquidity: liq }); continue; }
    const m = scoreTicker(rec.profile, config, { history: null, targetExpiry: expiry, runDate });
    m.liquidity = liq;
    if (m.skip) { rows.push({ ticker: m.ticker, spot: m.spot, dropped: m.skip, magnet: m.magnet, liquidity: liq }); continue; }
    m.pre_score = m.flow_through_score;
    scored.push({ rec, m });
  }

  // Shortlist by pre-score, then add persistence via history pull (cached for replay).
  const shortlistN = config.scan.history_shortlist || 40;
  scored.sort((a, b) => b.m.pre_score - a.m.pre_score);
  const shortlist = scored.slice(0, shortlistN);
  const rl = new RateLimiter(config.ingest.rate_limit);
  const gex = gexProvider || new GexProvider({
    maxStrikes: config.ingest.max_strikes, maxExpirations: config.ingest.max_expirations,
    timeoutMs: config.ingest.request_timeout_ms, eodHHMM: config.ingest.skylit_eod_hhmm, limiter: rl,
  });
  log(`[stage1] ${runDate}: ${scored.length} setups · pulling persistence history for top ${shortlist.length}…`);
  let authDead = false;
  for (const item of shortlist) {
    if (authDead) break;
    let history = null;
    try { history = await historyCached(gex, runDate, item.rec.ticker, config, rawDir, refresh); }
    catch (e) { if (e.message === 'AUTH') { authDead = true; log('[stage1] AUTH failure during history pull — persistence limited to cached'); } }
    if (history) {
      const full = scoreTicker(item.rec.profile, config, { history, targetExpiry: expiry, runDate });
      full.liquidity = item.m.liquidity;
      full.pre_score = item.m.pre_score;
      item.m = full;
    }
  }

  // Final ranking across ALL scored tickers (shortlist has persistence, tail uses pre-score).
  scored.sort((a, b) => b.m.flow_through_score - a.m.flow_through_score);
  const ranked = scored.map((s) => s.m);
  const topK = ranked.slice(0, config.scan.top_k);

  // Compact per-ticker rows for the full audit trail.
  for (const s of scored) {
    const m = s.m;
    rows.push({
      ticker: m.ticker, spot: m.spot,
      score: m.flow_through_score, pre_score: m.pre_score,
      magnet: m.magnet ? { strike: m.magnet.strike, gex: m.magnet.gex, dist_pct: m.magnet.dist_pct, magnet_norm: m.magnet.magnet_norm, sign: m.magnet.sign, respecified_from: m.magnet.respecified_from } : null,
      king: m.nodes && m.nodes[0] ? { strike: m.nodes[0].strike, gex: m.nodes[0].gex, sign: m.nodes[0].gamma_sign, position: m.nodes[0].position } : null,
      path: m.path, proximity_weight: m.proximity_weight,
      persistence_days: m.persistence?.days ?? 0, persistence_mult: m.persistence?.mult ?? 1,
      suggested_weeks: m.suggested_weeks, suggested_weekly_expiry: m.suggested_weekly_expiry,
      effective_target_expiry: m.effective_target_expiry,
      magnet_gamma_before_target_pct: m.magnet_gamma_before_target_pct,
      liquidity: m.liquidity, score_parts: m.score_parts,
    });
  }
  rows.sort((a, b) => (b.score || -1) - (a.score || -1));

  const out = {
    runDate, requestedDate: date, expiry, target_is_monthly_opex: expiry ? isMonthlyOpex(expiry) : null,
    generatedAt: new Date().toISOString(),
    universe_ingested: manifest.ok.length, scored: scored.length, dropped: rows.filter((r) => r.dropped).length,
    top_k: config.scan.top_k, shortlist_n: shortlist.length, auth_dead: authDead,
    config_snapshot: { scan: config.scan, liquidity: config.liquidity, target_expiry: expiry },
    ranked: topK, tickers: rows,
  };
  const scanFile = resolveFromRoot(path.join(config.scan.scans_dir, `${runDate}_scan.json`));
  ensureDir(path.dirname(scanFile));
  writeJson(scanFile, out);
  log(`[stage1] ${runDate}: ranked ${scored.length} setups → top ${topK.length}. ${out.dropped} dropped → ${scanFile}`);
  return { runDate, scanFile, topK, ranked, out };
}
