// FLOW CONFIRMATION (Falcon's FLOWSEEKER, from UW — Skylit has no flow API). After a setup fires, is the
// AGGRESSIVE (ask-side) options premium leaning WITH the trade? UW tags each print ask_side/bid_side +
// bullish/bearish. Lean = ask-side bullish − bearish premium over the last N min. Agree = confirm; against = veto.
// Usage: node flow_confirm.mjs [SPXW] [dir: long|short] [winMin]
import '../apps/gex/scripts/_env-bootstrap.js';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const TKR = process.argv[2] || 'SPXW', DIR = process.argv[3] || null, WIN = Number(process.argv[4] || 20);

async function trades() {
  for (const path of [`/api/option-trades?ticker_symbol=${TKR}&min_premium=25000&limit=500&order=executed_at&order_direction=desc`,
    `/api/stock/${TKR}/option-trades?min_premium=25000&limit=500`]) {
    const r = await fetch(`https://api.unusualwhales.com${path}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (r && r.ok) { const j = await r.json(); const arr = j.data || j.result || j.trades; if (Array.isArray(arr) && arr.length) return arr; }
  }
  return null;
}
const arr = await trades();
if (!arr) { console.log('no flow data (endpoint/params)'); process.exit(0); }
const cutoff = Date.now() - WIN * 60000;
let bull = 0, bear = 0, n = 0, cAsk = 0, pAsk = 0, sweeps = 0;
for (const x of arr) {
  const ts = new Date(x.executed_at).getTime(); if (ts < cutoff) continue;
  const tags = x.tags || []; if (!tags.includes('ask_side')) continue;               // aggressive only
  const prem = +x.premium || 0; n++;
  if (tags.includes('bullish')) bull += prem; else if (tags.includes('bearish')) bear += prem;
  if (x.option_type === 'call') cAsk += prem; else pAsk += prem;
  if ((x.report_flags || []).includes?.('sweep') || (x.rule_id)) sweeps++;
}
const lean = bull - bear, leanDir = lean > 0 ? 'long' : 'short';
console.log(`=== FLOW CONFIRM · ${TKR} · last ${WIN}min (aggressive/ask-side) ===`);
console.log(`  bullish $${(bull / 1e6).toFixed(1)}M  vs  bearish $${(bear / 1e6).toFixed(1)}M  →  LEAN ${lean >= 0 ? 'BULLISH +' : 'BEARISH '}$${(Math.abs(lean) / 1e6).toFixed(1)}M  (${n} aggressive prints)`);
console.log(`  call-side $${(cAsk / 1e6).toFixed(1)}M · put-side $${(pAsk / 1e6).toFixed(1)}M`);
if (DIR) console.log(`  >>> trade is ${DIR.toUpperCase()} → flow ${leanDir === DIR.toLowerCase() ? 'AGREES ✓ (confirm/size up)' : 'AGAINST ✗ (red-team veto / reduce)'}`);
else console.log(`  >>> flow favors ${leanDir.toUpperCase()} entries right now`);
