#!/usr/bin/env node
// UW-only "Skylit-style" board (recipe from shadow/skylit_formula): per contract, dealer position = −Σ(customer ask-side − bid-side volume)
// over the contract's life (UW /historic daily rows); value = position × Black-Scholes gamma$ (or vanna) at the board time. No Skylit calls.
// Usage: node build_uw_board.mjs IREN 2026-10-16   → uw_board_<T>.json (same shape as iren_compact.json) + a comparison vs Skylit if present.
import fs from 'node:fs';
import { UW_API_KEY } from '../../feeds/env.js';
const T = process.argv[2] ?? 'IREN', D = process.argv[3] ?? '2026-10-16', HORIZON = '2027-10-17';
const CACHE = new URL('../../.cache/uwboard/', import.meta.url); fs.mkdirSync(CACHE, { recursive: true });
const uw = async (u, key) => { const f = new URL(key + '.json', CACHE); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  for (let a = 0; a < 3; a++) { await new Promise((r) => setTimeout(r, 120)); const r = await fetch('https://api.unusualwhales.com/api' + u, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null); if (r?.ok) { const j = await r.json(); fs.writeFileSync(f, JSON.stringify(j)); return j; } await new Promise((x) => setTimeout(x, 1500)); } return null; };
const phi = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
const greeks = (S, K, Ty, v) => { const sq = v * Math.sqrt(Ty), d1 = (Math.log(S / K) + 0.5 * v * v * Ty) / sq, d2 = d1 - sq; return { gamma: phi(d1) / (S * sq), vanna: -phi(d1) * d2 / v }; };
const parse = (id) => { const m = id.match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/); return m ? { exp: `20${m[2]}-${m[3]}-${m[4]}`, cp: m[5], K: +m[6] / 1000 } : null; };
const chains = await uw(`/stock/${T}/option-chains?date=${D}`, `chains_${T}_${D}`);
const ohlc = await uw(`/stock/${T}/ohlc/1d?limit=5&end_date=${D}`, `ohlc_${T}_${D}`);
const S = +((ohlc?.data ?? []).filter((b) => b.market_time === 'r' && b.date === D)[0]?.close);
const ids = (chains?.data ?? []).map((id) => ({ id, ...parse(id) })).filter((c) => c.exp && c.exp > D && c.exp <= HORIZON && c.K >= S * 0.35 && c.K <= S * 2.6);
console.log(T, D, 'spot', S, 'contracts', ids.length);
const cells = new Map(); let n = 0, used = 0;
for (const c of ids) {
  const h = await uw(`/option-contract/${c.id}/historic`, `hist_${c.id}`); n++; if (n % 250 === 0) console.log('  fetched', n, '/', ids.length);
  const rows = (h?.chains ?? []).filter((r) => r.date <= D); if (!rows.length) continue;
  const cum = rows.reduce((s, r) => s + (+r.ask_volume || 0) - (+r.bid_volume || 0), 0); if (!cum) continue;
  const last = rows.sort((a, b) => b.date.localeCompare(a.date))[0], v = Math.min(3, Math.max(0.05, +last.implied_volatility || 1));
  const Ty = Math.max(1e-4, (Date.parse(c.exp) - Date.parse(D)) / 864e5 / 365), gk = greeks(S, c.K, Ty, v);
  const key = `${c.K}|${c.exp}`, cell = cells.get(key) ?? { g: 0, v: 0 };
  // dealer is the other side of customer flow; ×100 shares; gamma$ per 1% (×S²×0.01), vanna per vol point (×S²×0.01 scale as in the fit)
  cell.g += -cum * gk.gamma * 100 * S * S * 0.01; cell.v += -cum * gk.vanna * 100 * S * S * 0.01; cells.set(key, cell); used++;
}
const strikes = [...new Set([...cells.keys()].map((k) => +k.split('|')[0]))].sort((a, b) => a - b), exps = [...new Set([...cells.keys()].map((k) => k.split('|')[1]))].sort();
const grid = (f) => strikes.map((K) => exps.map((e) => Math.round(f(cells.get(`${K}|${e}`)) || 0)));
const board = { source: 'UW-built (flow recipe)', gamma: { spot: S, prev: S, asOf: D + ' close (UW-built)', exp: exps, strikes, m: grid((c) => c?.g) }, vanna: { spot: S, prev: S, asOf: D + ' close (UW-built)', exp: exps, strikes, m: grid((c) => c?.v) } };
fs.writeFileSync(new URL(`./uw_board_${T}.json`, import.meta.url), JSON.stringify(board));
console.log('contracts with flow', used, 'cells', cells.size);
// compare with the Skylit board if we have it
const skf = new URL('./iren_compact.json', import.meta.url);
if (T === 'IREN' && fs.existsSync(skf)) {
  const SK = JSON.parse(fs.readFileSync(skf, 'utf8'));
  for (const M of ['gamma', 'vanna']) {
    const s = SK[M], pairs = [];
    s.strikes.forEach((K, i) => s.exp.forEach((e, j) => { if (e > HORIZON) return; const c = cells.get(`${K}|${e}`); const u = c ? (M === 'gamma' ? c.g : c.v) : 0; if (s.m[i][j] || u) pairs.push({ K, e, sk: s.m[i][j], uw: u }); }));
    const corr = (a, b) => { const k = a.length, ma = a.reduce((x, y) => x + y, 0) / k, mb = b.reduce((x, y) => x + y, 0) / k; let xy = 0, xx = 0, yy = 0; for (let i = 0; i < k; i++) { xy += (a[i] - ma) * (b[i] - mb); xx += (a[i] - ma) ** 2; yy += (b[i] - mb) ** 2; } return xy / Math.sqrt(xx * yy); };
    const top = (key) => [...pairs].sort((a, b) => Math.abs(b[key]) - Math.abs(a[key])).slice(0, 10).map((p) => p.K + '|' + p.e);
    const tS = top('sk'), tU = top('uw'), big = pairs.filter((p) => Math.abs(p.sk) >= Math.abs(pairs.reduce((a, b) => Math.abs(b.sk) > Math.abs(a.sk) ? b : a).sk) * 0.1);
    const kS = pairs.reduce((a, b) => Math.abs(b.sk) > Math.abs(a.sk) ? b : a), kU = pairs.reduce((a, b) => Math.abs(b.uw) > Math.abs(a.uw) ? b : a);
    const scale = pairs.reduce((s, p) => s + p.sk * p.uw, 0) / pairs.reduce((s, p) => s + p.uw * p.uw, 0);
    console.log(`\n${M === 'gamma' ? 'GEX' : 'VEX'} vs Skylit: cells ${pairs.length} | corr ${corr(pairs.map((p) => p.sk), pairs.map((p) => p.uw)).toFixed(3)} | sign agreement on Skylit's big nodes (≥10% of king) ${(big.filter((p) => Math.sign(p.sk) === Math.sign(p.uw)).length / big.length * 100).toFixed(0)}% of ${big.length} | top-10 overlap ${tU.filter((x) => tS.includes(x)).length}/10 | scale Skylit≈${scale.toFixed(3)}×UW`);
    console.log(`  Skylit king ${kS.K} ${kS.e} ${(kS.sk / 1e6).toFixed(2)}M | UW-built king ${kU.K} ${kU.e} ${(kU.uw * scale / 1e6).toFixed(2)}M (scaled)`);
  }
}
