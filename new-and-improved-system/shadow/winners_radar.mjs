#!/usr/bin/env node
// Winners radar (from the weekly-winners study, 2026-10-15/16): the validated part is NARROWING — the top 10 by 20-day
// realized volatility held 46% of each week's top/bottom-10% movers (base 10%). For each radar name: UW dealer gamma /
// vanna nodes above and below (the likely target each way), recent flow lean, and Skylit levels (1 credit each, optional).
// Direction is NOT predicted (no tested signal does that); the radar gives the shortlist + both-way targets.
//   node shadow/winners_radar.mjs [--n=10] [--skylit]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UW_API_KEY } from '../feeds/env.js';
const SH = path.dirname(fileURLToPath(import.meta.url)), W = path.join(SH, '..', '.cache', 'winners'), N = +(process.argv.find((a) => a.startsWith('--n='))?.slice(4) ?? 10);
const ETF = new Set(['SPY', 'QQQ', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB', 'XLRE', 'XLC', 'SMH', 'IGV']);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const uw = async (p) => { await new Promise((r) => setTimeout(r, 120)); const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }); return r.ok ? r.json() : null; };
const rows = []; for (const f of fs.readdirSync(W)) { if (!f.endsWith('.json') || f.startsWith('_')) continue; const t = f.replace('.json', ''); if (ETF.has(t)) continue;
  const j = JSON.parse(fs.readFileSync(path.join(W, f), 'utf8')), o = j.ohlc.slice().sort((a, b) => a.d.localeCompare(b.d)); if (o.length < 30) continue; const lr = []; for (let i = o.length - 20; i < o.length; i++) lr.push(Math.log(o[i].c / o[i - 1].c));
  rows.push({ t, d: o.at(-1).d, c: o.at(-1).c, rv: sd(lr) * Math.sqrt(252), w1: o.at(-1).c / o.at(-6).c - 1 }); }
rows.sort((a, b) => b.rv - a.rv); const pick = rows.slice(0, N), asOf = pick[0].d; let SK = null;
if (process.argv.includes('--skylit')) { const k = await import('../feeds/skylit.js'); SK = new Map((await k.levelsLive(pick.map((x) => x.t))).map((s) => [s.symbol, s])); }
const out = [`# Winners radar — as of ${asOf} close (for the next session/week)`, '', 'Shortlist = top 10 by 20-day realized volatility: historically ~46% of each week\'s biggest winners AND losers come from this list (vs 10% by chance). Direction is your call — no tested signal predicts it. Targets: the largest positive-gamma / vanna strikes above and below (UW, as of the close).', '',
  '| stock | close | 20d vol | 1-week | upside target (gamma · vanna) | downside target (gamma · vanna) | expected 1-week move (±1 sd) | flow lean (last session) |' + (SK ? ' Skylit king / flip |' : ''), '|---|---|---|---|---|---|---|---|' + (SK ? '---|' : '')];
for (const p of pick) { const g = await uw(`/stock/${p.t}/greek-exposure/strike?date=${asOf}`), v = await uw(`/stock/${p.t}/options-volume?limit=1`);
  const s = (g?.data ?? []).map((r) => ({ k: +r.strike, g: +r.call_gex + +r.put_gex, v: +r.call_vanna + +r.put_vanna })).filter((r) => Math.abs(r.k / p.c - 1) <= 0.15);
  const best = (a, key) => (a.length ? a.reduce((x, y) => (y[key] > x[key] ? y : x)).k : '—'), up = s.filter((r) => r.k > p.c * 1.01), dn = s.filter((r) => r.k < p.c * 0.99);
  const f = v?.data?.[0], lean = f ? (+f.net_call_premium - +f.net_put_premium) : NaN, mv = p.rv / Math.sqrt(52) * p.c;
  const sk = SK?.get(p.t); out.push(`| ${p.t} | ${p.c.toFixed(2)} | ${(p.rv * 100).toFixed(0)}% | ${(p.w1 * 100).toFixed(1)}% | ${best(up, 'g')} · ${best(up, 'v')} | ${best(dn, 'g')} · ${best(dn, 'v')} | ±$${mv.toFixed(2)} (${(p.c - mv).toFixed(0)}–${(p.c + mv).toFixed(0)}) | ${Number.isFinite(lean) ? (lean >= 0 ? '+' : '−') + '$' + (Math.abs(lean) / 1e6).toFixed(1) + 'M ' + (lean >= 0 ? 'calls' : 'puts') : '—'} |` + (SK ? ` ${sk?.summary?.king ?? sk?.king ?? '—'} / ${sk?.summary?.flip ?? sk?.flip ?? '—'} |` : '')); }
out.push('', 'How to use: pick direction from your own read (catalyst, sector, Startup indicators); take the target on that side; size the stop from the expected move; confirm with fresh opening flow at the target strike. Do not buy both sides blindly — brackets lose to whipsaw (tested).');
fs.mkdirSync(path.join(SH, 'results_winners'), { recursive: true }); fs.writeFileSync(path.join(SH, 'results_winners', `radar_${asOf}.md`), out.join('\n') + '\n'); console.log(out.join('\n'));
