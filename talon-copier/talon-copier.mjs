// TALON-COPIER — a STANDALONE "buy the ripper BEFORE it rips" scanner.
//
// Born from the 8/14 post-mortem: the structural universe-scan flagged MU (#4) and NBIS (#10) but we
// vetoed/buried them, and they + SNDK ripped +6% / +43% / +22% as ONE theme (AI-memory/compute). The three
// leading tells we under-weighted were: (1) CALL-OI ACCUMULATION (positioning building days before the move),
// (2) a HOT THEME (the whole complex moving together), (3) a big FAR vanna magnet = upside runway. This tool
// scores exactly those, so the pre-rip names surface and you can buy the calls beforehand.
//
// Standalone, but uses the SAME Skylit auth as falcon-copier (Clerk session from ENV_FILE=session-b.env) +
// the same paid Unusual Whales key. Run AFTER the close / when the live loop is idle (shares session-b.env —
// give it its own session-c.env to run concurrently). Skylit only touches the TOP candidates (fast).
//
//   ENV_FILE="…/session-b.env" ENV_FILE_PATH="…/session-b.env" DATABASE_URL= \
//     node talon-copier/talon-copier.mjs [2026-08-28] [--limit N] [--top N]
import '../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../apps/gex/src/heatseeker/auth.js';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const UWKEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const EXP = process.argv.find(a => /^\d{4}-\d\d-\d\d$/.test(a)) || '2026-08-28';
const LIM = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? +process.argv[i + 1] : 0; })();
const TOPN = (() => { const i = process.argv.indexOf('--top'); return i > 0 ? +process.argv[i + 1] : 15; })();
const M = (x) => +(x / 1e6).toFixed(1);

// ── THEME baskets — the "whole complex on fire" detector. Members that accumulate TOGETHER = the ripper theme. ──
const THEMES = {
  'ai-memory/storage': ['MU', 'SNDK', 'WDC', 'STX'],
  'ai-compute/neocloud': ['NBIS', 'CRWV', 'NVDA', 'SMCI', 'DELL', 'VRT', 'AVGO', 'MRVL', 'AMD'],
  'ai-software': ['PLTR', 'AI', 'SNOW', 'NOW', 'GTLB', 'S', 'PATH'],
  'nuclear/ai-power': ['OKLO', 'SMR', 'NNE', 'CEG', 'VST', 'NRG', 'TLN', 'GEV', 'EOSE'],
  'space': ['ASTS', 'RKLB', 'LUNR', 'RDW', 'ACHR', 'JOBY'],
  'crypto-infra/miners': ['CORZ', 'HUT', 'MARA', 'CIFR', 'RIOT', 'BMNR', 'IREN', 'WULF', 'CLSK'],
  'quantum': ['IONQ', 'RGTI', 'QBTS', 'QUBT'],
  'china-tech': ['PDD', 'BABA', 'BIDU', 'JD', 'FUTU'],
  'optical/networking': ['AAOI', 'CIEN', 'LITE', 'ANET', 'COHR'],
  'fintech': ['SOFI', 'HOOD', 'AFRM', 'UPST', 'XYZ'],
};
const themeOf = (t) => Object.entries(THEMES).find(([, arr]) => arr.includes(t))?.[0] || null;

// ── UW pulls (paid key, robust auth) ──────────────────────────────────────
async function uw(p) { if (!UWKEY) return null; return fetch('https://api.unusualwhales.com/api/' + p, { headers: { Authorization: 'Bearer ' + UWKEY, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) }).then(x => x.ok ? x.json() : null).catch(() => null); }
async function flowSignals(t) {
  const [ovR, ohR] = await Promise.all([uw(`stock/${t}/options-volume?limit=8`), uw(`stock/${t}/ohlc/1d?limit=400`)]);
  const ov = (ovR?.data || ovR || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));   // newest first
  if (ov.length < 5) return null;
  const now = ov[0], oi5 = ov[Math.min(5, ov.length - 1)];
  const oiAccum = (now.call_open_interest && oi5.call_open_interest) ? +(((now.call_open_interest - oi5.call_open_interest) / oi5.call_open_interest) * 100).toFixed(1) : null;   // call-OI 5d growth % = ACCUMULATION
  const rc = ov.slice(0, 3), volSurge = +(rc.reduce((a, x) => a + (+x.call_volume || 0), 0) / rc.reduce((a, x) => a + (+x.avg_30_day_call_volume || 1), 0)).toFixed(2);   // recent call vol vs 30d avg
  const netPremM = M(rc.reduce((a, x) => a + (+x.net_call_premium || 0), 0));                 // 3d net call premium ($M) — TREND, de-emphasized level
  const askLean = +(rc.reduce((a, x) => a + (+x.call_volume_ask_side || 0), 0) / Math.max(1, rc.reduce((a, x) => a + (+x.call_volume_ask_side || 0) + (+x.call_volume_bid_side || 0), 0))).toFixed(2);
  // momentum from the r-session close series (sorted newest-first)
  const oh = (ohR?.data || ohR || []).filter(x => x.market_time === 'r').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const c = oh.map(x => +x.close);
  const spot = c[0] ?? null, mom1 = (c[0] && c[1]) ? +(((c[0] - c[1]) / c[1]) * 100).toFixed(1) : null, mom5 = (c[0] && c[5]) ? +(((c[0] - c[5]) / c[5]) * 100).toFixed(1) : null;
  return { spot, oiAccum, volSurge, netPremM, askLean, mom1, mom5, callOI: now.call_open_interest };
}

