#!/usr/bin/env node
// uw-research.mjs — the "UW Terminal" research battery over the PUBLIC API.
// Fires the whole command set for one ticker in parallel, distills it to a compact
// evidence block, and (unless --raw) has Sonnet write the single-name options-pick dossier.
//
//   node research/uw-research.mjs <TICKER> [--raw]
//
// HARD RULE (same as the rest of the repo): UW is FLOW / PRICE / OI / IV / earnings only.
// The greek-exposure here is UW's *dealer-gamma* read, surfaced as CONTEXT — it is NOT the
// Skylit GEX/VEX doctrine (that comes from Skylit via the surface-json bridge). Labeled as such.
import { loadEnvKeysFrom, resolveFromRoot, fetchJson, log } from '../lib/util.mjs';

loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY', 'ANTHROPIC_API_KEY']);
const KEY = process.env.UNUSUAL_WHALES_API_KEY;
const AKEY = process.env.ANTHROPIC_API_KEY;
const BASE = 'https://api.unusualwhales.com/api/';

const TICKER = (process.argv[2] || '').toUpperCase();
const RAW = process.argv.includes('--raw');
if (!TICKER || TICKER.startsWith('--')) { console.error('usage: node research/uw-research.mjs <TICKER> [--raw]'); process.exit(1); }
if (!KEY) { console.error('missing UNUSUAL_WHALES_API_KEY (repo-root .env)'); process.exit(1); }

const num = (x) => (x == null || x === '' ? null : (Number.isFinite(+x) ? +x : null));
const rows = (j) => (Array.isArray(j) ? j : (j && (j.data || j.result || j.chains || j.states)) || []);
const pct = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%');
const $ = (x) => (x == null ? '—' : '$' + (+x).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const m$ = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + '$' + (Math.abs(x) / 1e6).toFixed(1) + 'M');
const T = encodeURIComponent(TICKER);

const uw = (path) => fetchJson(BASE + path, { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' }, timeoutMs: 15000, retries: 2 }).catch(() => null);

// ---- fire the whole battery in parallel -------------------------------------------------
const [ohlcJ, ivJ, ovJ, alertsJ, darkJ, mpJ, gexJ, ernJ, anJ, insJ] = await Promise.all([
  uw(`stock/${T}/ohlc/1d?limit=180`),           // price / OHLC candles (trend)
  uw(`stock/${T}/iv-rank?limit=5`),             // IV rank (iv_rank_1y) + realized vol
  uw(`stock/${T}/options-volume?limit=10`),     // net premium + ask/bid + bull/bear premium + OI
  uw(`stock/${T}/flow-alerts?limit=40`),        // unusual-activity rule hits
  uw(`darkpool/${T}?limit=15`),                 // block prints
  uw(`stock/${T}/max-pain`),                    // pin levels per expiry
  uw(`stock/${T}/greek-exposure/strike`),       // UW dealer-gamma by strike (CONTEXT, not Skylit)
  uw(`earnings/${T}`),                          // earnings dates + expected move
  uw(`screener/analysts?ticker=${T}`),          // broker ratings + targets
  uw(`insider/${T}`),                           // insiders (roster)
]);

// ---- distill -----------------------------------------------------------------------------
const ohlc = rows(ohlcJ).filter((r) => r.market_time == null || r.market_time === 'r')
  .map((r) => ({ ...r, date: String(r.date || r.market_date || '').slice(0, 10), close: num(r.close) }))
  .filter((r) => r.date && r.close != null);
const seen = new Set(); const px = [];
for (const r of ohlc) if (!seen.has(r.date)) { seen.add(r.date); px.push(r); }
px.sort((a, b) => (a.date < b.date ? -1 : 1));
if (!px.length) { console.error(`no price data for ${TICKER} — check the symbol / API key`); process.exit(1); }

const last = px[px.length - 1];
const ago = (n) => (px.length > n ? px[px.length - 1 - n] : null);
const chg = (n) => { const p = ago(n); return p && p.close ? last.close / p.close - 1 : null; };
const hi20 = Math.max(...px.slice(-20).map((r) => num(r.high) ?? r.close));
const lo20 = Math.min(...px.slice(-20).map((r) => num(r.low) ?? r.close));

// earnings: next date + approx close-to-close reactions around the last few reports
const ernRows = rows(ernJ);
const today = last.date;
const ernDates = ernRows.map((e) => String(e.report_date || e.date || '').slice(0, 10)).filter(Boolean).sort();
const nextErn = ernDates.find((d) => d >= today) || null;
const nextErnRow = ernRows.find((e) => String(e.report_date || e.date || '').slice(0, 10) === nextErn) || {};
const reactions = ernDates.filter((d) => d < today).slice(-4).map((d) => {
  const i = px.findIndex((r) => r.date >= d); if (i < 1) return null;
  const a = px[i - 1]?.close, b = px[i]?.close, c = px[i + 1]?.close; if (!a) return null;
  const r1 = b ? b / a - 1 : 0, r2 = (b && c) ? c / b - 1 : 0;           // pre- vs post-market timing
  return Math.abs(r2) > Math.abs(r1) ? r2 : r1;
}).filter((x) => x != null);

// IV regime — from the iv-rank endpoint (iv_rank_1y is 0–100)
const ivr = rows(ivJ).slice().sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1)).pop() || {};
let ivRank = num(ivr.iv_rank_1y); if (ivRank != null && ivRank <= 1) ivRank *= 100;
const rvol = num(ivr.volatility);
const expMove = num(nextErnRow.expected_move) ?? num(nextErnRow.implied_move);

