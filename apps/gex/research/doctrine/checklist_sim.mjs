// ULTRA-SELECTIVE checklist reversal sim. ALL boxes true or NO TRADE. Few trades by
// design (that selectivity IS the edge). Identical sizing, pre-set stop, tracked stats.
// Boxes: 1 +gamma regime · 2 at the WALL · 3 wall fresh (<2 taps) · 4 decel into wall ·
//        5 vanna aligned · 6 no VIXY shock · 7 rejection on VOLUME · 8 R:R>=3 · 9 pre-15:15
// Prints the funnel (candidates → pass each box). Usage: node checklist_sim.mjs
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
import Database from 'better-sqlite3';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const DEFL = 5, CONFIRM = 0.0012, W = 20, MIN_WALL_G = 12e6, COOLDOWN = 35;
const RUNGS = 4, STEP = 10, TRAIL = 0.0012, ARM = 0.0018;
const RR_MIN = Number(process.env.RR_MIN) || 3;
const VIXY_SHOCK = 0.04;        // VIXY up >4% over 15 min = vol shock, skip
const VOL_MULT = 1.15;          // rejection bar volume >= 1.15x day-median
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const load = (day) => { const f = path.join(DIR, `replay_${day}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : []; };
const aux = (day) => { const f = path.join(DIR, `aux_${day}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { spy: [], vixy: [] }; };
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const netG = (fr) => fr.strikes.reduce((a, b) => a + b.g0, 0);
const callWall = (fr, s) => fr.strikes.filter(n => n.g0 >= MIN_WALL_G && n.strike > s + DEFL).sort((a, b) => b.g0 - a.g0)[0];
const putWall = (fr, s) => fr.strikes.filter(n => n.g0 >= MIN_WALL_G && n.strike < s - DEFL).sort((a, b) => b.g0 - a.g0)[0];
const nearVanna = (fr, s) => fr.strikes.filter(n => Math.abs(n.strike - s) / s < 0.01).reduce((a, b) => a + b.v0, 0);

async function markAt(day, cp, k, et) {
  const occ = `SPXW${day.slice(2).replace(/-/g, '')}${cp}${String(Math.round(k * 1000)).padStart(8, '0')}`;
  const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${occ}/intraday?date=${day}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || !r.ok) return null;
  const pts = ((await r.json())?.data || []).map(x => ({ et: new Date(x.start_time).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5), m: +(x.close ?? x.avg_price ?? 0) })).filter(p => p.m > 0).sort((a, b) => a.et.localeCompare(b.et));
  const e = pts.find(p => p.et >= et) || pts[pts.length - 1]; return e ? e.m : null;
}

