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
