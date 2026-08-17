#!/usr/bin/env node
// DEEP ANALYSIS — present the GEX/VEX data (the "charts"), let the LLM READ it. No hard-coded
// interpretation: the code only PULLS + FORMATS the structure (per-expiry node matrix now vs a
// week ago, sector peers, price action); ALL judgment — king node, air pockets, the path/
// sequence, entry, target, conviction, the option — is the LLM reading the maps like a skilled
// analyst would. Data in code, discretion in the model.
//   node deep-analysis.mjs SNDK MU WDC
import { loadConfig, loadEnvKeysFrom, resolveFromRoot, log } from './lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['ANTHROPIC_API_KEY', 'UNUSUAL_WHALES_API_KEY']);
const { GexProvider } = await import('./providers/gex-skylit.mjs');
const { FlowProvider } = await import('./providers/flow-uw.mjs');
const config = loadConfig();
const gex = new GexProvider({ maxStrikes: config.ingest.max_strikes, maxExpirations: config.ingest.max_expirations, eodHHMM: config.ingest.skylit_eod_hhmm });
const flow = new FlowProvider();
const AKEY = process.env.ANTHROPIC_API_KEY;
try { await gex.init(); } catch (e) { console.log('AUTH-FAIL (reauth main session):', e.message); process.exit(2); }

const M = (x) => Math.round((x / 1e6) * 100) / 100;
const pct = (k, s) => Math.round((k - s) / s * 1000) / 10;
const daysTo = (E) => Math.round((Date.parse(E) - Date.now()) / 86400000);
const iso = (d) => d.toISOString().slice(0, 10);
const SECTOR = { MU: ['SMH', 'WDC', 'SNDK'], SNDK: ['SMH', 'MU', 'WDC'], WDC: ['SMH', 'MU'], NVDA: ['SMH', 'AVGO'], AVGO: ['SMH', 'NVDA'], AMD: ['SMH', 'NVDA'], TSM: ['SMH'], MRVL: ['SMH'], QCOM: ['SMH'], ORCL: ['IGV'], NOW: ['IGV'], IONQ: ['QTUM'], DKNG: ['XLC'], XYZ: ['XLF'], WMT: ['XLP'] };
function daysAgo(n) { const d = new Date(Date.now() - n * 86400000); const g = d.getUTCDay(); if (g === 0) d.setUTCDate(d.getUTCDate() - 2); if (g === 6) d.setUTCDate(d.getUTCDate() - 1); return iso(d); }
async function llm(system, user, maxTok = 10000) { // sonnet-5 thinks by default → needs room for thinking + the full structured output (incl. the PICK line)
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': AKEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: maxTok, system, messages: [{ role: 'user', content: user }] }) });
      const j = await r.json();
      if (j.error) { await new Promise((s) => setTimeout(s, 1500 * (a + 1))); continue; }
      const txt = (j.content || []).map((c) => c.text).filter(Boolean).join('').trim();
      if (txt) return txt;
    } catch { }
    await new Promise((s) => setTimeout(s, 1500 * (a + 1)));
  }
  return '(no synthesis — API busy; the DATA above is the read)';
}

