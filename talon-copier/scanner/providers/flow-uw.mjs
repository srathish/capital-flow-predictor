// flow-uw.mjs — FlowProvider (Unusual Whales implementation).
// HARD RULE: UW is used ONLY for options FLOW, PRICE/OHLC, and OI — NEVER for
// gamma/vanna/charm structure (that is Skylit's job). The daily options-volume
// series is historical, so it drives both the live gate and the walk-forward backtest.
import { fetchJson } from '../lib/util.mjs';

const BASE = 'https://api.unusualwhales.com/api/';

const num = (x) => (x == null || x === '' ? null : (Number.isFinite(+x) ? +x : null));

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
    const series = await this.getFlowSeries(ticker, Math.max(lookbackSessions + 6, 30));
    const trimmed = asOfDate ? series.filter((r) => r.date <= asOfDate) : series;
    const asOfDay = trimmed.length ? trimmed[trimmed.length - 1] : null;
    // Alerts/darkpool are only historically reliable for recent (live) runs.
    const live = !asOfDate;
    const alerts = live ? await this.getAlerts(ticker) : [];
    const darkpool = live ? await this.getDarkpool(ticker) : [];
    return { ticker, source: 'uw', asOfDate, asOfDay, series: trimmed, alerts, darkpool, live };
  }

  // Daily OHLC (regular session). Used by the resolver/backtest to score cards on a
  // closing basis and measure MFE/MAE. UW price data — allowed.
  async getDailyOHLC(ticker, { limit = 60 } = {}) {
    const j = await this._get(`stock/${encodeURIComponent(ticker)}/ohlc/1d?limit=${limit}`);
    const rows = Array.isArray(j) ? j : (j && j.data) || [];
    const out = rows.map((r) => ({
      date: String(r.date || r.market_date || r.start_time || '').slice(0, 10),
      open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close),
      volume: num(r.volume),
    })).filter((r) => r.date && r.close != null);
    out.sort((a, b) => (a.date < b.date ? -1 : 1));
    return out;
  }
}
