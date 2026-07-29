// LIVE CO-PILOT — run intraday. Pulls the CURRENT Skylit SPXW surface + SPY tape + VIX, marks the correct
// levels (strong king >=15M, walls, barney floors), classifies trend/chop, and prints the action.
// It does NOT trade — you execute. Every run appends a snapshot to live_snapshots.jsonl (tomorrow = fwd day 1).
//
// SETUP (session-B isolation so it never clobbers the live tracker):
//   cd apps/gex
//   ENV_FILE=research/stock-gex/session-b.env ENV_FILE_PATH=research/stock-gex/session-b.env DATABASE_URL= \
//     /usr/local/bin/node research/doctrine/live_copilot.mjs            # one snapshot
//   ...append --loop 15   to re-read every 15 minutes through the day.
import '../../scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../src/heatseeker/auth.js';
import fs from 'node:fs'; import path from 'node:path';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const BAND = 0.012, MINSTR = 15e6, WALL = 12e6, BARNEY = 8e6, TREND_STOP = 8, CHOP_BAND = 8, CHOP_STOP = 6;
const DATE = process.env.DATE || new Date().toISOString().slice(0, 10);
const LOOP = process.argv.includes('--loop') ? Number(process.argv[process.argv.indexOf('--loop') + 1]) : 0;
const LOG = path.join(process.cwd(), 'research', 'doctrine', 'live_snapshots.jsonl');
await initAuth();