// FORMAT the per-expiry GEX/VEX matrix as data (no interpretation) — the "chart" for the model.
function matrix(profile, label) {
  const spot = profile.spot, S = profile.strikes, exps = (profile.expirations || []).slice(0, 6);
  const lines = [`${label} — spot ${spot.toFixed(2)}`];
  for (const E of exps) {
    const g = S.map((s) => ({ k: s.strike, v: s.perExpiry?.[E] || 0 })).filter((x) => x.v).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 5);
    const v = S.map((s) => ({ k: s.strike, v: s.perExpiryVanna?.[E] || 0 })).filter((x) => x.v).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 5);
    if (!g.length && !v.length) continue;
    const f = (n) => `${n.k}${n.v >= 0 ? '+' : ''}${M(n.v)}(${pct(n.k, spot)}%)`;
    lines.push(`  ${E} ${String(daysTo(E)).padStart(3)}d | GEX ${g.map(f).join(' ') || '—'} | VEX ${v.map(f).join(' ') || '—'}`);
  }
  return lines.join('\n');
}
// compact one-liner of a peer's aggregate king nodes (for sector confluence data)
function peerLine(t, profile) {
  const spot = profile.spot, S = profile.strikes;
  const gk = S.slice().sort((a, b) => Math.abs(b.gexAgg) - Math.abs(a.gexAgg))[0];
  const vk = S.filter((s) => s.vexAgg > 0 && s.strike > spot).sort((a, b) => b.vexAgg - a.vexAgg)[0];
  return `${t} spot ${spot.toFixed(2)}: GEX king ${gk ? gk.strike + (gk.gexAgg >= 0 ? '+' : '') + M(gk.gexAgg) + `(${pct(gk.strike, spot)}%)` : '—'}, VEX magnet ${vk ? vk.strike + '+' + M(vk.vexAgg) + `(${pct(vk.strike, spot)}%)` : '—'}`;
}

const SYS = `You are a Skylit GEX/VEX swing analyst. You read the dealer-positioning maps and REASON OUT the PATH price is likely to take THROUGH the node structure — like a skilled discretionary trader, not a formula.

HOW THE NODES SHAPE A PRICE PATH (the mechanics you reason with — apply them, don't recite them):
- GEX = dealer gamma / price-hedging. POSITIVE gamma (long-gamma wall) → dealers buy dips & sell rips → price gets PINNED to / attracted toward it; it acts as SUPPORT below spot and RESISTANCE / a magnet-target above, and its pull strengthens INTO that node's expiration. NEGATIVE gamma (short-gamma) → dealers sell weakness & buy strength → it ACCELERATES moves (squeeze fuel): price entering a neg-gamma zone tends to move fast/violently, not stall.
- VEX = dealer vanna / vol-hedging. POSITIVE vanna above spot = a MELT-UP MAGNET that pulls price up ONLY as IV COMPRESSES (after a scare/consolidation). It is not a standalone pull — it needs the vol to come in. Negative vanna / vanna below can drag the other way.
- WHICH EXPIRATION drives it: a thin near-dated expiry does NOT drive dealer hedging — the next expiration out that actually holds the size does. A node that persists across MULTIPLE expiries is durable positioning; a lone near-term node is fragile.
- So a PATH is a SEQUENCE of these interactions: price may pin at a gamma wall, get drawn to a magnet, squeeze fast through a neg-gamma pocket, or test a gamma support first and only then melt to a vanna magnet once IV compresses — the order depends on where spot sits vs each node, the vol regime, and where the real (multi-expiry) size is.

SINGLE-NAME REALITY (this framework's intuition came from SPX — on individual stocks the hierarchy REORDERS; weigh accordingly):
- SQUEEZE is PRIMARY here, not seasoning. Negative gamma above spot is far more potent on a single name than an index (a stock can move 15% in a day) — it IS the gamma-squeeze. Weight it heavily. BUT it's dry tinder: it needs a catalyst / real ask-side flow to light it. Flag strong squeeze fuel and say it needs the flow gate to confirm someone's lighting the match.
- PINNING (gamma floor/ceiling) is SECONDARY and less reliable on stocks: dealer OI share is smaller, positioning flips name-by-name (retail call-buying vs institutional overwriting/collars), and idiosyncratic news steamrolls single-name gamma levels. Trust pinning most on huge-OI mega-caps (AAPL/MSFT), and at ~half your index-intuition weight elsewhere.
- VANNA is EVENT-AWARE, not just location-aware: a magnet above is a LIVE pull only when IV rank is elevated with room to compress — the classic setup is post-earnings IV-crush on a name that held up (dealers buy back short-vega deltas → grind up). Same node with IV already at the floor = dead weight.
- VALIDITY CONDITIONS (see CONTEXT): pre-earnings (~5 trading days) → the gamma map is event-vol that vaporizes at the print, so heavily discount the pinning read. A king node that's a large share of total gamma may be ONE institutional block/collar (hedged once, not continuously) — don't read it as a durable dealer wall. Thin liquidity = no real structure.

YOUR JOB: from THESE maps, trace the specific likely path — starting at spot, what does price encounter, in what order, what does each node do to it, and where does that lead. Reason it out with the single-name hierarchy above; do not assume a fixed pattern. If the structure is muddled or event-dominated, say so.

Output:
STRUCTURE: what the maps show (durable king node vs thin near one, air pocket vs friction, VEX building/fading over the week, sector agreement)
PATH: the sequence you expect price to trace through the nodes, and WHY (the mechanics)
LEVELS: floor / first target / ceiling
CONVICTION: 0-1, what confirms/invalidates
OPTION: the call + expiry you'd want and WHEN to enter (now, or wait for a specific level in the path) — or "no clean setup"
PICK: <TICKER> <YYYY-MM-DD> <strike>C  — your single best specific contract (one strike, one real expiry, even if the entry is "wait for the dip"). This line will be auto-priced, so make it exact.
Honest and selective — the maps are context; you + a catalyst make the call.`;

