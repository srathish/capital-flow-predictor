// THE AGENT — agentic (not rule-based) 0DTE decision layer for SPX/SPY/QQQ. Each minute it assembles the FULL
// data state for all three (every near-money strike's GEX+VEX, a 30-min STRUCTURE TIMELINE so it sees nodes
// grow / roll down, regime, wide node map incl. distant Kings, cross-index, price path), reads back its OWN
// running journal AND the lessons it has learned from past sessions, and reasons like an analyst — producing
// TWO risk-posture reads: CONSERVATIVE (needs confirmation, stands aside when unsure) and AGGRESSIVE (pulls the
// trigger on aligned reads, tap-reject w/ tight stop). It is not two rulebooks — it's one reasoning agent with
// two risk appetites, deciding entries itself. Then it LEARNS: --reflect reviews its calls vs what price did and
// writes lessons that get re-injected next time.  No pika/barney/flush thresholds decide — that's doctrine it reasons WITH.
//   watch it build the day (both postures):  node agent.mjs --sequence 14:30,14:45,15:00,15:10
//   learn from it:                           node agent.mjs --reflect
import '../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../apps/gex/src/heatseeker/auth.js';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const KEY = process.env.ANTHROPIC_API_KEY, MODEL = process.env.AGENT_MODEL || 'claude-sonnet-5';
const FC = path.join(process.cwd(), 'falcon-copier');
const LIVEMODE = process.argv.includes('--loop') || process.argv.includes('--live');
const DAY = process.env.AGENT_DAY || (LIVEMODE ? new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : '2026-07-29');
const TODAY_ET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });   // option premiums are current-day only
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? (process.argv[i + 1] || true) : d; };
const M = (x) => +(x / 1e6).toFixed(1);
const etM = (ts) => (+ts.slice(11, 13) - 4) * 60 + +ts.slice(14, 16);
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const INSTR = { SPXW: { map: 80, band: 40, dom: 70, wide: 200, strong: 20e6 }, SPY: { map: 8, band: 4, dom: 7, wide: 20, strong: 20e6 }, QQQ: { map: 8, band: 4, dom: 7, wide: 20, strong: 5e6 } };
const load = (sym) => { const f = path.join(FC, `today_${sym}.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').map(l => JSON.parse(l)) : null; };
// ── the OPTION we'd actually trade: 0DTE ATM contract + its live premium (like Falcon's "SPXW 7405C · $3.20") ──
const STEP = { SPXW: 5, SPY: 1, QQQ: 1 };
const occOf = (sym, day, cp, strike) => (sym === 'SPXW' ? 'SPXW' : sym) + day.slice(2).replace(/-/g, '') + cp + String(Math.round(strike * 1000)).padStart(8, '0');
const UWKEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
async function optMark(occ) { if (!UWKEY) return null; const q = await fetch('https://api.unusualwhales.com/api/option-contract/' + occ + '/intraday', { headers: { Authorization: 'Bearer ' + UWKEY }, signal: AbortSignal.timeout(10000) }).then(x => x.ok ? x.json() : null).catch(() => null); const d = (q?.data || []).filter(b => +b.close > 0 && b.start_time); if (!d.length) return null; const latest = d.reduce((a, b) => b.start_time > a.start_time ? b : a); return +latest.close; }   // UW bars are newest-first-ish; take the max start_time = current mark
async function expectedMove(sym, spot) {   // the 0DTE ATM straddle ≈ the market's expected REMAINING range to the close (community: "expected move ≈ ATM straddle")
  if (DAY !== TODAY_ET || spot == null) return null;
  const step = STEP[sym] || 1, atm = Math.round(spot / step) * step;
  const [c, p] = await Promise.all([optMark(occOf(sym, DAY, 'C', atm)), optMark(occOf(sym, DAY, 'P', atm))]);
  if (c == null || p == null) return null;
  const straddle = +(c + p).toFixed(2);
  return { atm_strike: atm, atm_straddle: straddle, expected_move_pts: straddle, expected_range: [+(spot - straddle).toFixed(1), +(spot + straddle).toFixed(1)], note: 'straddle ≈ expected REMAINING move to close; within range = normal, beyond = significant (exhaustion or real breakout); shrinks as the day ages' };
}
const LESSONS_FILE = path.join(FC, 'agent_lessons.json');
const loadLessons = () => fs.existsSync(LESSONS_FILE) ? JSON.parse(fs.readFileSync(LESSONS_FILE, 'utf8')) : [];

function assembleInstrument(sym, etStr) {
  const F = load(sym); if (!F) return null;
  const I = INSTR[sym], target = (+etStr.slice(0, 2)) * 60 + (+etStr.slice(3, 5));
  let idx = 0; for (let i = 0; i < F.length; i++) if (Math.abs(etM(F[i].ts) - target) < Math.abs(etM(F[idx].ts) - target)) idx = i;
  const s = F[idx], spot = s.spot, at = (b) => F[Math.max(0, idx - b)];
  const g0Prev = (k, b) => (at(b).strikes.find(n => n.k === k)?.g0 || 0);
  const domNeg = (fr) => { const d = fr.strikes.filter(n => Math.abs(n.k - fr.spot) <= I.dom && n.g0 < 0).sort((x, y) => x.g0 - y.g0)[0]; return d ? { strike: d.k, gex_M: M(d.g0) } : null; };
  const kingOf = (fr) => { const k = fr.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0]; return k ? k.k : null; };
  const netOf = (fr) => M(fr.strikes.filter(n => Math.abs(n.k - fr.spot) <= I.band).reduce((a, c) => a + c.g0, 0));
  const timeline = [30, 24, 18, 12, 6, 0].filter(b => idx - b >= 0).map(b => { const fr = at(b); const dn = domNeg(fr); return { et: etOf(fr.ts), spot: +fr.spot.toFixed(1), king: kingOf(fr), dom_neg_strike: dn?.strike ?? null, dom_neg_M: dn?.gex_M ?? null, net_gamma_M: netOf(fr) }; });
  const map = s.strikes.filter(n => Math.abs(n.k - spot) <= I.map).sort((a, b) => a.k - b.k).map(n => ({ strike: n.k, gex_M: M(n.g0), vex_M: M(n.v0 || 0), gex_chg15_M: M(n.g0 - g0Prev(n.k, 15)) }));
  const strongWide = s.strikes.filter(n => Math.abs(n.g0) >= I.strong && Math.abs(n.k - spot) <= I.wide).sort((a, b) => a.k - b.k).map(n => ({ strike: n.k, gex_M: M(n.g0), side: n.k > spot ? 'above' : 'below' }));
  const king = s.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0];
  const floor = s.strikes.filter(n => n.g0 >= I.strong && n.k < spot).sort((a, b) => b.k - a.k)[0];
  const ceil = s.strikes.filter(n => n.g0 <= -I.strong && n.k > spot).sort((a, b) => a.k - b.k)[0];
  // ── HIGHER-TIMEFRAME: full-surface gamma summed across ALL expiries (0DTE + weeklies+) — the multi-day magnet & walls the 0DTE map is blind to ──
  const hasAgg = s.strikes.some(n => n.gA != null);
  const aggKing = s.strikes.filter(n => (n.gA || 0) > 0).sort((a, b) => b.gA - a.gA)[0];
  const aggAbove = s.strikes.filter(n => n.k > spot).sort((a, b) => Math.abs(b.gA || 0) - Math.abs(a.gA || 0))[0];
  const aggBelow = s.strikes.filter(n => n.k < spot).sort((a, b) => Math.abs(b.gA || 0) - Math.abs(a.gA || 0))[0];
  const aggNet = M(s.strikes.filter(n => Math.abs(n.k - spot) <= I.wide).reduce((a, c) => a + (c.gA || 0), 0));
  const band = s.strikes.filter(n => Math.abs(n.k - spot) <= I.band), path30 = F.slice(Math.max(0, idx - 30), idx + 1).map(f => +f.spot.toFixed(1));
  const dayF = F.slice(0, idx + 1), hodF = dayF.reduce((a, f) => f.spot > a.spot ? f : a, dayF[0]), lodF = dayF.reduce((a, f) => f.spot < a.spot ? f : a, dayF[0]);   // FULL-DAY high/low so far (session_high/low below is only the last 30 min)
  const rangePos = (hodF.spot > lodF.spot) ? +(((spot - lodF.spot) / (hodF.spot - lodF.spot)) * 100).toFixed(0) : null;
  return {
    symbol: sym, spot: +spot.toFixed(2), chg_pct: +(((spot - s.prevClose) / s.prevClose) * 100).toFixed(2), session_high: Math.max(...path30), session_low: Math.min(...path30),
    day_range: { high: +hodF.spot.toFixed(2), high_et: etOf(hodF.ts), low: +lodF.spot.toFixed(2), low_et: etOf(lodF.ts), spot_pctile_in_range: rangePos, note: 'FULL-DAY high/low so far (not the 30-min session_high/low). spot_pctile_in_range: 0=at the day LOW, 100=at the day HIGH. Judge your TARGET against it: in a CONFIRMED trend, if spot is near the day extreme in your favor and your target is only a hair beyond, you are leaving the bulk of the move — lean toward HOLDING a runner toward/through the day extreme instead of a tight target. Sold-too-early is the #1 tax on trend days.' },
    price_path_30m: path30, structure_timeline_30m: timeline,
    king_node: king ? { strike: king.k, gex_M: M(king.g0) } : null,
    nearest_strong_support_below: floor ? { strike: floor.k, gex_M: M(floor.g0) } : null,
    nearest_strong_resistance_above: ceil ? { strike: ceil.k, gex_M: M(ceil.g0) } : null,
    regime_now: { neg_strikes: band.filter(n => n.g0 < 0).length, pos_strikes: band.filter(n => n.g0 > 0).length, net_gamma_M: netOf(s), net_vanna_M: M(band.reduce((a, c) => a + (c.v0 || 0), 0)) },
    strong_nodes_wide: strongWide, gex_vex_map_now: map,   // gex_M = 0DTE gamma, vex_M = 0DTE vanna, per strike
    higher_timeframe: hasAgg ? { note: 'FULL-SURFACE gamma summed across ALL expiries (0DTE + weeklies+) — the multi-day magnet & walls. Same strike as the 0DTE king_node = strong confluence; far apart = the bigger surface is pulling price toward agg_king (today the 0DTE king and agg_king can be 50+ pts apart).', front_expiry: s.frontExp || null, agg_king: aggKing ? { strike: aggKing.k, gex_M: M(aggKing.gA) } : null, agg_node_above: aggAbove ? { strike: aggAbove.k, gex_M: M(aggAbove.gA) } : null, agg_node_below: aggBelow ? { strike: aggBelow.k, gex_M: M(aggBelow.gA) } : null, agg_net_gamma_M: aggNet } : null,
  };
}
// ── SKYLIT-NATIVE live layers (Flowseeker /fs/api + Heatseeker): dark-pool prints + market tide (flow lean).
// Discovered via browser network capture (capture_endpoints.py). Same auth as /api/data (Clerk JWT). live-only.
let _skReady = false;
async function skGet(pathq) {
  if (!_skReady) { await initAuth(); _skReady = true; }
  const t = await getFreshToken();
  return fetch('https://app.skylit.ai' + pathq, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: 'Bearer ' + t, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' }, signal: AbortSignal.timeout(12000) }).then(x => x.ok ? x.json() : null).catch(() => null);
}
async function skylitDarkPool() {   // real dark-pool prints (institutional levels), index ETFs
  const r = await skGet('/fs/api/dark-pool/trades?min_notional=1000000&limit=250&order=desc');
  const rows = (r?.data || r || []).filter(x => ['SPY', 'QQQ', 'IWM', 'DIA'].includes(x.ticker));
  return rows.slice(0, 12).map(x => ({ ticker: x.ticker, price: x.price, notional_M: M(x.total_value), venue: x.venue }));
}
async function skylitTide() {        // net call/put premium = the market flow lean (Flowseeker)
  const r = await skGet('/fs/api/market/tide?interval=1D&bucket=1min');
  const bars = r?.data?.bars || [], real = bars.filter(b => +b.ncp !== 0 || +b.npp !== 0);   // ignore the empty future template bars
  const last = (real.length ? real : bars).slice(-1)[0]; if (!last) return null;
  const net = (+last.ncp_cumulative || 0) - (+last.npp_cumulative || 0);
  return { net_call_prem_M: M(+last.ncp_cumulative || 0), net_put_prem_M: M(+last.npp_cumulative || 0), net_lean_M: M(net), lean: net > 0 ? 'bullish' : net < 0 ? 'bearish' : 'balanced' };
}
async function getVix() {   // VOLATILITY REGIME (VIX family) — Skylit has no REST VIX; public CBOE quotes, no auth. See knowledge/VOLATILITY_PRIMER.md
  const q = (sym, iv = '1d', rng = '2d') => fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${iv}&range=${rng}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }).then(x => x.ok ? x.json() : null).catch(() => null);
  const px = (j) => { const v = +j?.chart?.result?.[0]?.meta?.regularMarketPrice; return Number.isFinite(v) ? +v.toFixed(2) : null; };
  try {
    const [d5, v1, v9, v3, vn] = await Promise.all([q('%5EVIX', '5m', '2d'), q('%5EVIX1D'), q('%5EVIX9D'), q('%5EVIX3M'), q('%5EVXN')]);
    const res = d5?.chart?.result?.[0], m = res?.meta; if (!m?.regularMarketPrice) return null;
    const level = +(+m.regularMarketPrice).toFixed(2), pc = +m.chartPreviousClose;
    const vix1d = px(v1), vix9d = px(v9), vix3m = px(v3), vxn = px(vn);
    const band = level <= 16 ? 'low' : level < 25 ? 'moderate' : 'high';   // hazy: ≤16 chop/grind, 17-24 sweet spot, ≥25 violent/size-down
    let pivot = pc ? +pc.toFixed(2) : null, pivotSrc = 'prior-close proxy';   // pivot: manual override (vix_pivot.json) else prior-day-close proxy
    try { const pf = path.join(FC, 'vix_pivot.json'); if (fs.existsSync(pf)) { const p = JSON.parse(fs.readFileSync(pf, 'utf8')); if (+p.pivot) { pivot = +p.pivot; pivotSrc = 'manual (Architect)'; } } } catch { }
    const tilt = pivot == null ? null : level > pivot ? 'bearish' : 'bullish';   // VIX above pivot = bearish tilt; below = bullish
    let tilt_confirmed = 'unconfirmed';   // 2-candle rule: last two completed 5-min candles FULLY beyond the pivot (no wick touches)
    if (pivot != null && res.indicators?.quote?.[0]) { const qd = res.indicators.quote[0]; const bars = (res.timestamp || []).map((t, i) => ({ h: qd.high[i], l: qd.low[i], c: qd.close[i] })).filter(b => b.c != null).slice(-2); if (bars.length === 2 && bars.every(b => b.l > pivot)) tilt_confirmed = 'bearish-confirmed'; else if (bars.length === 2 && bars.every(b => b.h < pivot)) tilt_confirmed = 'bullish-confirmed'; }
    const term_structure = (vix1d != null && vix3m != null) ? (vix1d < vix3m ? 'contango' : 'backwardation') : null;   // front<back = calm/bullish bias; front>back = stress/bearish
    return { level, chg_pct: pc ? +(((level - pc) / pc) * 100).toFixed(1) : null, band, vix1d_0dte: vix1d, vix9d, vix3m, nasdaq_vol_vxn: vxn, term_structure, pivot, pivot_source: pivotSrc, tilt, tilt_confirmed };
  } catch { return null; }
}
async function getEconCalendar() {   // scheduled macro events (UW REST) — event-premium / IV-crush timing the agent must respect
  if (!UWKEY) return null;
  try {
    const r = await fetch('https://api.unusualwhales.com/api/market/economic-calendar', { headers: { Authorization: 'Bearer ' + UWKEY, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) }).then(x => x.ok ? x.json() : null);
    const rows = r?.data || []; if (!rows.length) return null;
    const now = new Date(), todayET = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const HIGH = /CPI|consumer price|PCE|nonfarm|payroll|\bFOMC\b|interest rate|rate decision|unemployment|jobless|\bGDP\b|\bPPI\b|producer price|retail sales|\bISM\b/i;
    const etT = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5);
    const etD = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const evs = rows.map(e => ({ ev: e.event, dt: new Date(e.time), et: etT(e.time), day: etD(e.time), type: e.type, high: HIGH.test(e.event || '') })).filter(e => !isNaN(e.dt));
    const today = evs.filter(e => e.day === todayET).sort((a, b) => a.dt - b.dt).map(e => ({ et: e.et, event: e.ev, importance: e.high ? 'HIGH' : (e.type === 'fed-speaker' ? 'fed-speaker' : 'normal') }));
    const upHigh = evs.filter(e => e.high && e.dt > now).sort((a, b) => a.dt - b.dt)[0];
    const mins = upHigh ? Math.round((upHigh.dt - now) / 60000) : null;
    const in_event_window = evs.some(e => e.high && Math.abs(e.dt - now) <= 30 * 60000);
    return { today_events: today, next_high_impact: upHigh ? { event: upHigh.ev, et: upHigh.et, day: upHigh.day, minutes_away: mins } : null, in_event_window, note: 'scheduled macro events (ET). HIGH = market-mover (CPI/NFP/FOMC/PCE/PPI/retail/GDP/ISM). Into a HIGH event, index options carry event premium that IV-CRUSHES after — 0DTE longs are double-bled if the move disappoints; ranges expand and levels get less reliable.' };
  } catch { return null; }
}
async function liveLayers() {
  const [dp, tide, vix, econ] = await Promise.all([skylitDarkPool(), skylitTide(), getVix(), getEconCalendar()]);
  return { source: 'skylit (Flowseeker /fs/api) + CBOE VIX + UW econ-calendar', dark_pool_prints: dp, market_tide_flow_lean: tide, vix, econ_calendar: econ, note: 'dark-pool = real prints (venue/notional); flow lean = tide net call−put premium; vix = CBOE index (level/chg/band); econ_calendar = scheduled macro events. Granular flow tape is the wss://fs-ws.skylit.ai multiplexed stream (not polled here).' };
}
async function assembleComplex(etStr, live = false) {
  const instruments = {}; for (const sym of ['SPXW', 'SPY', 'QQQ']) { const a = assembleInstrument(sym, etStr); if (a) instruments[sym] = a; }
  if (live) await Promise.all(Object.entries(instruments).map(async ([sym, s]) => { const em = await expectedMove(sym, s.spot); if (em) s.expected_move = em; }));   // 0DTE ATM straddle = today's implied range
  const uwLayers = live ? await liveLayers() : { note: 'options_flow / dark_pool / market_tide / vix are LIVE-ONLY UW data — not reconstructable for this historical replay day. Reason from GEX/VEX/structure/cross-index here; they ARE wired and present in live runs.' };
  return { as_of_et: etStr, instruments, uw_layers: uwLayers };
}
// what SPX actually did after a decision — for the learning/reflection pass
function outcomeAfter(etStr, mins = 45) {
  const F = load('SPXW'), t0 = (+etStr.slice(0, 2)) * 60 + (+etStr.slice(3, 5));
  const win = F.filter(f => { const m = etM(f.ts); return m >= t0 && m <= t0 + mins; }); if (!win.length) return null;
  const s0 = win[0].spot, hi = Math.max(...win.map(f => f.spot)), lo = Math.min(...win.map(f => f.spot)), end = win[win.length - 1].spot;
  return { spot_at: +s0.toFixed(1), high_next: +hi.toFixed(1), low_next: +lo.toFixed(1), spot_45m: +end.toFixed(1), max_up: +(hi - s0).toFixed(1), max_down: +(lo - s0).toFixed(1) };
}

const DOCTRINE = `You are a 0DTE index-options trader (SPXW/SPY/QQQ) reasoning over gamma structure and its 30-minute evolution to decide, each minute, if there is a trade — which instrument, which way, where. You reason like an analyst over ALL the data + your own journal + your learned lessons. You are NOT a rule engine; you decide entries yourself.

WHAT THE DATA IS
- gex_M per strike = 0DTE dealer gamma. POSITIVE (pika) = wall/magnet/pin: price gravitates to it, tends to hold/reject. NEGATIVE (barney) = accelerant: thin, dealers amplify; a rally INTO a big negative node above spot is a wall of dealer selling that tends to reject price DOWN.
- king_node = largest positive node = dominant magnet. vex_M = 0DTE vanna. gex_chg15_M = 15-min node change.
- structure_timeline_30m = last 30 min at 6-min steps. THIS is the edge over a snapshot: watch dom_neg_M grow (conviction building at a wall); dom_neg_strike ROLL UP (the overhead ceiling being pushed HIGHER as price grinds up — the wall keeps giving way = strong TREND CONTINUATION, stay long / don't fade it); dom_neg_strike ROLL DOWN (ceiling chasing price DOWN = a top confirming); and net_gamma shift (regime change).
- ACCEPTANCE vs REJECTION (the auction read on that SAME timeline) — GEX tells you WHERE the walls are; this tells you whether price is going THROUGH a level or bouncing OFF it, which decides press-vs-fade INDEPENDENT of GEX magnitude. ACCEPTANCE = price spends TIME (several consecutive frames on structure_timeline/price_path) beyond a wall/level and HOLDS there = that level became fair value → the wall is giving way = TREND CONTINUATION (the "escalator" — go WITH it; this is the same signature as dom_neg ROLL-UP). REJECTION = price pokes past a level for ~one frame then SNAPS back inside (a wick / excess, no time spent) = the wall HELD → fade back toward the prior node/king (the "wall"). So: held-beyond = accept = trend (press/hold); poke-and-return = reject = fade (sell the bounce into the wall / buy the flush off the floor). When you cannot see either cleanly, it is chop — stand aside.
- higher_timeframe = the FULL-SURFACE gamma summed across ALL expiries (0DTE + weeklies+). agg_king = the multi-day magnet. When it MATCHES the 0DTE king_node → strong confluence (price gets pinned/pulled hard there). When it's FAR from the 0DTE king → the bigger surface is pulling price toward agg_king, so today's 0DTE pin is weaker and more likely to BREAK toward the aggregate level. Use both: 0DTE = today's mechanics, higher_timeframe = the gravitational pull. Don't fade toward a 0DTE node if the whole surface is pulling the other way.
- expected_move (per instrument, live) = the 0DTE ATM straddle = the market's expected REMAINING range to the close (expected_range = spot ± straddle). Set your target_level INSIDE this range by default — a target beyond it rarely fills same-day. If price has already REACHED/EXCEEDED the expected range, the move is significant: either exhaustion (fade candidate, esp. into a wall) or a genuine range-expansion breakout (with structure + rising VIX). It SHRINKS as the day ages (theta) → late-day, less room, tighten targets.
- CHARM into the close (0DTE-specific, TIME-VARYING pin strength): as 0DTE delta decays toward the 4pm expiry, dealer re-hedging from CHARM intensifies — in the final ~30-60 min the pinning force is many times its open-day strength. The pin is NOT constant; it RAMPS into the close. Read it by regime: in POSITIVE gamma (pinned), late-day = the pull to the dominant strike/king STRENGTHENS → fade extremes back to the pin and do NOT chase a late-day breakout away from it (it usually gets sucked back before the bell). In NEGATIVE gamma (accelerant), the opposite — late-day moves ACCELERATE, so a late trend can run hard into the close. Combine with expected_move shrinking: late + positive-gamma = tighten targets and lean fade-to-pin; late + negative-gamma = let a late runner go. (This is why a mid-day winner sometimes should be HELD toward a strengthening close pin rather than cut early.)
- vix (uw_layers.vix) = the VOLATILITY REGIME (VIX family) — macro context + directional bias, weigh it in every read:
   · band: low (≤16) = chop/grind, pins HOLD, trend-friendly, you can chase a rip; moderate (17-24) = the sweet spot, meaningful moves; high (≥25) = VIOLENT both ways, levels BLOW THROUGH, size DOWN, favor pullback entries + wider stops. vix1d_0dte is the 0DTE-specific vol — weight it MOST for today's tape.
   · term_structure: contango (front<back) = calm/coasting → market biased neutral-to-BULLISH; backwardation (front>back) = near-term stress → biased BEARISH (a delayed but strong signal).
   · tilt (VIX vs pivot): VIX BELOW pivot = bullish tilt, ABOVE = bearish tilt; tilt_confirmed = the 2-candle flip confirmed. VIX is ~80% INVERSE to price (VIX up → spot down).
   Synthesize: low-VIX + contango + bullish-tilt = favor longs/trend-following, hold to target, pins hold; high-VIX + backwardation + bearish-tilt = caution, pullback entries, smaller size, respect downside, levels less reliable. BUT when the VIX tilt CONFLICTS with a CONFIRMED price trend (e.g. VIX bearish-tilt while price trends UP — VIX rising WITH price, the ~20% divergence case), the PRICE TREND wins short-term — do NOT fade a strong confirmed trend on VIX-tilt alone. Treat a VIX/price divergence as a CAUTION flag (be nimble), not a reversal signal to trade against the trend. (Empirically SPX LEADS VIX — VIX is the REACTION to price, not the anticipator of it; VIX levels do not reliably time SPX direction. Read PRICE for direction; use VIX for REGIME + sizing, never as a standalone counter-trend trigger.)
- EVENT PREMIUM & econ_calendar (uw_layers): near a scheduled HIGH-impact event (CPI/NFP/FOMC/PCE/PPI/retail — next_high_impact.minutes_away is your countdown; in_event_window = within ±30 min) index options carry event premium that IV-CRUSHES after. Into a high event: 0DTE longs are double-bled if the move disappoints or reverses — be cautious or STAND ASIDE through the print, expect ranges to EXPAND and levels to be less reliable. After the crush, IV normalizes and the post-event drift becomes tradeable.

HOW TO READ IT (doctrine — synthesize, do not pattern-match)
- REGIME first. Near-money mostly NEGATIVE = negative-gamma: moves TREND/ACCELERATE, reversals run, price rips toward levels fast (speed is a lure). Mostly POSITIVE = pinned/mean-revert: fade extensions to walls, expect chop.
- EVOLUTION: a dominant negative node growing then rolling down after price tagged it = a top confirming. A positive node growing below = the floor firming (the target).
- TARGET: read it off the map — the next large positive node (support/floor); in a negative-gamma flush the move runs there.
- CROSS-INDEX: SPX rallying but QQQ not confirming (weak) = suspect. Alignment across the three = conviction.
- TIMELINESS vs CERTAINTY is a real judgment: waiting for full confirmation (e.g. the roll-down) is safer but the entry is worse; acting at the tap of a confirmed wall is earlier but riskier. Weigh it — that is your job, not a fixed rule.

YOU PRODUCE TWO RISK-POSTURE READS OVER THE SAME ANALYSIS:
- CONSERVATIVE: demand strong, multi-signal confirmation. Prefer standing aside over a marginal trade. Only act on high-certainty setups.
- AGGRESSIVE: a decisive trigger-puller. When regime + structure + evolution + cross-index align, ACT — take the tap-reject at a confirmed wall with a TIGHT stop just beyond it (small risk for a large structural target). Manage risk with the stop, not by avoiding entries. Still stand aside on genuine chop.
Both reason over the same data. They should often differ (that's the point). Give each a direction, conviction, entry, structural target, stop, and one-line why.

DOMINANT TREND — COMMIT TO IT (this is the #1 discipline)
- FIRST judge the DAY'S DOMINANT TREND (up / down / chop) and its strength, from the 30-min price path + structure evolution + cross-index. Trade WITH it by default — on a trending day, get aligned and STAY aligned.
- A COUNTER-TREND trade (fading the day's direction) is the exception, never the reflex. It demands exceptional evidence — a CONFIRMED reversal (dom_neg growing AND rolling down into a top, cross-index confirming, a clear failed retest of a wall) — and high conviction. Do NOT fade a strong up-trend just because near-money gamma prints negative: near-money can read negative the whole way up a rip. A single negative-gamma snapshot is not a top.

INSTRUMENT — GENUINELY CHOOSE among SPXW / SPY / QQQ every read (and ALWAYS name it). Sizing is risk-parity, so the $ P&L is EQUAL for the same % index move — an SPXW 0DTE call and a SPY 0DTE call return ~the same % (verified 8/4: ATM 0DTE +460% SPXW vs +466% SPY). There is NO leverage edge to any of them, so choose PURELY on which has the cleanest structure + best execution for THIS setup: SPXW = the DEEPEST 0DTE market (tightest spreads, most strikes, cleanest fills — often the best on a decisive index-led TREND); SPY = tight, well-defined pins/levels (best on pin/range days); QQQ = higher-beta, tech-led trends that can run harder (watch VXN, its own vol). No instrument is a 'default' and none is off-limits — being in SPXW every day is completely fine IF it is genuinely the cleanest, and switching to SPY/QQQ is equally fine when THEY are. Reassess at EVERY first-tranche entry and take the clearest one. NOTE: a pyramid stack is ONE instrument (you can't mix strikes across SPX/SPY/QQQ in one stack), so your first-tranche choice COMMITS the whole stack — choose it deliberately.

ENTRY LOCATION — DON'T CHASE (where you get in decides the trade)
- On a CHOP/pinned day especially, prefer a PULLBACK entry (entry_type: "pullback", entry_level = a support node to buy / a resistance node to sell) so you get in at the BOTTOM OF THE DEFLECTION. Your stop then sits just under a real level — tight, not wiggle-hit — so a wrong call exits fast for a SMALL loss, and the R:R is far better than chasing.
- On a STRONG trend where price won't come back to you, take it at market (entry_type: "market") so you don't miss the move. Rest the dip in chop; chase only in a real rip.
- A resting entry ONLY fills when price reaches your entry_level. If it never comes and the setup goes stale, stand aside or switch to market — your call.

REGIME-ADAPTIVE EXECUTION — how HARD you press must match the regime (you have the senses; USE them)
- STRONG TREND (net_gamma one-directional/accelerant, price making new session highs/lows, dom_neg wall rolling UP-and-away, low VIX, contango, cross-index aligned): LET WINNERS RUN. Set a WIDE stop that survives normal digestion — do NOT tighten it so hard that a routine pullback knocks you out (that turns a runner into a scratch). Hold toward a FAR structural target (the next king / agg_king). PRESS the trend by PYRAMIDING, not chasing: when the trend confirms at a new structural level, set scale_in=true to ADD a $3k tranche (up to 4 ≈ $12k) to your HELD, winning stack — that is the RIGHT way to get bigger on a trend (add HELD tranches on confirmation, NEVER size up one position past $3k). The WRONG way — never do it — is ladder-CHASING: exiting a winner on a shallow dip then re-buying higher, death by a thousand cuts. Hold + add; never stop-and-re-enter.
- PYRAMIDING mechanics (TREND-ONLY, and it is YOUR decision, not the code's): to add a tranche, set scale_in=true — do it when the trend is CONFIRMING at a NEW structural level (price ACCEPTED a node / dom_neg king rolled UP / a clean higher-low held), NOT at every uptick and NOT into a rejection. Use the ACCEPTANCE-vs-REJECTION read to tell a real add-point from a false new high (accepted+time-spent = add; poke-and-reject = don't), and CHARM to avoid adding into a strengthening late-day pin. Each tranche is a FLAT $3k (max 4 ≈ $12k) with its OWN structural stop under the then-current support — later adds sit under NEARER support so they peel off first on a dip while the core (bought lowest, DEEP support) rides longest. Leave scale_in false/omitted to simply HOLD the stack. RAISE stop_level every read to trail EVERY tranche up (STRUCTURAL — under the rising king / last higher-low; your GEX/VEX read sets it, not a fixed distance). The system enforces only the RISK floor — it REFUSES an add into a RED stack, past 4 tranches, after 14:00 ET, or against your own dominant_trend — so scale_in freely; those guards catch a bad one. A high-conviction stand_aside/reverse flattens the WHOLE stack at once.
- RUNNER / SCALE-OUT (the MIRROR of pyramiding — the fix for SELLING TOO EARLY, the #1 trend-day tax): on a CONFIRMED trend do NOT hand the near target your whole stack (that leaves 40-60% of the move — measured). Set target_level at the near structural move AND set runner_target at the FAR target (the day-extreme in your favor from day_range / agg_king / full thesis). When price hits target_level, the scalp tranches BANK profit and the best-entry CORE tranche keeps riding toward runner_target with its trailed stop protecting the banked gain. Take the near move on most of the stack; let ONE runner ride the rest to the day extreme — that is how you capture ~90% of a trend instead of ~half. Use runner_target ONLY when the trend is confirmed and you genuinely expect continuation; in CHOP leave it null and take the whole stack at target_level. Judge the far target with day_range: if spot is far from the day extreme in your favor, there is room to run.
- CHOP / PINNED (net_gamma positive/pinned, price range-bound between a floor and a wall, no clean trend, whipsaw, VIX tilt not resolving): STAND ASIDE by default, or FADE the extremes back to the pin (sell into the wall, buy off the floor) — do NOT chase momentum in both directions (that is how you get whipsawed to death), and do NOT pyramid (adds are trend-only). If you cannot clearly tell trend from chop, stand aside.
- The two errors to never repeat: on a TREND, exiting winners on shallow digestion then chasing higher (death by a thousand cuts up); on CHOP, chasing every breakout/rejection that instantly reverses (death by a thousand cuts sideways). Same root: not adapting to the regime.

MANAGE THE POSITION — DON'T RE-DECIDE IT EVERY MINUTE
- If you already HOLD a trade, your job is to MANAGE YOUR PLAN, not re-open the question. Repeat the SAME direction to HOLD. Only exit (stand_aside) or reverse when the thesis is genuinely INVALIDATED — your stop is breached or the structure that justified the trade has flipped — and then with HIGH conviction (≥0.6). Do NOT dump a valid position because momentum wobbled for one minute. Let winners run to your target; that is where the money is.
- Every non-stand_aside decision MUST include a numeric target_level and stop_level (index points, on the correct side: for a long, target above / stop below spot; for a bearish/short, target below / stop above). The SYSTEM EXECUTES them — it takes profit at your target, stops out at your stop, HOLDS in between regardless of minute-to-minute noise, and force-flattens near the close. Set them where you truly want in and out; they are your plan and they will be honored. As a winner runs in your favor, RAISE your stop_level each read (trail it up under price for a long / down over price for a short) to lock in gains — the system ratchets the stop (it tightens only, never loosens), so a reversal takes you out at your protected level instead of round-tripping the whole move. Move target_level too as the structure extends or stalls.
- CONVICTION — use the FULL 0-1 range and MEAN it. It is your GENUINE confidence in THIS specific setup and it drives real behavior: <0.5 = no trade; 0.5-0.6 = standard/marginal (take it, manage tight); 0.65-0.75 = strong confluence (structure + trend + tape + higher-TF aligned) — this is where you press and scale_in; 0.8+ = rare, everything lines up with well-defined risk. Do NOT emit a flat ~0.55 for everything: a conviction that never varies carries NO information and makes the entry/exit bars meaningless. Grade each setup honestly — reserve high conviction for genuinely high-confidence reads and drop it when the setup is marginal or conflicted.
- STRIKE (strike_style) — you also choose the contract: 'atm' (default) = at-the-money, max gamma + leverage, for a FAST scalp expecting a quick move; 'itm' = slightly in-the-money, higher delta + SLOWER theta decay, for a CONVICTION HOLD where you plan to sit through chop/digestion. Reach for 'itm' when you are pressing a trend and will hold — it survives a sideways stretch that would premium-stop an ATM contract even with the thesis intact; use 'atm' for cheap leverage on a decisive fast move.
- SELF-CHALLENGE your journal (kill confirmation bias) — your running journal is a MEMORY AID, not a commitment. Each read, before you trust it, ask: does the CURRENT frame still support the thesis it asserts? Especially on a NET_GAMMA FLIP, a dominant_trend change, or a structure break (king / dom_neg roll reversing), a thesis that was right an hour ago may be stale NOW. If the data no longer supports your journal, SAY SO and rewrite it — do not talk yourself into a losing thesis all day. On a real trend this costs nothing (the data keeps confirming); on a whipsaw it is what saves you.

0DTE THETA — DON'T BAG-HOLD A BLEEDER: your option is a wasting asset. If a LONG isn't working and price grinds sideways, the premium melts from time decay even while your price-stop is never hit — you can lose most of the option "correctly" holding a level. Your live option P/L is shown in YOUR OPEN POSITIONS; if it's bleeding and the move you wanted isn't coming, BAIL (stand_aside, conv ≥0.6) rather than waiting for the far price-stop. (A hard −50% premium stop backstops you — but exit on your own read first.)`;

const TOOL = {
  name: 'emit_decisions', description: 'Emit the shared read plus a conservative and an aggressive decision, and update your journal. Call exactly once.',
  input_schema: {
    type: 'object', required: ['regime_read', 'dominant_trend', 'shared_thesis', 'conservative', 'aggressive', 'journal_update'],
    properties: {
      regime_read: { type: 'string' },
      dominant_trend: { type: 'object', required: ['direction', 'strength'], description: 'the DAY\'s dominant trend — trade with it by default; fading it needs high conviction', properties: { direction: { type: 'string', enum: ['up', 'down', 'chop'] }, strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] }, basis: { type: 'string', description: 'what in the price path + structure evolution + cross-index says so' } } },
      shared_thesis: { type: 'string', description: '2-4 sentences: the synthesis across map+timeline+cross-index+price that both postures share' },
      conservative: { type: 'object', required: ['instrument', 'direction', 'conviction', 'why'], properties: { instrument: { type: 'string', enum: ['SPXW', 'SPY', 'QQQ', 'none'], description: 'REQUIRED — genuinely pick the cleanest of SPXW/SPY/QQQ for THIS setup (or none if standing aside); do not omit, no silent default in either direction' }, direction: { type: 'string', enum: ['long', 'short', 'stand_aside'] }, conviction: { type: 'number', minimum: 0, maximum: 1 }, entry: { type: 'string' }, entry_type: { type: 'string', enum: ['market', 'pullback'], description: 'market = take it now; pullback = WAIT for price to come back to entry_level (buy the dip / sell the bounce) for a better fill + tighter stop' }, entry_level: { type: 'number', description: 'if entry_type=pullback, the price to wait for (long: below current spot; bearish: above)' }, target: { type: 'string' }, stop: { type: 'string' }, target_level: { type: 'number', description: 'index-points level to TAKE PROFIT (long: above entry; bearish: below). Give it for any trade — the system executes it.' }, runner_target: { type: 'number', description: 'OPTIONAL far target for ONE core RUNNER on a CONFIRMED trend (scale-out): when target_level hits, the scalp tranches bank profit and the best-entry core tranche keeps riding toward runner_target — set it FURTHER in your direction than target_level (long: above; short: below; e.g. the day-extreme / agg_king / full thesis). This is the fix for selling-too-early: take the near move on most of the stack, let a runner ride the rest to the day extreme. Leave null to exit the whole stack at target_level.' }, stop_level: { type: 'number', description: 'index-points level to STOP OUT (long: below entry; bearish: above). Give it for any trade.' }, scale_in: { type: 'boolean', description: 'set TRUE to ADD a $3k tranche to your EXISTING winning stack this tick — ONLY when the trend is confirming at a NEW structural level (price ACCEPTED a node / king rolled up / clean higher-low), never into a red stack or a late-day charm pin. The system enforces the risk floor (green stack, trend-aligned, max 4, before 14:00 ET); YOU decide the timing + level using acceptance-vs-rejection. Omit/false = HOLD the stack as-is (no new tranche); this is how you press a trend instead of churning.' }, strike_style: { type: 'string', enum: ['atm', 'itm'], description: 'which 0DTE strike to buy: "atm" (default) = at-the-money = max gamma + leverage, best for a FAST scalp expecting quick movement; "itm" = slightly in-the-money = higher delta + SLOWER theta decay, best for a CONVICTION HOLD on a trend where you sit through digestion — it survives a sideways stretch that would premium-stop an ATM contract with the thesis intact.' }, why: { type: 'string' } } },
      aggressive: { type: 'object', required: ['instrument', 'direction', 'conviction', 'why'], properties: { instrument: { type: 'string', enum: ['SPXW', 'SPY', 'QQQ', 'none'], description: 'REQUIRED — genuinely pick the cleanest of SPXW/SPY/QQQ for THIS setup (or none if standing aside); do not omit, no silent default in either direction' }, direction: { type: 'string', enum: ['long', 'short', 'stand_aside'] }, conviction: { type: 'number', minimum: 0, maximum: 1 }, entry: { type: 'string' }, entry_type: { type: 'string', enum: ['market', 'pullback'], description: 'market = take it now; pullback = WAIT for price to come back to entry_level (buy the dip / sell the bounce) for a better fill + tighter stop' }, entry_level: { type: 'number', description: 'if entry_type=pullback, the price to wait for (long: below current spot; bearish: above)' }, target: { type: 'string' }, stop: { type: 'string' }, target_level: { type: 'number', description: 'index-points level to TAKE PROFIT (long: above entry; bearish: below). Give it for any trade — the system executes it.' }, runner_target: { type: 'number', description: 'OPTIONAL far target for ONE core RUNNER on a CONFIRMED trend (scale-out): when target_level hits, the scalp tranches bank profit and the best-entry core tranche keeps riding toward runner_target — set it FURTHER in your direction than target_level (long: above; short: below; e.g. the day-extreme / agg_king / full thesis). This is the fix for selling-too-early: take the near move on most of the stack, let a runner ride the rest to the day extreme. Leave null to exit the whole stack at target_level.' }, stop_level: { type: 'number', description: 'index-points level to STOP OUT (long: below entry; bearish: above). Give it for any trade.' }, scale_in: { type: 'boolean', description: 'set TRUE to ADD a $3k tranche to your EXISTING winning stack this tick — ONLY when the trend is confirming at a NEW structural level (price ACCEPTED a node / king rolled up / clean higher-low), never into a red stack or a late-day charm pin. The system enforces the risk floor (green stack, trend-aligned, max 4, before 14:00 ET); YOU decide the timing + level using acceptance-vs-rejection. Omit/false = HOLD the stack as-is (no new tranche); this is how you press a trend instead of churning.' }, strike_style: { type: 'string', enum: ['atm', 'itm'], description: 'which 0DTE strike to buy: "atm" (default) = at-the-money = max gamma + leverage, best for a FAST scalp expecting quick movement; "itm" = slightly in-the-money = higher delta + SLOWER theta decay, best for a CONVICTION HOLD on a trend where you sit through digestion — it survives a sideways stretch that would premium-stop an ATM contract with the thesis intact.' }, why: { type: 'string' } } },
      journal_update: { type: 'string', description: 'running notes to carry to the next minute: current bias, levels watched, what triggers/invalidates' },
    },
  },
};

async function claude(system, content, tool, maxTok = 1800) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, max_tokens: maxTok, system, messages: [{ role: 'user', content }], tools: [tool], tool_choice: { type: 'tool', name: tool.name } }) });
  const j = await r.json(); if (r.status !== 200) throw new Error(`API ${r.status}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
  return (j.content || []).find(c => c.type === 'tool_use')?.input || {};
}

const MEM = path.join(FC, `agent_state_${DAY}.json`);
const sysWithLessons = () => { const L = loadLessons(); return DOCTRINE + (L.length ? `\n\nLESSONS YOU LEARNED FROM PAST SESSIONS (apply them):\n${L.map((x, i) => `${i + 1}. ${x.lesson}`).join('\n')}` : ''); };
const fmt = (d) => d && d.direction && d.direction !== 'stand_aside' ? `${d.instrument && d.instrument !== 'none' ? d.instrument + ' ' : ''}${d.direction.toUpperCase()} → tgt ${d.target_level ?? d.target ?? '?'} / stop ${d.stop_level ?? d.stop ?? '?'} (conv ${d.conviction})` : `stand aside (${d?.conviction ?? '?'})`;   // d.direction guarded (fixes the morning toUpperCase crash)

const DASH = path.join(FC, `agent_dashboard.json`);
// ── EXECUTION DISCIPLINE ── the agent sets the PLAN (direction + numeric target/stop); the book HOLDS to it.
// A position exits only on: stop hit · target hit · EOD flatten · or a genuinely high-conviction invalidation/reversal
// — never on a noisy minute-read. New entries clear a conviction bar (RAISED when fighting the dominant trend).
const ENTRY_BAR = 0.5, EXIT_BAR = 0.6;   // decisive-entry / exit-or-reverse-early. Trend-caution lives in the agent's CONVICTION (doctrine guides it) + the stop, NOT a hard counter-trend gate — keeps it agentic, not a one-day rule.
const NOTIONAL_PER_POSITION = 3000;   // FLAT $ per tranche — HARD CAP, never scaled up (never $10k on one position). Scale trend exposure by ADDING tranches, not by sizing up. Equal-notional so SPXW/SPY/QQQ are comparable.
const MAX_TRANCHES = 4;                // max concurrent same-direction tranches per posture (~$12k total on a confirmed trend)
const ADD_CUTOFF_ET = '14:00';        // no NEW tranches after this (late-day charm/pin reversal risk + little room left); existing tranches still trail to their own stop/target/EOD
const NO_NEW_ET = '15:45', FLATTEN_ET = '15:55';                  // 0DTE: no new entries late; force-flat before the close
const MAX_OPT_LOSS_PCT = -50;         // premium/theta stop when price has gone ADVERSE on a trend regime (the thesis is breaking, not just theta)
const MAX_OPT_LOSS_PCT_WIDE = -70;    // LENIENT theta cap when price still holds OR the regime is chop (positive gamma) — theta bleed is EXPECTED there, so give it room: stop the thesis breaking, not the clock ticking
const ITM_PCT = 0.0015;               // strike_style:'itm' shifts the strike ~0.15% in-the-money (higher delta, LESS theta-fragile) for a conviction hold; default 'atm' (max gamma/leverage) for a fast scalp
async function closePosition(b, pos, instruments, et, why, exitPrem) {
  if (!pos || pos._closing || !b.positions || b.positions.indexOf(pos) < 0) return;   // MUTEX (per-tranche): the fast stop-loop and the slow LLM loop share the book — never double-close the SAME tranche (flag set synchronously before any await); different tranches may close concurrently
  pos._closing = true;
  try {
    const sgn = pos.dir === 'long' ? 1 : -1, exitPx = +(instruments[pos.instrument]?.spot ?? pos.entryPx).toFixed(2);
    if (exitPrem === undefined) exitPrem = (pos.occ && DAY === TODAY_ET) ? await optMark(pos.occ) : null;   // reuse the mark manage() already fetched (no double API call)
    const optRet = (pos.entry_premium && exitPrem) ? +(((exitPrem - pos.entry_premium) / pos.entry_premium) * 100).toFixed(0) : null;
    const pnlUsd = (pos.entry_premium != null && exitPrem != null && pos.contracts != null) ? Math.round((exitPrem - pos.entry_premium) * 100 * pos.contracts) : null;   // sized $ (always long the option) — equal-notional so SPXW & SPY are comparable
    const peakPrem = Math.max(pos.peak_premium ?? 0, exitPrem ?? 0, pos.entry_premium ?? 0) || null;   // OPTION high-water-mark incl. the exit tick
    const peakRet = (pos.entry_premium && peakPrem) ? +(((peakPrem - pos.entry_premium) / pos.entry_premium) * 100).toFixed(0) : null;
    const peakCapturePct = (peakRet != null && peakRet !== 0 && optRet != null) ? Math.round(100 * optRet / peakRet) : null;   // % of the option's PEAK gain kept at exit: 100 = sold the high, <100 = gave some back to theta/reversal, <0 = round-tripped a winner into a loss
    const { _closing, ...rec } = pos;
    b.closed.push({ ...rec, exitET: et, exitPx, exit_premium: exitPrem, opt_ret_pct: optRet, peak_premium: peakPrem, peak_ret_pct: peakRet, peak_capture_pct: peakCapturePct, pnl: +((exitPx - pos.entryPx) * sgn).toFixed(1), pnl_usd: pnlUsd, why });
    const i = b.positions.indexOf(pos); if (i >= 0) b.positions.splice(i, 1);
  } finally { pos._closing = false; }
}
async function manage(book, mode, dec, instruments, et, trend) {
  if (!dec || typeof dec !== 'object') dec = { direction: 'stand_aside', conviction: 0 };   // never crash on a missing/malformed posture — treat as HOLD (manage existing tranches, open nothing)
  const b = (book[mode] ||= { positions: [], closed: [] });
  b.positions ||= (b.open ? [b.open] : []); delete b.open;   // migrate a pre-pyramid single-open book to the stack
  const inst = dec.instrument && dec.instrument !== 'none' ? dec.instrument : null;   // NO forced SPXW default — a directional decision must NAME its instrument (schema requires it); a missing one will not silently open SPX (see the !inst guard on the open block)
  const px = instruments[inst]?.spot ?? instruments.SPXW?.spot;   // px is only a spot REFERENCE for the manage loop's fallback; SPX is fine as that reference (not a trade)
  const decDir = dec.direction, conv = dec.conviction ?? 0;
  const held = b.positions;
  // a high-conviction FLIP (reverse) or stand-aside flattens the WHOLE stack this tick; the reverse then opens the opposite side below
  const wantsFlatten = decDir && ((decDir === 'stand_aside') || (held.length && held[0].dir !== decDir)) && conv >= EXIT_BAR;
  const isReverse = wantsFlatten && decDir !== 'stand_aside';
  // ── manage EACH open tranche: trail its OWN structural stop/target up (ratchet, never loosen), then exit on stop/target/premium/EOD/high-conv-flatten ──
  let mechExit = false;                                                   // a non-reverse exit this tick → go flat, no same-tick re-entry
  const core = held[0], trendAligned = (decDir === 'long' && trend === 'up') || (decDir === 'short' && trend === 'down');   // core = oldest / best-entry tranche = the RUNNER kept for scale-out on a confirmed trend
  for (const pos of [...held]) {                                          // copy — closePosition() splices b.positions
    const long = pos.dir === 'long', opx = instruments[pos.instrument]?.spot ?? px;
    if (opx != null) {   // roll the agent's CURRENT structural stop/target onto this tranche (GEX/VEX-dictated level; ratchet only)
      const s = dec.stop_level, t = dec.target_level;
      if (s != null && (long ? s < opx : s > opx) && (pos.stop_level == null || (long ? s > pos.stop_level : s < pos.stop_level))) pos.stop_level = s;   // RATCHET UP a long's stop / DOWN a short's — never loosen
      const rt = dec.runner_target, wantRunner = rt != null && trendAligned && (t == null || (long ? rt > t : rt < t));   // SCALE-OUT: the CORE (best-entry) tranche rides the FAR runner_target on a confirmed trend; the scalp tranches take the near target. Designated HERE (not at target-hit) so each tranche carries its own target and the 10s fast loop can't close the core at the near target.
      if ((pos === core && wantRunner) || pos.is_runner) { if (rt != null && (long ? rt > opx : rt < opx)) { pos.target_level = rt; pos.is_runner = true; } }
      else if (t != null && (long ? t > opx : t < opx)) pos.target_level = t;
    }
    const curPrem = (pos.occ && DAY === TODAY_ET) ? await optMark(pos.occ) : null;   // live mark — powers the theta stop + the P/L the agent sees
    if (curPrem != null) { pos.live_premium = curPrem; pos.peak_premium = Math.max(pos.peak_premium ?? curPrem, curPrem); pos.live_ret_pct = pos.entry_premium ? +(((curPrem - pos.entry_premium) / pos.entry_premium) * 100).toFixed(0) : null; pos.peak_ret_pct = (pos.entry_premium && pos.peak_premium) ? +(((pos.peak_premium - pos.entry_premium) / pos.entry_premium) * 100).toFixed(0) : null; }   // track the OPTION's high-water-mark (max premium seen), not just the last tick — powers real exit-efficiency (did we sell near the option's high?)
    const ng = instruments[pos.instrument]?.regime_now?.net_gamma_M ?? 0, priceFav = opx != null && (long ? opx >= pos.entryPx : opx <= pos.entryPx);
    const premCap = (priceFav || ng > 0) ? MAX_OPT_LOSS_PCT_WIDE : MAX_OPT_LOSS_PCT;   // regime-aware theta stop: LENIENT when price still holds OR chop (positive gamma, theta expected); TIGHT only when price has gone adverse on a trend (thesis breaking, not clock ticking)
    let why = null;
    if (opx != null && pos.stop_level != null && (long ? opx <= pos.stop_level : opx >= pos.stop_level)) why = 'stop hit';
    else if (opx != null && pos.target_level != null && (long ? opx >= pos.target_level : opx <= pos.target_level)) why = 'target hit';   // each tranche exits at its OWN target — the core rides runner_target (set in the trail), the scalps the near target
    else if (pos.live_ret_pct != null && pos.live_ret_pct <= premCap) why = `premium stop (${premCap}% ${(priceFav || ng > 0) ? 'lenient/theta' : 'adverse'})`;
    else if (et >= FLATTEN_ET) why = 'EOD flatten';
    else if (wantsFlatten) why = isReverse ? 'reversed (high conviction)' : 'exit — thesis invalidated';
    if (why) { await closePosition(b, pos, instruments, et, why, curPrem); if (!isReverse) mechExit = true; }
  }
  // ── OPEN a tranche: the FIRST position, or an ADD (pyramid) on a confirmed trend at a NEW extreme. stand-aside never opens; a reverse opens the flipped side. ──
  if (!decDir || decDir === 'stand_aside' || px == null || et >= NO_NEW_ET || !inst) return;   // !inst → the agent named no instrument; open nothing (never default to SPX)
  if (mechExit) return;                                                  // a stop/target/premium/EOD/stand-aside fired this tick → flat, re-evaluate next tick (only a reverse opens same-tick, below)
  const openCount = b.positions.length;                                   // post-close count (a reverse just flattened → 0)
  const sameDir = openCount === 0 || b.positions.every(p => p.dir === decDir);
  if (!sameDir) return;                                                   // never mix directions in one posture's stack
  const wantPullback = dec.entry_type === 'pullback' && dec.entry_level != null;
  const reached = !wantPullback || (decDir === 'long' ? px <= dec.entry_level : px >= dec.entry_level);
  let allow = false, isAdd = false;
  if (openCount === 0) allow = conv >= ENTRY_BAR && reached;              // first tranche: decisive + (resting entry) reached
  else {                                                                  // ADD (pyramid): the AGENT decides WHEN via scale_in (reasoning acceptance/rejection + structure); the code only enforces the RISK floor
    const trendOK = (decDir === 'long' && trend === 'up') || (decDir === 'short' && trend === 'down');   // coherent with the agent's OWN dominant_trend (no adding to a long while you call the trend down)
    const allGreen = b.positions.every(p => p.live_ret_pct == null || p.live_ret_pct > 0);   // never add on top of a RED stack — this IS add-to-winners (a green long stack means price is above your entries)
    allow = dec.scale_in === true && conv >= ENTRY_BAR && trendOK && allGreen && openCount < MAX_TRANCHES && et < ADD_CUTOFF_ET;   // agent-signalled add + pure risk guards (no mechanical new-high trigger — the agent's structural read decides the level)
    isAdd = true;
  }
  if (!allow) return;
  const cp = decDir === 'long' ? 'C' : 'P', step = STEP[inst] || 1;
  const refPx = dec.strike_style === 'itm' ? (decDir === 'long' ? px * (1 - ITM_PCT) : px * (1 + ITM_PCT)) : px;   // strike_style 'itm' = slightly in-the-money (higher delta, less theta-fragile — for a conviction HOLD); default ATM (max gamma/leverage — for a fast scalp)
  const strike = Math.round(refPx / step) * step;
  const occ = occOf(inst, DAY, cp, strike), premium = DAY === TODAY_ET ? await optMark(occ) : null;
  const contracts = premium ? +(NOTIONAL_PER_POSITION / (premium * 100)).toFixed(2) : null;   // FLAT $3k per tranche — hard cap, never scaled up
  const counter = (trend === 'up' && decDir === 'short') || (trend === 'down' && decDir === 'long');
  const initStop = (dec.stop_level != null && (decDir === 'long' ? dec.stop_level < px : dec.stop_level > px)) ? dec.stop_level : null;   // structural stop on the correct side of THIS entry
  const initTarget = (dec.target_level != null && (decDir === 'long' ? dec.target_level > px : dec.target_level < px)) ? dec.target_level : null;
  b.positions.push({ mode, instrument: inst, dir: decDir, entryET: et, entryPx: +px.toFixed(2), cp, strike, occ, entry_premium: premium, contracts, notional: premium ? NOTIONAL_PER_POSITION : null, tranche: openCount + 1, is_add: isAdd, target: dec.target || '', stop: dec.stop || '', target_level: initTarget, stop_level: initStop, counter_trend: counter, conviction: dec.conviction, thesis: dec.why || '' });
}
const bookLine = (book) => ['conservative', 'aggressive'].map(m => { const b = book[m] || { positions: [], closed: [] }; const ps = b.positions || (b.open ? [b.open] : []); const rp = b.closed.reduce((a, c) => a + (c.pnl_usd || 0), 0); return `${m}: ${ps.length ? `IN ${ps.length}×${ps[0].dir} ${ps[0].instrument}` : 'flat'} · realized ${rp >= 0 ? '+' : ''}$${rp} (${b.closed.length} closed)`; }).join(' | ');

const LIVE = !!arg('--live', false);
async function step(et, mem) {
  const state = await assembleComplex(et, LIVE), R = state.instruments.SPXW;
  mem.book ||= { conservative: { positions: [], closed: [] }, aggressive: { positions: [], closed: [] } };
  for (const _m of ['conservative', 'aggressive']) { const _b = mem.book[_m] ||= { positions: [], closed: [] }; _b.positions ||= (_b.open ? [_b.open] : []); delete _b.open; _b.closed ||= []; }   // migrate a pre-pyramid single-open book
  const planNote = (m) => {
    const ps = mem.book[m]?.positions || []; if (!ps.length) return `${m}: flat`;
    const dir = ps[0].dir, lines = ps.map((o, i) => `#${i + 1} ${o.instrument} ${o.strike}${o.cp} @${o.entryPx} ${o.live_ret_pct != null ? (o.live_ret_pct >= 0 ? '+' : '') + o.live_ret_pct + '%' : 'new'} stop→${o.stop_level ?? '?'}`).join(' | ');
    return `${m}: HOLDING ${ps.length}/${MAX_TRANCHES} ${dir} tranche(s) [${lines}] · tgt ${ps[0].target_level ?? '?'}. MANAGE the stack: repeat "${dir}" to HOLD as-is; set scale_in=true to ADD a $${NOTIONAL_PER_POSITION / 1000}k tranche when the trend CONFIRMS at a new structural level (price ACCEPTED a node / king rolled ${dir === 'long' ? 'up' : 'down'}) — your call, ≤${MAX_TRANCHES}, all-green, trend-aligned, before ${ADD_CUTOFF_ET} (system refuses a bad one); RAISE stop_level (STRUCTURAL — under the GEX support / king / last higher-${dir === 'long' ? 'low' : 'high'}) to trail EVERY tranche up; stand_aside/reverse (conv ≥${EXIT_BAR}) to flatten the WHOLE stack. System auto-exits each tranche at its own stop/target, a hard ${MAX_OPT_LOSS_PCT}% premium stop, and flattens all near close.`;
  };
  const bookNote = `YOUR OPEN POSITIONS & PLANS (manage them — don't re-decide from scratch):\n  ${planNote('conservative')}\n  ${planNote('aggressive')}`;
  const journal = mem.notes ? `YOUR RUNNING JOURNAL (your notes from earlier today):\n${mem.notes}\n${bookNote}` : `YOUR RUNNING JOURNAL: (empty — first read of the day)\n${bookNote}`;
  const _ng = state.instruments.SPXW?.regime_now?.net_gamma_M;   // a net_gamma sign flip is exactly when the journal thesis is most likely STALE — inject a challenge (kills confirmation-bias-all-day)
  const _flip = (mem._lastNG != null && _ng != null && Math.sign(_ng) !== Math.sign(mem._lastNG)) ? `\n\n⚠ REGIME FLIP since your last read: SPX net_gamma ${mem._lastNG}M → ${_ng}M (${mem._lastNG > 0 ? 'pinned/mean-revert' : 'accelerant/trend'} → ${_ng > 0 ? 'pinned/mean-revert' : 'accelerant/trend'}). Your journal thesis may be STALE — RE-DERIVE from THIS frame and challenge the journal before trusting it.` : '';
  if (_ng != null) mem._lastNG = _ng;
  const d = await claude(sysWithLessons(), `${journal}${_flip}\n\nFULL DATA STATE @ ${et} ET:\n${JSON.stringify(state, null, 1)}\n\nReason over ALL of it (manage any open trades) and emit your two-posture decision + journal update.`, TOOL);
  for (const k of ['conservative', 'aggressive']) { if (typeof d[k] === 'string') { try { d[k] = JSON.parse(d[k]); } catch { d[k] = { direction: 'stand_aside', conviction: 0, why: 'parse-fallback' }; } } if (!d[k] || typeof d[k] !== 'object') d[k] = { direction: 'stand_aside', conviction: 0, why: 'missing-posture' }; }   // sonnet sometimes emits a posture as a JSON string, or OMITS one entirely — default a missing/invalid posture to HOLD (stand_aside) so existing tranches are still managed (trailed/stopped/EOD) rather than crashing the tick
  const trendDir = d.dominant_trend?.direction;
  await manage(mem.book, 'conservative', d.conservative, state.instruments, et, trendDir);
  await manage(mem.book, 'aggressive', d.aggressive, state.instruments, et, trendDir);
  mem.notes = d.journal_update || mem.notes; mem.log = (mem.log || []).concat({ et, regime: d.regime_read, trend: d.dominant_trend, thesis: d.shared_thesis, conservative: d.conservative, aggressive: d.aggressive });
  // (live option P/L is set inside manage() each tick now — powers the theta safety-stop + the P/L the agent sees)
  fs.writeFileSync(MEM, JSON.stringify(mem, null, 1));
  // dashboard snapshot — SPX/SPY/QQQ + both postures' decisions + the live book + journal + lessons
  const inst = {}; for (const [sym, s] of Object.entries(state.instruments)) inst[sym] = { spot: s.spot, chg_pct: s.chg_pct, king: s.king_node, htf: s.higher_timeframe, em: s.expected_move, regime: s.regime_now, support_below: s.nearest_strong_support_below, resist_above: s.nearest_strong_resistance_above, dom_neg_roll: s.structure_timeline_30m.map(t => t.dom_neg_strike), strong_nodes: s.strong_nodes_wide, path: s.price_path_30m };
  fs.writeFileSync(DASH, JSON.stringify({ day: DAY, as_of_et: et, instruments: inst, uw_layers: state.uw_layers, decision: { regime_read: d.regime_read, dominant_trend: d.dominant_trend, shared_thesis: d.shared_thesis, conservative: d.conservative, aggressive: d.aggressive }, book: mem.book, journal: mem.notes, lessons: loadLessons() }, null, 1));
  console.log(`\n─── @ ${et} ET · SPX ${R.spot} (${R.chg_pct >= 0 ? '+' : ''}${R.chg_pct}%) · trend ${d.dominant_trend?.direction || '?'}/${d.dominant_trend?.strength || ''} · regime ${R.regime_now.net_gamma_M}M ───`);
  console.log(`  CONSERVATIVE: ${fmt(d.conservative)}`);
  console.log(`  AGGRESSIVE:   ${fmt(d.aggressive)}`);
  console.log(`  book: ${bookLine(mem.book)}`);
  return mem;
}

const arr = (v) => Array.isArray(v) ? v : typeof v === 'string' ? v.replace(/<!\[CDATA\[|\]\]>/g, '').split('\n').map(s => s.replace(/^\s*[\d.\-)]+\s*/, '').trim()).filter(Boolean) : Object.values(v || {}).map(String);
const DIARY_FILE = path.join(FC, 'agent_diary.json');
const loadDiary = () => fs.existsSync(DIARY_FILE) ? JSON.parse(fs.readFileSync(DIARY_FILE, 'utf8')) : [];
// standing instrumentation: exit-reason mix + conviction calibration across ALL recorded days — makes the theta-tax + conviction-degeneracy hypotheses visible on every --reflect
function tradeStats() {
  let trades = [];
  try { for (const f of fs.readdirSync(FC).filter(f => /^agent_state_2026-\d\d-\d\d\.json$/.test(f))) { const m = JSON.parse(fs.readFileSync(path.join(FC, f), 'utf8')); for (const mode of ['conservative', 'aggressive']) for (const t of (m.book?.[mode]?.closed || [])) trades.push({ why: t.why || '', conv: t.conviction, pnl: t.pnl, usd: t.pnl_usd }); } } catch { }
  const cat = w => /premium stop/.test(w) ? 'premium_stop' : /stop hit/.test(w) ? 'price_stop' : /target/.test(w) ? 'target' : /EOD/.test(w) ? 'EOD_flatten' : /reversed/.test(w) ? 'reverse' : /invalidated/.test(w) ? 'standaside_exit' : 'other';
  const N = trades.length || 1, byReason = {};
  for (const t of trades) { const c = cat(t.why); (byReason[c] ||= { n: 0, usd: 0 }); byReason[c].n++; byReason[c].usd += (t.usd || 0); }
  const reasonStr = Object.entries(byReason).sort((a, b) => b[1].n - a[1].n).map(([c, v]) => `${c} ${v.n} (${Math.round(100 * v.n / N)}%, net $${v.usd})`).join(' · ') || 'none';
  const wc = trades.filter(t => t.conv != null && t.pnl != null);
  const buckets = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1.01]].map(([lo, hi]) => { const b = wc.filter(t => t.conv >= lo && t.conv < hi); return `${lo}-${hi}: n=${b.length}${b.length ? ` (win ${Math.round(100 * b.filter(t => t.pnl > 0).length / b.length)}%, avg ${(b.reduce((a, t) => a + t.pnl, 0) / b.length).toFixed(1)}pt)` : ''}`; }).join(' | ');
  const cv = wc.map(t => t.conv), mode = cv.length ? [...cv].sort((a, b) => cv.filter(v => v === a).length - cv.filter(v => v === b).length).pop() : null;
  const degen = cv.length ? `${Math.round(100 * cv.filter(v => v === mode).length / cv.length)}% of trades at ONE conviction value (${mode}); ${new Set(cv).size} distinct values across ${cv.length} trades` : 'n/a';
  return { total: trades.length, reasonStr, buckets, degen };
}
// exit efficiency: did we sell near the favorable extreme? UNDERLYING (exit spot vs the day's extreme after entry, from frames) + OPTION (exit vs the tracked premium peak)
function exitEfficiency(day, book) {
  const ld = (sym) => { try { return zlib.gunzipSync(fs.readFileSync(path.join(FC, 'archive', `${day}_${sym}.jsonl.gz`))).toString().trim().split('\n').map(l => { const f = JSON.parse(l); return { et: etOf(f.ts), spot: +f.spot }; }); } catch { return []; } };
  const paths = { SPXW: ld('SPXW'), SPY: ld('SPY'), QQQ: ld('QQQ') }, rows = [];
  for (const mode of ['conservative', 'aggressive']) for (const t of (book?.[mode]?.closed || [])) {
    const p = paths[t.instrument]; let uEff = null, uLeft = null;
    if (p?.length && t.entryPx != null && t.exitPx != null) {
      const ei = p.findIndex(x => x.et >= t.entryET), after = ei >= 0 ? p.slice(ei) : [];
      if (after.length) { const short = t.dir === 'short', ext = short ? after.reduce((a, x) => x.spot < a.spot ? x : a) : after.reduce((a, x) => x.spot > a.spot ? x : a);
        const avail = short ? (t.entryPx - ext.spot) : (ext.spot - t.entryPx), capt = short ? (t.entryPx - t.exitPx) : (t.exitPx - t.entryPx);
        uEff = avail > 0.5 ? Math.round(100 * capt / avail) : null; uLeft = +(avail - capt).toFixed(1); } }
    rows.push({ mode, tag: `${t.entryET}->${t.exitET} ${t.instrument} ${t.dir}`, optCapture: t.peak_capture_pct ?? null, peakRet: t.peak_ret_pct ?? null, optRet: t.opt_ret_pct ?? null, uEff, uLeft, pnl: t.pnl_usd });
  }
  return rows;
}

// --reflect: review today vs outcomes → append to the PERMANENT diary (raw experience). Does NOT touch durable lessons.
async function reflect() {
  const mem = fs.existsSync(MEM) ? JSON.parse(fs.readFileSync(MEM, 'utf8')) : null;
  if (!mem?.log?.length) { console.log('no decision log to reflect on — run --sequence first'); return; }
  const _B = mem.book || {};   // focus the review on the actual TRADES + a sampled decision arc — sending all ~275 ticks (~750KB) drowned the model and it returned only a grade
  const trades = ['conservative', 'aggressive'].flatMap(mode => (_B[mode]?.closed || []).map(t => ({ mode, when: `${t.entryET}->${t.exitET}`, inst: t.instrument, dir: t.dir, strike: `${t.strike}${t.cp}`, conv: t.conviction, opt_ret_pct: t.opt_ret_pct, pnl_usd: t.pnl_usd, why: t.why })));
  const arc = mem.log.filter((e, i) => i % 10 === 0 || i === mem.log.length - 1).map(e => ({ et: e.et, trend: e.trend?.direction, agg: `${e.aggressive?.direction} (${e.aggressive?.conviction})`, next45m: outcomeAfter(e.et) }));
  const review = { trades, decision_arc_sampled: arc };
  const S = tradeStats();
  const EFF = exitEfficiency(DAY, mem.book);
  const effStr = EFF.length ? EFF.map(r => `${r.mode[0]} ${r.tag}: underlying ${r.uEff != null ? r.uEff + '% captured (left ' + r.uLeft + 'pt on the table)' : 'n/a'}${r.optCapture != null ? ` · option sold at ${r.optCapture}% of its peak (peaked +${r.peakRet}%, exited +${r.optRet}%)` : ' · option-peak n/a (tracking starts today)'}`).join('\n  ') : 'no closed trades today';
  const out = await claude(
    `You are the same 0DTE agent REVIEWING your own decisions today against what price actually did, to build EXPERIENCE. Compare conservative vs aggressive vs the real outcome; be blunt where you were too cautious or too aggressive. ALSO explicitly GRADE the system's execution behaviors so we can VALIDATE them across many days (never conclude from one): (1) HOLD-TO-TARGET — did holding winners to their target help or hurt vs exiting sooner? (2) FORCED EXITS — did any stop-out or 15:55 EOD-flatten save or cost money? (3) TREND-COMMITMENT — did trading WITH the dominant trend help, and would any counter-trend trade have worked or failed? (4) THETA-TAX & CONVICTION — grade the STANDING METRICS given below (across ALL recorded days): does the exit-reason mix show PREMIUM-STOPS taxing the edge (a theta/strike-selection tax, not a market read)? Is CONVICTION degenerate — nearly all trades at ONE value, so the number carries no information and the entry/exit bars are arbitrary dials? Do higher-conviction buckets actually produce better outcomes (do they rank-order)? (5) EXIT EFFICIENCY / SOLD-TOO-EARLY — grade the EXIT EFFICIENCY data below: did you sell/cover near the favorable extreme, or leave a big chunk of the move on the table (low underlying-capture %, low option-peak-capture %)? On a TREND day especially, was the target set too CLOSE to your own thesis, forcing a target-out-then-re-chase instead of holding ONE runner toward the day extreme? Sold-too-early is the #1 trend-day tax. These are HYPOTHESES on trial, not settled — say if today's evidence supports or undercuts each. Record OBSERVATIONS (what you saw and how it resolved) and PROVISIONAL lessons (tentative — one day is not proof). This goes into a permanent multi-day diary; durable lessons are distilled later across many days, so do NOT overclaim from one session.`,
    `Your decisions today (${DAY}) and actual outcomes:\n${JSON.stringify(review, null, 1)}\n\nSTANDING METRICS (all ${S.total} recorded closed trades, all days):\n  exit-reason mix: ${S.reasonStr}\n  conviction→outcome buckets: ${S.buckets}\n  conviction spread: ${S.degen}\n\nEXIT EFFICIENCY TODAY (did you sell near the favorable extreme? underlying = exit spot vs the day's extreme after entry; option = exit vs the option's premium peak):\n  ${effStr}\n\nWrite today's diary entry.`,
    { name: 'emit_diary', description: "today's diary entry", input_schema: { type: 'object', required: ['grade', 'observations', 'provisional_lessons'], properties: { grade: { type: 'string' }, observations: { type: 'array', items: { type: 'string' }, description: 'what you saw today + how it resolved (the raw record)' }, provisional_lessons: { type: 'array', items: { type: 'string' }, description: 'tentative takeaways — hypotheses, not yet doctrine' } } } }, 2800);
  const entry = { day: DAY, grade: out.grade, observations: arr(out.observations), provisional_lessons: arr(out.provisional_lessons) };
  const diary = loadDiary().filter(d => d.day !== DAY).concat(entry);   // one entry per day; re-reflect replaces today's
  fs.writeFileSync(DIARY_FILE, JSON.stringify(diary, null, 1));
  console.log(`\n═══ STANDING METRICS (all ${S.total} recorded closed trades) ═══\n  exit-reason mix: ${S.reasonStr}\n  conviction→outcome: ${S.buckets}\n  conviction spread: ${S.degen}`);
  console.log(`\n═══ EXIT EFFICIENCY · ${DAY} (did we sell near the favorable extreme?) ═══\n  ${effStr}`);
  console.log(`\n═══ DIARY · ${DAY} (day ${diary.length} of the record) ═══\n  self-grade: ${out.grade}\n  provisional lessons (hypotheses, not yet doctrine):`);
  entry.provisional_lessons.forEach((l, i) => console.log(`   ${i + 1}. ${l}`));
  console.log(`\n  → appended to agent_diary.json (${diary.length} days). Durable lessons update only on --distill (needs the pattern to RECUR).`);
}

// --distill: read the WHOLE diary → promote only lessons that RECUR across days → agent_lessons.json (the durable doctrine).
async function distill() {
  const diary = loadDiary(), prior = loadLessons(), force = arg('--force', false);
  const FIRST_MIN = 5, INTERVAL = 5;                                    // first durable lessons need ~a week; then re-review ~weekly
  const lastDays = prior.length ? Math.max(...prior.map(p => p.days || 0)) : 0;
  if (diary.length < FIRST_MIN && !force) { console.log(`diary has ${diary.length} day(s) — need ≥${FIRST_MIN} (about a week) before the FIRST durable lessons; a single day is a hypothesis, not doctrine. Keep running --reflect daily. (--force to override.)`); return; }
  if (prior.length && diary.length - lastDays < INTERVAL && !force) { console.log(`only ${diary.length - lastDays} new day(s) since the last distill (at ${lastDays} days) — cadence is ~weekly. Wait for ${INTERVAL} new days so changes are evidence-driven, not reactive. (--force to override.)`); return; }
  const out = await claude(
    `You distill DURABLE trading lessons from a multi-day diary. STRICT anti-overfit discipline:
- A pattern seen on only ONE day is a HYPOTHESIS, not a lesson — do NOT promote it. Promote only what RECURS across multiple days.
- If diary days CONTRADICT each other, flag the tension; do NOT just pick the most recent day.
- Keep lessons FEW (max 7) and GENERAL/transferable (judgment about reading regime, node evolution, timing, risk) — never day-specific.
- Strongly prefer KEEPING an existing durable lesson over churning it; only revise one if multiple days clearly warrant it. Stability over reactivity.`,
    `EXISTING durable lessons:\n${prior.length ? prior.map((x, i) => `${i + 1}. ${x.lesson}`).join('\n') : '(none yet)'}\n\nDIARY (${diary.length} days):\n${JSON.stringify(diary, null, 1)}\n\nDistill the durable lesson set (mostly stable; only change what the multi-day record justifies).`,
    { name: 'emit_durable', description: 'durable cross-day lessons', input_schema: { type: 'object', required: ['durable_lessons', 'note'], properties: { durable_lessons: { type: 'array', items: { type: 'string' }, description: 'max 7 lessons confirmed across multiple days' }, note: { type: 'string', description: 'what changed vs prior and why (or "no change")' } } } }, 1600);
  const lessons = arr(out.durable_lessons).slice(0, 7);
  fs.writeFileSync(LESSONS_FILE, JSON.stringify(lessons.map(l => ({ days: diary.length, lesson: l })), null, 1));
  console.log(`\n═══ DISTILL · ${diary.length}-day diary → durable lessons ═══\n  change: ${out.note}\n  DURABLE LESSONS (re-injected into every future decision):`);
  lessons.forEach((l, i) => console.log(`   ${i + 1}. ${l}`));
}

// ── LIVE: pull one Skylit GEX/VEX frame for a symbol (same auth/headers as the app) ──
async function pullLiveGEX(sym) {
  if (!_skReady) { await initAuth(); _skReady = true; }
  const t = await getFreshToken();
  const u = new URL('https://app.skylit.ai/api/data');
  u.searchParams.set('symbol', sym); u.searchParams.set('max_strikes', '200'); u.searchParams.set('max_expirations', '10'); u.searchParams.set('nocache', Math.random().toString());
  const r = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: 'Bearer ' + t, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || !r.ok) return null; const raw = await r.json(); if (raw.CurrentSpot == null) return null;
  const spot = raw.CurrentSpot, K = raw.Strikes || [], G = raw.GammaValues || [], V = raw.VannaValues || [], EXP = raw.Expirations || [], strikes = [];
  const sum = (a) => (a || []).reduce((s, x) => s + (+x || 0), 0);   // aggregate across ALL expiries = the full-surface (multi-day) structure
  for (let i = 0; i < K.length; i++) { const k = +K[i]; if (Number.isFinite(k) && Math.abs(k - spot) / spot <= 0.025) strikes.push({ k, g0: (G[i] || [])[0] || 0, v0: (V[i] || [])[0] || 0, gA: sum(G[i]), vA: sum(V[i]) }); }   // g0/v0 = 0DTE (col0); gA/vA = aggregate/full-surface. window widened to ±2.5% to catch the higher-TF walls.
  return { ts: new Date().toISOString(), spot, prevClose: raw.PreviousClose, frontExp: EXP[0], strikes };
}
// ── FAST half of the split loop: price-stop / price-target execution every FAST_SEC sec, NO LLM, so a stop fires in seconds instead of waiting on the ~90s reasoning tick ──
async function fastSpot(sym) {   // lightweight real-time spot — the SAME Skylit CurrentSpot the agent's stop/target levels are set against (max_strikes=1 = tiny payload)
  try {
    if (!_skReady) { await initAuth(); _skReady = true; }
    const t = await getFreshToken();
    const u = new URL('https://app.skylit.ai/api/data');
    u.searchParams.set('symbol', sym); u.searchParams.set('max_strikes', '1'); u.searchParams.set('max_expirations', '1'); u.searchParams.set('nocache', Math.random().toString());
    const r = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: 'Bearer ' + t, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' }, signal: AbortSignal.timeout(6000) }).catch(() => null);
    if (!r || !r.ok) return null; const raw = await r.json(); const v = +raw?.CurrentSpot; return Number.isFinite(v) ? v : null;
  } catch { return null; }
}
const FAST_SEC = 10;   // fast-loop cadence. Only pulls a spot when a position is actually OPEN (0 calls when flat) → legitimate position-monitoring, not high-frequency scraping.
let _fastBusy = false;   // reentrancy guard so a slow spot pull can't stack overlapping fast ticks
async function fastStops(mem) {   // price-stop / price-target ONLY. Trailing, premium/theta stop, EOD flatten, and all OPENS stay on the slow LLM tick.
  if (_fastBusy || !mem?.book) return; _fastBusy = true;
  try {
    const et = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5);
    const m = (+et.slice(0, 2)) * 60 + (+et.slice(3, 5)); if (m < 9 * 60 + 30 || m > 16 * 60) return;   // RTH only
    const spotCache = {};   // one spot pull per instrument per fast tick (tranches usually share the trend instrument)
    for (const mode of ['conservative', 'aggressive']) {
      const b = mem.book[mode]; if (!b?.positions?.length) continue;
      for (const pos of [...b.positions]) {   // copy — closePosition() splices; each tranche has its OWN structural stop
        if (pos._closing || (pos.stop_level == null && pos.target_level == null)) continue;
        const long = pos.dir === 'long';
        if (!(pos.instrument in spotCache)) spotCache[pos.instrument] = await fastSpot(pos.instrument);
        const spot = spotCache[pos.instrument]; if (spot == null) continue;
        let why = null;   // mirrors the slow loop's manage() price checks so both halves agree on what a breach is
        if (pos.stop_level != null && (long ? spot <= pos.stop_level : spot >= pos.stop_level)) why = 'stop hit (fast)';
        else if (pos.target_level != null && (long ? spot >= pos.target_level : spot <= pos.target_level)) why = 'target hit (fast)';
        if (why && !pos._closing) {   // closePosition re-checks the per-tranche mutex; the slow manage() shares this book + guard, so the two halves never double-close
          await closePosition(b, pos, { [pos.instrument]: { spot } }, et, why);
          try { fs.writeFileSync(MEM, JSON.stringify(mem, null, 1)); } catch { }
          console.log(`  ⚡ FAST-EXIT · ${why} @${et} · ${pos.instrument} ${pos.strike}${pos.cp} ${pos.dir} #${pos.tranche ?? '?'} @ ${spot} (${mode})`);
        }
      }
    }
  } finally { _fastBusy = false; }
}
// ── LIVE loop (SLOW half): every minute during RTH, refresh the GEX buffer + reason + write the dashboard ──
async function loop() {
  const bufs = { SPXW: [], SPY: [], QQQ: [] };
  // resume today's FRAMES on restart (durability, BUGS #3): reload from the dated archive so a restart never loses the day's GEX history
  try { fs.mkdirSync(path.join(FC, 'archive'), { recursive: true }); } catch { }
  for (const sym of ['SPXW', 'SPY', 'QQQ']) { const af = path.join(FC, 'archive', `${DAY}_${sym}.jsonl.gz`); if (fs.existsSync(af)) { try { bufs[sym] = zlib.gunzipSync(fs.readFileSync(af)).toString().trim().split('\n').map(l => JSON.parse(l)); } catch { } } }
  if (bufs.SPXW.length) console.log(`  ↺ resumed ${bufs.SPXW.length} frames from today's archive (no data lost on restart)`);
  // resume today's book/journal on restart so the full day of plays survives (step() saves mem to MEM each tick)
  let mem = fs.existsSync(MEM) ? (() => { try { return JSON.parse(fs.readFileSync(MEM, 'utf8')); } catch { return null; } })() : null;
  if (!mem || mem.day !== DAY) mem = { day: DAY, notes: '', log: [] };
  mem.book ||= { conservative: { positions: [], closed: [] }, aggressive: { positions: [], closed: [] } };
  for (const _m of ['conservative', 'aggressive']) { const _b = mem.book[_m] ||= { positions: [], closed: [] }; _b.positions ||= (_b.open ? [_b.open] : []); delete _b.open; _b.closed ||= []; }   // migrate a pre-pyramid single-open book on resume
  const nplays = () => mem.book.conservative.closed.length + mem.book.aggressive.closed.length;
  const idleDash = (status) => { try { fs.writeFileSync(DASH, JSON.stringify({ day: DAY, as_of_et: new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5), status, instruments: {}, uw_layers: {}, decision: {}, book: mem.book, journal: mem.notes || '', lessons: loadLessons() }, null, 1)); } catch (e) { } };
  idleDash('agent starting — clearing prior state…');   // wipe the stale (e.g. backtest) dashboard immediately
  console.log(`\n  🦅 agent LIVE loop started (${DAY}) · ${nplays()} plays so far today · dashboard → http://localhost:8790 · Ctrl-C to stop\n`);
  setInterval(() => { fastStops(mem).catch(() => { }); }, FAST_SEC * 1000);   // ⚡ FAST stop/target loop runs CONCURRENTLY with the slow reasoning loop below — checks the live price of any open position every FAST_SEC sec and exits the moment it breaches stop/target, no LLM wait
  console.log(`  ⚡ fast stop-loop armed · checks open-position price every ${FAST_SEC}s (stops fire in seconds, not on the ~90s reasoning tick)\n`);
  for (; ;) {
    const et = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5);
    const m = (+et.slice(0, 2)) * 60 + (+et.slice(3, 5));
    if (m >= 9 * 60 + 30 && m <= 16 * 60) {
      try {
        for (const sym of ['SPXW', 'SPY', 'QQQ']) { const f = await pullLiveGEX(sym); if (f) { bufs[sym].push(f); const gz = zlib.gzipSync(bufs[sym].map(x => JSON.stringify(x)).join('\n') + '\n'); fs.writeFileSync(path.join(FC, `today_${sym}.jsonl.gz`), gz); fs.writeFileSync(path.join(FC, 'archive', `${DAY}_${sym}.jsonl.gz`), gz); } }   // uncapped now (full-day archive); dated copy survives the next day's overwrite. assembleInstrument only reads the last ~30 frames so the prompt doesn't grow.
        if (bufs.SPXW.length) mem = await step(et, mem);
      } catch (e) { console.log(`  ${et} loop error: ${e.message.slice(0, 90)}`); }
    } else { console.log(`  ${et} ET · market closed — idle`); idleDash(`market ${m < 9 * 60 + 30 ? 'not open yet' : 'closed'} — agent idle · ${nplays()} plays today`); }
    await new Promise(r => setTimeout(r, 60000));
  }
}

if (arg('--loop', false)) await loop();
else if (arg('--distill', false)) await distill();
else if (arg('--reflect', false)) await reflect();
else { const seq = arg('--sequence', null); let mem = { day: DAY, notes: '', log: [] }; if (seq) { for (const et of String(seq).split(',')) mem = await step(et.trim(), mem); } else await step(arg('--et', '15:00'), mem); }
