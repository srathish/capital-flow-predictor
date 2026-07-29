// Research-grounded reversal sim: fade ONLY the actual walls, in POSITIVE gamma,
// toward the king. Directly targets our failures (fading lesser/over-tested nodes in
// the wrong regime). Rules (SpotGamma playbook):
//   - regime gate: only fade when net gamma > 0 (mean-reversion). Skip negative gamma.
//   - BEAR reversal ONLY at the CALL WALL (largest pika above spot) rejecting.
//   - BULL reversal ONLY at the PUT WALL (largest pika below spot) holding.
//   - target = the opposite wall / king. Stop = price breaks back through the wall.
//   - skip a wall tested >=2x without rejection (customer-held → breaks).
// Real UW fills. Usage: node wall_sim.mjs [DAY]
import '../apps/gex/scripts/_env-bootstrap.js';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
import Database from 'better-sqlite3';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const DEFL = 5, CONFIRM = 0.0012, W = 20, MIN_WALL_G = 12e6, COOLDOWN = 35;
const RUNGS = 4, STEP = 10, TRAIL = 0.0012, ARM = 0.0018;
const DIR = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const load = (day) => { const f = path.join(DIR, `replay_${day}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : []; };
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const netG = (fr) => fr.strikes.reduce((a, b) => a + b.g0, 0);
const callWall = (fr, s) => fr.strikes.filter(n => n.g0 >= MIN_WALL_G && n.strike > s + DEFL).sort((a, b) => b.g0 - a.g0)[0];
const putWall = (fr, s) => fr.strikes.filter(n => n.g0 >= MIN_WALL_G && n.strike < s - DEFL).sort((a, b) => b.g0 - a.g0)[0];

async function markAt(day, cp, k, et) {
  const occ = `SPXW${day.slice(2).replace(/-/g, '')}${cp}${String(Math.round(k * 1000)).padStart(8, '0')}`;
  const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${occ}/intraday?date=${day}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || !r.ok) return null;
  const pts = ((await r.json())?.data || []).map(x => ({ et: new Date(x.start_time).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5), m: +(x.close ?? x.avg_price ?? 0) })).filter(p => p.m > 0).sort((a, b) => a.et.localeCompare(b.et));
  const e = pts.find(p => p.et >= et) || pts[pts.length - 1]; return e ? e.m : null;
}

function findReversals(fr) {
  const out = []; let lastB = -99, lastS = -99; const taps = {};   // wall strike -> tap count
  for (let j = W; j < fr.length; j++) {
    const s = fr[j].spot, win = fr.slice(j - W, j + 1);
    if (netG(fr[j]) <= 0) continue;               // REGIME GATE: only fade in positive gamma
    const cw = callWall(fr[j], s), pw = putWall(fr[j], s);
    // BEAR: local max AT the call wall, rejecting down
    const hi = win.reduce((a, b) => b.spot > a.spot ? b : a);
    if (cw && Math.abs(hi.spot - cw.strike) <= DEFL && (hi.spot - s) / s >= CONFIRM && fr[j].spot < fr[j - 1].spot && j - lastS >= COOLDOWN) {
      const tk = `C${cw.strike}`; taps[tk] = (taps[tk] || 0) + 1;
      if (taps[tk] <= 2 && pw) { out.push({ i: j, et: etOf(fr[j].ts), side: 'BEAR', spot: s, node: cw.strike, target: pw.strike }); lastS = j; }
    }
    // BULL: local min AT the put wall, holding up
    const lo = win.reduce((a, b) => b.spot < a.spot ? b : a);
    if (pw && Math.abs(lo.spot - pw.strike) <= DEFL && (s - lo.spot) / lo.spot >= CONFIRM && fr[j].spot > fr[j - 1].spot && j - lastB >= COOLDOWN) {
      const tk = `P${pw.strike}`; taps[tk] = (taps[tk] || 0) + 1;
      if (taps[tk] <= 2 && cw) { out.push({ i: j, et: etOf(fr[j].ts), side: 'BULL', spot: s, node: pw.strike, target: cw.strike }); lastB = j; }
    }
  }
  return out.sort((a, b) => a.i - b.i).slice(0, 5);
}

async function simulate(day) {
  const fr = load(day); if (fr.length < 60) return { day, rev: [], pnl: 0 };
  const revs = findReversals(fr); let usd = 0; const detail = [];
  for (const rv of revs) {
    let exit = fr[fr.length - 1], reason = 'EOD', best = rv.spot;
    for (let j = rv.i; j < fr.length; j++) {
      const sp = fr[j].spot; best = rv.side === 'BULL' ? Math.max(best, sp) : Math.min(best, sp);
      if (rv.side === 'BULL' ? sp < rv.node - DEFL : sp > rv.node + DEFL) { exit = fr[j]; reason = 'STOP'; break; }   // wall broke
      if (Math.abs(sp - rv.target) <= DEFL) { exit = fr[j]; reason = 'target'; break; }
      const fav = rv.side === 'BULL' ? best - rv.spot : rv.spot - best, give = rv.side === 'BULL' ? best - sp : sp - best;
      if (fav >= rv.spot * ARM && give >= rv.spot * TRAIL) { exit = fr[j]; reason = 'trail'; break; }
    }
    const cp = rv.side === 'BULL' ? 'C' : 'P', base = Math.round(rv.spot / STEP) * STEP;
    const rungs = Array.from({ length: RUNGS }, (_, r) => rv.side === 'BULL' ? base + r * STEP : base - r * STEP);
    let sub = 0;
    for (const k of rungs) { const a = await markAt(day, cp, k, rv.et); await new Promise(r => setTimeout(r, 240)); const b = await markAt(day, cp, k, etOf(exit.ts)); await new Promise(r => setTimeout(r, 240)); if (a && b && a > 0) sub += (b - a) * 100; }
    usd += sub; detail.push(`${rv.side}@${rv.et}(wall ${rv.node}→${rv.target},${reason} ${etOf(exit.ts)}) ${sub >= 0 ? '+$' : '-$'}${Math.abs(Math.round(sub))}`);
  }
  return { day, rev: detail, pnl: Math.round(usd) };
}

const db = new Database(path.join(process.cwd(), 'data', 'gexester.db'), { readonly: true });
const actualPnl = (day) => { const rows = db.prepare('SELECT entry_mark,close_mark FROM tracked_plays WHERE trading_day=? AND close_mark IS NOT NULL AND entry_mark>0').all(day); return Math.round(rows.reduce((a, r) => a + (r.close_mark - r.entry_mark) * 100, 0)); };
const arg = process.argv[2];
const days = arg ? [arg] : fs.readdirSync(DIR).filter(f => /replay_2026-07-\d\d_SPXW/.test(f)).map(f => f.slice(7, 17)).sort();
console.log(`=== WALL reversal (fade only walls, positive gamma, toward king) vs ACTUAL ===\n`);
let TD = 0, TA = 0;
for (const day of days) { const s = await simulate(day); const act = actualPnl(day); TD += s.pnl; TA += act; console.log(`${day}  wall ${(s.pnl >= 0 ? '+$' : '-$') + Math.abs(s.pnl)}  vs actual ${(act >= 0 ? '+$' : '-$') + Math.abs(act)}`); for (const d of s.rev) console.log(`     · ${d}`); if (!s.rev.length) console.log(`     · sit out`); }
console.log(`\nTOTAL: wall ${(TD >= 0 ? '+$' : '-$') + Math.abs(TD)}  vs actual ${(TA >= 0 ? '+$' : '-$') + Math.abs(TA)}  (edge ${(TD - TA >= 0 ? '+$' : '-$') + Math.abs(TD - TA)})`);
