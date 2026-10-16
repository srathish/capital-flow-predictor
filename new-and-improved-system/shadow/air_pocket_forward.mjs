#!/usr/bin/env node
// Forward paper ledger for GEX air-pocket node breaks (DESIGN_air_pocket.md; refinements frozen 2026-10-16 BEFORE any
// forward day): base rule (stop 0.05% behind node, target next node) + R1 longs only, R2 stop 0.15% behind node,
// R3 half off at the pocket midpoint then stop to breakeven, rest to the next node. AIR only (next node ≥ 0.40% away).
// Runs after the close: node shadow/air_pocket_forward.mjs [--date=YYYY-MM-DD]. Appends results_air_pocket/forward.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UW_API_KEY } from '../feeds/env.js';
const SH = path.dirname(fileURLToPath(import.meta.url)), R = path.join(SH, 'results_air_pocket'), F = path.join(R, 'forward.jsonl'), START = '2026-10-19';
const uw = async (p) => { const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); };
const etMin = (iso, d) => { const off = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(d + 'T16:00:00Z')) - 16; const t = new Date(iso); return ((t.getUTCHours() + off + 24) % 24) * 60 + t.getUTCMinutes(); };
function sim(B, i, dir, entry, stop, tgt, half) { const R0 = Math.abs(entry - stop); if (!(R0 > 0) || dir * (tgt - entry) < R0) return null; const cost = 0.02 / R0; let st = stop, booked = 0, size = 1;
  for (let j = i + 1; j < B.length && B[j].m < 955; j++) { const b = B[j];
    if (dir > 0 ? b.l <= st : b.h >= st) { const f = dir > 0 ? Math.min(st, b.o) : Math.max(st, b.o); return booked + size * dir * (f - entry) / R0 - cost; }
    if (half && size === 1 && (dir > 0 ? b.h >= half : b.l <= half)) { booked += 0.5 * dir * (half - entry) / R0; size = 0.5; st = entry; }
    if (dir > 0 ? b.h >= tgt : b.l <= tgt) return booked + size * dir * (tgt - entry) / R0 - cost; }
  const last = B.filter((b) => b.m < 955).at(-1); return booked + size * dir * (last.c - entry) / R0 - cost; }
const have = new Set(fs.existsSync(F) ? fs.readFileSync(F, 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return j.T + j.d; }) : []);
const want = process.argv.find((a) => a.startsWith('--date='))?.slice(7), test = process.argv.includes('--test');
for (const T of ['SPY', 'QQQ', 'IWM', 'DIA']) {
  const days = (await uw(`/stock/${T}/ohlc/1d?timeframe=1M`)).data.filter((b) => b.market_time === 'r').map((b) => ({ d: b.date, c: +b.close })).sort((a, b) => a.d.localeCompare(b.d));
  const k = want ? days.findIndex((x) => x.d === want) : days.length - 1; if (k < 1) continue; const d = days[k].d, p = days[k - 1]; if (!test && (have.has(T + d) || d < START)) continue;
  const g = (await uw(`/stock/${T}/greek-exposure/strike?date=${p.d}`)).data.map((r) => ({ k: +r.strike, g: +r.call_gex + +r.put_gex })).filter((x) => Math.abs(x.k / p.c - 1) <= 0.03); if (g.length < 5) continue;
  const king = Math.max(...g.map((x) => Math.abs(x.g))), nodes = g.filter((x) => Math.abs(x.g) >= 0.3 * king).map((x) => x.k);
  const B = (await uw(`/stock/${T}/ohlc/1m?date=${d}&limit=1000`)).data.filter((b) => b.market_time === 'r').map((b) => ({ m: etMin(b.start_time, d), o: +b.open, h: +b.high, l: +b.low, c: +b.close })).sort((a, b) => a.m - b.m);
  const trades = [], first = new Set();
  for (let i = 1; i < B.length; i++) { if (B[i].m < 585 || B[i].m > 900) continue; const pc = B[i - 1].c, c = B[i].c;
    for (const N of nodes) { const up = pc <= N && c > N, dn = pc >= N && c < N; if (!up && !dn) continue; const key = N + (up ? 'u' : 'd'); if (first.has(key)) continue; first.add(key); const dir = up ? 1 : -1;
      const N2 = nodes.filter((x) => (dir > 0 ? x > N : x < N)).sort((a, b) => dir * (a - b))[0]; if (N2 == null || Math.abs(N2 - N) / N < 0.004) continue; const tgt = N2 * (1 - dir * 0.0002);
      const base = sim(B, i, dir, c, N * (1 - dir * 0.0005), tgt), r2 = sim(B, i, dir, c, N * (1 - dir * 0.0015), tgt), r3 = sim(B, i, dir, c, N * (1 - dir * 0.0005), tgt, (N + N2) / 2);
      trades.push({ min: B[i].m, dir, N, N2, base, r1: dir > 0 ? base : null, r2, r3 }); } }
  const row = { T, d, nodes: nodes.length, trades }; if (test) { console.log(JSON.stringify(row)); continue; } fs.appendFileSync(F, JSON.stringify(row) + '\n'); }
// summary
const rows = fs.existsSync(F) ? fs.readFileSync(F, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [], all = rows.flatMap((r) => r.trades.map((t) => ({ ...t, T: r.T, d: r.d })));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), line = (k, lab) => { const v = all.map((t) => t[k]).filter((x) => x != null); return `| ${lab} | ${v.length} | ${v.length ? (mean(v) >= 0 ? '+' : '') + mean(v).toFixed(3) + 'R' : '—'} | ${v.length ? Math.round(100 * v.filter((x) => x > 0).length / v.length) + '%' : '—'} | ${v.length ? v.reduce((s, x) => s + x, 0).toFixed(2) + 'R' : '—'} |`; };
if (!test) fs.writeFileSync(path.join(R, 'forward.md'), ['# Forward ledger — GEX air-pocket node breaks (rules frozen 2026-10-16; days from 2026-10-19)\n', 'Backtest holdout reference: base +0.044R/trade (8% reach next node); AIR beat CROWD by +0.27R and beat 19/20 random-level twins.\n',
  '| rule | trades | mean | win | total |', '|---|---|---|---|---|', line('base', 'base (stop 0.05% behind node, target next node)'), line('r1', 'R1 longs only'), line('r2', 'R2 stop 0.15% behind node'), line('r3', 'R3 half off at pocket midpoint, then breakeven stop'), `\nDays logged: ${new Set(rows.map((r) => r.d)).size}`].join('\n') + '\n');
console.error(`forward rows ${rows.length}`);