const FUNNEL = { cand: 0, b1: 0, b3: 0, b4: 0, b5: 0, b6: 0, b7: 0, b8: 0, take: 0 };
function findTrades(fr, a) {
  const spyVol = {}; a.spy.forEach(p => spyVol[p.et] = p.v);
  const vixy = {}; a.vixy.forEach(p => vixy[p.et] = p.c);
  const vols = a.spy.map(p => p.v).filter(v => v > 0).sort((x, y) => x - y); const medVol = vols[Math.floor(vols.length / 2)] || 1;
  const vixyAt = (et) => { const k = Object.keys(vixy).filter(x => x <= et).sort(); return k.length ? vixy[k[k.length - 1]] : null; };
  const vixyShock = (et) => { const now = vixyAt(et); const hh = +et.slice(0, 2), mm = +et.slice(3); const back = `${String(hh - (mm < 15 ? 1 : 0)).padStart(2, '0')}:${String((mm + 45) % 60).padStart(2, '0')}`; const then = vixyAt(back); return now && then ? (now - then) / then : 0; };
  const out = []; let lastB = -99, lastS = -99; const taps = {};
  for (let j = W; j < fr.length; j++) {
    const s = fr[j].spot, et = etOf(fr[j].ts), win = fr.slice(j - W, j + 1);
    const cw = callWall(fr[j], s), pw = putWall(fr[j], s);
    const hi = win.reduce((x, y) => y.spot > x.spot ? y : x), lo = win.reduce((x, y) => y.spot < x.spot ? y : x);
    // BEAR candidate at the call wall
    if (cw && Math.abs(hi.spot - cw.strike) <= DEFL && (hi.spot - s) / s >= CONFIRM && fr[j].spot < fr[j - 1].spot && j - lastS >= COOLDOWN && pw) {
      FUNNEL.cand++;
      const b1 = netG(fr[j]) > 0; if (b1) FUNNEL.b1++;
      const tk = `C${cw.strike}`; const b3 = (taps[tk] || 0) < 2; if (b1 && b3) FUNNEL.b3++;
      const decel = Math.abs(fr[j].spot - fr[j - 3].spot) < Math.abs(fr[j - 3].spot - fr[j - 6].spot); if (b1 && b3 && decel) FUNNEL.b4++;
      const b5 = (nearVanna(fr[j], s) - nearVanna(fr[Math.max(0, j - 10)], s)) <= 0; if (b1 && b3 && decel && b5) FUNNEL.b5++;
      const b6 = vixyShock(et) < VIXY_SHOCK; if (b1 && b3 && decel && b5 && b6) FUNNEL.b6++;
      const b7 = (spyVol[et] || 0) >= VOL_MULT * medVol; if (b1 && b3 && decel && b5 && b6 && b7) FUNNEL.b7++;
      const b8 = (s - pw.strike) / (cw.strike + DEFL - s) >= RR_MIN; if (b1 && b3 && decel && b5 && b6 && b7 && b8) FUNNEL.b8++;
      const b9 = et < '15:15';
      if (b1 && b3 && decel && b5 && b6 && b7 && b8 && b9) { taps[tk] = (taps[tk] || 0) + 1; out.push({ i: j, et, side: 'BEAR', spot: s, node: cw.strike, target: pw.strike }); lastS = j; FUNNEL.take++; }
    }
    // BULL candidate at the put wall
    if (pw && Math.abs(lo.spot - pw.strike) <= DEFL && (s - lo.spot) / lo.spot >= CONFIRM && fr[j].spot > fr[j - 1].spot && j - lastB >= COOLDOWN && cw) {
      FUNNEL.cand++;
      const b1 = netG(fr[j]) > 0; if (b1) FUNNEL.b1++;
      const tk = `P${pw.strike}`; const b3 = (taps[tk] || 0) < 2; if (b1 && b3) FUNNEL.b3++;
      const decel = Math.abs(fr[j].spot - fr[j - 3].spot) < Math.abs(fr[j - 3].spot - fr[j - 6].spot); if (b1 && b3 && decel) FUNNEL.b4++;
      const b5 = (nearVanna(fr[j], s) - nearVanna(fr[Math.max(0, j - 10)], s)) >= 0; if (b1 && b3 && decel && b5) FUNNEL.b5++;
      const b6 = vixyShock(et) < VIXY_SHOCK; if (b1 && b3 && decel && b5 && b6) FUNNEL.b6++;
      const b7 = (spyVol[et] || 0) >= VOL_MULT * medVol; if (b1 && b3 && decel && b5 && b6 && b7) FUNNEL.b7++;
      const b8 = (cw.strike - s) / (s - (pw.strike - DEFL)) >= RR_MIN; if (b1 && b3 && decel && b5 && b6 && b7 && b8) FUNNEL.b8++;
      const b9 = et < '15:15';
      if (b1 && b3 && decel && b5 && b6 && b7 && b8 && b9) { taps[tk] = (taps[tk] || 0) + 1; out.push({ i: j, et, side: 'BULL', spot: s, node: pw.strike, target: cw.strike }); lastB = j; FUNNEL.take++; }
    }
  }
  return out.sort((a, b) => a.i - b.i);
}

