#!/usr/bin/env node
// DESIGN_king_break.md collector: Skylit SPX board at each prior 15:59 ET (5 credits) + SPY 1-minute bars after 2026-10-02.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UW_API_KEY } from '../feeds/env.js';
const SH = path.dirname(fileURLToPath(import.meta.url)), C = path.join(SH, '..', '.cache'), OUT = path.join(C, 'skylit_spx'); fs.mkdirSync(OUT, { recursive: true });
const k = await import('../feeds/skylit.js');
const spy = (await (await fetch('https://api.unusualwhales.com/api/stock/SPY/ohlc/1d?timeframe=6M', { headers: { Authorization: `Bearer ${UW_API_KEY}` } })).json()).data.filter((b) => b.market_time === 'r').map((b) => b.date).sort();
const days = spy.filter((d) => d >= '2026-07-08' && d <= '2026-10-16');
const etToUtc = (d) => { const off = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(d + 'T16:00:00Z')) - 16; return new Date(Date.parse(d + 'T15:59:00Z') - off * 3600e3).toISOString(); };
for (let i = 0; i < days.length; i++) { const d = days[i], prev = spy[spy.indexOf(d) - 1], f = path.join(OUT, `${d}.json`);
  if (!fs.existsSync(f)) { try { const r = await k.heatmapAt('SPX', etToUtc(prev), { metric: 'gamma' }); fs.writeFileSync(f, JSON.stringify({ d, prev, at: etToUtc(prev), spot: r[0].spot, strikes: r[0].strikes.map((s) => [s.strike, s.value, s.nodeType ?? '']) })); } catch (e) { console.error('skylit stop:', e.message.slice(0, 160)); break; } }
  const mf = path.join(C, 'uw', 'm1', 'SPY', `${d}.json`); if (d > '2026-10-02' && !fs.existsSync(mf)) { const m = await (await fetch(`https://api.unusualwhales.com/api/stock/SPY/ohlc/1m?date=${d}&limit=1000`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } })).json(); fs.writeFileSync(mf, JSON.stringify((m.data ?? []).map((x) => ({ t: Math.floor(Date.parse(x.start_time) / 1000), o: +x.open, h: +x.high, l: +x.low, c: +x.close, v: +x.volume, m: x.market_time })))); } }
console.error(`maps ${fs.readdirSync(OUT).length}/${days.length}, credits this run ${k.spend.process}`);
