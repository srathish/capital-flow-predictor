// REVERSAL backtest (the model we actually agreed on): entry = a confirmed turn
// AT a node — floor tap + bounce → LONG, ceiling tap + reject → SHORT. Then ladder
// toward the opposite king (target); exit at target-tap or a trailing giveback.
// Direction comes from the reversal itself (not a separate radar). Real UW fills.
// Usage: node reversal_sim.mjs [DAY]   (no DAY = backtest all replay days)
import '../apps/gex/scripts/_env-bootstrap.js';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
import Database from 'better-sqlite3';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
// ── reversal params ──────────────────────────────────────────
const DEFL = 5;            // node-tap tolerance (SPX pts)
const CONFIRM = 0.0012;    // 0.12% move off the extreme = reversal confirmed
const W = 20;              // lookback bars to find the local extreme
const MIN_NODE_G = 12e6;   // the reversal node must be a real pika
const COOLDOWN = 40;       // min between entries (same dir)
const RUNGS = 4, STEP = 10, TRAIL = 0.0012, ARM = 0.0018;
// ─────────────────────────────────────────────────────────────
const DIR = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const load = (day) => { const f = path.join(DIR, `replay_${day}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : []; };
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const pikaNear = (fr, px) => fr.strikes.filter(n => n.g0 >= MIN_NODE_G && Math.abs(n.strike - px) <= DEFL).sort((a, b) => b.g0 - a.g0)[0];
const strongestAbove = (fr, s) => fr.strikes.filter(n => n.g0 > 0 && n.strike > s + DEFL).sort((a, b) => b.g0 - a.g0)[0];
const strongestBelow = (fr, s) => fr.strikes.filter(n => n.g0 > 0 && n.strike < s - DEFL).sort((a, b) => b.g0 - a.g0)[0];

async function markAt(day, cp, k, et) {
  const occ = `SPXW${day.slice(2).replace(/-/g, '')}${cp}${String(Math.round(k * 1000)).padStart(8, '0')}`;
  const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${occ}/intraday?date=${day}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || !r.ok) return null;
  const pts = ((await r.json())?.data || []).map(x => ({ et: new Date(x.start_time).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5), m: +(x.close ?? x.avg_price ?? 0) })).filter(p => p.m > 0).sort((a, b) => a.et.localeCompare(b.et));
  const e = pts.find(p => p.et >= et) || pts[pts.length - 1]; return e ? e.m : null;
}

function findReversals(fr) {           // returns list of {i, et, side, spot, node, target}
  const out = []; let lastBull = -99, lastBear = -99;
  for (let j = W; j < fr.length; j++) {
    const win = fr.slice(j - W, j + 1), s = fr[j].spot;
    // BULL: recent local min tapped a floor pika, price now confirmed up off it
    const lo = win.reduce((a, b) => b.spot < a.spot ? b : a);
    if ((s - lo.spot) / lo.spot >= CONFIRM && fr[j].spot > fr[j - 1].spot && j - lastBull >= COOLDOWN) {
      const node = pikaNear(fr[Math.max(0, j - 5)], lo.spot) || pikaNear(fr[j], lo.spot);
      const tgt = strongestAbove(fr[j], s);
      if (node && tgt) { out.push({ i: j, et: etOf(fr[j].ts), side: 'BULL', spot: s, node: node.strike, target: tgt.strike }); lastBull = j; }
    }
    // BEAR: recent local max tapped a ceiling pika, price now confirmed down off it
    const hi = win.reduce((a, b) => b.spot > a.spot ? b : a);
    if ((hi.spot - s) / s >= CONFIRM && fr[j].spot < fr[j - 1].spot && j - lastBear >= COOLDOWN) {
      const node = pikaNear(fr[Math.max(0, j - 5)], hi.spot) || pikaNear(fr[j], hi.spot);
      const tgt = strongestBelow(fr[j], s);
      if (node && tgt) { out.push({ i: j, et: etOf(fr[j].ts), side: 'BEAR', spot: s, node: node.strike, target: tgt.strike }); lastBear = j; }
    }
  }
  return out.sort((a, b) => a.i - b.i).slice(0, 4);   // up to 4 reversals/day
}

async function simulate(day) {
  const fr = load(day); if (fr.length < 60) return { day, rev: [], pnl: 0 };
  const revs = findReversals(fr); let usd = 0; const detail = [];
  for (const rv of revs) {
    // exit: target tap or trailing giveback
    let exit = fr[fr.length - 1], reason = 'EOD', best = rv.spot;
    for (let j = rv.i; j < fr.length; j++) {
      const sp = fr[j].spot; best = rv.side === 'BULL' ? Math.max(best, sp) : Math.min(best, sp);
      if (Math.abs(sp - rv.target) <= DEFL) { exit = fr[j]; reason = 'target'; break; }
      const fav = rv.side === 'BULL' ? best - rv.spot : rv.spot - best, give = rv.side === 'BULL' ? best - sp : sp - best;
      if (fav >= rv.spot * ARM && give >= rv.spot * TRAIL) { exit = fr[j]; reason = 'trail'; break; }
    }
    const cp = rv.side === 'BULL' ? 'C' : 'P', base = Math.round(rv.spot / STEP) * STEP;
    const rungs = Array.from({ length: RUNGS }, (_, r) => rv.side === 'BULL' ? base + r * STEP : base - r * STEP);
    let sub = 0, n = 0;
    for (const k of rungs) {
      const en = await markAt(day, cp, k, rv.et); await new Promise(r => setTimeout(r, 240));
      const ex = await markAt(day, cp, k, etOf(exit.ts)); await new Promise(r => setTimeout(r, 240));
      if (en && ex && en > 0) { sub += (ex - en) * 100; n++; }
    }
    usd += sub; detail.push(`${rv.side}@${rv.et}(node ${rv.node}→tgt ${rv.target},${reason} ${etOf(exit.ts)}) ${sub >= 0 ? '+$' : '-$'}${Math.abs(Math.round(sub))}`);
  }
  return { day, rev: detail, pnl: Math.round(usd) };
}

const db = new Database(path.join(process.cwd(), 'data', 'gexester.db'), { readonly: true });
const actualPnl = (day) => { const rows = db.prepare('SELECT entry_mark,close_mark FROM tracked_plays WHERE trading_day=? AND close_mark IS NOT NULL AND entry_mark>0').all(day); return Math.round(rows.reduce((a, r) => a + (r.close_mark - r.entry_mark) * 100, 0)); };
const arg = process.argv[2];
const days = arg ? [arg] : fs.readdirSync(DIR).filter(f => /replay_2026-07-\d\d_SPXW/.test(f)).map(f => f.slice(7, 17)).sort();
console.log(`=== REVERSAL system vs ACTUAL (entry = confirmed turn at a node → ladder to target king) ===\n`);
let TD = 0, TA = 0;
for (const day of days) {
  const s = await simulate(day); const act = actualPnl(day); TD += s.pnl; TA += act;
  console.log(`${day}  reversal ${(s.pnl >= 0 ? '+$' : '-$') + Math.abs(s.pnl)}  vs actual ${(act >= 0 ? '+$' : '-$') + Math.abs(act)}`);
  for (const d of s.rev) console.log(`     · ${d}`);
  if (!s.rev.length) console.log(`     · no qualifying reversal (sit out)`);
}
console.log(`\nTOTAL: reversal ${(TD >= 0 ? '+$' : '-$') + Math.abs(TD)}  vs actual ${(TA >= 0 ? '+$' : '-$') + Math.abs(TA)}  (edge ${(TD - TA >= 0 ? '+$' : '-$') + Math.abs(TD - TA)})`);
