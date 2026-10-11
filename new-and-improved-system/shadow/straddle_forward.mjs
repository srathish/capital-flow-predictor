#!/usr/bin/env node
// Forward paper test of the premium-selling filter (shadow/DESIGN_real_straddle.md; frozen 2026-10-11). Runs after the
// close (launchd com.srathish.straddlefwd, weekdays 21:40 ET). For SPY and QQQ, for today's session d:
//   filter (from d−1's close): ±1% gamma balance ≥ build top-third threshold AND close above its 20-day average AND
//   ln(VIX1D ÷ VIX9D) < build median;  trade: sell the ATM 0DTE straddle at the 09:35 one-minute close − $0.01/leg, settle
//   at d's close. Appends one row per symbol-day to results_real_straddle/forward.jsonl and rewrites forward.md.
// Thresholds frozen from the build period: SPY a01 ≥ 0.6560, QQQ a01 ≥ 0.7562, event < −0.1530 (both).
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), NIS = path.join(SH, '..'), C = path.join(NIS, '.cache'), R = path.join(SH, 'results_real_straddle');
const TH = { SPY: 0.655983927441445, QQQ: 0.7562330965688158 }, EV = -0.15301081876687586;
const uw = async (p) => { const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); };
const cboe = async (x) => { const t = await (await fetch(`https://cdn.cboe.com/api/global/us_indices/daily_prices/${x}_History.csv`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text(); const o = {}; for (const l of t.trim().split('\n').slice(1)) { const [d, , , , c] = l.split(','); const [m, dd, y] = d.split('/'); o[`${y}-${m}-${dd}`] = +c; } return o; };
const etMin = (iso, d) => { const off = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(d + 'T16:00:00Z')) - 16; const t = new Date(iso); return ((t.getUTCHours() + off + 24) % 24) * 60 + t.getUTCMinutes(); };
const occ = (T, d, cp, k) => `${T}${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}${cp}${String(Math.round(k * 1000)).padStart(8, '0')}`;
const [V1, V9] = [await cboe('VIX1D'), await cboe('VIX9D')]; const F = path.join(R, 'forward.jsonl'), have = new Set(fs.existsSync(F) ? fs.readFileSync(F, 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return j.T + j.d; }) : []);
for (const T of ['SPY', 'QQQ']) {
  const bars = (await uw(`/stock/${T}/ohlc/1d?timeframe=3M`)).data.filter((b) => b.market_time === 'r').map((b) => ({ d: b.date, c: +b.close })).sort((a, b) => a.d.localeCompare(b.d));
  const d = bars.at(-1).d, p = bars.at(-2); if (have.has(T + d) || d < '2026-10-12') continue;
  const g = (await uw(`/stock/${T}/greek-exposure/strike?date=${p.d}`)).data; let A = 0, N = 0; for (const r of g) { const k = +r.strike, x = +r.call_gex + +r.put_gex; if (Math.abs(k / p.c - 1) <= 0.01) { A += Math.abs(x); N += x; } }
  const a01 = A > 0 ? N / A : NaN, ma20 = bars.slice(-21, -1).reduce((s, b) => s + b.c / 20, 0), ev = V1[p.d] && V9[p.d] ? Math.log(V1[p.d] / V9[p.d]) : NaN;
  const filt = Number.isFinite(a01) && Number.isFinite(ev) ? +(a01 >= TH[T] && p.c > ma20 && ev < EV) : null;
  const m1 = (await uw(`/stock/${T}/ohlc/1m?date=${d}&limit=1000`)).data.filter((b) => b.market_time === 'r').map((b) => ({ m: etMin(b.start_time, d), c: +b.close })).sort((a, b) => a.m - b.m);
  const px = m1.find((b) => b.m >= 574)?.c; if (!px) continue; const k = Math.round(px), legs = {};
  for (const cp of ['C', 'P']) { const rows = ((await uw(`/option-contract/${occ(T, d, cp, k)}/intraday?date=${d}`)).data ?? []).map((r) => ({ m: etMin(r.start_time, d), c: +r.close })).filter((r) => r.m >= 574 && r.m <= 579).sort((a, b) => a.m - b.m); legs[cp] = rows[0]?.c; }
  if (!(legs.C > 0.02 && legs.P > 0.02)) continue; const prem = legs.C + legs.P - 0.02, close = bars.at(-1).c, pnl = prem - Math.abs(close - k);
  fs.appendFileSync(F, JSON.stringify({ T, d, filter: filt, a01: +a01.toFixed(3), aboveMA20: p.c > ma20, event: +ev.toFixed(3), strike: k, premium: +prem.toFixed(2), close, pnl: +pnl.toFixed(2), ratio: +(pnl / prem).toFixed(3) }) + '\n'); }
const rows = fs.existsSync(F) ? fs.readFileSync(F, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [], mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const line = (name, a) => `| ${name} | ${a.length} | ${a.length ? mean(a.map((x) => x.pnl)).toFixed(2) : '—'} | ${a.length ? (mean(a.map((x) => x.ratio)) * 100).toFixed(1) + '%' : '—'} | ${a.length ? Math.round(100 * a.filter((x) => x.pnl > 0).length / a.length) + '%' : '—'} | ${a.length ? Math.min(...a.map((x) => x.pnl)).toFixed(2) : '—'} |`;
fs.writeFileSync(path.join(R, 'forward.md'), ['# Forward paper test — 0DTE straddle selling filter (frozen 2026-10-11, started 2026-10-12)\n', 'Holdout reference: filter days +$0.56 / straddle (+17% of premium, win 68%, worst −$6.89); other days +$0.18 (+6%, worst −$38.36).\n',
  '| sample | days | mean $ / straddle | mean % of premium | win | worst $ |', '|---|---|---|---|---|---|', line('filter days', rows.filter((x) => x.filter === 1)), line('other days', rows.filter((x) => x.filter === 0)), line('all', rows),
  '\n| date | symbol | filter | premium | close vs strike | P&L $ |', '|---|---|---|---|---|---|', ...rows.slice().reverse().slice(0, 60).map((x) => `| ${x.d} | ${x.T} | ${x.filter ? 'yes' : 'no'} | ${x.premium} | ${(x.close - x.strike).toFixed(2)} | ${x.pnl} |`)].join('\n') + '\n');
console.error(`forward rows: ${rows.length}`);
