// UNIFIED system = REVERSAL trades (fade a node turn on range days) + TREND trades
// (ride a growing king on trend days). Both node-anchored, both ladder to a target
// king and exit at target-tap / trailing giveback. Entries de-overlapped by cooldown.
// Real UW fills. Usage: node unified_sim.mjs [DAY]
import '../apps/gex/scripts/_env-bootstrap.js';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
import Database from 'better-sqlite3';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
// reversal
const DEFL = 5, CONFIRM = 0.0012, W = 20, MIN_NODE_G = 12e6, COOLDOWN = 35;
// trend
const TREND_MOM = 0.003, TREND_W = 25, KING_GROW = 1.5;
// ladder/exit
const RUNGS = 4, STEP = 10, TRAIL = 0.0012, ARM = 0.0018;
const DIR = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const load = (day) => { const f = path.join(DIR, `replay_${day}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : []; };
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const gAt = (fr, k) => { const n = fr.strikes.find(x => x.strike === k); return n ? n.g0 : 0; };
const pikaNear = (fr, px) => fr.strikes.filter(n => n.g0 >= MIN_NODE_G && Math.abs(n.strike - px) <= DEFL).sort((a, b) => b.g0 - a.g0)[0];
const kingAbove = (fr, s) => fr.strikes.filter(n => n.g0 > 0 && n.strike > s + DEFL).sort((a, b) => b.g0 - a.g0)[0];
const kingBelow = (fr, s) => fr.strikes.filter(n => n.g0 > 0 && n.strike < s - DEFL).sort((a, b) => b.g0 - a.g0)[0];

async function markAt(day, cp, k, et) {
  const occ = `SPXW${day.slice(2).replace(/-/g, '')}${cp}${String(Math.round(k * 1000)).padStart(8, '0')}`;
  const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${occ}/intraday?date=${day}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || !r.ok) return null;
  const pts = ((await r.json())?.data || []).map(x => ({ et: new Date(x.start_time).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5), m: +(x.close ?? x.avg_price ?? 0) })).filter(p => p.m > 0).sort((a, b) => a.et.localeCompare(b.et));
  const e = pts.find(p => p.et >= et) || pts[pts.length - 1]; return e ? e.m : null;
}

function findEntries(fr) {
  const cand = [];
  for (let j = Math.max(W, TREND_W); j < fr.length; j++) {
    const s = fr[j].spot;
    // REVERSAL: local extreme tapped a node, price confirmed off it
    const win = fr.slice(j - W, j + 1);
    const lo = win.reduce((a, b) => b.spot < a.spot ? b : a), hi = win.reduce((a, b) => b.spot > a.spot ? b : a);
    if ((s - lo.spot) / lo.spot >= CONFIRM && fr[j].spot > fr[j - 1].spot) { const node = pikaNear(fr[Math.max(0, j - 5)], lo.spot); const t = kingAbove(fr[j], s); if (node && t) cand.push({ i: j, type: 'REV', side: 'BULL', spot: s, node: node.strike, target: t.strike }); }
    if ((hi.spot - s) / s >= CONFIRM && fr[j].spot < fr[j - 1].spot) { const node = pikaNear(fr[Math.max(0, j - 5)], hi.spot); const t = kingBelow(fr[j], s); if (node && t) cand.push({ i: j, type: 'REV', side: 'BEAR', spot: s, node: node.strike, target: t.strike }); }
    // TREND: sustained momentum toward a growing king (catches the open-at-extreme trend days)
    const mom = (s - fr[j - TREND_W].spot) / s;
    if (Math.abs(mom) >= TREND_MOM) {
      const side = mom > 0 ? 'BULL' : 'BEAR', king = side === 'BULL' ? kingAbove(fr[j], s) : kingBelow(fr[j], s);
      if (king && king.g >= MIN_NODE_G) { const grew = gAt(fr[j - 20], king.strike) > 0 ? king.g / gAt(fr[j - 20], king.strike) : 99; if (grew >= KING_GROW) cand.push({ i: j, type: 'TREND', side, spot: s, node: null, target: king.strike }); }
    }
  }
  // de-overlap: greedily accept entries >= COOLDOWN bars apart
  cand.sort((a, b) => a.i - b.i); const out = []; let last = -99;
  for (const c of cand) if (c.i - last >= COOLDOWN) { out.push({ ...c, et: etOf(fr[c.i].ts) }); last = c.i; }
  return out.slice(0, 6);
}

async function simulate(day) {
  const fr = load(day); if (fr.length < 60) return { day, e: [], pnl: 0 };
  const ent = findEntries(fr); let usd = 0; const detail = [];
  for (const en of ent) {
    let exit = fr[fr.length - 1], reason = 'EOD', best = en.spot;
    for (let j = en.i; j < fr.length; j++) { const sp = fr[j].spot; best = en.side === 'BULL' ? Math.max(best, sp) : Math.min(best, sp); if (Math.abs(sp - en.target) <= DEFL) { exit = fr[j]; reason = 'target'; break; } const fav = en.side === 'BULL' ? best - en.spot : en.spot - best, give = en.side === 'BULL' ? best - sp : sp - best; if (fav >= en.spot * ARM && give >= en.spot * TRAIL) { exit = fr[j]; reason = 'trail'; break; } }
    const cp = en.side === 'BULL' ? 'C' : 'P', base = Math.round(en.spot / STEP) * STEP;
    const rungs = Array.from({ length: RUNGS }, (_, r) => en.side === 'BULL' ? base + r * STEP : base - r * STEP);
    let sub = 0;
    for (const k of rungs) { const a = await markAt(day, cp, k, en.et); await new Promise(r => setTimeout(r, 230)); const b = await markAt(day, cp, k, etOf(exit.ts)); await new Promise(r => setTimeout(r, 230)); if (a && b && a > 0) sub += (b - a) * 100; }
    usd += sub; detail.push(`${en.type} ${en.side}@${en.et}→${etOf(exit.ts)}(${reason},tgt ${en.target}) ${sub >= 0 ? '+$' : '-$'}${Math.abs(Math.round(sub))}`);
  }
  return { day, e: detail, pnl: Math.round(usd) };
}

const db = new Database(path.join(process.cwd(), 'data', 'gexester.db'), { readonly: true });
const actual = (day) => { const r = db.prepare('SELECT entry_mark,close_mark FROM tracked_plays WHERE trading_day=? AND close_mark IS NOT NULL AND entry_mark>0').all(day); return Math.round(r.reduce((a, x) => a + (x.close_mark - x.entry_mark) * 100, 0)); };
const arg = process.argv[2];
const days = arg ? [arg] : fs.readdirSync(DIR).filter(f => /replay_2026-07-\d\d_SPXW/.test(f)).map(f => f.slice(7, 17)).sort();
console.log(`=== UNIFIED (reversal + trend) vs ACTUAL ===\n`);
let TD = 0, TA = 0;
for (const day of days) { const s = await simulate(day); const a = actual(day); TD += s.pnl; TA += a; console.log(`${day}  unified ${(s.pnl >= 0 ? '+$' : '-$') + Math.abs(s.pnl)}  vs actual ${(a >= 0 ? '+$' : '-$') + Math.abs(a)}`); for (const d of s.e) console.log(`     · ${d}`); if (!s.e.length) console.log(`     · no entry (sit out)`); }
console.log(`\nTOTAL: unified ${(TD >= 0 ? '+$' : '-$') + Math.abs(TD)}  vs actual ${(TA >= 0 ? '+$' : '-$') + Math.abs(TA)}  (edge ${(TD - TA >= 0 ? '+$' : '-$') + Math.abs(TD - TA)})`);
