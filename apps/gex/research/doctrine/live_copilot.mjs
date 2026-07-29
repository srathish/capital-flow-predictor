// LIVE CO-PILOT (operational) — the single tool to run tomorrow. Consolidates every VALIDATED edge:
//   strong levels (>=15M pika) · reach% (node-size table, OOS-validated) · trend/chop (trinity) · node-sign
//   (pika=fade/barney=ride) · ride-exit (next pika ahead) · FAILED-REACH fade · vanna hold. Direction is
//   NOT forecast (proven unpredictable) — the tool marks the map + rules; you react. It does NOT trade.
// SETUP (session-B isolated):
//   cd apps/gex
//   ENV_FILE=research/stock-gex/session-b.env ENV_FILE_PATH=research/stock-gex/session-b.env DATABASE_URL= \
//     /usr/local/bin/node research/doctrine/live_copilot.mjs            (add --loop 10 to refresh every 10 min)
import '../../scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../src/heatseeker/auth.js';
import fs from 'node:fs'; import path from 'node:path';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const BAND = 0.012, STRONG = 15e6, WALL = 12e6, BARNEY = 8e6, MOM = 15;
const DATE = process.env.DATE || new Date().toISOString().slice(0, 10);
const LOOP = process.argv.includes('--loop') ? Number(process.argv[process.argv.indexOf('--loop') + 1]) : 0;
const LOG = path.join(process.cwd(), 'research', 'doctrine', 'live_snapshots.jsonl');
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
// VALIDATED reach table: P(reach a pika before close) by |dist| bucket × node gamma size (engine.mjs, OOS 8.6pt)
const REACH = { S: [93, 74, 59, 42, 24], M: [89, 69, 55, 43, 26], L: [87, 52, 38, 22, 6] };
const reachPct = (ad, g0) => { const g = g0 >= 35e6 ? 'L' : g0 >= 20e6 ? 'M' : 'S'; const b = ad < 4 ? 0 : ad < 8 ? 1 : ad < 12 ? 2 : ad < 18 ? 3 : 4; return REACH[g][b]; };
await initAuth();

async function surface() {
  const token = await getFreshToken();
  const u = new URL('https://app.skylit.ai/api/data');
  u.searchParams.set('symbol', 'SPXW'); u.searchParams.set('max_strikes', '200'); u.searchParams.set('max_expirations', '10'); u.searchParams.set('nocache', Math.random().toString());
  const r = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (r.status === 401 || r.status === 403) throw new Error('SKYLIT AUTH FAILED — re-auth: cfp-jobs skylit-login --env-file research/stock-gex/session-b.env');
  if (!r.ok) throw new Error(`skylit ${r.status}`);
  const raw = await r.json(); if (!raw || raw.CurrentSpot == null) throw new Error('empty surface');
  const K = raw.Strikes || [], G = raw.GammaValues || [], V = raw.VannaValues || [], spot = raw.CurrentSpot, strikes = [];
  for (let i = 0; i < K.length; i++) { const k = +K[i]; if (Number.isFinite(k) && Math.abs(k - spot) / spot <= BAND) strikes.push({ strike: k, g0: (G[i] || [])[0] || 0, v0: (V[i] || [])[0] || 0 }); }
  return { spot, strikes };
}
const ser = async (tk) => { const r = await fetch(`https://api.unusualwhales.com/api/stock/${tk}/ohlc/1m?date=${DATE}`, { headers: { Authorization: `Bearer ${KEY}` } }).catch(() => null); if (!r || !r.ok) return []; return ((await r.json())?.data || []).map(x => +x.close).filter(Number.isFinite); };
const mom = (a) => a.length > MOM ? sign(a[a.length - 1] - a[a.length - 1 - MOM]) : 0;

