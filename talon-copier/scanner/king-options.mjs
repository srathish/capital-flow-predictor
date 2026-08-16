#!/usr/bin/env node
// KING-NODE OPTIONS — the missing step 4 of the bullish-scan system. For each ticker, read the
// CURRENT per-expiry GEX/VEX (Skylit), find the GAMMA KING (biggest |gamma| = the wall/pin,
// the ★ in Skylit) and the VANNA KING (biggest |vanna| = the melt-up magnet), then emit the
// bullish option to TRADE THE KING NODE: a call struck at the entry with the vanna king as the
// target and the gamma structure as wall/stop. Outputs the exact contract; pair with the
// universe-scan ranking + your catalyst read for the discretionary entry (GEX = the map).
//   node king-options.mjs MU NVDA AVGO            (current structure)
//   node king-options.mjs --top 10               (reads universe-verdicts.json top bullish)
//   node king-options.mjs MU --exp 2026-08-21     (force a target expiry)
import { loadConfig, loadEnvKeysFrom, resolveFromRoot, readJson, log } from './lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['ANTHROPIC_API_KEY', 'UNUSUAL_WHALES_API_KEY']);
const { GexProvider } = await import('./providers/gex-skylit.mjs');
const { assembleStructure } = await import('./lib/structure.mjs');
const { FlowProvider } = await import('./providers/flow-uw.mjs');
const flow = new FlowProvider();
const AKEY = process.env.ANTHROPIC_API_KEY;
async function llm(system, user, maxTok = 900) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': AKEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: maxTok, system, messages: [{ role: 'user', content: user }] }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message || 'llm'); return (j.content || []).map((c) => c.text).filter(Boolean).join('').trim();
}
const smaN = (a, n) => a.length >= n ? a.slice(-n).reduce((s, x) => s + x, 0) / n : null;
function priceContext(ohlc, spot) {
  const b = ohlc.slice(-50), c = b.map((x) => x.close), h = b.map((x) => x.high), l = b.map((x) => x.low);
  const hi20 = Math.max(...h.slice(-20)), lo20 = Math.min(...l.slice(-20));
  return { sma20: smaN(c, 20), sma50: smaN(c, 50), hi20, lo20, mom5: c.length >= 6 ? (spot / c[c.length - 6] - 1) * 100 : null, mom20: c.length >= 21 ? (spot / c[c.length - 21] - 1) * 100 : null, distHi: (spot - hi20) / hi20 * 100, recent: b.slice(-12).map((x) => x.close.toFixed(2)).join(' ') };
}

const args = process.argv.slice(2);
const getOpt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const forceExp = getOpt('--exp');
let tickers = args.filter((a) => !a.startsWith('--') && !/^\d/.test(a)).map((t) => t.toUpperCase());
if (args.includes('--top')) {
  const n = +getOpt('--top') || 10;
  const v = readJson(resolveFromRoot('../../apps/gex/research/stock-gex/universe-verdicts.json'));
  const ranked = (v?.ranked_all || []).slice(0, n).map((r) => r.ticker);
  tickers = [...new Set([...tickers, ...ranked])];
}
if (!tickers.length) { console.log('usage: node king-options.mjs MU NVDA ...  |  --top 10  [--exp YYYY-MM-DD]'); process.exit(1); }

const config = loadConfig();
const M = (x) => Math.round((x / 1e6) * 100) / 100;
const pct = (k, s) => Math.round((k - s) / s * 1000) / 10;
const daysTo = (E) => Math.round((Date.parse(E) - Date.now()) / 86400000);
const inc = (s) => s < 25 ? 0.5 : s < 50 ? 1 : s < 100 ? 2.5 : s < 200 ? 5 : 10;
const roundK = (x, i) => Math.round(x / i) * i;
const gex = new GexProvider({ maxStrikes: config.ingest.max_strikes, maxExpirations: config.ingest.max_expirations, eodHHMM: config.ingest.skylit_eod_hhmm });
try { await gex.init(); } catch (e) { console.log('AUTH-FAIL (main Skylit session needs reauth):', e.message); process.exit(2); }

