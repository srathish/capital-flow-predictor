/**
 * Observation-only live fire logger — forward-validation instrumentation.
 *
 * NOTHING here affects trading. The fire-loop calls logFireObservation()
 * behind ENABLE_UW_OBSERVATION_LOGGING=true, fire-and-forget, and every
 * code path in this module is wrapped so an exception can never propagate
 * into the fire loop (errors go to live_fire_observation_errors_<day>.log).
 *
 * One row per live fire (including gate-blocked / dedupe-skipped fires —
 * they are candidates too; execution status is recorded in notes_json).
 * The row is written AFTER the 1-min confirmation check resolves (~70s),
 * so a crash inside that window loses at most one row.
 *
 * Red-flag definitions mirror research/uw/studies/policy_config.py via
 * thresholds.json (policy_config is canonical). Missing live data → null
 * fields + missing_data flag + affected red flags marked "unknown".
 *
 * Dry run: node research/uw/live_logging/observation-logger.js --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UW = path.resolve(__dirname, '..');
const OUTDIR = path.join(UW, 'outputs', 'live_observations');
const T = JSON.parse(fs.readFileSync(path.join(__dirname, 'thresholds.json'), 'utf-8'));

const COLUMNS = [
  'timestamp', 'trading_date', 'ticker', 'underlying_symbol', 'fire_direction', 'fire_price',
  'fire_source', 'entry_candidate_time', 'current_time_bucket',
  'option_contract_candidate', 'option_symbol', 'expiry', 'strike', 'call_or_put',
  'premium_mid', 'premium_bid', 'premium_ask', 'premium_band', 'spread_pct', 'volume', 'open_interest',
  'gex_state', 'distance_to_wall_bps', 'wall_bucket', 'day_type', 'trend_or_chop_state',
  'vix_level', 'vix_change_from_open',
  'flow_5m_direction', 'flow_5m_net_premium', 'flow_5m_agreement', 'flow_tier', 'flow_exhaustion_flag',
  'confirmation_entry_outcome', 'confirmation_timestamp', 'confirmation_price',
  'red_flag_count', 'red_flags_json', 'positive_stack_score',
  'policy_flags_eq_0_pass', 'policy_flags_le_1_pass', 'policy_full_combined_pass',
  'missing_data', 'notes_json',
];

// ---------------- infra ----------------
function etParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = k => p.find(x => x.type === k)?.value;
  return { day: `${g('year')}-${g('month')}-${g('day')}`, hr: Number(g('hour')) + Number(g('minute')) / 60 };
}
function csvEscape(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function appendRow(file, row) {
  fs.mkdirSync(OUTDIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, COLUMNS.join(',') + '\n');
  fs.appendFileSync(file, COLUMNS.map(c => csvEscape(row[c])).join(',') + '\n');
}
function logError(day, err, ctx = '') {
  try {
    fs.mkdirSync(OUTDIR, { recursive: true });
    fs.appendFileSync(path.join(OUTDIR, `live_fire_observation_errors_${day}.log`),
      `${new Date().toISOString()} ${ctx} ${err?.stack || err}\n`);
  } catch { /* never throw from the error logger */ }
}

// ---------------- feature helpers ----------------
function timeBucket(hr) {
  if (hr < 10) return '9:30-10';
  if (hr < 11) return '10-11';
  if (hr < 12) return '11-12';
  if (hr < 13.5) return 'lunch';
  if (hr < 15) return '13:30-15';
  return '15+';
}
function atmStrike(ticker, spot) {
  return ticker === 'SPXW' || ticker === 'SPX' ? Math.round(spot / 5) * 5 : Math.round(spot);
}
function occSymbol(t, day, dir, K) {
  const [y, m, d] = day.split('-');
  return `${t}${y.slice(2)}${m}${d}${dir > 0 ? 'C' : 'P'}${Math.round(K * 1000).toString().padStart(8, '0')}`;
}

