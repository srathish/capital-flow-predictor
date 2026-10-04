#!/usr/bin/env node
// Do UW DARK-POOL price levels act as support/resistance — better than random, and next to the Skylit map nodes?
// Locked 2026-10-04 BEFORE running. 35 stocks with cached maps + minute bars, every 3rd session Jan–Sep 2026.
//   DP levels   prior session's off-exchange volume by price (UW stock-volume-price-levels), bucketed to 0.25% of price;
//               top 3 buckets within ±3% of the prior close
//   NODES       Skylit weekly-map major nodes (king/gatekeeper or ≥8% share) within ±3% (cached 09:35 board)
//   RANDOM      3 uniform levels within ±3% of the prior close (seeded) — the control
//   CONFLUENCE  DP level within 0.15% of a node
// Test per level, 09:35–15:30 on the day: first 1-min touch (±0.05%) from one side → REJECT if price then moves 0.3% back
// the way it came before it CLOSES 0.3% through; BREAK if the opposite; else neither (by 15:59).
//   node shadow/dp_levels.mjs
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';
import { loadDaily } from '../desk/common.mjs';
import { normalizeBoard, majorNodes } from '../map/board.js';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), ROOT = path.join(HERE, '..'), C = path.join(ROOT, '.cache', 'uw', 'dpl');
const SYMS = 'AAPL ADBE AMD AMZN AVGO COST CRM GOOGL JPM META MSFT NFLX NVDA ORCL TSLA PLTR MU MSTR TSM INTC LLY HOOD GEV APP CRWV WMT CVNA BAC SNDK COIN XOM WBD RKLB UNH BA'.split(' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let last = 0;
async function dpLevels(sym, date) {
  const f = path.join(C, sym, `${date}.json`); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  for (let k = 0; k < 5; k++) {
    const w = 260 - (Date.now() - last); if (w > 0) await sleep(w); last = Date.now();
    const r = await fetch(`https://api.unusualwhales.com/api/stock/${sym}/stock-volume-price-levels?date=${date}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
    if (r?.status === 429) { await sleep(5000 * (k + 1)); continue; }
    if (!r?.ok) return null;
    const rows = ((await r.json().catch(() => null))?.data ?? []).map((x) => [+x.price, +x.off_vol || 0]).filter(([p, v]) => p > 0 && v > 0);
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(rows)); return rows;
  }
  return null;
}
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const dayFiles = (sym) => fs.readdirSync(path.join(ROOT, '.cache', 'stock', sym)).filter((f) => /^\d{4}-\d\d-\d\d_\d{4}-\d\d-\d\d\.json$/.test(f));
function react(bars, L, pc) {
  const tz = L * 0.0005, mv = L * 0.003; let side = null, k0 = -1;
  for (let k = 5; k < bars.length - 30; k++) { const b = bars[k]; if (b.l <= L + tz && b.h >= L - tz) { side = bars[k - 1].c > L ? 'above' : 'below'; k0 = k; break; } }
  if (k0 < 0) return 'untouched';
  for (let k = k0; k < bars.length; k++) { const b = bars[k];
    if (side === 'above') { if (b.h >= L + mv) return 'reject'; if (b.c <= L - mv) return 'break'; } else { if (b.l <= L - mv) return 'reject'; if (b.c >= L + mv) return 'break'; } }
  return 'neither';
}
const tally = {}; const add = (k, r) => { (tally[k] ??= { n: 0, reject: 0, break: 0, neither: 0, untouched: 0 }); tally[k][r]++; if (r !== 'untouched') tally[k].n++; };
let days = 0;
for (const s of SYMS) {
  const daily = loadDaily(s); if (!daily.length) continue;
  const files = new Map(dayFiles(s).map((f) => [f.slice(0, 10), f]));
  const dates = daily.map((b) => b.d).filter((d) => d >= '2026-01-05' && d <= '2026-09-30' && files.has(d)).filter((_, i) => i % 3 === 0);
  for (const D of dates) {
    const i = daily.findIndex((b) => b.d === D); if (i < 1) continue; const prev = daily[i - 1], pcl = prev.c;
    const mf = path.join(ROOT, '.cache', 'bars', D, `${s}.json`); if (!fs.existsSync(mf)) continue;
    const bars = JSON.parse(fs.readFileSync(mf, 'utf8')); if (bars.length < 300) continue;
    const dp = await dpLevels(s, prev.d); if (!dp?.length) continue;
    const bucket = pcl * 0.0025, agg = new Map(); for (const [p, v] of dp) { if (Math.abs(p - pcl) / pcl > 0.03) continue; const k = Math.round(p / bucket); agg.set(k, (agg.get(k) ?? 0) + v); }
    const dpL = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k * bucket);
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, '.cache', 'stock', s, files.get(D)), 'utf8'));
    const nodes = raw?.strikes?.length ? majorNodes(normalizeBoard({ ...raw, symbol: s }), 0.08).filter((n) => n.skylitType === 'king' || n.skylitType === 'gatekeeper' || n.share >= 0.08).map((n) => n.strike).filter((x) => Math.abs(x - pcl) / pcl <= 0.03) : [];
    for (const L of dpL) { add('DP level', react(bars, L, pcl)); if (nodes.some((n) => Math.abs(n - L) / L <= 0.0015)) add('DP + node confluence', react(bars, L, pcl)); }
    for (const L of nodes) add('map node', react(bars, L, pcl));
    for (let k = 0; k < 3; k++) add('random level', react(bars, pcl * (1 + (rnd() * 2 - 1) * 0.03), pcl));
    days++;
  }
  console.error(`… ${s} done (${days} stock-days)`);
}
console.log(`dark-pool levels vs map nodes vs random · ${days} stock-days (35 stocks, every 3rd session Jan–Sep 2026)\n`);
for (const [k, t] of Object.entries(tally)) console.log(`  ${k.padEnd(22)} touched ${String(t.n).padStart(5)} · REJECT ${(t.reject / t.n * 100).toFixed(1).padStart(5)}% · break ${(t.break / t.n * 100).toFixed(1).padStart(5)}% · neither ${(t.neither / t.n * 100).toFixed(1).padStart(5)}% · untouched ${t.untouched}`);
const p = (k) => tally[k].reject / tally[k].n, se = (k) => Math.sqrt(p(k) * (1 - p(k)) / tally[k].n);
for (const k of ['DP level', 'map node', 'DP + node confluence']) if (tally[k]) console.log(`  ${k} vs random: ${((p(k) - p('random level')) * 100).toFixed(1)} pts (z ${((p(k) - p('random level')) / Math.sqrt(se(k) ** 2 + se('random level') ** 2)).toFixed(1)})`);
fs.writeFileSync(path.join(HERE, 'journal', 'dp_levels.json'), JSON.stringify(tally));
