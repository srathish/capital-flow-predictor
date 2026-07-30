// READINESS CHECK — go/no-go for a live session. Verifies every data source (Skylit GEX/VEX for SPX/SPY/QQQ,
// Skylit dark-pool + tide, UW option quotes), the agent brain (Anthropic), and the files. Run before the open:
//   ENV_FILE=apps/gex/research/stock-gex/session-b.env DATABASE_URL= node falcon-copier/readiness.mjs
import '../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../apps/gex/src/heatseeker/auth.js';
import fs from 'node:fs'; import path from 'node:path';
const FC = path.join(process.cwd(), 'falcon-copier');
const UWKEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY, AKEY = process.env.ANTHROPIC_API_KEY;
const R = []; const add = (ok, name, note = '') => R.push({ ok, name, note });
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

let token = null;
try { await initAuth(); token = await getFreshToken(); add(!!token, 'Skylit auth (Clerk JWT)', token ? 'live' : 'no token'); } catch (e) { add(false, 'Skylit auth (Clerk JWT)', e.message.slice(0, 60)); }
const skGet = async (p) => { const t = await getFreshToken(); const r = await fetch('https://app.skylit.ai' + p, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: 'Bearer ' + t, Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(12000) }); return { status: r.status, json: r.ok ? await r.json().catch(() => null) : null }; };
let spx = null;
if (token) for (const sym of ['SPXW', 'SPY', 'QQQ']) {
  try { const { status, json } = await skGet(`/api/data?symbol=${sym}&max_strikes=50&max_expirations=5&nocache=${Math.random()}`); const ok = json && json.CurrentSpot != null && (json.Strikes || []).length > 0; if (sym === 'SPXW' && ok) spx = json.CurrentSpot; add(ok, `Skylit GEX/VEX · ${sym}`, ok ? `spot ${json.CurrentSpot} · ${json.Strikes.length} strikes` : `HTTP ${status}`); } catch (e) { add(false, `Skylit GEX/VEX · ${sym}`, e.message.slice(0, 40)); }
}
if (token) {
  try { const { status, json } = await skGet('/fs/api/dark-pool/trades?min_notional=1000000&limit=5&order=desc'); const arr = json?.data || json || []; add(Array.isArray(arr) && arr.length > 0, 'Skylit dark-pool · /fs/api/dark-pool/trades', arr.length ? `${arr.length} recent prints` : `HTTP ${status}`); } catch (e) { add(false, 'Skylit dark-pool', e.message.slice(0, 40)); }
  try { const { status, json } = await skGet('/fs/api/market/tide?interval=1D&bucket=1min'); const bars = json?.data?.bars || []; add(bars.length > 0, 'Skylit flow lean · /fs/api/market/tide', bars.length ? `${bars.length} 1-min bars` : `HTTP ${status}`); } catch (e) { add(false, 'Skylit flow lean', e.message.slice(0, 40)); }
}
// UW reachable (0DTE option quotes for the entry premium — live during RTH)
try { const r = await fetch('https://api.unusualwhales.com/api/stock/SPY/stock-volume-price-levels', { headers: { Authorization: 'Bearer ' + UWKEY }, signal: AbortSignal.timeout(10000) }); add(!!UWKEY && r.status !== 401 && r.status !== 403, 'UW reachable (option-premium quotes)', UWKEY ? `HTTP ${r.status} · 0DTE quotes fill during RTH` : 'no UW key'); } catch (e) { add(false, 'UW reachable', e.message.slice(0, 40)); }
// Anthropic (the agent's brain)
try { const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': AKEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: process.env.AGENT_MODEL || 'claude-sonnet-5', max_tokens: 8, messages: [{ role: 'user', content: 'ok' }] }) }); add(r.status === 200, 'Anthropic API (agent reasoning)', `HTTP ${r.status}`); } catch (e) { add(false, 'Anthropic API', e.message.slice(0, 40)); }
// files present
for (const f of ['agent.mjs', 'dashboard.mjs', 'go.sh', 'preflight.mjs', 'run_precheck.sh']) add(fs.existsSync(path.join(FC, f)), `file · ${f}`);

console.log('\n═══ FALCON-COPIER READINESS ═══');
for (const r of R) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.note ? '  —  ' + r.note : ''}`);
const pass = R.filter(r => r.ok).length;
console.log(`\n  ${pass}/${R.length}  ${pass === R.length ? '✓✓ READY — bash falcon-copier/go.sh at the open' : '✗ NOT READY — fix the ✗ above (Skylit auth? re-login)'}`);
process.exit(pass === R.length ? 0 : 1);
