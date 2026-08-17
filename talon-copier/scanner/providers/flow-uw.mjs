// flow-uw.mjs — FlowProvider (Unusual Whales implementation).
// HARD RULE: UW is used ONLY for options FLOW, PRICE/OHLC, and OI — NEVER for
// gamma/vanna/charm structure (that is Skylit's job). The daily options-volume
// series is historical, so it drives both the live gate and the walk-forward backtest.
import { fetchJson } from '../lib/util.mjs';

const BASE = 'https://api.unusualwhales.com/api/';

const num = (x) => (x == null || x === '' ? null : (Number.isFinite(+x) ? +x : null));

// OCC option symbol: TICKER + YYMMDD + C/P + strike*1000 (8 digits). e.g.
// occSymbol('SNDK','2026-08-14','call',1600) -> 'SNDK260814C01600000'
export function occSymbol(ticker, expiry, type, strike) {
  const [Y, M, D] = expiry.split('-');
  const cp = String(type)[0].toUpperCase();
  const strk = String(Math.round(strike * 1000)).padStart(8, '0');
  return `${ticker}${Y.slice(2)}${M}${D}${cp}${strk}`;
}

export class FlowProvider {
  constructor({ timeoutMs = 12000, limiter = null } = {}) {
    this.key = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY || null;
    this.timeoutMs = timeoutMs;
    this.limiter = limiter;
  }

  get available() { return !!this.key; }

  async _get(pathPart) {
    if (!this.key) return null;
    if (this.limiter) await this.limiter.acquire();
    return fetchJson(BASE + pathPart, {
      headers: { Authorization: `Bearer ${this.key}`, Accept: 'application/json' },
      timeoutMs: this.timeoutMs, retries: 2,
    });
  }

  // Daily options-flow series (historical). Normalized, oldest-first.
  async getFlowSeries(ticker, limit = 40) {
    const j = await this._get(`stock/${encodeURIComponent(ticker)}/options-volume?limit=${limit}`);
    const rows = Array.isArray(j) ? j : (j && j.data) || [];
    const out = rows.map((r) => ({
      date: String(r.date || r.market_date || '').slice(0, 10),
      call_volume: num(r.call_volume),
      put_volume: num(r.put_volume),
      call_oi: num(r.call_open_interest),
      put_oi: num(r.put_open_interest),
      net_call_premium: num(r.net_call_premium),
      net_put_premium: num(r.net_put_premium),
      call_ask: num(r.call_volume_ask_side),
      call_bid: num(r.call_volume_bid_side),
      put_ask: num(r.put_volume_ask_side),
      put_bid: num(r.put_volume_bid_side),
      avg30_call_volume: num(r.avg_30_day_call_volume),
      avg30_put_volume: num(r.avg_30_day_put_volume),
    })).filter((r) => r.date);
    out.sort((a, b) => (a.date < b.date ? -1 : 1));
    return out;
  }

  // Recent flow alerts (sweeps/blocks). Best-effort; UW returns most-recent first.
  async getAlerts(ticker, limit = 50) {
    const j = await this._get(`stock/${encodeURIComponent(ticker)}/flow-alerts?limit=${limit}`);
    const rows = Array.isArray(j) ? j : (j && j.data) || [];
    return rows.map((r) => ({
      time: r.created_at || r.executed_at || r.start_time || null,
      type: r.type || r.alert_rule || null,
      side: r.side || null,              // ask/bid/mid
      is_call: r.type ? /call/i.test(String(r.option_chain || r.type)) : (r.put_call === 'call'),
      option_type: r.put_call || r.option_type || null,
      strike: num(r.strike),
      expiry: r.expiry ? String(r.expiry).slice(0, 10) : null,
      premium: num(r.total_premium || r.premium),
      is_sweep: !!(r.is_sweep || /sweep/i.test(String(r.rule_name || r.type || ''))),
      is_block: !!(r.is_block || /block/i.test(String(r.rule_name || r.type || ''))),
      volume: num(r.volume),
      oi: num(r.open_interest),
    }));
  }

  // Dark-pool prints (best-effort). Used only as a confirmation bonus.
  async getDarkpool(ticker, limit = 50) {
    const j = await this._get(`darkpool/${encodeURIComponent(ticker)}?limit=${limit}`);
    const rows = Array.isArray(j) ? j : (j && j.data) || [];
    return rows.map((r) => ({
      time: r.executed_at || r.created_at || null,
      price: num(r.price),
      size: num(r.size || r.volume),
      premium: num(r.premium),
    }));
  }

  // Everything Stage 3 needs, sliced to be historically honest for backtests:
  // the flow series is trimmed to rows on/before asOfDate.
  async getFlow(ticker, { asOfDate = null, lookbackSessions = 20 } = {}) {
    // Pull deep enough that the trailing-lookback window is covered even for a scan
    // date ~2 months back (UW options-volume history is ~60 sessions).
    const series = await this.getFlowSeries(ticker, Math.max(lookbackSessions * 2 + 25, 65));
    const trimmed = asOfDate ? series.filter((r) => r.date <= asOfDate) : series;
    const asOfDay = trimmed.length ? trimmed[trimmed.length - 1] : null;
    // Alerts/darkpool are only historically reliable for recent (live) runs.
    const live = !asOfDate;
    const alerts = live ? await this.getAlerts(ticker) : [];
    const darkpool = live ? await this.getDarkpool(ticker) : [];
    return { ticker, source: 'uw', asOfDate, asOfDay, series: trimmed, alerts, darkpool, live };
  }