for (const t of tickers) {
  try {
    const profile = await gex.getProfile(t); // CURRENT structure
    if (!profile) { log(`\n${t}: no structure`); continue; }
    const s = profile, spot = s.spot;
    // NODE expiry: the expiry (3-60 DTE) with the STRONGEST vanna magnet above spot — where the
    // melt-up structure actually sits (often the near monthly, e.g. the 8/21 OPEX).
    const exps = profile.expirations || [];
    let nodeE = null, nodeV = -1;
    for (const E of exps.filter((E) => daysTo(E) >= 3 && daysTo(E) <= 60)) {
      const maxv = Math.max(0, ...profile.strikes.map((x) => ((x.perExpiryVanna?.[E] || 0) > 0 && x.strike > spot) ? x.perExpiryVanna[E] : 0));
      if (maxv > nodeV) { nodeV = maxv; nodeE = E; }
    }
    nodeE = nodeE || exps.find((E) => daysTo(E) >= 10) || exps[exps.length - 1];
    // OPTION expiry = the WEEK AFTER the node. The node pulls price INTO its own expiration; owning
    // that expiry means holding into the terminal theta cliff. Buy the next expiry → capture the
    // move via delta with a time cushion past the node date.
    // "week after" = a genuine ~1 trading week (≥4 cal days) past the node, so we skip a Monday
    // weekly that sits right after a Friday node (too little cushion) and land on the next real expiry.
    const optionE = forceExp || exps.filter((E) => daysTo(E) >= daysTo(nodeE) + 4)[0] || exps.filter((E) => E > nodeE)[0] || nodeE;
    // kings/magnet read from the NODE expiry (that IS the structure); the CONTRACT is on optionE.
    const rows = profile.strikes.map((x) => ({ k: x.strike, g: x.perExpiry?.[nodeE] || 0, v: x.perExpiryVanna?.[nodeE] || 0 })).filter((r) => r.g || r.v);
    const gKing = rows.filter((r) => r.g).sort((a, b) => Math.abs(b.g) - Math.abs(a.g))[0];
    const vKing = rows.filter((r) => r.v).sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
    // also the aggregate king (across all expiries) for context
    const st = assembleStructure(profile);
    // bullish read: is there a vanna magnet ABOVE spot (melt-up target)? a positive-gamma floor below?
    const vMagAbove = rows.filter((r) => r.v > 0 && r.k > spot).sort((a, b) => b.v - a.v)[0];
    const floor = rows.filter((r) => r.g > 0 && r.k < spot).sort((a, b) => b.k - a.k)[0];
    const target = vMagAbove || (gKing && gKing.k > spot ? gKing : null);
    // the OPTION at the king node: a call, target expiry, entry ~ATM, target = vanna magnet
    const i = inc(spot), K = roundK(spot, i);
    const occ = `${t}${optionE.slice(2).replace(/-/g, '')}C${String(Math.round(K * 1000)).padStart(8, '0')}`;
    log(`\n════ ${t}  spot ${spot.toFixed(2)} ════`);
    log(`   NODE expiry (structure): ${nodeE} (${daysTo(nodeE)}d)  →  BUY expiry (week after, dodge terminal theta): ${optionE} (${daysTo(optionE)}d)`);
    log(`   GEX king (wall/pin): ${gKing ? `${gKing.k} ${gKing.g >= 0 ? 'pos' : 'NEG'} ${M(gKing.g)}M  ${pct(gKing.k, spot)}%` : '—'}`);
    log(`   VEX king (magnet):   ${vKing ? `${vKing.k} ${vKing.v >= 0 ? 'pos' : 'neg'} ${M(vKing.v)}M  ${pct(vKing.k, spot)}%` : '—'}`);
    log(`   floor below: ${floor ? `${floor.k} (+${M(floor.g)}M, ${pct(floor.k, spot)}%)` : '—'}   melt-up target: ${target ? `${target.k} (${pct(target.k, spot)}%)` : '— (no magnet above → not a clean bull)'}`);
    if (target && target.k > spot) {
      log(`   ►► BUY: ${t} ${optionE} $${K}C   (ATM, ${daysTo(optionE)}d — week after the ${nodeE} node)   TARGET ${target.k} (+${pct(target.k, spot)}%)   OCC ${occ}`);
      if (AKEY) {
        try {
          const oh = await flow.getDailyOHLC(t, { limit: 60 }).catch(() => []);
          if (oh.length >= 20) {
            const p = priceContext(oh, spot);
            const sys = `You are a GEX/VEX + price-action swing analyst. You get a stock's DEALER STRUCTURE (gamma/vanna king nodes = the map of where price gets pulled) AND recent PRICE ACTION. Decide if the bullish king-node / vanna-melt-up setup is CONFIRMED BY THE CHART — a great magnet above is worthless if the chart is broken or extended. Weigh: trend vs 20/50d SMA, momentum, where price sits vs its 20-day range + the gamma floor, and whether it's a clean pullback-to-support / fresh breakout / or extended-and-toppy. Output EXACTLY 4 lines: "VERDICT: confirm|wait|pass", "CONVICTION: 0-1", "ENTRY: <buy now | pullback to X | breakout of Y>", "INVALIDATION: <level>". Selective and honest — GEX is the map; the chart + a catalyst decide.`;
            const user = `${t} spot ${spot.toFixed(2)}\nSTRUCTURE: gamma king ${gKing ? gKing.k + (gKing.g >= 0 ? ' +' : ' ') + M(gKing.g) + 'M' : '—'}, vanna magnet ${target.k} (+${pct(target.k, spot)}%), gamma floor ${floor ? floor.k : '—'}. Trade idea: buy ${optionE} $${K}C toward ${target.k}.\nPRICE ACTION: 20d SMA ${p.sma20 ? p.sma20.toFixed(2) : '—'}, 50d SMA ${p.sma50 ? p.sma50.toFixed(2) : '—'}; spot vs 20d-high ${p.distHi.toFixed(1)}%; 5d mom ${p.mom5 != null ? p.mom5.toFixed(1) : '—'}%, 20d mom ${p.mom20 != null ? p.mom20.toFixed(1) : '—'}%; 20d range ${p.lo20.toFixed(2)}-${p.hi20.toFixed(2)}; last 12 closes: ${p.recent}.`;
            const read = await llm(sys, user);
            log(read.split('\n').filter(Boolean).map((x) => '      📊 ' + x.trim()).join('\n'));
          }
        } catch (e) { log(`      📊 (chart read skipped: ${String(e.message).slice(0, 40)})`); }
      }
    } else {
      log(`   ►► no clean bullish king-node setup (no vanna magnet above spot) — skip / watch`);
    }
  } catch (e) { if (e.message === 'AUTH') { log('AUTH died — reauth main session'); break; } log(`\n${t}: ${e.message}`); }
}
log('\n(Structure = the map. Pair with universe-scan ranking + your catalyst read. Pull the live option price to confirm tradeable + ask-side.)');