// ── Skylit GEX structure (SAME auth as falcon-copier) — upside RUNWAY on the target expiry (top candidates only) ──
let _sk = false;
async function skPull(t) {
  if (!_sk) { await initAuth(); _sk = true; }
  const tok = await getFreshToken();
  const url = new URL('https://app.skylit.ai/api/data');
  url.searchParams.set('symbol', t); url.searchParams.set('max_strikes', '150'); url.searchParams.set('max_expirations', '12'); url.searchParams.set('nocache', String(Math.random()));
  const r = await fetch(url, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: 'Bearer ' + tok, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }).then(x => x.ok ? x.json() : null).catch(() => null);
  if (!r) return null;
  const spot = r.CurrentSpot, ei = (r.Expirations || []).indexOf(EXP); if (spot == null || ei < 0) return null;
  const K = r.Strikes || [], G = r.GammaValues || [], V = r.VannaValues || [], nodes = [];
  for (let i = 0; i < K.length; i++) { const k = +K[i]; if (!Number.isFinite(k) || Math.abs(k - spot) / spot > 0.30) continue; const g = (+G[i]?.[ei] || 0) / 1e6, v = (+V[i]?.[ei] || 0) / 1e6; if (g || v) nodes.push({ k, g, v }); }
  const above = nodes.filter(n => n.k > spot);
  const vanMag = above.slice().sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0] || null;                  // biggest vanna magnet ABOVE = the pull
  const ceil = above.filter(n => n.g > 0).sort((a, b) => a.k - b.k)[0] || null;                            // nearest positive-gamma wall above
  const runwayPct = vanMag ? +(((vanMag.k - spot) / spot) * 100).toFixed(1) : null;                        // % distance to the magnet = upside runway
  const airPocket = (ceil && vanMag) ? (Math.abs(ceil.k - spot) / spot > 0.03 || ceil.k >= vanMag.k) : true; // no big near wall between spot and magnet
  return { spot, vanna_magnet: vanMag ? vanMag.k : null, vanna_v: vanMag ? +vanMag.v.toFixed(1) : null, runwayPct, nearest_ceiling: ceil ? ceil.k : null, air_pocket: airPocket };
}

// ── TALON SCORE — weights the LEADING signals (accumulation + surge + runway + theme), momentum rewarded but
//    penalized when already-extended, daily ask/bid DE-emphasized (it's what misled us on MU). ──
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function momScore(m5) { if (m5 == null) return 0; if (m5 <= 0) return m5 * 0.5; if (m5 <= 15) return m5 * 1.5; if (m5 <= 25) return 22.5 - (m5 - 15) * 1.0; return Math.max(0, 12.5 - (m5 - 25) * 0.8); }   // sweet spot +2..+15%, fade the already-ripped
function talonScore(f, themeHeat) {
  if (!f) return null;
  const s_oi = clamp((f.oiAccum ?? 0), -10, 40) * 1.6;          // ACCUMULATION — heaviest leading signal
  const corrob = ((f.oiAccum ?? 0) > 3 || (themeHeat || 0) >= 1.0) ? 1 : 0.4;   // a lone vol spike (no OI build, no hot theme) is a news blip, not accumulation — discount it (kills XOM-style false positives)
  const s_vol = clamp((f.volSurge ?? 0) - 1, -0.5, 3) * 12 * corrob;     // vol surge over 30d avg, corroborated
  const s_mom = momScore(f.mom5);                               // early momentum, not late
  const s_flow = clamp(f.netPremM ?? 0, -60, 120) * 0.12 + clamp((f.askLean ?? 0.5) - 0.5, -0.2, 0.2) * 30; // net-prem trend + mild ask lean (low weight)
  const s_theme = (themeHeat || 0) * 12;                        // hot-theme boost
  return +(s_oi + s_vol + s_mom + s_flow + s_theme).toFixed(1);
}

// ── MAIN ───────────────────────────────────────────────────────────────────
const TCK = (() => { const i = process.argv.indexOf('--tickers'); return i > 0 ? process.argv[i + 1].split(',').map(s => s.trim().toUpperCase()) : null; })();   // test/override a custom list
const uni = JSON.parse(fs.readFileSync(path.join(HERE, '../apps/gex/scanner/data/symbols.json'), 'utf8')).symbols.filter(s => s && s.name && !s.is_index).map(s => s.name);
const tickers = TCK || (LIM ? uni.slice(0, LIM) : uni);
console.log(`TALON-COPIER · ${tickers.length} stocks · target expiry ${EXP}\n(pre-rip scan: call-OI accumulation + vol-surge + early momentum + hot-theme; Skylit runway on the top ${TOPN})\n`);

