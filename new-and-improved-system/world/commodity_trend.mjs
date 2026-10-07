#!/usr/bin/env node
// E2c commodity / freight / crypto trend sleeve (DESIGN_engines.md amendment 5). Textbook time-series momentum, not tuned:
// each month hold every asset with 12-month return > 0 AND price > its 200-day average, equal weight; cash otherwise.
// Universe = fixed category list, each asset entering once it has ≥ 13 months of (clean, NYSE-trading-day) prices.
//   node world/commodity_trend.mjs   (runs once; --force re-run)
import fs from 'node:fs';
import path from 'node:path';
import { isTradingDay } from './prices_clean.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), RES = path.join(ROOT, 'world', 'results_engines');
if (fs.existsSync(path.join(RES, 'commodity_trend.txt')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const rd = (f, d = []) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const LIST = ['GLD', 'SLV', 'PPLT', 'PALL', 'CPER', 'USO', 'BNO', 'UNG', 'UGA', 'DBA', 'CORN', 'WEAT', 'SOYB', 'CANE', 'DBC', 'URA', 'LIT', 'REMX', 'BDRY', 'BWET', 'BITO'];
const A = new Map(LIST.map((t) => [t, rd(path.join(C, 'commodity', `${t}.json`)).filter((x) => isTradingDay(x.d) && x.c > 0)]));
A.set('BTC', (rd(path.join(C, 'graph', 'fred.json'), {})?.CBBTCUSD?.obs ?? []).map((o) => ({ d: o.d, c: o.v })));
const at = (b, d) => { let lo = 0, hi = b.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (b[m].d <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const ME = []; for (let y = 2010, m = 12; `${y}-${String(m).padStart(2, '0')}` <= '2026-09'; m === 12 ? (y++, m = 1) : m++) ME.push(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10));
const rows = [];
for (let i = 0; i < ME.length - 1; i++) { const M = ME[i], N = ME[i + 1], live = [], on = [];
  for (const [t, b] of A) { const j = at(b, M), k = at(b, N); if (j < 0 || k <= j || b[0].d > addD(M, -395) || b[j].d < addD(M, -7)) continue; const j12 = at(b, addD(M, -365)); if (j12 < 0) continue;
    let ma = 0; const w = Math.min(200, j + 1); for (let q = j - w + 1; q <= j; q++) ma += b[q].c; const r = b[k].c / b[j].c - 1; live.push(r); if (b[j].c / b[j12].c - 1 > 0 && b[j].c > ma / w) on.push([t, r]); }
  if (live.length) rows.push({ M: N, strat: on.length ? mean(on.map((x) => x[1])) : 0, bench: mean(live), held: on.map((x) => x[0]), n: live.length }); }
const stat = (rs, k) => { const v = rs.map((r) => r[k]), eq = v.reduce((a, x) => [...a, a.at(-1) * (1 + x)], [1]); let pk = 1, dd = 0; for (const e of eq) { pk = Math.max(pk, e); dd = Math.max(dd, 1 - e / pk); }
  return { cagr: eq.at(-1) ** (12 / v.length) - 1, dd, sh: (mean(v) / (sd(v) || 1)) * Math.sqrt(12) }; };
const pc = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const L = ['# E2c commodity / freight / crypto trend sleeve\n', 'Rule: hold every asset whose 12-month return > 0 and price > 200-day average, equal weight, monthly; cash otherwise. Benchmark: equal-weight buy-and-hold of the same assets.\n',
  '| period | trend: yearly return | worst drawdown | Sharpe | buy & hold: yearly return | worst drawdown | Sharpe |', '|---|---|---|---|---|---|---|'];
for (const [n, a, b] of [['2011–2022 (build)', '2011-01', '2022-12'], ['2023–2026-09 (partly seen)', '2023-01', '2026-09']]) { const rs = rows.filter((r) => r.M.slice(0, 7) >= a && r.M.slice(0, 7) <= b), s = stat(rs, 'strat'), h = stat(rs, 'bench');
  L.push(`| ${n} | **${pc(s.cagr)}** | ${pc(-s.dd)} | ${s.sh.toFixed(2)} | ${pc(h.cagr)} | ${pc(-h.dd)} | ${h.sh.toFixed(2)} |`); }
L.push('\n## Year by year\n', '| year | trend | buy & hold | assets held most |', '|---|---|---|---|');
for (let y = 2011; y <= 2026; y++) { const rs = rows.filter((r) => r.M.startsWith(String(y))); if (!rs.length) continue; const c = new Map(); for (const r of rs) for (const t of r.held) c.set(t, (c.get(t) ?? 0) + 1);
  L.push(`| ${y} | ${pc(rs.reduce((p, r) => p * (1 + r.strat), 1) - 1)} | ${pc(rs.reduce((p, r) => p * (1 + r.bench), 1) - 1)} | ${[...c].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => `${t} (${n}m)`).join(', ')} |`); }
const txt = L.join('\n'); console.log(txt); fs.mkdirSync(RES, { recursive: true }); fs.writeFileSync(path.join(RES, 'commodity_trend.txt'), txt + '\n'); fs.writeFileSync(path.join(RES, 'commodity_trend.json'), JSON.stringify(rows));