function surfaceFeatures(nodes, spot, dir) {
  if (!nodes?.length || !spot) return {};
  let tot = 0, tota = 0;
  for (const n of nodes) { tot += n.gamma; tota += Math.abs(n.gamma); }
  if (!tota) return {};
  const regime = tot / tota;
  const gex_state = regime > T.gex_positive_min ? 'positive' : regime < T.gex_negative_max ? 'negative' : 'neutral';
  const side = dir > 0 ? nodes.filter(n => n.gamma > 0 && n.strike > spot)
                       : nodes.filter(n => n.gamma > 0 && n.strike < spot);
  let d_wall = null;
  if (side.length) {
    const w = side.reduce((a, b) => (a.gamma > b.gamma ? a : b)).strike;
    d_wall = Math.abs(w - spot) / spot * 1e4;
  }
  const pin = nodes.some(n => n.gamma > 0 && Math.abs(n.strike - spot) / spot <= T.pin_distance_pct &&
                              Math.abs(n.gamma) / tota >= T.pin_relsig);
  const wall_bucket = d_wall == null ? null :
    d_wall < T.wall_skip_below_bps ? '<20' :
    d_wall < T.wall_sweet_lo_bps ? '20-50' :
    d_wall <= T.wall_sweet_hi_bps ? '50-100(sweet)' : '>100';
  return { gex_state, d_wall, wall_bucket, pin };
}