async function surface() {
  const token = await getFreshToken();
  const u = new URL('https://app.skylit.ai/api/data');
  u.searchParams.set('symbol', 'SPXW'); u.searchParams.set('max_strikes', '200'); u.searchParams.set('max_expirations', '10'); u.searchParams.set('nocache', Math.random().toString()); // NO timestamp = live/latest
  const r = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (r.status === 401 || r.status === 403) throw new Error('SKYLIT AUTH FAILED — re-auth session B (cfp-jobs skylit-login --env-file research/stock-gex/session-b.env)');
  if (!r.ok) throw new Error(`skylit ${r.status}`);
  const raw = await r.json(); if (!raw || raw.CurrentSpot == null) throw new Error('empty surface');
  const K = raw.Strikes || [], G = raw.GammaValues || [], spot = raw.CurrentSpot, strikes = [];
  for (let i = 0; i < K.length; i++) { const k = +K[i]; if (!Number.isFinite(k) || Math.abs(k - spot) / spot > BAND) continue; strikes.push({ strike: k, g0: (G[i] || [])[0] || 0 }); }
  return { spot, strikes };
}
async function tapeVix() {
  const ohlc = async (tk) => { const r = await fetch(`https://api.unusualwhales.com/api/stock/${tk}/ohlc/1m?date=${DATE}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15000) }).catch(() => null); if (!r || !r.ok) return []; return ((await r.json())?.data || []).map(x => +x.close).filter(Number.isFinite); };
  const spy = await ohlc('SPY'), vixy = await ohlc('VIXY');
  return { spyOpen: spy[0], spyNow: spy[spy.length - 1], vixyNow: vixy[vixy.length - 1], vixyMin: vixy.length ? Math.min(...vixy) : null, vixyMax: vixy.length ? Math.max(...vixy) : null };
}
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;

async function snapshot() {
  const s = await surface(); const spot = s.spot;
  const sumAbs = s.strikes.reduce((t, n) => t + Math.abs(n.g0), 0);
  const king = s.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0];
  const callWall = s.strikes.filter(n => n.g0 >= WALL && n.strike > spot).sort((a, b) => b.g0 - a.g0)[0];
  const putWall = s.strikes.filter(n => n.g0 >= WALL && n.strike < spot).sort((a, b) => b.g0 - a.g0)[0];
  const barneyDn = s.strikes.filter(n => n.g0 <= -BARNEY && n.strike < spot).sort((a, b) => b.strike - a.strike)[0];
  const barneyUp = s.strikes.filter(n => n.g0 <= -BARNEY && n.strike > spot).sort((a, b) => a.strike - b.strike)[0];
  const conc = king ? king.g0 / sumAbs : 0;
  const t = await tapeVix();
  const tape = sign((t.spyNow ?? 0) - (t.spyOpen ?? 0));
  const strong = king && king.g0 >= MINSTR;
  const kingSide = strong ? sign(spot - king.strike) : 0;
  const trend = strong && tape !== 0 && tape === kingSide;
  const vixPct = (t.vixyMax > t.vixyMin && t.vixyNow != null) ? (t.vixyNow - t.vixyMin) / (t.vixyMax - t.vixyMin) : null;
  const nowET = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5);
  const fm = (n) => n ? `${n.strike} (${(n.g0 / 1e6).toFixed(0)}M, ${(n.strike - spot >= 0 ? '+' : '') + (n.strike - spot).toFixed(0)})` : '—';

  console.log(`\n================ LIVE CO-PILOT · ${DATE} ${nowET} ET ================`);
  console.log(`SPX spot: ${spot.toFixed(1)}   |   tape(SPY vs open): ${tape > 0 ? 'UP' : tape < 0 ? 'DOWN' : 'flat'}   |   VIX regime: ${vixPct == null ? '?' : vixPct < 0.34 ? 'COMPRESSED (coiled — fades have range)' : vixPct > 0.66 ? 'ELEVATED (caution)' : 'mid'}`);
  console.log(`LEVELS  king: ${fm(king)}   ${strong ? '[STRONG]' : '[WEAK <15M]'}   conc ${(conc * 100).toFixed(0)}%`);
  console.log(`        call wall: ${fm(callWall)}    put wall: ${fm(putWall)}`);
  console.log(`        barney floor↓: ${fm(barneyDn)}   barney↑: ${fm(barneyUp)}`);
  console.log(`------------------------------------------------------------------`);
  let mode, action;
  if (!strong) { mode = 'STAND ASIDE'; action = `No strong king (need >=15M). ${conc < 0.12 ? 'GEX scattered = chop/no structure.' : ''} Re-check in 30 min; structure can build intraday.`; }
  else if (trend) {
    const dir = tape > 0 ? 'LONG (calls)' : 'SHORT (puts)';
    mode = `TREND ${tape > 0 ? 'BULL' : 'BEAR'}`;
    action = `Hold ONE thesis: ${dir}. Expect price to PUSH THROUGH levels. Stop if SPX reverses ~${TREND_STOP} pts against. Ride toward ${tape > 0 ? fm(callWall) || 'the next pika up' : fm(putWall) || 'the next pika down'}. ${conc > 0.15 ? 'Concentrated GEX confirms trend.' : 'NOTE conc <15% — trend weak, size down.'}`;
  } else {
    mode = 'CHOP (fade)';
    const dAbove = king.strike + CHOP_BAND, dBelow = king.strike - CHOP_BAND;
    action = `Fade the ${king.strike} magnet. If SPX extends to ${dAbove} → SHORT back to ${king.strike}. If to ${dBelow} → LONG back to ${king.strike}. Stop ${CHOP_STOP} pts beyond entry. TAKE THE POP (+20-30% on the option), don't hold. 2 stops same way = stand down (it's trending).`;
  }
  console.log(`>>> MODE: ${mode}`);
  console.log(`>>> ACTION: ${action}`);
  console.log(`>>> NODE-SIGN: nearest level in your path — PIKA(+)=fade/deflect, BARNEY(-)=ride through (trapdoor). Manage the pop; never hold 0DTE to expiry.`);
  fs.appendFileSync(LOG, JSON.stringify({ t: `${DATE}T${nowET}`, spot: +spot.toFixed(1), king: king?.strike, kingG: king ? +(king.g0 / 1e6).toFixed(0) : 0, strong, conc: +(conc * 100).toFixed(0), tape, vixPct: vixPct == null ? null : +vixPct.toFixed(2), mode }) + '\n');
}

try {
  await snapshot();
  if (LOOP > 0) { console.log(`\n(looping every ${LOOP} min — Ctrl-C to stop)`); setInterval(() => snapshot().catch(e => console.error('ERR', e.message)), LOOP * 60000); }
} catch (e) { console.error(`\nCO-PILOT ERROR: ${e.message}`); process.exit(1); }