// flow + OI — from options-volume (last 5 sessions)
const ov = rows(ovJ).map((r) => ({ ...r, date: String(r.date || '').slice(0, 10) })).filter((r) => r.date).sort((a, b) => (a.date < b.date ? -1 : 1));
const ovLast = ov[ov.length - 1] || {};
const sum = (arr, f) => arr.reduce((a, r) => a + (f(r) || 0), 0);
const w = ov.slice(-5);
const callAsk = sum(w, (r) => num(r.call_volume_ask_side)), callBid = sum(w, (r) => num(r.call_volume_bid_side));
const askPct = (callAsk + callBid) ? Math.round((callAsk / (callAsk + callBid)) * 100) : null;
const net5 = sum(w, (r) => (num(r.net_call_premium) || 0) + (num(r.net_put_premium) || 0));
const bull = num(ovLast.bullish_premium), bear = num(ovLast.bearish_premium);
const callOI = num(ovLast.call_open_interest), putOI = num(ovLast.put_open_interest);

// flow alerts — top by premium, opening-ish
const alerts = rows(alertsJ).map((a) => ({
  type: a.type, rule: a.alert_rule, call: a.type === 'call', strike: num(a.strike),
  expiry: String(a.expiry || '').slice(0, 10), prem: num(a.total_premium),
  ask: num(a.total_ask_side_prem), bid: num(a.total_bid_side_prem), sweep: !!a.has_sweep, floor: !!a.has_floor,
})).sort((a, b) => (b.prem || 0) - (a.prem || 0));
const topAlerts = alerts.slice(0, 6);
const callPrem = sum(alerts, (a) => (a.call ? a.prem : 0)), putPrem = sum(alerts, (a) => (a.call ? 0 : a.prem));

// dark pool — biggest blocks
const dark = rows(darkJ).map((d) => ({ prem: num(d.premium), price: num(d.price), size: num(d.size), time: String(d.executed_at || '').slice(0, 10) }))
  .sort((a, b) => (b.prem || 0) - (a.prem || 0)).slice(0, 5);

// max pain — nearest expiries
const mp = rows(mpJ).map((r) => ({ expiry: String(r.expiry || '').slice(0, 10), pain: num(r.max_pain) }))
  .filter((r) => r.expiry >= today).slice(0, 5);

// UW dealer gamma by strike — biggest call-gamma wall + biggest put node near spot
const gex = rows(gexJ).map((r) => ({ strike: num(r.strike), net: (num(r.call_gex) || 0) + (num(r.put_gex) || 0), call: num(r.call_gex), put: num(r.put_gex) }))
  .filter((r) => r.strike != null && r.strike > last.close * 0.7 && r.strike < last.close * 1.4);
const callWall = gex.filter((r) => r.net > 0).sort((a, b) => b.net - a.net)[0];
const putWall = gex.filter((r) => r.net < 0).sort((a, b) => a.net - b.net)[0];

// analysts
const analysts = rows(anJ).map((a) => ({ firm: a.firm, rec: a.recommendation, tgt: num(a.target), action: a.action, when: String(a.timestamp || '').slice(0, 10) }))
  .filter((a) => a.tgt).slice(0, 8);
const tgts = analysts.map((a) => a.tgt).filter(Boolean).sort((x, y) => x - y);
const insiders = rows(insJ).length;

