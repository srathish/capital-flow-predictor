// UW context for a card (UW quota only — no Skylit credits). Informational unless shadow/uw_signals.mjs or
// shadow/dp_levels.mjs validated the item — see desk/README.md for which ones count.
import { UW_API_KEY } from '../feeds/env.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let last = 0;
async function uw(p) {
  for (let k = 0; k < 4; k++) {
    const w = 260 - (Date.now() - last); if (w > 0) await sleep(w); last = Date.now();
    const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
    if (r?.status === 429) { await sleep(4000 * (k + 1)); continue; }
    return r?.ok ? r.json().catch(() => null) : null;
  }
  return null;
}
const daysAgo = (D, n) => new Date(Date.parse(D + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);
const money = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}k`);

/** { insider, analysts, shortInterest, darkPool:{levels:[{price,offVol}], nearEntry} } — `prevD` = last completed session. */
export async function uwContext(sym, D, prevD, entry) {
  const out = {};
  const ins = (await uw(`/insider/transactions?ticker_symbol=${sym}&limit=200`))?.data ?? [];
  const since = daysAgo(D, 90), recent = ins.filter((r) => r.filing_date >= since && ['P', 'S'].includes(r.transaction_code));
  const buys = recent.filter((r) => r.transaction_code === 'P'), sells = recent.filter((r) => r.transaction_code === 'S' && !r.is_10b5_1);
  const val = (xs) => xs.reduce((a, r) => a + Math.abs(r.amount) * +r.price, 0);
  out.insider = { buys: buys.length, buyers: new Set(buys.map((r) => r.owner_name)).size, buyValue: Math.round(val(buys)), sells: sells.length, sellers: new Set(sells.map((r) => r.owner_name)).size, sellValue: Math.round(val(sells)),
    text: `${buys.length ? `${new Set(buys.map((r) => r.owner_name)).size} insider buyer(s) ${money(val(buys))}` : 'no insider buys'}; ${sells.length ? `${new Set(sells.map((r) => r.owner_name)).size} discretionary seller(s) ${money(val(sells))}` : 'no discretionary sells'} (90d)` };
  const an = ((await uw(`/screener/analysts?ticker=${sym}&limit=50`))?.data ?? []).filter((r) => r.timestamp.slice(0, 10) >= daysAgo(D, 30));
  out.analysts = { up: an.filter((r) => r.action === 'upgraded').length, down: an.filter((r) => r.action === 'downgraded').length, n: an.length,
    text: an.length ? an.slice(0, 3).map((r) => `${r.timestamp.slice(5, 10)} ${r.firm} ${r.action} ${r.recommendation ?? ''}${r.target ? ` PT ${(+r.target).toFixed(0)}` : ''}`).join(' · ') : 'no analyst actions (30d)' };
  const si = (await uw(`/shorts/${sym}/interest-float/v2`))?.data?.[0];
  out.shortInterest = si ? { pct: +(+si.si_float * 100).toFixed(1), asOf: si.market_date, daysToCover: +si.days_to_cover } : null;
  const dp = ((await uw(`/stock/${sym}/stock-volume-price-levels?date=${prevD}`))?.data ?? []).map((x) => [+x.price, +x.off_vol || 0]).filter(([p, v]) => p > 0 && v > 0);
  if (dp.length && entry) {
    const ref = entry, bucket = ref * 0.0025, agg = new Map();
    for (const [p, v] of dp) { if (Math.abs(p - ref) / ref > 0.03) continue; const k = Math.round(p / bucket); agg.set(k, (agg.get(k) ?? 0) + v); }
    const levels = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => ({ price: +(k * bucket).toFixed(2), offVol: v }));
    out.darkPool = { levels, nearEntry: levels.some((l) => Math.abs(l.price - entry) / entry <= 0.0015) };
  }
  return out;
}