async function snapshot() {
  const s = await surface(), spot = s.spot;
  const spy = await ser('SPY'), qqq = await ser('QQQ'), vixy = await ser('VIXY');
  const tape = spy.length ? sign(spy[spy.length - 1] - spy[0]) : 0;
  const spyMom = mom(spy), qqqMom = mom(qqq);              // SPX momentum ~= SPY intraday
  const aligned = spyMom !== 0 && spyMom === qqqMom;       // trinity: SPX(≈SPY)+SPY+QQQ same way
  const vmin = vixy.length ? Math.min(...vixy) : 0, vmax = vixy.length ? Math.max(...vixy) : 0, vnow = vixy[vixy.length - 1];
  const vixPct = (vmax > vmin && vnow != null) ? (vnow - vmin) / (vmax - vmin) : null;

  const king = s.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0];
  const strong = king && king.g0 >= STRONG;
  const pikaUp = s.strikes.filter(n => n.g0 >= WALL && n.strike > spot + 1).sort((a, b) => a.strike - b.strike)[0];
  const pikaDn = s.strikes.filter(n => n.g0 >= WALL && n.strike < spot - 1).sort((a, b) => b.strike - a.strike)[0];
  const barnUp = s.strikes.filter(n => n.g0 <= -BARNEY && n.strike > spot + 1).sort((a, b) => a.strike - b.strike)[0];
  const barnDn = s.strikes.filter(n => n.g0 <= -BARNEY && n.strike < spot - 1).sort((a, b) => b.strike - a.strike)[0];
  const kingSide = strong ? sign(spot - king.strike) : 0;
  const trend = strong && tape !== 0 && tape === kingSide && aligned;
  const nowET = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5);
  const N = (n) => n ? `${n.strike}(${(n.g0 / 1e6).toFixed(0)}M${n.v0 < 0 ? ',v-' : ',v+'})` : '—';
  const R = (n) => n ? `${reachPct(Math.abs(n.strike - spot), n.g0)}%` : '—';

  console.log(`\n══════ CO-PILOT · ${DATE} ${nowET} ET · SPX ${spot.toFixed(1)} ══════`);
  console.log(`TRINITY ${spyMom > 0 ? '+' : spyMom < 0 ? '−' : '0'}/${spyMom > 0 ? '+' : spyMom < 0 ? '−' : '0'}(SPX≈SPY)/${qqqMom > 0 ? '+' : qqqMom < 0 ? '−' : '0'}(QQQ) → ${aligned ? 'ALIGNED' : 'DIVERGING'} · tape ${tape > 0 ? 'UP' : tape < 0 ? 'DN' : 'flat'} · VIX ${vixPct == null ? '?' : vixPct < 0.34 ? 'COMPRESSED(coiled)' : vixPct > 0.66 ? 'ELEVATED' : 'mid'}`);
  console.log(`KING ${N(king)} ${strong ? 'STRONG' : 'WEAK<15M — levels unreliable'}`);
  console.log(`  ▲ pika ceiling ${N(pikaUp)} reach ${R(pikaUp)}   |   barney↑(accel) ${N(barnUp)}`);
  console.log(`  ▼ pika floor   ${N(pikaDn)} reach ${R(pikaDn)}   |   barney↓(accel) ${N(barnDn)}`);
  console.log(`──────────────────────────────────────────────`);
  if (!strong) { console.log(`>>> STAND ASIDE — no strong king (≥15M). ~half of days. Re-check in 30m; structure can build.`); }
  else {
    console.log(`>>> MODE: ${trend ? `TREND ${tape > 0 ? 'BULL' : 'BEAR'} (trinity aligned + tape/king agree)` : 'CHOP / RANGE (fade the walls)'}`);
    console.log(`>>> DIRECTION-FREE LOOP (react, don't forecast):`);
    console.log(`   1. Ride a CONFIRMED move to the next pika = EXIT. ${trend ? `Trend ${tape > 0 ? 'up→ride to ' + N(pikaUp) : 'dn→ride to ' + N(pikaDn)}.` : ''}`);
    console.log(`      Barney ahead (${tape > 0 ? N(barnUp) : N(barnDn)}) = accelerant → ride THROUGH it, longer.`);
    console.log(`   2. At a pika: expect reversal (79%; ${pikaUp && pikaUp.v0 > 0 || pikaDn && pikaDn.v0 > 0 ? 'vanna+ = holds/deflect 74%' : 'check vanna: v+ holds, v− breaks'}).`);
    console.log(`   3. FAILED-REACH = stronger fade: if price stalls ~4pt SHORT of ${N(pikaUp)}/${N(pikaDn)} and rejects → fade harder (reverses ~7-9pt vs 4pt).`);
    console.log(`   4. Fade back toward the opposite pika = next ride. Convex 0DTE, take pop +20-30%, cut fast, same size.`);
  }
  console.log(`   ⚠ Direction is NOT predictable — these are reach/level rules. Paper/min size (fwd-validation day).`);
  fs.appendFileSync(LOG, JSON.stringify({ t: `${DATE}T${nowET}`, spot: +spot.toFixed(1), king: king?.strike, kingG: king ? +(king.g0 / 1e6).toFixed(0) : 0, strong, trend, aligned, tape, vixPct }) + '\n');
}
try { await snapshot(); if (LOOP > 0) { console.log(`\n(looping every ${LOOP}m — Ctrl-C to stop)`); setInterval(() => snapshot().catch(e => console.error('ERR', e.message)), LOOP * 60000); } }
catch (e) { console.error(`\nCO-PILOT ERROR: ${e.message}`); process.exit(1); }
