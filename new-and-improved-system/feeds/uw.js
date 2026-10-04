// Unusual Whales: real 1-minute option contract bars (the fill source for shadow trading).
import { UW_API_KEY } from './env.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;

/** OCC symbol, e.g. occ('SPY','2026-10-01','put',760) → SPY261001P00760000 */
export function occ(root, date, type, strike) {
  const [y, m, d] = date.split('-');
  return `${root}${y.slice(2)}${m}${d}${type === 'call' ? 'C' : 'P'}${String(Math.round(strike * 1000)).padStart(8, '0')}`;
}

/** 1-min bars for one contract on one date → [{t, o, h, l, c, v}] sorted (t = unix seconds of bar start). */
export async function contractMinuteBars(id, date) {
  if (!UW_API_KEY) throw new Error('UNUSUAL_WHALES_API_KEY missing');
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = 250 - (Date.now() - last); if (wait > 0) await sleep(wait); last = Date.now();
    const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${id}/intraday?date=${date}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } });
    if (r.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
    const j = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(j?.data)) return [];
    return j.data.map((b) => ({ t: Math.floor(Date.parse(b.start_time) / 1000), o: +b.open, h: +b.high, l: +b.low, c: +b.close, v: (b.volume_ask_side || 0) + (b.volume_bid_side || 0) + (b.volume_mid_side || 0) + (b.volume_no_side || 0) })).sort((a, b) => a.t - b.t);
  }
  return [];
}

/** Recent headlines that actually tag `ticker` (UW news; UW quota, no Skylit credits). → [{at, headline, source, sentiment}] */
export async function headlines(ticker, n = 3) {
  if (!UW_API_KEY) return [];
  const r = await fetch(`https://api.unusualwhales.com/api/news/headlines?ticker=${ticker}&limit=20`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
  const j = r?.ok ? await r.json().catch(() => null) : null;
  return (j?.data ?? []).filter((h) => (h.tickers ?? []).includes(ticker)).slice(0, n).map((h) => ({ at: h.created_at, headline: h.headline, source: h.source, sentiment: h.sentiment }));
}

const uwGet = async (p) => { const wait = 250 - (Date.now() - last); if (wait > 0) await sleep(wait); last = Date.now(); const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null); return r?.ok ? r.json().catch(() => null) : null; };
/** Every OCC symbol listed for `ticker` on `date` (parsed). */
export async function optionSymbols(ticker, date) {
  const j = await uwGet(`/stock/${ticker}/option-chains?date=${date}`);
  return (j?.data ?? []).map((id) => { const m = id.match(/^([A-Z.]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/); return m ? { id, exp: `20${m[2]}-${m[3]}-${m[4]}`, type: m[5] === 'C' ? 'call' : 'put', strike: +m[6] / 1000 } : null; }).filter(Boolean);
}
/** Last session's quote for one contract: NBBO bid/ask, OI, volume, IV (UW historic, newest row). */
export async function contractQuote(id) {
  const row = (await uwGet(`/option-contract/${id}/historic?limit=1`))?.chains?.[0];
  if (!row) return null;
  const bid = +row.nbbo_bid || 0, ask = +row.nbbo_ask || 0, mid = (bid + ask) / 2;
  return { id, date: row.date, bid, ask, mid: +mid.toFixed(2), spreadPct: mid > 0 ? +((ask - bid) / mid * 100).toFixed(1) : null, oi: +row.open_interest || 0, volume: +row.volume || 0, iv: row.implied_volatility != null ? +(row.implied_volatility * 100).toFixed(1) : null };
}
