#!/usr/bin/env node
// Short stock factory universe (DESIGN_stock_factory amendment 2): the 300 stocks with the highest 50-day RAW dollar
// volume as of 2023-10-31 (raw price = adjusted price × later split factor; volume taken on its raw basis — UW volume is
// split-adjusted for some tickers and not others, detected by a volume jump of ~the split ratio across the split).
// Commodity / fund trusts (SIC 6221, 6722, 6726) excluded. Writes .cache/uwgreeks_w/tickers.json (old list kept as tickers_v1.json).
import fs from 'node:fs';
import path from 'node:path';
import { universeV2, loadW } from '../world/universe_prices.mjs';
import { splitEvents, adjustedBars, factorAt } from './weekly_basis.mjs';

const NIS = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(NIS, '.cache'), GW = path.join(C, 'uwgreeks_w'), AT = '2023-10-31';
const SIC = (t) => { try { return String(JSON.parse(fs.readFileSync(path.join(C, 'edgar', 'sic', `${t}.json`), 'utf8')).sic ?? '').padStart(4, '0'); } catch { return ''; } };
const FUNDS = new Set(['6221', '6722', '6726']), med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const rows = [];
for (const { t } of universeV2(1e9)) { if (FUNDS.has(SIC(t))) continue; const raw = loadW(t); if (raw.filter((b) => b.d <= AT).length < 120) continue;
  const { ev } = splitEvents(C, t, raw), bars = adjustedBars(raw, ev), L = bars.filter((b) => b.d <= AT).slice(-50); if (L.at(-1).d < '2023-10-24') continue;
  // volume basis for SEC-only events (price already adjusted): if volume jumps by ~ratio across the split it is raw (unadjusted)
  let volRaw = true; for (const e of ev.filter((x) => x.kind === 'sec' && x.after > AT)) { const pre = bars.filter((b) => b.d < e.after).slice(-60).map((b) => b.v), post = bars.filter((b) => b.d > e.at).slice(0, 60).map((b) => b.v);
    if (pre.length > 20 && post.length > 20) { const r = med(post) / med(pre); volRaw = Math.abs(Math.log(r / e.q)) < Math.abs(Math.log(r)); } }
  const dv = L.reduce((s, b) => { const f = factorAt(ev, b.d) ?? 1; return s + b.c * f * (volRaw ? b.v : b.v / f); }, 0) / L.length;
  rows.push([t, dv]); }
rows.sort((a, b) => b[1] - a[1]); const list = rows.slice(0, 300).map((r) => r[0]);
const f = path.join(GW, 'tickers.json'), old = JSON.parse(fs.readFileSync(f, 'utf8')); if (!fs.existsSync(path.join(GW, 'tickers_v1.json'))) fs.writeFileSync(path.join(GW, 'tickers_v1.json'), JSON.stringify(old));
fs.writeFileSync(f, JSON.stringify(list));
console.log(`new list ${list.length}; added ${list.filter((t) => !old.includes(t)).join(' ')}; removed ${old.filter((t) => !list.includes(t)).join(' ')}`);
