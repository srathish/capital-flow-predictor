#!/usr/bin/env node
// CASE STUDY the user's names: MU, SNDK, NBIS. Find each one's biggest ~1-week moves over the
// GEX history, then pull the PER-EXPIRY GEX/VEX structure the Friday BEFORE — did a real
// squeeze / melt-up setup show up on a specific expiry? (per-expiry = the proper read).
import { loadConfig, loadEnvKeysFrom, resolveFromRoot, log } from '../../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { GexProvider } = await import('../../providers/gex-skylit.mjs');
const { FlowProvider } = await import('../../providers/flow-uw.mjs');
const config = loadConfig();
const gex = new GexProvider({ maxStrikes: config.ingest.max_strikes, maxExpirations: config.ingest.max_expirations, eodHHMM: config.ingest.skylit_eod_hhmm });
await gex.init();
const flow = new FlowProvider();
const M = (x) => Math.round((x / 1e6) * 100) / 100;
const NAMES = ['MU', 'SNDK', 'NBIS'];

for (const t of NAMES) {
  const oh = await flow.getDailyOHLC(t, { limit: 200 }).catch(() => []);
  if (oh.length < 20) { log(`\n${t}: no OHLC`); continue; }
  // biggest 5-trading-day forward moves (entry = day i close → i+5 close)
  const clean = oh.filter((b) => b.close != null && isFinite(b.close) && b.close > 0);
  const moves = [];
  for (let i = 0; i < clean.length - 6; i++) { const ret = (clean[i + 5].close - clean[i].close) / clean[i].close; if (!isFinite(ret)) continue; moves.push({ date: clean[i].date, ret, absr: Math.abs(ret) }); }
  moves.sort((a, b) => b.absr - a.absr);
  // de-dup overlapping windows (keep top distinct by >7 days apart)
  const picks = []; for (const m of moves) { if (picks.every((p) => Math.abs(Date.parse(p.date) - Date.parse(m.date)) > 7 * 86400000)) picks.push(m); if (picks.length >= 3) break; }
  log(`\n════════ ${t} — top 3 one-week moves ════════`);
  for (const p of picks) {
    log(`\n  ${p.date} → +5d move ${(p.ret * 100).toFixed(1)}%   (structure as-of ${p.date}, the decision day):`);
    let prof; try { prof = await gex.getProfile(t, { date: p.date }); } catch (e) { log(`    structure err ${e.message}`); continue; }
    if (!prof || !prof.strikes?.length) { log('    no structure'); continue; }
    const spot = prof.spot;
    // per-expiry decomposition for the nearest 4 expiries
    for (const E of prof.expirations.slice(0, 4)) {
      const rows = prof.strikes.map((s) => ({ k: s.strike, g: s.perExpiry?.[E] || 0, v: s.perExpiryVanna?.[E] || 0 })).filter((r) => r.g || r.v);
      if (!rows.length) continue;
      const gk = rows.filter((r) => r.g).sort((a, b) => Math.abs(b.g) - Math.abs(a.g))[0];
      const vk = rows.filter((r) => r.v).sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
      const dte = Math.round((Date.parse(E) - Date.parse(p.date)) / 86400000);
      const gkPos = gk ? `${gk.k}${gk.g >= 0 ? '+' : '-'}(${M(gk.g)}M, ${((gk.k - spot) / spot * 100).toFixed(1)}%)` : '—';
      const vkPos = vk ? `${vk.k}${vk.v >= 0 ? '+' : '-'}(${M(vk.v)}M, ${((vk.k - spot) / spot * 100).toFixed(1)}%)` : '—';
      const squeeze = gk && gk.g < 0 && Math.abs(gk.k - spot) / spot < 0.03 ? '  ⚡SQUEEZE (neg-gamma king AT spot)' : '';
      log(`    ${E} (${dte}d): GEX king ${gkPos}  |  VEX king ${vkPos}${squeeze}`);
    }
    log(`    spot ${spot.toFixed(2)}`);
  }
}
