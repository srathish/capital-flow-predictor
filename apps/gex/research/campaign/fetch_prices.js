/**
 * Fetch current option prices (latest daily bar: mid/bid/ask/IV) for every
 * contract in play_candidates.json + the watchlist. Writes play_prices.json.
 * Used by the live Atlas server on each refresh. Paced, 429-aware.
 */
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
if (!KEY) { console.error('no UW key'); process.exit(1); }

const cand = JSON.parse(fs.readFileSync(path.join(__dirname, 'play_candidates.json'), 'utf-8'));
const occs = [
  ...cand.plays.map(p => ({ occ: p.occ, tk: p.ticker })),
  ...Object.values(cand.watch).filter(w => w.occ).map(w => ({ occ: w.occ, tk: w.ticker })),
];

const SPACING = 550;
let last = 0, backoff = 0;
async function px(occ) {
  for (;;) {
    const wait = Math.max(0, last + SPACING - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    let r;
    try {
      r = await fetch(`https://api.unusualwhales.com/api/option-contract/${occ}/historic`,
        { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15_000) });
    } catch { return null; }
    if (r.status === 429) { backoff = backoff ? Math.min(backoff * 2, 60_000) : 10_000; await new Promise(rr => setTimeout(rr, backoff)); continue; }
    backoff = 0;
    if (!r.ok) return null;
    const rows = (await r.json()).chains || [];
    if (!rows.length) return null;
    rows.sort((a, b) => a.date < b.date ? 1 : -1);
    const l = rows[0];
    return { date: l.date, mid: parseFloat(l.avg_price || l.last_price || 0),
      bid: parseFloat(l.nbbo_bid || 0), ask: parseFloat(l.nbbo_ask || 0),
      iv: parseFloat(l.implied_volatility || 0) };
  }
}

const out = {};
for (const { occ } of occs) out[occ] = await px(occ);
fs.writeFileSync(path.join(__dirname, 'play_prices.json'), JSON.stringify(out));
console.log(`priced ${Object.keys(out).length} contracts`);