// ---- evidence block ----------------------------------------------------------------------
const dist = (lvl) => (lvl == null ? '' : ` (${pct(lvl / last.close - 1)})`);
const L = [];
L.push(`📟 uw-research — ${TICKER} · ${$(last.close)} · ${last.date}`);
L.push(`price     : 1d ${pct(chg(1))} · 5d ${pct(chg(5))} · 20d ${pct(chg(20))} · 20d range ${$(lo20)}–${$(hi20)}`);
L.push(`catalyst  : next earnings ${nextErn || 'none scheduled'}${expMove ? ` · implied move ${$(expMove)} (${pct(expMove / last.close)})` : ''}${reactions.length ? ` · last reactions ${reactions.map(pct).join(' / ')}` : ''}`);
L.push(`IV regime : IV rank ${ivRank != null ? ivRank.toFixed(0) : '—'}${ivRank != null ? (ivRank < 35 ? ' (cheap → favors buying)' : ivRank > 65 ? ' (rich)' : ' (moderate)') : ''} · realized vol ${rvol != null ? (rvol * 100).toFixed(0) + '%' : '—'}`);
L.push(`flow (5d) : net premium ${m$(net5)} · call ask-side ${askPct ?? '—'}% · today bull ${m$(bull)} vs bear ${m$(bear)}`);
L.push(`alerts    : ${alerts.length} hits · call $ ${m$(callPrem)} vs put $ ${m$(putPrem)}`);
for (const a of topAlerts) L.push(`   • ${a.expiry} $${a.strike}${a.call ? 'C' : 'P'} ${m$(a.prem)} ${a.ask > a.bid ? 'ASK' : a.bid > a.ask ? 'bid' : 'mid'}${a.sweep ? ' sweep' : ''}${a.floor ? ' FLOOR' : ''} [${a.rule}]`);
L.push(`OI        : total ${callOI != null && putOI != null ? (callOI + putOI).toLocaleString() : '—'} · calls ${callOI?.toLocaleString() || '—'} / puts ${putOI?.toLocaleString() || '—'}`);
L.push(`dealer γ* : call-wall $${callWall?.strike ?? '—'}${dist(callWall?.strike)} · put-node $${putWall?.strike ?? '—'}${dist(putWall?.strike)}   [*UW dealer-gamma, NOT Skylit]`);
L.push(`max pain  : ${mp.map((r) => `${r.expiry} $${r.pain}`).join(' · ') || '—'}`);
L.push(`analysts  : ${analysts.length} rated · targets ${tgts.length ? `$${tgts[0]}–$${tgts[tgts.length - 1]}` : '—'} vs spot ${$(last.close)}`);
for (const a of analysts.slice(0, 5)) L.push(`   • ${a.firm} ${a.rec} $${a.tgt} (${a.action}, ${a.when})`);
L.push(`insiders  : ${insiders} on file`);
const evidence = L.join('\n');
console.log('\n' + evidence + '\n');

// ---- synthesis (Sonnet) ------------------------------------------------------------------
if (RAW) process.exit(0);
if (!AKEY) { log('(no ANTHROPIC_API_KEY — evidence only; pass --raw to silence this)'); process.exit(0); }

const SYS = `You are a single-name options analyst. From the UW evidence block, write a tight options-pick dossier. Doctrine:
- LEAD with the catalyst (earnings/date) — a map that will vaporize at a print is a timing anchor, not a wall.
- IV cheap/rich decides buy-vs-sell: LOW IV rank favors BUYING premium (less crush). NEVER recommend SELLING premium on a big-mover/tail name (last reactions in double digits, or realized ≥ implied) — it earns pennies in front of a steamroller.
- Flow is a LEAN not proof: ask-side call buying + building net premium + call-side OI accumulation = bullish ignition; heavy put/bid = distribution. A big block can be one collar — don't over-read.
- Dealer γ shown is UW's, NOT Skylit — treat as weak context; a concentrated wall may be one position.
- Analysts/insiders = conviction backdrop, not timing.
- If price is extended between entry and the first target with no defined-risk retest, the answer is NO-TRADE / wait for the pullback.
Output, terse:
1) VERDICT: bullish / bearish / neutral lean + is the edge DIRECTIONAL or STRUCTURAL (usually directional; say so).
2) IV read: cheap or rich → buy or don't-sell.
3) THE PICK: a DEFINED-RISK structure (debit call/put spread preferred into a print), concrete strikes near spot + the catalyst expiry, and what it needs to work. Note you don't have live bid/ask (flag "price the exact spread next").
4) INVALIDATION: the level/condition that kills it.
5) LEVEL MAP: current → first target → stretch, one line (Talon-style).
Be decisive and honest about weak edges. ~180 words.`;

async function sonnet(system, user, maxTok = 3000) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': AKEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: maxTok, system, messages: [{ role: 'user', content: user }] }),
  });
  const j = await r.json(); if (j.error) throw new Error(j.error.message);
  return (j.content || []).map((c) => c.text).filter(Boolean).join('');
}

try {
  const synth = await sonnet(SYS, `${TICKER} evidence:\n\n${evidence}\n\nWrite the options-pick dossier.`);
  console.log('─'.repeat(78) + '\nSYNTHESIS\n' + '─'.repeat(78) + '\n' + synth + '\n');
} catch (e) { console.error('synthesis failed:', e.message, '\n(evidence above is complete)'); }
