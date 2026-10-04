// A+ RULE (locked 2026-10-03) — single source of truth for shadow/aplus_walk.mjs, desk/ (live decision support) and desk/score.mjs.
// Bull (bear = mirror): strong floor (king/gatekeeper, ≥8% share, ≤1.5% away) · untouched-this-week target · air pocket
// (nothing between ≥0.7× target) · R:R ≥ 3 with stop one node beyond · not against the daily trend · entry on the RETEST
// THAT HOLDS (tag ±zone, 1-min close back on the right side), 1st/2nd tap · no earnings in the hold · ≥14 DTE, hold ≤10 days.
// Desk defaults (best out-of-sample variant 2026-10-04, still NOT profitable on its own): skip slide-ins (opened >0.3 ATR beyond
// the level on the trade's side) and a daily-close stop at max(1 step, 0.5 ATR) beyond the entry.
import { majorNodes } from '../map/board.js';
import { tapCount } from '../map/living.js';

export const APLUS = { REACH: 0.015, ZONE_PCT: 0.0015, MIN_SHARE: 0.08, GATE: 0.7, MIN_RR: 3, HOLD: 10, DTE: 14, SLIDE_ATR: 0.3, STOP_ATR: 0.5 };

/** Every A+ check for both directions, with the first failing reason. ok rows carry the setup. weekHi/weekLo = this week's
 *  sessions BEFORE today (−Inf/+Inf on Monday). chart = dailyTrend. */
export function aplusDiagnose({ board, hier, chart, weekHi, weekLo }) {
  const spot = board.spot, majors = majorNodes(board, 0.03).sort((a, b) => a.strike - b.strike), out = [];
  for (const dir of ['up', 'down']) {
    const fail = (reason, extra = {}) => out.push({ dir, ok: false, reason, ...extra });
    const entry = dir === 'up' ? hier.floor : hier.ceiling, side = dir === 'up' ? 'floor' : 'ceiling';
    if (!entry) { fail(`no ${side} on the map`); continue; }
    const at = { entry: entry.strike, entryType: entry.skylitType, share: entry.share };
    if (!['king', 'gatekeeper'].includes(entry.skylitType)) { fail(`${side} ${entry.strike} is a ${entry.skylitType}, not king/gatekeeper`, at); continue; }
    if (entry.share < APLUS.MIN_SHARE) { fail(`${side} ${entry.strike} too small (${(entry.share * 100).toFixed(0)}% < 8%)`, at); continue; }
    if (Math.abs(entry.strike - spot) / spot > APLUS.REACH) { fail(`${side} ${entry.strike} is ${(Math.abs(entry.strike - spot) / spot * 100).toFixed(1)}% away (> 1.5%)`, at); continue; }
    if ((dir === 'up' && chart === 'down') || (dir === 'down' && chart === 'up')) { fail(`daily trend is ${chart} — against the trade`, at); continue; }
    const beyond = majors.filter((n) => (dir === 'up' ? n.strike > spot : n.strike < spot) && n.strike !== entry.strike).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
    const target = beyond.find((n) => (dir === 'up' ? n.strike > weekHi : n.strike < weekLo));
    if (!target) { fail(beyond.length ? `every target ${dir === 'up' ? 'above' : 'below'} was already delivered this week` : `no major node ${dir === 'up' ? 'above' : 'below'} to target`, at); continue; }
    const between = majors.filter((n) => (dir === 'up' ? n.strike > entry.strike && n.strike < target.strike : n.strike < entry.strike && n.strike > target.strike));
    const block = between.find((n) => n.abs >= APLUS.GATE * target.abs);
    if (block) { fail(`no air pocket — ${block.strike} (${block.skylitType}) sits between ${entry.strike} and target ${target.strike}`, { ...at, target: target.strike }); continue; }
    const back = majors.filter((n) => (dir === 'up' ? n.strike < entry.strike : n.strike > entry.strike)).sort((a, b) => Math.abs(a.strike - entry.strike) - Math.abs(b.strike - entry.strike))[0];
    const step = entry.strike >= 200 ? 2.5 : 1;
    const stop = back && Math.abs(back.strike - entry.strike) / entry.strike <= 0.01 ? back.strike : entry.strike + (dir === 'up' ? -step : step);
    const rr = Math.abs(target.strike - entry.strike) / Math.abs(entry.strike - stop);
    if (rr < APLUS.MIN_RR) { fail(`R:R ${rr.toFixed(1)} < 3 (entry ${entry.strike}, stop ${stop}, target ${target.strike})`, { ...at, target: target.strike }); continue; }
    const t2 = beyond.find((n) => (dir === 'up' ? n.strike > target.strike : n.strike < target.strike))?.strike ?? null;
    out.push({ dir, ok: true, entry: entry.strike, entryType: entry.skylitType, share: entry.share, stop, target: target.strike, targetType: target.skylitType, t2, rr: +rr.toFixed(1),
      why: `${entry.skylitType} ${side} ${entry.strike} (${(entry.share * 100).toFixed(0)}%) · untouched target ${target.strike} (${target.skylitType}) · air pocket (${between.length} small node(s) between) · R:R ${rr.toFixed(1)} · trend ${chart}` });
  }
  return out;
}