for (const t of process.argv.slice(2).filter((a) => !a.startsWith('--')).map((x) => x.toUpperCase())) {
  try {
    const now = await gex.getProfile(t);
    if (!now) { log(`\n${t}: no structure`); continue; }
    const past = await gex.getProfile(t, { date: daysAgo(9) }).catch(() => null);
    const peers = [];
    for (const p of (SECTOR[t] || []).slice(0, 2)) { try { const pr = await gex.getProfile(p); if (pr) peers.push(peerLine(p, pr)); } catch { } }
    const oh = await flow.getDailyOHLC(t, { limit: 40 }).catch(() => []);
    const c = oh.map((b) => b.close), sma20 = c.length >= 20 ? c.slice(-20).reduce((a, b) => a + b, 0) / 20 : null, sma50 = c.length >= 50 ? c.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;
    const mom10 = c.length >= 11 ? (now.spot / c[c.length - 11] - 1) * 100 : null;
    const priceLine = `spot ${now.spot.toFixed(2)}, 20dSMA ${sma20 ? sma20.toFixed(2) : '—'}, 50dSMA ${sma50 ? sma50.toFixed(2) : '—'}, 10d mom ${mom10 != null ? mom10.toFixed(1) : '—'}%, last8 ${c.slice(-8).map((x) => x.toFixed(2)).join(' ')}`;
    // single-name validity raw material (the LLM weighs it; we don't hard-code)
    const state = await flow.getStockState(t).catch(() => ({}));
    const ernDte = state.next_earnings ? Math.round((Date.parse(state.next_earnings) - Date.now()) / 86400000) : null;
    const totG = now.strikes.reduce((a, s) => a + Math.abs(s.gexAgg), 0) || 1;
    const conc = Math.round(Math.max(0, ...now.strikes.map((s) => Math.abs(s.gexAgg))) / totG * 100);
    const ctxLine = `IV rank ${state.iv_rank != null ? state.iv_rank.toFixed(0) : '—'}${state.iv_rank != null ? '/100' : ''} · earnings ${state.next_earnings || 'none'}${ernDte != null ? ` (${ernDte}d)` : ''}${ernDte != null && ernDte <= 7 ? ' ⚠PRE-EARNINGS' : ''} · biggest gamma node = ${conc}% of total${conc >= 30 ? ' ⚠concentrated' : ''}`;
    // squeeze-IGNITION raw material — is someone lighting the negative-gamma tinder? (surfaced, not gated)
    const fl = await flow.getSqueezeFlow(t).catch(() => ({}));
    const PM = (x) => x == null ? '—' : `${x >= 0 ? '+' : ''}${Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : Math.round(x / 1e3) + 'k'}`;
    const flowLine = fl.askPct != null
      ? `${fl.days}d call flow: ${fl.askPct}% ask-side${fl.askPct >= 55 ? ' 🔥aggressive-buying' : fl.askPct <= 45 ? ' (sold into)' : ''} · net call premium ${PM(fl.netCallPrem)}${fl.building ? ' ↑building' : ''}`
      : 'call flow: —';

    // PRINT the data (the chart the human reads)
    log(`\n═══════════ ${t} ═══════════`);
    log(matrix(now, 'NOW'));
    if (past) log(matrix(past, `~1wk ago (${past.asofDate || daysAgo(9)})`).split('\n').slice(0, 4).join('\n'));
    log(`  SECTOR: ${peers.join('  |  ') || '(no peer map)'}`);
    log(`  PRICE: ${priceLine}`);
    log(`  CONTEXT: ${ctxLine}`);
    log(`  FLOW: ${flowLine}`);

    // LLM READS it (all judgment)
    if (AKEY) {
      const user = `${t}\n\n=== GEX/VEX matrix (NOW) ===\n${matrix(now, 'NOW')}\n\n=== ~1 week ago ===\n${past ? matrix(past, 'THEN') : 'n/a'}\n\n=== SECTOR peers ===\n${peers.join('\n') || 'n/a'}\n\n=== PRICE ===\n${priceLine}\n\n=== CONTEXT (single-name validity) ===\n${ctxLine}\n(IV rank: the vanna magnet is only a LIVE pull if IV is elevated with room to compress — if IV rank is already low, that magnet is dead weight. Earnings: if within ~5 trading days, the gamma map is event-vol structure that vaporizes at the print — discount the pinning read. Concentration: a single node that's a huge share of total gamma may be one institutional block/collar hedged once at inception, NOT continuous dealer-pinning structure.)\n\n=== FLOW (squeeze ignition — is the match lit?) ===\n${flowLine}\n(This is the flow gate for the SQUEEZE term: negative-gamma structure is dry tinder. Ask-side% >55 with net call premium building = someone is actively lighting it → the squeeze is live, not just latent. Sold-into / flat / bleeding premium = the fuel is there but unlit → don't front-run it.)\n\nRead these maps and give me your discretionary swing analysis.`;
      const read = await llm(SYS, user);
      log('\n' + read.split('\n').filter(Boolean).map((x) => '  ▸ ' + x.trim()).join('\n'));
      // turn the model's PICK into a concrete, LIVE-PRICED contract
      const pk = read.match(/PICK:\s*\$?([A-Z]{1,6})\s+(\d{4}-\d{2}-\d{2})\s+\$?(\d+(?:\.\d+)?)\s*C/i);
      if (pk) {
        const [, pt, pe, ps] = pk;
        const occ = `${pt.toUpperCase()}${pe.slice(2).replace(/-/g, '')}C${String(Math.round(+ps * 1000)).padStart(8, '0')}`;
        try {
          const h = await flow.getOptionHistory(occ);
          const last = h && h.length ? h[h.length - 1] : null;
          if (last && (last.mid || last.last)) log(`  💵 BUY ${occ}  ~$${(last.mid || last.last).toFixed(2)}  IV ${last.iv ? (last.iv * 100).toFixed(0) + '%' : '—'}  OI ${last.oi ?? '—'}  (live)`);
          else log(`  💵 ${occ} — no live quote (verify the strike/expiry is listed)`);
        } catch { log(`  💵 ${occ} — price pull failed (verify live)`); }
      }
    }
  } catch (e) { if (e.message === 'AUTH') { log('AUTH died — reauth'); break; } log(`\n${t}: ${e.message}`); }
}
log('\n(Code presents the maps; the model reads them. Pair with your catalyst.)');
