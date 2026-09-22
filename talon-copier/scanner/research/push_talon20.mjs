// push_talon20.mjs — take the top 20 from the UW bullish screener's ranked.csv and push them to the
// 'Talon-20' Skylit watchlist (so in Talon you type /watchlist and pick Talon-20). Idempotent:
// creates the watchlist if missing, else replaces its symbols. Read-only re Skylit except that one write.
import '../../../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../../apps/gex/src/heatseeker/auth.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RANKED = path.join(os.homedir(), '.claude/skills/uw-bullish-screener/output/ranked.csv');
const N = 20;
const B = 'https://app.skylit.ai';

// --- parse ranked.csv ---
const raw = fs.readFileSync(RANKED, 'utf8').trim().split('\n');
const cols = raw[0].split(',');
const ix = (name) => cols.indexOf(name);
const rows = raw.slice(1).map((line) => line.split(',')).filter((r) => r[0]);
const parsed = rows.map((r) => ({
  ticker: r[ix('ticker')],
  composite: parseFloat(r[ix('composite')]),
  sector: r[ix('sector')],
  tide: r[ix('sector_tide')],
  confluence: r[ix('confluence_flag')] === 'True',
  earnings: r[ix('earnings_flag')] === 'True',
  dominant: r[ix('dominant_signal')],
  share: parseFloat(r[ix('dominant_share')]),
})).sort((a, b) => b.composite - a.composite);

// prefer confluence=True (multi-signal), backfill with the rest if fewer than N
const conf = parsed.filter((p) => p.confluence);
const pick = (conf.length >= N ? conf : [...conf, ...parsed.filter((p) => !p.confluence)]).slice(0, N);
const symbols = pick.map((p) => p.ticker);

console.log(`ranked.csv: ${parsed.length} names · file mtime ${fs.statSync(RANKED).mtime.toISOString()}`);
console.log(`\nTOP ${N} (bullish 2-week, confluence-preferred):`);
pick.forEach((p, i) => console.log(`${String(i + 1).padStart(2)} ${p.ticker.padEnd(6)} ${p.composite.toFixed(1).padStart(5)}  ${p.sector.slice(0, 12).padEnd(12)} ${p.tide.padEnd(8)} ${p.earnings ? 'EARNINGS' : ''}`));

// --- push to Skylit ---
await initAuth();
const token = await getFreshToken();
const H = { Authorization: `Bearer ${token}`, Origin: B, Referer: B + '/', Accept: 'application/json', 'Content-Type': 'application/json' };

const list = await (await fetch(B + '/api/watchlists', { headers: H })).json();
let wl = (list.watchlists || []).find((w) => w.name === 'Talon-20');
let res;
if (wl) {
  res = await fetch(`${B}/api/watchlists/${wl.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ name: 'Talon-20', symbols }) });
} else {
  res = await fetch(`${B}/api/watchlists`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Talon-20', symbols }) });
}
console.log(`\n${wl ? 'PUT (update)' : 'POST (create)'} Talon-20 -> ${res.status}`);

// verify — poll for eventual consistency (writes can lag several seconds)
let now = null;
for (let attempt = 0; attempt < 6; attempt++) {
  await new Promise((r) => setTimeout(r, 2000));
  const after = await (await fetch(B + '/api/watchlists', { headers: H })).json();
  now = (after.watchlists || []).find((w) => w.name === 'Talon-20');
  if (now && now.symbols && now.symbols.length === symbols.length) break;
}
const ok = now && now.symbols && now.symbols.length === symbols.length;
console.log(`\n${ok ? '✅' : '⚠️'} Talon-20 now holds ${now?.symbols?.length ?? '?'} names:`);
console.log('   ' + (now?.symbols || []).join(' '));
console.log(`\nIn Talon: type /watchlist → pick "Talon-20" → run your scan.`);