/** The A+ setups (unchanged behavior: same checks, same order, same fields). */
export function findAplus(args) {
  return aplusDiagnose(args).filter((x) => x.ok).map(({ ok, ...a }) => a);
}

/** The retest that holds, at session bar bi (bars = today's 1-min bars from the open). */
export function retestHolds(a, bars, bi, zone) {
  const b = bars[bi];
  if (!(b.l <= a.entry + zone && b.h >= a.entry - zone)) return false;
  if (!(a.dir === 'up' ? b.c >= a.entry - zone : b.c <= a.entry + zone)) return false;
  return tapCount(bars.slice(0, bi), a.entry, zone).taps < 2;
}

/** Slide-in: the day OPENED more than SLIDE_ATR×ATR beyond the level on the trade's side (price fell INTO a floor / rose into a ceiling). */
export const slidIn = (a, dayOpen, atr) => (a.dir === 'up' ? dayOpen - a.entry : a.entry - dayOpen) > APLUS.SLIDE_ATR * atr;

/** Daily-close stop level: 1 strike (as validated) or the wide desk default max(1 step, STOP_ATR×ATR). */
export const stopLevel = (fill, atr, wide) => (wide ? fill.entry - (fill.dir === 'up' ? 1 : -1) * Math.max(Math.abs(fill.entry - fill.stop), APLUS.STOP_ATR * atr) : fill.stop);

/** Trade management (shared by the walk and the desk scorer): half at TARGET then stop→entry, rest at T2, daily-close stop,
 *  time exit on the last hold day. getBars(day) → that day's 1-min bars. Returns exit legs [{d,t,f,why}]. */
export async function manage({ fill, holdDays, getBars, stopLvl, zone }) {
  const dir = fill.dir === 'up' ? 1 : -1, legs = []; let half = false;
  outer: for (const d of holdDays) {
    const bs = (await getBars(d)).filter((x) => d !== holdDays[0] || x.t > fill.t);
    for (const x of bs) {
      if (!half && (dir > 0 ? x.h >= fill.target : x.l <= fill.target)) { legs.push({ d, t: x.t, f: 0.5, why: 'TARGET' }); half = true; stopLvl = fill.entry; if (fill.t2 == null) { legs.push({ d, t: x.t, f: 0.5, why: 'TARGET(all)' }); break outer; } }
      if (half && fill.t2 != null && (dir > 0 ? x.h >= fill.t2 : x.l <= fill.t2)) { legs.push({ d, t: x.t, f: 0.5, why: 'T2' }); break outer; }
      if (half && (dir > 0 ? x.l <= stopLvl - zone : x.h >= stopLvl + zone)) { legs.push({ d, t: x.t, f: 0.5, why: 'breakeven' }); break outer; }
    }
    const c = bs[bs.length - 1];
    if (c && !half && (dir > 0 ? c.c < stopLvl : c.c > stopLvl)) { legs.push({ d, t: c.t, f: 1, why: 'stop(close)' }); break; }
    if (d === holdDays[holdDays.length - 1] && c) { legs.push({ d, t: c.t, f: half ? 0.5 : 1, why: 'time' }); break; }
  }
  return legs;
}