async function fetchFlow(ticker, day) {
  const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
  if (!KEY) return null;
  const t = ticker === 'SPXW' ? 'SPX' : ticker;
  const r = await fetch(`https://api.unusualwhales.com/api/stock/${t}/net-prem-ticks?date=${day}`, {
    headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  const rows = (await r.json())?.data || [];
  const out = [];
  for (const x of rows) {
    const ts = x.tape_time || x.start_time || x.timestamp || x.date;
    const tt = Date.parse(ts);
    if (!Number.isFinite(tt)) continue;
    out.push({ t: tt, c: Number(x.net_call_premium) || 0, p: Number(x.net_put_premium) || 0 });
  }
  return out.sort((a, b) => a.t - b.t);
}
function flowFeatures(flow, fireTsMs, dir) {
  if (!flow?.length) return {};
  const win = (lo, hi = 0) => {
    const v = flow.filter(x => x.t >= fireTsMs - lo * 60_000 && x.t <= fireTsMs - hi * 60_000);
    if (!v.length) return null;
    return { net: v.reduce((s, x) => s + x.c - x.p, 0), tot: v.reduce((s, x) => s + Math.abs(x.c) + Math.abs(x.p), 0) };
  };
  const w5 = win(5), w15 = win(15);
  if (!w5 || !w15) return {};
  const onesided = w15.tot ? Math.abs(w15.net) / w15.tot : 0;
  return {
    f5: w5.net,
    flow_5m_direction: w5.net > 0 ? 'bullish' : w5.net < 0 ? 'bearish' : 'flat',
    flow_5m_agreement: Math.sign(w5.net) === Math.sign(dir),
    onesided,
    flow_tier: onesided >= T.onesided15_threshold ? 'one-sided' : 'mixed',
    flow_exhaustion_flag: Math.abs(w15.net) >= T.f15_extreme_threshold,
  };
}

// Red flags — same six definitions as the policy simulator. Missing input → 'unknown'.
function redFlags({ hr, gex_state, d_wall, pin, flowF, breakeven_bps }) {
  const flags = {};
  flags.afternoon = hr >= T.bad_window_start_hr && hr < T.bad_window_end_hr;
  flags.posgex_noroom = gex_state == null ? 'unknown'
    : gex_state === 'positive' && (d_wall ?? 99) < T.wall_skip_below_bps;
  flags.flow_exhausted = flowF.onesided == null ? 'unknown' : flowF.onesided >= T.onesided15_threshold;
  flags.flow_against = flowF.f5 == null ? 'unknown' : !flowF.flow_5m_agreement;
  flags.pin = pin == null ? 'unknown' : pin;
  flags.breakeven = breakeven_bps == null ? 'unknown' : breakeven_bps > T.breakeven_max_bps;
  const known = Object.values(flags).filter(v => v !== 'unknown');
  const count = known.filter(Boolean).length;
  const unknowns = Object.values(flags).filter(v => v === 'unknown').length;
  return { flags, count, unknowns };
}
function positiveStackScore({ flowF, gex_state, d_wall, count, premium_band, trend }) {
  let s = 0;
  if (flowF.flow_5m_agreement === true && flowF.flow_tier === 'mixed') s++;
  if (gex_state && gex_state !== 'positive') s++;
  if (d_wall != null && d_wall >= T.wall_sweet_lo_bps && d_wall <= T.wall_sweet_hi_bps) s++;
  if (count === 0) s++;
  if (trend === 'trend') s++;
  if (premium_band === 'good_0.5-2') s++;
  return s;
}

// ---------------- main entry ----------------
/**
 * fireCtx: { ticker, state, dir, spot, fireTsMs, surfaceNodes, executed, execNote,
 *            quoteFetcher (occ -> {bid,ask,mid}|null), vixFetcher (() -> spot|null) }
 * All heavy work is async and self-contained. NEVER throws.
 */
export function logFireObservation(fireCtx) {
  if (process.env.ENABLE_UW_OBSERVATION_LOGGING !== 'true') return;
  const { day } = etParts();
  _log(fireCtx, day).catch(err => logError(day, err, 'logFireObservation'));
}

async function _log(ctx, day) {
  const { hr } = etParts(new Date(ctx.fireTsMs));
  const missing = [];
  const dir = ctx.dir ?? (ctx.state?.startsWith('BEAR') ? -1 : 1);
  const K = atmStrike(ctx.ticker, ctx.spot);
  const occ = occSymbol(ctx.ticker, day, dir, K);

  // option quote (never throw)
  let q = null;
  try { q = ctx.quoteFetcher ? await ctx.quoteFetcher(occ) : null; } catch { q = null; }
  if (!q || q.mid == null) missing.push('option_quote');
  const mid = q?.mid ?? null;
  const spread_pct = q?.bid != null && q?.ask != null && mid ? (q.ask - q.bid) / mid * 100 : null;
  const premium_band = mid == null ? null :
    (mid >= T.premium_band_good[0] && mid <= T.premium_band_good[1]) ? 'good_0.5-2' :
    (mid > T.premium_band_bad[0] && mid <= T.premium_band_bad[1]) ? 'bad_2-10' : 'other';
  const breakeven_bps = mid != null && ctx.spot ? mid / ctx.spot * 1e4 : null;

  // surface
  const sf = surfaceFeatures(ctx.surfaceNodes, ctx.spot, dir);
  if (sf.gex_state == null) missing.push('surface');

  // VIX
  let vix_level = null, vix_change_from_open = null;
  try {
    const v = ctx.vixFetcher ? await ctx.vixFetcher() : null;
    if (v != null) {
      vix_level = v;
      if (_vixOpen.day !== day) { _vixOpen.day = day; _vixOpen.open = v; }
      vix_change_from_open = v - _vixOpen.open;
    } else missing.push('vix');
  } catch { missing.push('vix'); }

  // flow
  let flowF = {};
  try {
    const flow = await fetchFlow(ctx.ticker, day);
    flowF = flowFeatures(flow, ctx.fireTsMs, dir);
    if (flowF.f5 == null) missing.push('flow');
  } catch { missing.push('flow'); }

  // red flags + stack score (before confirmation — entry-time features)
  const rf = redFlags({ hr, gex_state: sf.gex_state, d_wall: sf.d_wall, pin: sf.pin, flowF, breakeven_bps });
  const stack = positiveStackScore({
    flowF, gex_state: sf.gex_state, d_wall: sf.d_wall, count: rf.count,
    premium_band, trend: ctx.trend ?? null,
  });

  // confirmation check: re-quote after confirm_wait_min (+5s cushion)
  let confirmation_entry_outcome = 'unknown', confirmation_timestamp = null, confirmation_price = null;
  if (mid != null && ctx.quoteFetcher) {
    await new Promise(r => setTimeout(r, T.confirm_wait_min * 60_000 + 5_000));
    try {
      const q2 = await ctx.quoteFetcher(occ);
      if (q2?.mid != null) {
        confirmation_price = q2.mid;
        confirmation_timestamp = new Date().toISOString();
        confirmation_entry_outcome = q2.mid > mid ? 'confirmed' : 'not_confirmed';
      }
    } catch { /* stays unknown */ }
  } else missing.push('confirmation');

  // policy passes (logging only; unknown inputs → pass = null)
  const anyUnknown = rf.unknowns > 0;
  const flags_eq_0 = anyUnknown ? null : rf.count === 0;
  const flags_le_1 = anyUnknown ? null : rf.count <= T.flags_max_relaxed;
  let full_combined = null;
  if (!anyUnknown && confirmation_entry_outcome !== 'unknown') {
    full_combined = confirmation_entry_outcome === 'confirmed' &&
      flowF.flow_5m_agreement === true && flowF.flow_tier === 'mixed' &&
      rf.count <= T.flags_max_relaxed &&
      (premium_band !== 'bad_2-10' || rf.count === 0) &&
      (sf.d_wall ?? 60) >= T.wall_skip_below_bps &&
      !(hr >= T.bad_window_start_hr && hr < T.bad_window_end_hr) &&
      breakeven_bps <= T.breakeven_max_bps &&
      (ctx.ticker !== 'SPXW' || rf.count === 0);
  }

  const row = {
    timestamp: new Date(ctx.fireTsMs).toISOString(),
    trading_date: day,
    ticker: ctx.ticker,
    underlying_symbol: ctx.ticker === 'SPXW' ? 'SPX' : ctx.ticker,
    fire_direction: dir > 0 ? 'bull' : 'bear',
    fire_price: ctx.spot,
    fire_source: ctx.state ?? null,
    entry_candidate_time: new Date(ctx.fireTsMs + T.confirm_wait_min * 60_000).toISOString(),
    current_time_bucket: timeBucket(hr),
    option_contract_candidate: occ,
    option_symbol: occ,
    expiry: day,
    strike: K,
    call_or_put: dir > 0 ? 'call' : 'put',
    premium_mid: mid, premium_bid: q?.bid ?? null, premium_ask: q?.ask ?? null,
    premium_band, spread_pct: spread_pct != null ? Number(spread_pct.toFixed(1)) : null,
    volume: q?.volume ?? null, open_interest: q?.oi ?? null,
    gex_state: sf.gex_state ?? null,
    distance_to_wall_bps: sf.d_wall != null ? Number(sf.d_wall.toFixed(0)) : null,
    wall_bucket: sf.wall_bucket ?? null,
    day_type: ctx.dayType ?? null,
    trend_or_chop_state: ctx.trend ?? null,
    vix_level, vix_change_from_open:
      vix_change_from_open != null ? Number(vix_change_from_open.toFixed(2)) : null,
    flow_5m_direction: flowF.flow_5m_direction ?? null,
    flow_5m_net_premium: flowF.f5 != null ? Math.round(flowF.f5) : null,
    flow_5m_agreement: flowF.flow_5m_agreement ?? null,
    flow_tier: flowF.flow_tier ?? null,
    flow_exhaustion_flag: flowF.flow_exhaustion_flag ?? null,
    confirmation_entry_outcome, confirmation_timestamp, confirmation_price,
    red_flag_count: rf.count,
    red_flags_json: JSON.stringify(rf.flags),
    positive_stack_score: stack,
    policy_flags_eq_0_pass: flags_eq_0,
    policy_flags_le_1_pass: flags_le_1,
    policy_full_combined_pass: full_combined,
    missing_data: missing.length ? missing.join('|') : null,
    notes_json: JSON.stringify({ executed: ctx.executed ?? null, note: ctx.execNote ?? null, unknown_flags: rf.unknowns }),
  };
  appendRow(path.join(OUTDIR, `live_fire_observations_${day}.csv`), row);
  appendRow(path.join(OUTDIR, 'live_fire_observations_all.csv'), row);
}
const _vixOpen = { day: null, open: null };

// ---------------- dry run ----------------
if (process.argv.includes('--dry-run')) {
  process.env.ENABLE_UW_OBSERVATION_LOGGING = 'true';
  const mockNodes = [
    { strike: 745, gamma: 40e6 }, { strike: 742, gamma: 30e6 }, { strike: 748, gamma: 25e6 },
    { strike: 744, gamma: -8e6 }, { strike: 746, gamma: -5e6 },
  ];
  console.log('dry run: mocked SPY BULL fire, mocked quotes, no network...');
  logFireObservation({
    ticker: 'SPY', state: 'BULL_REVERSE', dir: 1, spot: 744.6, fireTsMs: Date.now(),
    surfaceNodes: mockNodes, executed: false, execNote: 'dry_run',
    quoteFetcher: async () => ({ bid: 1.00, ask: 1.10, mid: 1.05 }),
    vixFetcher: async () => 17.4,
    dayType: 'flat', trend: 'chop',
  });
  // dry run uses a short confirm wait
  setTimeout(() => {
    const { day } = etParts();
    const f = path.join(OUTDIR, `live_fire_observations_${day}.csv`);
    console.log('row written?', fs.existsSync(f) ? `yes → ${f}` : 'NOT YET (confirmation wait ~65s)');
  }, 70_000);
}
