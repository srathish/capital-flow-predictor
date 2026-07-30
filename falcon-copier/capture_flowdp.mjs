// CAPTURE FLOW + DARK-POOL + TIDE every minute — UW only (no Skylit / no session B, so it runs safely alongside
// autotrade). These are the engine's flow + dp-extension layers, which are LIVE-ONLY (UW keeps intraday flow/DP
// for the current day; historical intraday isn't retrievable) — so they can never be backtested unless we record
// them NOW. This daemon writes one snapshot/min to velocity-capture/flowdp_<day>.jsonl; a future backtest joins
// it with replay_<day>_SPXW.jsonl.gz (GEX) BY TIMESTAMP to reconstruct the full 7-criteria confluence off-line.
// No spot is captured here on purpose — spot comes from the GEX replay at join time (keeps this pure-UW).
import '../apps/gex/scripts/_env-bootstrap.js';
import fs from 'node:fs'; import path from 'node:path';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
if (!KEY) { console.error(`${new Date().toISOString()} flowdp: NO UW KEY — abort`); process.exit(0); }
const OUT = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const nowISO = new Date().toISOString();
const uw = (p) => fetch(`https://api.unusualwhales.com${p}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(12000) }).then(x => x.ok ? x.json() : null).catch(() => null);

// flow: trailing-20min ask-side opening premium, bull vs bear, per instrument (raw sums → any window recomputable)
async function flow(sym) {
  const since = new Date(Date.now() - 20 * 60000).toISOString();
  const r = await uw(`/api/option-trades?ticker_symbol=${sym}&min_premium=25000&limit=1000&newer_than=${since}`);
  let bull = 0, bear = 0, n = 0;
  for (const x of (r?.data || r?.result || [])) { const tg = x.tags || []; if (!tg.includes('ask_side')) continue; const p = +x.premium || 0; if (tg.includes('bullish')) bull += p; else if (tg.includes('bearish')) bear += p; n++; }
  return { bull: Math.round(bull), bear: Math.round(bear), n };
}
// dark-pool value area: off_vol by price → top buckets (POC/VAH/VAL reconstructable) per ETF
async function dp(sym) {
  const r = await uw(`/api/stock/${sym}/stock-volume-price-levels`);
  const b = {}; for (const x of (r?.data || [])) { const o = +x.off_vol || 0; if (o > 0) b[Math.round(+x.price)] = (b[Math.round(+x.price)] || 0) + o; }
  const a = Object.entries(b).map(([p, v]) => ({ p: +p, v: Math.round(v) })).sort((x, y) => y.v - x.v).slice(0, 12);
  return a.length ? { poc: a[0].p, vah: Math.max(...a.map(x => x.p)), val: Math.min(...a.map(x => x.p)), buckets: a } : null;
}
// market tide: latest net premium + net volume (whole-market flow lean)
async function tide() {
  const r = await uw(`/api/market/market-tide?date=${day}&interval_5m=true`); const t = r?.data?.slice(-1)[0];
  return t ? { netPrem: Math.round(+t.net_call_premium - +t.net_put_premium), netVol: Math.round(+t.net_volume) } : null;
}

const [fSPX, fSPY, fQQQ, dSPY, dQQQ, tde] = await Promise.all([flow('SPXW'), flow('SPY'), flow('QQQ'), dp('SPY'), dp('QQQ'), tide()]);
const snap = { ts: nowISO, flow: { SPXW: fSPX, SPY: fSPY, QQQ: fQQQ }, dp: { SPY: dSPY, QQQ: dQQQ }, tide: tde };
fs.appendFileSync(path.join(OUT, `flowdp_${day}.jsonl`), JSON.stringify(snap) + '\n');
const M = (x) => (x >= 0 ? '+' : '') + Math.round(x / 1e6) + 'M';
console.log(`${nowISO}  flow SPX ${M(fSPX.bull - fSPX.bear)}(n${fSPX.n}) SPY ${M(fSPY.bull - fSPY.bear)} QQQ ${M(fQQQ.bull - fQQQ.bear)} · dp SPY POC ${dSPY?.poc ?? '—'}/VAH ${dSPY?.vah ?? '—'}/VAL ${dSPY?.val ?? '—'} · tide ${tde ? M(tde.netPrem) : 'n/a'}`);
