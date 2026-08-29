// gex-uw.mjs — GexProviderUW: a Skylit-SHAPED GEX/VEX profile sourced entirely from Unusual Whales'
// dealer greek-exposure. Drop-in replacement for GexProvider (Skylit): same getProfile() output shape
// (spot, strikes:[{strike, gexAgg, vexAgg, perExpiry, perExpiryVanna}], expirations, totalAbsGex).
//
// HONEST NOTE: this is NOT numerically identical to Skylit — the two vendors compute GEX/VEX with different
// dealer-sign conventions, IV surfaces, and OI/vol snapshots (validated: no single formula maps one to the
// other, cross-vendor corr ~0.2–0.7). It is a UW-NATIVE surface: net per strike = call_gex + put_gex
// (already dealer-signed by UW: + = MM long gamma / pin, − = MM short / squeeze). The doctrine/mech-score
// must be RE-CALIBRATED to UW's magnitude (UW ≈ 2–3 orders smaller than Skylit) before the scores compare.
import { fetchJson } from '../lib/util.mjs';

const BASE = 'https://api.unusualwhales.com/api/';
const num = (x) => (x == null || x === '' ? null : (Number.isFinite(+x) ? +x : null));

export class GexProviderUW {
  constructor({ timeoutMs = 15000, limiter = null } = {}) {
    this.key = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY || null;
    this.timeoutMs = timeoutMs;
    this.limiter = limiter;
  }

  get available() { return !!this.key; }

  async _get(path) {
    if (!this.key) return null;
    if (this.limiter) await this.limiter.acquire();
    return fetchJson(BASE + path, { headers: { Authorization: `Bearer ${this.key}`, Accept: 'application/json' }, timeoutMs: this.timeoutMs, retries: 2 });
  }

  async _spot(ticker) {
    const se = await this._get(`stock/${encodeURIComponent(ticker)}/spot-exposures`).catch(() => null);
    const rows = (se && (se.data || se.result)) || [];
    const last = rows.length ? rows[rows.length - 1] : null; // most-recent minute
    if (last && last.price != null) return +last.price;
    const oh = await this._get(`stock/${encodeURIComponent(ticker)}/ohlc/1d?limit=1`).catch(() => null);
    const or = (Array.isArray(oh) ? oh : (oh && oh.data)) || [];
    return or.length ? num(or[or.length - 1].close) : null;
  }

  // Current surface. UW's strike-expiry defaults to the FRONT expiry only, but accepts ?expiry=YYYY-MM-DD
  // for any single expiry. So:
  //   getProfile(t)                     → aggregate surface (greek-exposure/strike, all expiries netted)
  //   getProfile(t, {expiry})           → that ONE expiry's per-strike surface  (1 call — cheap, what the doctrine wants)
  //   getProfile(t, {allExpiries:true}) → full forward matrix (1 call per expiry ≈ 12 — the true Skylit-shape)
  async getProfile(ticker, { expiry = null, allExpiries = false } = {}) {
    if (!this.key) return null;
    const T = encodeURIComponent(ticker);
    const spot = await this._spot(ticker);
    if (spot == null) return null;
    let rows = [];
    if (allExpiries) {
      const ej = await this._get(`stock/${T}/greek-exposure/expiry`).catch(() => null);
      const exps = [...new Set(((ej && (ej.data || ej.result)) || []).map((r) => String(r.expiry || '').slice(0, 10)).filter(Boolean))];
      const parts = await Promise.all(exps.map((e) => this._get(`stock/${T}/greek-exposure/strike-expiry?expiry=${e}`).catch(() => null)));
      rows = parts.flatMap((j) => (j && (j.data || j.result)) || []);
    } else if (expiry) {
      const j = await this._get(`stock/${T}/greek-exposure/strike-expiry?expiry=${expiry}`).catch(() => null);
      rows = (j && (j.data || j.result)) || [];
    } else {
      const j = await this._get(`stock/${T}/greek-exposure/strike`).catch(() => null);
      rows = ((j && (j.data || j.result)) || []).map((r) => ({ ...r, expiry: 'ALL' }));
    }
    if (!rows.length) return null;

    const byStrike = new Map();
    const expSet = new Set();
    for (const r of rows) {
      const k = num(r.strike);
      if (k == null) continue;
      const exp = String(r.expiry || '').slice(0, 10);
      const g = (num(r.call_gex) || 0) + (num(r.put_gex) || 0);   // dealer-signed net gamma exposure
      const v = (num(r.call_vanna) || 0) + (num(r.put_vanna) || 0); // dealer-signed net vanna
      if (exp) expSet.add(exp);
      if (!byStrike.has(k)) byStrike.set(k, { strike: k, gexAgg: 0, vexAgg: 0, perExpiry: {}, perExpiryVanna: {} });
      const s = byStrike.get(k);
      s.gexAgg += g; s.vexAgg += v;
      if (exp && g !== 0) s.perExpiry[exp] = (s.perExpiry[exp] || 0) + g;
      if (exp && v !== 0) s.perExpiryVanna[exp] = (s.perExpiryVanna[exp] || 0) + v;
    }
    const strikes = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
    return {
      ticker,
      source: 'uw',
      requestedExpiry: expiry,
      asof: rows[0]?.date || null,
      asofDate: rows[0]?.date ? String(rows[0].date).slice(0, 10) : null,
      spot,
      expirations: [...expSet].sort(),
      strikes,
      totalAbsGex: strikes.reduce((a, s) => a + Math.abs(s.gexAgg), 0),
    };
  }
}
