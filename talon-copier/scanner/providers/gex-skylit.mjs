// gex-skylit.mjs — GexProvider (Skylit implementation).
// HARD RULE: ALL gamma/vanna/charm structure comes from Skylit, NEVER Unusual Whales.
// Reuses the proven Clerk-JWT auth (initAuth/getFreshToken). Historical surfaces via
// the `timestamp` param (ReplayMode) — the same mechanism that powers persistence AND
// the walk-forward backtest.
import '../../../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../../apps/gex/src/heatseeker/auth.js';
import { skylitTimestamp, etDate, priorSessions } from '../lib/time.mjs';
import { sleep } from '../lib/util.mjs';

const BASE = 'https://app.skylit.ai/api/data';

export class GexProvider {
  constructor({ maxStrikes = 200, maxExpirations = 10, timeoutMs = 15000, eodHHMM = '16:00', limiter = null } = {}) {
    this.maxStrikes = maxStrikes;
    this.maxExpirations = maxExpirations;
    this.timeoutMs = timeoutMs;
    this.eodHHMM = eodHHMM;
    this.limiter = limiter;
    this._inited = false;
  }

  async init() {
    if (this._inited) return;
    await initAuth();
    this._inited = true;
  }

  async _raw(ticker, timestamp) {
    if (this.limiter) await this.limiter.acquire();
    const token = await getFreshToken();
    const u = new URL(BASE);
    u.searchParams.set('symbol', ticker);
    u.searchParams.set('max_strikes', String(this.maxStrikes));
    u.searchParams.set('max_expirations', String(this.maxExpirations));
    u.searchParams.set('nocache', Math.random().toString());
    if (timestamp) u.searchParams.set('timestamp', timestamp);
    const r = await fetch(u.toString(), {
      headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (r.status === 401 || r.status === 403) { const e = new Error('AUTH'); e.status = r.status; throw e; }
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || j.CurrentSpot == null) return null;
    return j;
  }

  // Normalize a raw Skylit blob into a profile with aggregate GEX/VEX per strike
  // AND the per-expiry decomposition (keyed by expiration date).
  _normalize(ticker, raw, requestedTimestamp) {
    const spot = +raw.CurrentSpot;
    const K = raw.Strikes || [];
    const G = raw.GammaValues || [];
    const V = raw.VannaValues || [];
    const exps = (raw.Expirations || []).map((e) => String(e).slice(0, 10));
    const strikes = [];
    let totalAbsGex = 0;
    for (let i = 0; i < K.length; i++) {
      const strike = +K[i];
      if (!Number.isFinite(strike)) continue;
      const gRow = G[i] || [];
      const vRow = V[i] || [];
      let gexAgg = 0, vexAgg = 0;
      const perExpiry = {};
      const perExpiryVanna = {};
      for (let e = 0; e < exps.length; e++) {
        const g = +gRow[e] || 0;
        const v = +vRow[e] || 0;
        gexAgg += g; vexAgg += v;
        if (g !== 0) perExpiry[exps[e]] = g;
        if (v !== 0) perExpiryVanna[exps[e]] = v;
      }
      totalAbsGex += Math.abs(gexAgg);
      strikes.push({ strike, gexAgg, vexAgg, perExpiry, perExpiryVanna });
    }
    strikes.sort((a, b) => a.strike - b.strike);
    return {
      ticker,
      source: 'skylit',
      requestedTimestamp: requestedTimestamp || null,
      asof: raw.HistoricalTimestamp || raw.LastUpdated || null,
      asofDate: raw.HistoricalTimestamp ? etDate(new Date(raw.HistoricalTimestamp)) : null,
      replayMode: !!raw.ReplayMode,
      spot,
      previousClose: raw.PreviousClose != null ? +raw.PreviousClose : null,
      expirations: exps,
      strikes,
      totalAbsGex,
    };
  }

  // Current surface, or a historical one when `timestamp` (or as-of `date`) is given.
  async getProfile(ticker, { timestamp = null, date = null, hhmm = null } = {}) {
    await this.init();
    const ts = timestamp || (date ? skylitTimestamp(date, hhmm || this.eodHHMM) : null);
    const raw = await this._raw(ticker, ts);
    if (!raw) return null;
    return this._normalize(ticker, raw, ts);
  }

  // Trailing per-session EOD surfaces strictly BEFORE `asOfDate`, most-recent-first.
  // Each session is filtered to strikes within ±band of that session's spot and
  // sorted ascending. Used by Stage 1 persistence. Sessions whose returned snapshot
  // date doesn't match the requested date (holidays / outages) are skipped.
  async getHistory(ticker, { asOfDate, sessions = 12, band = 0.20, hhmm = null }) {
    await this.init();
    const dates = priorSessions(asOfDate, sessions);
    const out = [];
    for (const d of dates) {
      let prof;
      try {
        prof = await this.getProfile(ticker, { date: d, hhmm: hhmm || this.eodHHMM });
      } catch (e) {
        if (e.message === 'AUTH') throw e;
        prof = null;
      }
      if (!prof) { await sleep(20); continue; }
      // Only accept a session that actually returned that date's snapshot.
      if (prof.asofDate && prof.asofDate !== d) continue;
      const near = prof.strikes
        .filter((s) => Math.abs(s.strike - prof.spot) / prof.spot <= band)
        .map((s) => ({ strike: s.strike, gexAgg: s.gexAgg }));
      out.push({ date: d, spot: prof.spot, replayMode: prof.replayMode, strikes: near });
    }
    return out;
  }

  async authStatus() {
    await this.init();
    const t = await getFreshToken();
    return { ok: !!t, tokenLen: t ? t.length : 0 };
  }
}