// 1) UW flow signals for the whole universe (fast, paced)
const rows = [];
for (let i = 0; i < tickers.length; i++) {
  const f = await flowSignals(tickers[i]).catch(() => null);
  if (f && f.oiAccum != null) rows.push({ ticker: tickers[i], theme: themeOf(tickers[i]), ...f });
  if ((i + 1) % 40 === 0) console.log(`  …${i + 1}/${tickers.length} (${rows.length} with flow)`);
  await new Promise(r => setTimeout(r, 130));
}

// 2) THEME HEAT — a theme is "hot" when its members are accumulating + moving together
const heat = {};
for (const [name, arr] of Object.entries(THEMES)) {
  const mem = rows.filter(r => arr.includes(r.ticker));
  if (mem.length < 2) continue;
  const avgOI = mem.reduce((a, r) => a + (r.oiAccum || 0), 0) / mem.length, avgMom = mem.reduce((a, r) => a + (r.mom5 || 0), 0) / mem.length;
  const hotMembers = mem.filter(r => ((r.oiAccum || 0) > 3 && (r.mom5 || 0) > 2) || (r.mom5 || 0) > 12).length;   // accumulation+move, OR strong momentum alone
  heat[name] = { score: +((clamp(avgOI, 0, 25) / 25) + (clamp(avgMom, 0, 12) / 12) + (hotMembers / mem.length)).toFixed(2), avgOI: +avgOI.toFixed(1), avgMom: +avgMom.toFixed(1), hotMembers, n: mem.length };
}
const hotThemes = Object.entries(heat).sort((a, b) => b[1].score - a[1].score);
console.log('\n═══ THEME HEAT (which complexes are accumulating/moving together) ═══');
hotThemes.slice(0, 6).forEach(([n, h]) => console.log(`  ${h.score >= 1.5 ? '🔥' : '  '} ${n.padEnd(22)} heat ${h.score} · avgOI+${h.avgOI}% · avgMom+${h.avgMom}% · ${h.hotMembers}/${h.n} hot`));

// 3) TALON SCORE (theme heat folded in) → rank
for (const r of rows) r.talon = talonScore(r, heat[r.theme]?.score || 0);
rows.sort((a, b) => (b.talon || 0) - (a.talon || 0));

// 4) Skylit RUNWAY + option pick for the top candidates
console.log(`\n═══ Skylit runway on the top ${TOPN} ═══`);
const top = rows.slice(0, TOPN);
for (const r of top) {
  const sk = await skPull(r.ticker).catch(() => null);
  if (sk) { r.runwayPct = sk.runwayPct; r.vanna_magnet = sk.vanna_magnet; r.air_pocket = sk.air_pocket; r.sk_spot = sk.spot; if (sk.runwayPct != null) r.talon = +(r.talon + clamp(sk.runwayPct, 0, 20) * 0.6 + (sk.air_pocket ? 5 : 0)).toFixed(1); }
  process.stdout.write(`  ${r.ticker.padEnd(6)} runway ${sk?.runwayPct ?? '—'}%→magnet ${sk?.vanna_magnet ?? '—'}${sk?.air_pocket ? ' (air pocket)' : ''}\n`);
  await new Promise(r2 => setTimeout(r2, 700));
}
top.sort((a, b) => (b.talon || 0) - (a.talon || 0));

// 5) OUTPUT — ranked talon picks + the CALL to buy beforehand
const STEP = (px) => px >= 500 ? 10 : px >= 100 ? 5 : px >= 25 ? 1 : px >= 5 ? 0.5 : 0.5;
console.log(`\n═══ TALON PICKS — buy the ${EXP} calls BEFORE the rip ═══`);
top.forEach((r, i) => {
  const spot = r.sk_spot || r.spot, atm = spot ? Math.round(spot / STEP(spot)) * STEP(spot) : null;
  console.log(`\n${i + 1}. ${r.ticker}  TALON ${r.talon}${r.theme ? '  [' + r.theme + (heat[r.theme]?.score >= 1.5 ? ' 🔥' : '') + ']' : ''}`);
  console.log(`   spot ${spot} · call-OI accum ${r.oiAccum >= 0 ? '+' : ''}${r.oiAccum}% · vol-surge ${r.volSurge}x · mom 5d ${r.mom5 >= 0 ? '+' : ''}${r.mom5}% · net-callprem ${r.netPremM >= 0 ? '+' : ''}$${r.netPremM}M · ask-lean ${r.askLean}`);
  if (r.vanna_magnet) console.log(`   runway: +${r.runwayPct}% to vanna magnet ${r.vanna_magnet}${r.air_pocket ? ' (air pocket)' : ' (wall in the way)'}`);
  if (atm) console.log(`   → BUY: ${r.ticker} ${EXP} ${atm}C (ATM; slightly-OTM ${atm + STEP(spot)}C for more convexity into the magnet)`);
});
fs.writeFileSync(path.join(HERE, 'talon-picks.json'), JSON.stringify({ generated: new Date().toISOString(), expiry: EXP, theme_heat: heat, picks: top, all: rows.slice(0, 40) }, null, 1));
console.log(`\n-> talon-picks.json (${rows.length} scanned, top ${top.length})`);