async function simulate(day) {
  const fr = load(day); if (fr.length < 60) return { day, trades: [], pnl: 0 };
  const trs = findTrades(fr, aux(day)); const detail = []; const tradePnls = [];
  for (const rv of trs) {
    let exit = fr[fr.length - 1], reason = 'EOD', best = rv.spot;
    for (let j = rv.i; j < fr.length; j++) { const sp = fr[j].spot; best = rv.side === 'BULL' ? Math.max(best, sp) : Math.min(best, sp); if (rv.side === 'BULL' ? sp < rv.node - DEFL : sp > rv.node + DEFL) { exit = fr[j]; reason = 'STOP'; break; } if (Math.abs(sp - rv.target) <= DEFL) { exit = fr[j]; reason = 'target'; break; } const fav = rv.side === 'BULL' ? best - rv.spot : rv.spot - best, give = rv.side === 'BULL' ? best - sp : sp - best; if (fav >= rv.spot * ARM && give >= rv.spot * TRAIL) { exit = fr[j]; reason = 'trail'; break; } }
    const cp = rv.side === 'BULL' ? 'C' : 'P', base = Math.round(rv.spot / STEP) * STEP;
    const rungs = Array.from({ length: RUNGS }, (_, r) => rv.side === 'BULL' ? base + r * STEP : base - r * STEP);
    let sub = 0;
    for (const k of rungs) { const a2 = await markAt(day, cp, k, rv.et); await new Promise(r => setTimeout(r, 230)); const b2 = await markAt(day, cp, k, etOf(exit.ts)); await new Promise(r => setTimeout(r, 230)); if (a2 && b2 && a2 > 0) sub += (b2 - a2) * 100; }
    tradePnls.push(sub); detail.push(`${rv.side}@${rv.et}(wall ${rv.node}→${rv.target},${reason}) ${sub >= 0 ? '+$' : '-$'}${Math.abs(Math.round(sub))}`);
  }
  return { day, trades: detail, pnl: Math.round(tradePnls.reduce((a, b) => a + b, 0)), tradePnls };
}

const db = new Database(path.join(process.cwd(), 'data', 'gexester.db'), { readonly: true });
const actualPnl = (day) => { const rows = db.prepare('SELECT entry_mark,close_mark FROM tracked_plays WHERE trading_day=? AND close_mark IS NOT NULL AND entry_mark>0').all(day); return Math.round(rows.reduce((a, r) => a + (r.close_mark - r.entry_mark) * 100, 0)); };
const days = fs.readdirSync(DIR).filter(f => /replay_2026-07-\d\d_SPXW/.test(f)).map(f => f.slice(7, 17)).sort();
console.log(`=== CHECKLIST (all 9 boxes) vs ACTUAL ===\n`);
let TD = 0, TA = 0; const allT = [];
for (const day of days) { const s = await simulate(day); const act = actualPnl(day); TD += s.pnl; TA += act; allT.push(...s.tradePnls); console.log(`${day}  checklist ${(s.pnl >= 0 ? '+$' : '-$') + Math.abs(s.pnl)}  vs actual ${(act >= 0 ? '+$' : '-$') + Math.abs(act)}`); for (const d of s.trades) console.log(`     · ${d}`); if (!s.trades.length) console.log(`     · no trade`); }
const wins = allT.filter(p => p > 0), losses = allT.filter(p => p <= 0);
const gw = wins.reduce((a, b) => a + b, 0), gl = -losses.reduce((a, b) => a + b, 0);
console.log(`\nTOTAL: checklist ${(TD >= 0 ? '+$' : '-$') + Math.abs(TD)}  vs actual ${(TA >= 0 ? '+$' : '-$') + Math.abs(TA)}`);
console.log(`STATS: ${allT.length} trades | win ${allT.length ? (wins.length / allT.length * 100).toFixed(0) : 0}% | PF ${gl ? (gw / gl).toFixed(2) : '∞'} | expectancy ${allT.length ? '$' + Math.round(TD / allT.length) : '—'}/trade`);
console.log(`FUNNEL: ${FUNNEL.cand} candidates → +gamma ${FUNNEL.b1} → fresh ${FUNNEL.b3} → decel ${FUNNEL.b4} → vanna ${FUNNEL.b5} → no-shock ${FUNNEL.b6} → volume ${FUNNEL.b7} → RR≥3 ${FUNNEL.b8} → TAKE ${FUNNEL.take}`);