  // Daily price history for ONE option contract (OCC symbol). Real prices — lets us
  // measure option P&L (the convexity) exactly, not model it.
  async getOptionHistory(occ) {
    const j = await this._get(`option-contract/${encodeURIComponent(occ)}/historic`);
    const rows = (j && j.chains) || (Array.isArray(j) ? j : []);
    return rows.map((r) => {
      const bid = num(r.nbbo_bid), ask = num(r.nbbo_ask);
      return { date: String(r.date || '').slice(0, 10), last: num(r.last_price), bid, ask, mid: (bid != null && ask != null) ? (bid + ask) / 2 : num(r.last_price), avg: num(r.avg_price), iv: num(r.implied_volatility), oi: num(r.open_interest), volume: num(r.volume) };
    }).filter((r) => r.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  // Latest day-state: IV rank, realized vol, implied move, next earnings. Single-name raw
  // material — makes the vanna term event-aware and flags pre-earnings maps (validity condition).
  async getStockState(ticker, today = null) {
    const [ivj, ernj] = await Promise.all([
      this._get(`stock/${encodeURIComponent(ticker)}/iv-rank`).catch(() => null),
      this._get(`earnings/${encodeURIComponent(ticker)}`).catch(() => null),
    ]);
    const ivrows = ((ivj && ivj.data) || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const ivr = ivrows.length ? ivrows[ivrows.length - 1] : {};
    const t0 = today || new Date().toISOString().slice(0, 10);
    const next = ((ernj && ernj.data) || []).map((e) => String(e.report_date || '').slice(0, 10)).filter((d) => d >= t0).sort()[0] || null;
    return { iv_rank: num(ivr.iv_rank_1y), iv: num(ivr.volatility), next_earnings: next };
  }

  // "Is the match lit?" — the squeeze-IGNITION raw material. Negative-gamma structure is dry
  // tinder; aggressive ASK-SIDE call buying + BUILDING net-call premium is someone lighting it.
  // Surfaced for the LLM to weigh against the squeeze structure — NOT a hard-coded gate.
  async getSqueezeFlow(ticker, days = 5) {
    const s = await this.getFlowSeries(ticker, 30).catch(() => []);
    if (!s.length) return {};
    const w = s.slice(-days);
    const sum = (arr, f) => arr.reduce((a, r) => a + (f(r) || 0), 0);
    const callAsk = sum(w, (r) => r.call_ask), callBid = sum(w, (r) => r.call_bid);
    const askPct = (callAsk + callBid) ? Math.round((callAsk / (callAsk + callBid)) * 100) : null;
    const netCallPrem = sum(w, (r) => r.net_call_premium); // net premium into calls over the window
    // building? mean net-call premium of the last 2 sessions vs the prior 3
    const recent = s.slice(-2).length ? sum(s.slice(-2), (r) => r.net_call_premium) / s.slice(-2).length : 0;
    const prior = s.slice(-5, -2).length ? sum(s.slice(-5, -2), (r) => r.net_call_premium) / s.slice(-5, -2).length : 0;
    const last = s[s.length - 1];
    return { askPct, netCallPrem, todayNetCall: last.net_call_premium, building: recent > prior && recent > 0, days };
  }

  // Daily OHLC (regular session). Used by the resolver/backtest to score cards on a
  // closing basis and measure MFE/MAE. UW price data — allowed.
  async getDailyOHLC(ticker, { limit = 60 } = {}) {
    // UW ohlc/1d returns separate candles per date for the regular ('r'), pre-market
    // ('pr') and post-market ('po') sessions. We want ONLY the regular session so the
    // close matches Skylit's 4pm spot (a pre-market candle is off by the intraday move).
    const j = await this._get(`stock/${encodeURIComponent(ticker)}/ohlc/1d?limit=${limit * 3}`);
    const rows = Array.isArray(j) ? j : (j && j.data) || [];
    const hasSession = rows.some((r) => r.market_time != null);
    const out = rows
      .filter((r) => !hasSession || r.market_time === 'r')
      .map((r) => ({
        date: String(r.date || r.market_date || r.start_time || '').slice(0, 10),
        open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close),
        volume: num(r.volume), session: r.market_time || 'r',
      })).filter((r) => r.date && r.close != null);
    // de-dupe by date (keep first regular candle) and sort ascending
    const seen = new Set(), dedup = [];
    for (const r of out) { if (!seen.has(r.date)) { seen.add(r.date); dedup.push(r); } }
    dedup.sort((a, b) => (a.date < b.date ? -1 : 1));
    return dedup;
  }
}
