// Multi-day backtest: the doctrine ladder system vs our ACTUAL live results.
// System: node-growth-gated ladder (direction from the growing king pika, gate =
// king reaches a real size AND grew AND has room AND radar not opposing), exit at
// king-tap. Real UW option fills. Sit-out when the gate never opens.
// Compares to tracked_plays actual P&L per day.  Usage: node backtest_ladder.mjs
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
import Database from 'better-sqlite3';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
// ── gate (with magnitude FLOOR — the tuning fix) ──────────────
const GROWTH = 2.0;            // king grew >= 2x over 30 min
const KING_MIN_G = 20e6;       // AND reached >= 20M abs (a real magnet, not noise)
const MIN_SPREAD_PCT = 0.35;   // spot->king room
const RUNGS = 6, STEP = 10, DEFL = 5;
// ─────────────────────────────────────────────────────────────
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const load = (tk, day) => { const f = path.join(DIR, `replay_${day}_${tk}.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : []; };
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const gammaAt = (fr, k) => { const n = fr.strikes.find(x => x.strike === k); return n ? n.g0 : 0; };
const kingPika = (fr) => { const s = fr.spot; const a = fr.strikes.filter(n => n.g0 > 0 && n.strike > s).sort((x, y) => y.g0 - x.g0)[0]; const b = fr.strikes.filter(n => n.g0 > 0 && n.strike < s).sort((x, y) => y.g0 - x.g0)[0]; const k = [a, b].filter(Boolean).sort((x, y) => y.g0 - x.g0)[0]; return k ? { strike: k.strike, g: k.g0, side: k.strike > s ? 'BULL' : 'BEAR' } : null; };
const radarDir = (fr, prev) => { const mom = (fr.spot - prev.spot) / fr.spot * 100; return mom > 0.15 ? 'BULL' : mom < -0.15 ? 'BEAR' : 'NEUT'; };

async function markAt(day, cp, k, et) {
  const occ = `SPXW${day.slice(2).replace(/-/g, '')}${cp}${String(Math.round(k * 1000)).padStart(8, '0')}`;
  const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${occ}/intraday?date=${day}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || !r.ok) return null;
  const pts = ((await r.json())?.data || []).map(x => ({ et: new Date(x.start_time).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5), m: +(x.close ?? x.avg_price ?? 0) })).filter(p => p.m > 0).sort((a, b) => a.et.localeCompare(b.et));
  const e = pts.find(p => p.et >= et) || pts[pts.length - 1]; return e ? e.m : null;
}

async function simulate(day) {
  const spxw = load('SPXW', day);
  if (spxw.length < 60) return { day, decision: 'no data' };
  let trig = null;
  for (let i = 30; i < spxw.length; i += 15) {
    const f = spxw[i], king = kingPika(f); if (!king) continue;
    const spread = Math.abs(king.strike - f.spot) / f.spot * 100;
    const gPrev = gammaAt(spxw[i - 30], king.strike);
    const growth = gPrev > 0 ? king.g / gPrev : 99;
    const veto = (() => { const rd = radarDir(f, spxw[i - 15]); return rd !== 'NEUT' && rd !== king.side; })();
    if (king.g >= KING_MIN_G && growth >= GROWTH && spread >= MIN_SPREAD_PCT && !veto) {
      trig = { i, et: etOf(f.ts), spot: f.spot, king: king.strike, side: king.side, growth, kingG: king.g }; break;
    }
  }
  if (!trig) return { day, decision: 'SIT-OUT', pnl: 0 };
  // exit: FIRST of king-tap, OR a trailing giveback once price has run our way
  // (never hold 0DTE to EOD after the move stalls/pins), OR EOD.
  const ARM = trig.spot * 0.0015, TRAIL = trig.spot * 0.001;   // arm after +0.15%, exit on 0.1% giveback
  let exit = spxw[spxw.length - 1], reason = 'EOD', best = trig.spot;
  for (let j = trig.i; j < spxw.length; j++) {
    const sp = spxw[j].spot;
    best = trig.side === 'BULL' ? Math.max(best, sp) : Math.min(best, sp);
    if (Math.abs(sp - trig.king) <= DEFL) { exit = spxw[j]; reason = 'king-tap'; break; }
    const fav = trig.side === 'BULL' ? best - trig.spot : trig.spot - best;
    const give = trig.side === 'BULL' ? best - sp : sp - best;
    if (fav >= ARM && give >= TRAIL) { exit = spxw[j]; reason = 'trail'; break; }
  }
  const cp = trig.side === 'BULL' ? 'C' : 'P', base = Math.round(trig.spot / STEP) * STEP;
  const rungs = Array.from({ length: RUNGS }, (_, r) => trig.side === 'BULL' ? base + r * STEP : base - r * STEP);
  let usd = 0, n = 0;
  for (const k of rungs) {
    const en = await markAt(day, cp, k, trig.et); await new Promise(r => setTimeout(r, 260));
    const ex = await markAt(day, cp, k, etOf(exit.ts)); await new Promise(r => setTimeout(r, 260));
    if (en && ex && en > 0) { usd += (ex - en) * 100; n++; }
  }
  return { day, decision: `LADDER ${trig.side}`, entry: trig.et, exit: etOf(exit.ts), reason, king: trig.king, growth: trig.growth, kingG: trig.kingG, rungs: n, pnl: Math.round(usd) };
}

// actual P&L per day
const db = new Database(path.join(process.cwd(), 'data', 'gexester.db'), { readonly: true });
const actualPnl = (day) => { const rows = db.prepare('SELECT entry_mark,close_mark FROM tracked_plays WHERE trading_day=? AND close_mark IS NOT NULL AND entry_mark>0').all(day); return Math.round(rows.reduce((a, r) => a + (r.close_mark - r.entry_mark) * 100, 0)); };

const days = fs.readdirSync(DIR).filter(f => /replay_2026-07-\d\d_SPXW/.test(f)).map(f => f.slice(7, 17)).sort();
console.log(`=== DOCTRINE LADDER vs ACTUAL — ${days.length} days (gate: king>=${KING_MIN_G/1e6}M, grew>=${GROWTH}x, spread>=${MIN_SPREAD_PCT}%) ===\n`);
console.log('day          doctrine decision       ladder$   actual$   delta');
let TD = 0, TA = 0;
for (const day of days) {
  const s = await simulate(day); const act = actualPnl(day);
  TD += s.pnl || 0; TA += act;
  const dec = s.decision === 'LADDER BULL' || s.decision === 'LADDER BEAR' ? `${s.decision} @${s.entry}→${s.exit} (${s.reason}, king ${s.king} ${(s.kingG/1e6).toFixed(0)}M ${s.growth.toFixed(1)}x)` : s.decision;
  const d = (s.pnl || 0) - act;
  console.log(`${day}   ${dec.padEnd(52)} ${((s.pnl||0)>=0?'+$':'-$')+Math.abs(s.pnl||0)}`.padEnd(0) + `   ${(act>=0?'+$':'-$')+Math.abs(act)}   ${(d>=0?'+$':'-$')+Math.abs(d)}`);
}
console.log(`\nTOTAL: doctrine ladder ${(TD>=0?'+$':'-$')+Math.abs(TD)}  vs  actual ${(TA>=0?'+$':'-$')+Math.abs(TA)}  (edge ${(TD-TA>=0?'+$':'-$')+Math.abs(TD-TA)})`);
console.log('note: ladder P&L = 1 contract/rung, ~6 rungs; actual = 1 contract/fire. Both real fills.');
