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
  const band = s.strikes.filter(n => Math.abs(n.k - spot) <= I.band), path30 = F.slice(Math.max(0, idx - 30), idx + 1).map(f => +f.spot.toFixed(1));
  return {
    symbol: sym, spot: +spot.toFixed(2), chg_pct: +(((spot - s.prevClose) / s.prevClose) * 100).toFixed(2), session_high: Math.max(...path30), session_low: Math.min(...path30),
    price_path_30m: path30, structure_timeline_30m: timeline,
    king_node: king ? { strike: king.k, gex_M: M(king.g0) } : null,
    nearest_strong_support_below: floor ? { strike: floor.k, gex_M: M(floor.g0) } : null,
    nearest_strong_resistance_above: ceil ? { strike: ceil.k, gex_M: M(ceil.g0) } : null,
    regime_now: { neg_strikes: band.filter(n => n.g0 < 0).length, pos_strikes: band.filter(n => n.g0 > 0).length, net_gamma_M: netOf(s), net_vanna_M: M(band.reduce((a, c) => a + (c.v0 || 0), 0)) },
    strong_nodes_wide: strongWide, gex_vex_map_now: map,   // gex_M = 0DTE gamma, vex_M = 0DTE vanna, per strike
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
async function liveLayers() {
  const [dp, tide] = await Promise.all([skylitDarkPool(), skylitTide()]);
  return { source: 'skylit (Flowseeker /fs/api)', dark_pool_prints: dp, market_tide_flow_lean: tide, vix: null, note: 'dark-pool = real prints (venue/notional); flow lean = tide net call−put premium. Granular flow tape is the wss://fs-ws.skylit.ai multiplexed stream (not polled here). VIX endpoint TBD.' };
}
async function assembleComplex(etStr, live = false) {
  const instruments = {}; for (const sym of ['SPXW', 'SPY', 'QQQ']) { const a = assembleInstrument(sym, etStr); if (a) instruments[sym] = a; }
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
- structure_timeline_30m = last 30 min at 6-min steps. THIS is the edge over a snapshot: watch dom_neg_M grow (conviction building at a wall) and dom_neg_strike ROLL DOWN (ceiling chasing price = top confirming), and net_gamma shift (regime change).

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

MANAGE THE POSITION — DON'T RE-DECIDE IT EVERY MINUTE
- If you already HOLD a trade, your job is to MANAGE YOUR PLAN, not re-open the question. Repeat the SAME direction to HOLD. Only exit (stand_aside) or reverse when the thesis is genuinely INVALIDATED — your stop is breached or the structure that justified the trade has flipped — and then with HIGH conviction (≥0.6). Do NOT dump a valid position because momentum wobbled for one minute. Let winners run to your target; that is where the money is.
- Every non-stand_aside decision MUST include a numeric target_level and stop_level (index points, on the correct side: for a long, target above / stop below spot; for a bearish/short, target below / stop above). The SYSTEM EXECUTES them — it takes profit at your target, stops out at your stop, HOLDS in between regardless of minute-to-minute noise, and force-flattens near the close. Set them where you truly want in and out; they are your plan and they will be honored.`;

const TOOL = {
  name: 'emit_decisions', description: 'Emit the shared read plus a conservative and an aggressive decision, and update your journal. Call exactly once.',
  input_schema: {
    type: 'object', required: ['regime_read', 'dominant_trend', 'shared_thesis', 'conservative', 'aggressive', 'journal_update'],
    properties: {
      regime_read: { type: 'string' },
      dominant_trend: { type: 'object', required: ['direction', 'strength'], description: 'the DAY\'s dominant trend — trade with it by default; fading it needs high conviction', properties: { direction: { type: 'string', enum: ['up', 'down', 'chop'] }, strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] }, basis: { type: 'string', description: 'what in the price path + structure evolution + cross-index says so' } } },
      shared_thesis: { type: 'string', description: '2-4 sentences: the synthesis across map+timeline+cross-index+price that both postures share' },
      conservative: { type: 'object', required: ['direction', 'conviction', 'why'], properties: { instrument: { type: 'string', enum: ['SPXW', 'SPY', 'QQQ', 'none'] }, direction: { type: 'string', enum: ['long', 'short', 'stand_aside'] }, conviction: { type: 'number', minimum: 0, maximum: 1 }, entry: { type: 'string' }, target: { type: 'string' }, stop: { type: 'string' }, target_level: { type: 'number', description: 'index-points level to TAKE PROFIT (long: above entry; bearish: below). Give it for any trade — the system executes it.' }, stop_level: { type: 'number', description: 'index-points level to STOP OUT (long: below entry; bearish: above). Give it for any trade.' }, why: { type: 'string' } } },
      aggressive: { type: 'object', required: ['direction', 'conviction', 'why'], properties: { instrument: { type: 'string', enum: ['SPXW', 'SPY', 'QQQ', 'none'] }, direction: { type: 'string', enum: ['long', 'short', 'stand_aside'] }, conviction: { type: 'number', minimum: 0, maximum: 1 }, entry: { type: 'string' }, target: { type: 'string' }, stop: { type: 'string' }, target_level: { type: 'number', description: 'index-points level to TAKE PROFIT (long: above entry; bearish: below). Give it for any trade — the system executes it.' }, stop_level: { type: 'number', description: 'index-points level to STOP OUT (long: below entry; bearish: above). Give it for any trade.' }, why: { type: 'string' } } },
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
const ENTRY_BAR = 0.5, COUNTER_TREND_BAR = 0.7, EXIT_BAR = 0.6;   // open-aligned / open-counter-trend / exit-or-reverse-early
const NO_NEW_ET = '15:45', FLATTEN_ET = '15:55';                  // 0DTE: no new entries late; force-flat before the close
async function closeOpen(b, instruments, et, why) {
  const o = b.open, sgn = o.dir === 'long' ? 1 : -1, exitPx = +(instruments[o.instrument]?.spot ?? o.entryPx).toFixed(2);
  const exitPrem = (o.occ && DAY === TODAY_ET) ? await optMark(o.occ) : null;
  const optRet = (o.entry_premium && exitPrem) ? +(((exitPrem - o.entry_premium) / o.entry_premium) * 100).toFixed(0) : null;
  b.closed.push({ ...o, exitET: et, exitPx, exit_premium: exitPrem, opt_ret_pct: optRet, pnl: +((exitPx - o.entryPx) * sgn).toFixed(1), why });
  b.open = null;
}
async function manage(book, mode, dec, instruments, et, trend) {
  const b = (book[mode] ||= { open: null, closed: [] });
  const inst = dec.instrument && dec.instrument !== 'none' ? dec.instrument : 'SPXW';
  const px = instruments[inst]?.spot ?? instruments.SPXW?.spot;
  // ── manage an OPEN position: HOLD to the plan; exit only on stop/target/EOD or a high-conviction invalidation ──
  if (b.open) {
    const o = b.open, opx = instruments[o.instrument]?.spot ?? px, long = o.dir === 'long';
    let why = null, reverse = false;
    if (opx != null && o.stop_level != null && (long ? (o.stop_level < o.entryPx && opx <= o.stop_level) : (o.stop_level > o.entryPx && opx >= o.stop_level))) why = 'stop hit';
    else if (opx != null && o.target_level != null && (long ? (o.target_level > o.entryPx && opx >= o.target_level) : (o.target_level < o.entryPx && opx <= o.target_level))) why = 'target hit';
    else if (et >= FLATTEN_ET) why = 'EOD flatten';
    else { const wantsOut = dec.direction === 'stand_aside' || (dec.direction && dec.direction !== o.dir);
      if (wantsOut && (dec.conviction ?? 0) >= EXIT_BAR) { why = dec.direction === 'stand_aside' ? 'exit — thesis invalidated' : 'reversed (high conviction)'; reverse = dec.direction !== 'stand_aside'; } }
    if (!why) return;                                     // HOLD — plan intact; don't touch anything else this tick
    await closeOpen(b, instruments, et, why);
    if (!reverse) return;                                 // mechanical / stand-aside close → go flat, no same-tick re-entry
  }
  // ── OPEN a new position: flat + decisive + clears the bar (HIGHER if counter-trend) + before the late-day cutoff ──
  if (!b.open && dec.direction && dec.direction !== 'stand_aside' && px != null && et < NO_NEW_ET) {
    const counter = (trend === 'up' && dec.direction === 'short') || (trend === 'down' && dec.direction === 'long');
    if ((dec.conviction ?? 0) >= (counter ? COUNTER_TREND_BAR : ENTRY_BAR)) {
      const cp = dec.direction === 'long' ? 'C' : 'P', step = STEP[inst] || 1, strike = Math.round(px / step) * step;   // the 0DTE ATM option we'd buy
      const occ = occOf(inst, DAY, cp, strike), premium = DAY === TODAY_ET ? await optMark(occ) : null;
      b.open = { mode, instrument: inst, dir: dec.direction, entryET: et, entryPx: +px.toFixed(2), cp, strike, occ, entry_premium: premium, target: dec.target || '', stop: dec.stop || '', target_level: dec.target_level ?? null, stop_level: dec.stop_level ?? null, counter_trend: counter, conviction: dec.conviction, thesis: dec.why || '' };
    }
  }
}
const bookLine = (book) => ['conservative', 'aggressive'].map(m => { const b = book[m] || { open: null, closed: [] }; const rp = b.closed.reduce((a, c) => a + c.pnl, 0); return `${m}: ${b.open ? `IN ${b.open.instrument} ${b.open.dir} @${b.open.entryPx}` : 'flat'} · realized ${rp >= 0 ? '+' : ''}${rp.toFixed(1)}pt (${b.closed.length} closed)`; }).join(' | ');

const LIVE = !!arg('--live', false);
async function step(et, mem) {
  const state = await assembleComplex(et, LIVE), R = state.instruments.SPXW;
  mem.book ||= { conservative: { open: null, closed: [] }, aggressive: { open: null, closed: [] } };
  const planNote = (m) => { const o = mem.book[m].open; return o ? `${m}: HOLDING ${o.instrument} ${o.dir} from ${o.entryET} @${o.entryPx} (target ${o.target_level ?? (o.target || '?')}, stop ${o.stop_level ?? (o.stop || '?')}) — MANAGE it: repeat "${o.dir}" to HOLD; stand_aside/reverse ONLY if genuinely invalidated (conv ≥0.6). The system auto-exits at your target/stop and flattens near the close.` : `${m}: flat`; };
  const bookNote = `YOUR OPEN POSITIONS & PLANS (manage them — don't re-decide from scratch):\n  ${planNote('conservative')}\n  ${planNote('aggressive')}`;
  const journal = mem.notes ? `YOUR RUNNING JOURNAL (your notes from earlier today):\n${mem.notes}\n${bookNote}` : `YOUR RUNNING JOURNAL: (empty — first read of the day)\n${bookNote}`;
  const d = await claude(sysWithLessons(), `${journal}\n\nFULL DATA STATE @ ${et} ET:\n${JSON.stringify(state, null, 1)}\n\nReason over ALL of it (manage any open trades) and emit your two-posture decision + journal update.`, TOOL);
  for (const k of ['conservative', 'aggressive']) if (typeof d[k] === 'string') { try { d[k] = JSON.parse(d[k]); } catch { d[k] = { direction: 'stand_aside', conviction: 0, why: 'parse-fallback' }; } }   // sonnet sometimes emits the nested posture as a JSON string
  const trendDir = d.dominant_trend?.direction;
  await manage(mem.book, 'conservative', d.conservative, state.instruments, et, trendDir);
  await manage(mem.book, 'aggressive', d.aggressive, state.instruments, et, trendDir);
  mem.notes = d.journal_update || mem.notes; mem.log = (mem.log || []).concat({ et, regime: d.regime_read, trend: d.dominant_trend, thesis: d.shared_thesis, conservative: d.conservative, aggressive: d.aggressive });
  // running option P/L on any OPEN position (live mark each tick, so the % ticks in real time)
  for (const mm of ['conservative', 'aggressive']) { const o = mem.book[mm]?.open; if (o?.occ && DAY === TODAY_ET) { const mk = await optMark(o.occ); if (mk != null) { o.live_premium = mk; o.live_ret_pct = o.entry_premium ? +(((mk - o.entry_premium) / o.entry_premium) * 100).toFixed(0) : null; } } }
  fs.writeFileSync(MEM, JSON.stringify(mem, null, 1));
  // dashboard snapshot — SPX/SPY/QQQ + both postures' decisions + the live book + journal + lessons
  const inst = {}; for (const [sym, s] of Object.entries(state.instruments)) inst[sym] = { spot: s.spot, chg_pct: s.chg_pct, king: s.king_node, regime: s.regime_now, support_below: s.nearest_strong_support_below, resist_above: s.nearest_strong_resistance_above, dom_neg_roll: s.structure_timeline_30m.map(t => t.dom_neg_strike), strong_nodes: s.strong_nodes_wide, path: s.price_path_30m };
  fs.writeFileSync(DASH, JSON.stringify({ day: DAY, as_of_et: et, instruments: inst, uw_layers: state.uw_layers, decision: { regime_read: d.regime_read, dominant_trend: d.dominant_trend, shared_thesis: d.shared_thesis, conservative: d.conservative, aggressive: d.aggressive }, book: mem.book, journal: mem.notes, lessons: loadLessons() }, null, 1));
  console.log(`\n─── @ ${et} ET · SPX ${R.spot} (${R.chg_pct >= 0 ? '+' : ''}${R.chg_pct}%) · trend ${d.dominant_trend?.direction || '?'}/${d.dominant_trend?.strength || ''} · regime ${R.regime_now.net_gamma_M}M ───`);
  console.log(`  CONSERVATIVE: ${fmt(d.conservative)}`);
  console.log(`  AGGRESSIVE:   ${fmt(d.aggressive)}`);
  console.log(`  book: ${bookLine(mem.book)}`);
  return mem;
}

const arr = (v) => Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n').map(s => s.replace(/^\s*[\d.\-)]+\s*/, '').trim()).filter(Boolean) : Object.values(v || {}).map(String);
const DIARY_FILE = path.join(FC, 'agent_diary.json');
const loadDiary = () => fs.existsSync(DIARY_FILE) ? JSON.parse(fs.readFileSync(DIARY_FILE, 'utf8')) : [];

// --reflect: review today vs outcomes → append to the PERMANENT diary (raw experience). Does NOT touch durable lessons.
async function reflect() {
  const mem = fs.existsSync(MEM) ? JSON.parse(fs.readFileSync(MEM, 'utf8')) : null;
  if (!mem?.log?.length) { console.log('no decision log to reflect on — run --sequence first'); return; }
  const review = mem.log.map(e => ({ et: e.et, conservative: `${e.conservative.direction} (${e.conservative.conviction})`, aggressive: `${e.aggressive.direction} ${e.aggressive.entry || ''}→${e.aggressive.target || ''} (${e.aggressive.conviction})`, what_price_did_next_45m: outcomeAfter(e.et) }));
  const out = await claude(
    `You are the same 0DTE agent REVIEWING your own decisions today against what price actually did, to build EXPERIENCE. Compare conservative vs aggressive vs the real outcome; be blunt where you were too cautious or too aggressive. Record OBSERVATIONS (what you saw and how it resolved) and PROVISIONAL lessons (tentative — one day is not proof). This goes into a permanent multi-day diary; durable lessons are distilled later across many days, so do NOT overclaim from one session.`,
    `Your decisions today (${DAY}) and actual outcomes:\n${JSON.stringify(review, null, 1)}\n\nWrite today's diary entry.`,
    { name: 'emit_diary', description: "today's diary entry", input_schema: { type: 'object', required: ['grade', 'observations', 'provisional_lessons'], properties: { grade: { type: 'string' }, observations: { type: 'array', items: { type: 'string' }, description: 'what you saw today + how it resolved (the raw record)' }, provisional_lessons: { type: 'array', items: { type: 'string' }, description: 'tentative takeaways — hypotheses, not yet doctrine' } } } }, 1600);
  const entry = { day: DAY, grade: out.grade, observations: arr(out.observations), provisional_lessons: arr(out.provisional_lessons) };
  const diary = loadDiary().filter(d => d.day !== DAY).concat(entry);   // one entry per day; re-reflect replaces today's
  fs.writeFileSync(DIARY_FILE, JSON.stringify(diary, null, 1));
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
  const spot = raw.CurrentSpot, K = raw.Strikes || [], G = raw.GammaValues || [], V = raw.VannaValues || [], strikes = [];
  for (let i = 0; i < K.length; i++) { const k = +K[i]; if (Number.isFinite(k) && Math.abs(k - spot) / spot <= 0.012) strikes.push({ k, g0: (G[i] || [])[0] || 0, v0: (V[i] || [])[0] || 0 }); }
  return { ts: new Date().toISOString(), spot, prevClose: raw.PreviousClose, strikes };
}
// ── LIVE loop: every minute during RTH, refresh the GEX buffer + reason + write the dashboard ──
async function loop() {
  const bufs = { SPXW: [], SPY: [], QQQ: [] };
  // resume today's book/journal on restart so the full day of plays survives (step() saves mem to MEM each tick)
  let mem = fs.existsSync(MEM) ? (() => { try { return JSON.parse(fs.readFileSync(MEM, 'utf8')); } catch { return null; } })() : null;
  if (!mem || mem.day !== DAY) mem = { day: DAY, notes: '', log: [] };
  mem.book ||= { conservative: { open: null, closed: [] }, aggressive: { open: null, closed: [] } };
  const nplays = () => mem.book.conservative.closed.length + mem.book.aggressive.closed.length;
  const idleDash = (status) => { try { fs.writeFileSync(DASH, JSON.stringify({ day: DAY, as_of_et: new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5), status, instruments: {}, uw_layers: {}, decision: {}, book: mem.book, journal: mem.notes || '', lessons: loadLessons() }, null, 1)); } catch (e) { } };
  idleDash('agent starting — clearing prior state…');   // wipe the stale (e.g. backtest) dashboard immediately
  console.log(`\n  🦅 agent LIVE loop started (${DAY}) · ${nplays()} plays so far today · dashboard → http://localhost:8790 · Ctrl-C to stop\n`);
  for (; ;) {
    const et = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5);
    const m = (+et.slice(0, 2)) * 60 + (+et.slice(3, 5));
    if (m >= 9 * 60 + 30 && m <= 16 * 60) {
      try {
        for (const sym of ['SPXW', 'SPY', 'QQQ']) { const f = await pullLiveGEX(sym); if (f) { bufs[sym].push(f); if (bufs[sym].length > 60) bufs[sym].shift(); fs.writeFileSync(path.join(FC, `today_${sym}.jsonl.gz`), zlib.gzipSync(bufs[sym].map(x => JSON.stringify(x)).join('\n') + '\n')); } }
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
