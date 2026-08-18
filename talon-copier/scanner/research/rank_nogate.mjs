// rank_nogate.mjs — "what if we ranked ONLY on GEX/VEX, no flow gate, as of Aug 16?"
// Pulls the Aug-14 EOD structure (last session before the Sunday watchlist — no look-ahead) for our
// Talon names + the blow-ups, and asks Sonnet to rank the TOP 10 on PURE structure. No flow, no ask-side.
import { loadConfig, loadEnvKeysFrom, resolveFromRoot, log } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['ANTHROPIC_API_KEY', 'UNUSUAL_WHALES_API_KEY']);
const { GexProvider } = await import('../providers/gex-skylit.mjs');
const cfg = loadConfig();
const gex = new GexProvider({ maxStrikes: cfg.ingest.max_strikes, maxExpirations: cfg.ingest.max_expirations, eodHHMM: cfg.ingest.skylit_eod_hhmm });
try { await gex.init(); } catch (e) { console.log('AUTH-FAIL', e.message); process.exit(2); }
const AKEY = process.env.ANTHROPIC_API_KEY;
const ASOF = '2026-08-14';
const REF = Date.parse(ASOF + 'T20:00:00Z');
const M = (x) => Math.round(x / 1e6 * 100) / 100;
const pct = (k, s) => Math.round((k - s) / s * 1000) / 10;
const daysTo = (E) => Math.round((Date.parse(E) - REF) / 864e5);
async function sonnet(system, user, maxTok = 16000) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': AKEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: maxTok, system, messages: [{ role: 'user', content: user }] }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return (j.content || []).map((c) => c.text).filter(Boolean).join('');
}
function matrix(p) {
  const S = p.strikes, exps = (p.expirations || []).slice(0, 6), out = [`spot ${p.spot.toFixed(2)}`];
  for (const E of exps) {
    const g = S.map((s) => ({ k: s.strike, v: s.perExpiry?.[E] || 0 })).filter((x) => x.v).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 5);
    const v = S.map((s) => ({ k: s.strike, v: s.perExpiryVanna?.[E] || 0 })).filter((x) => x.v).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 5);
    if (!g.length && !v.length) continue;
    const f = (n) => `${n.k}${n.v >= 0 ? '+' : ''}${M(n.v)}(${pct(n.k, p.spot)}%)`;
    out.push(`  ${E} ${String(daysTo(E)).padStart(3)}d| G ${g.map(f).join(' ') || '—'} | V ${v.map(f).join(' ') || '—'}`);
  }
  return out.join('\n');
}
const NAMES = 'MU NVDA PLTR MRVL WDC TSM ORCL META MSFT HOOD PYPL MARA NKE DIS HD GDX XBI HAL VST IONQ RGTI ON DRAM BMNR SMH'.split(' ');
const blocks = [];
for (const t of NAMES) {
  try { const p = await gex.getProfile(t, { date: ASOF }); if (p) blocks.push(`### ${t}\n${matrix(p)}`); else log(`${t}: no ${ASOF} structure`); }
  catch (e) { if (e.message === 'AUTH') { log('AUTH died'); break; } log(`${t}: ${e.message}`); }
}
log(`\nPulled ${blocks.length}/${NAMES.length} names' ${ASOF} structure. Ranking on PURE GEX/VEX (NO flow gate)…\n`);
const SYS = `You are a single-name GEX/VEX swing analyst ranking stocks for a buy-this-week swing off the ${ASOF} Skylit structure (the LAST session before a Sunday watchlist). Rank by BULLISH STRUCTURE ONLY — you have NO options-flow / ask-side data and must NOT invent any; judge purely on the gamma/vanna maps.
Single-name hierarchy: (1) SQUEEZE — negative gamma (barney) above spot NEAR price = dealers must chase up = the biggest single-name move; weight it highest. (2) VANNA magnet above spot = melt-up target, but magnets FAR above tend to OVERSHOOT the realistic move, so weight NEAR magnets more than distant ones. (3) PINNING — positive-gamma floor below + air pocket above = support to lean on (secondary on single names). Per matrix: G=gamma$M, V=vanna$M, %=distance from spot; the expiry holding the real SIZE drives hedging, not a thin near-dated strike.
Output a RANKED TOP 10. For each: "N. TICKER — one-line structural thesis (king node, squeeze, nearest magnet, key %s)". End with exactly: "TOP10: t1,t2,...,t10". Be decisive; pure structure only.`;
const read = await sonnet(SYS, blocks.join('\n\n'));
log(read);
