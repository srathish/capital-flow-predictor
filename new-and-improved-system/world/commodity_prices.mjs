#!/usr/bin/env node
// Engines E2b: commodity / crypto price nodes — UW daily bars 2009-10 → now for commodity ETFs → .cache/commodity/<T>.json. UW quota only.
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';
const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), OUT = path.join(ROOT, '.cache', 'commodity');
export const COMMODITIES = { GLD: 'gold', SLV: 'silver', CPER: 'copper', URA: 'uranium', USO: 'oil', UNG: 'natural gas', LIT: 'lithium', REMX: 'rare earths', GDX: 'gold miners', SIL: 'silver miners', COPX: 'copper miners',
  PPLT: 'platinum', PALL: 'palladium', BNO: 'Brent oil', UGA: 'gasoline', DBA: 'agriculture', CORN: 'corn', WEAT: 'wheat', SOYB: 'soybeans', CANE: 'sugar', DBC: 'commodity index', BDRY: 'dry bulk freight', BWET: 'tanker freight', BITO: 'bitcoin futures' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function uw(p) { for (let k = 0; k < 6; k++) { await sleep(150); const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
  if (r?.status === 429) { const b = await r.text().catch(() => ''); if (b.includes('daily_request_limit_hit')) { console.error('UW daily limit — stopping'); process.exit(3); } await sleep(8000 * (k + 1)); continue; } return r?.ok ? r.json().catch(() => null) : null; } return null; }
fs.mkdirSync(OUT, { recursive: true });
for (const t of Object.keys(COMMODITIES)) { if (fs.existsSync(path.join(OUT, `${t}.json`)) && !process.argv.includes('--refresh')) continue; const m = new Map();
  for (let y = 2026; y >= 2010; y--) { const j = await uw(`/stock/${t}/ohlc/1d?end_date=${y}-10-03&limit=2500`); const d = j?.data ?? []; for (const b of d) if (b.market_time === 'r') m.set(b.date, { d: b.date, c: +b.close }); if (!d.length) break; }
  const bars = [...m.values()].sort((a, b) => a.d.localeCompare(b.d)); fs.writeFileSync(path.join(OUT, `${t}.json`), JSON.stringify(bars)); console.error(`${t} ${COMMODITIES[t]}: ${bars.length} bars ${bars[0]?.d ?? ''} → ${bars.at(-1)?.d ?? ''}`); }
