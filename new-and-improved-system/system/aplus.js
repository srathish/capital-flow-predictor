// A+ RULE (locked 2026-10-03) — single source of truth for shadow/aplus_walk.mjs AND live/runner.mjs --rule aplus.
// Bull (bear = mirror): strong floor (king/gatekeeper, ≥8% share, ≤1.5% away) · untouched-this-week target · air pocket
// (nothing between ≥0.7× target) · R:R ≥ 3 with stop one node beyond · not against the daily trend · entry on the RETEST
// THAT HOLDS (tag ±zone, 1-min close back on the right side), 1st/2nd tap · no earnings in the hold · ≥14 DTE, hold ≤10 days.
import { majorNodes } from '../map/board.js';
import { tapCount } from '../map/living.js';

export const APLUS = { REACH: 0.015, ZONE_PCT: 0.0015, MIN_SHARE: 0.08, GATE: 0.7, MIN_RR: 3, HOLD: 10, DTE: 14 };

/** weekHi/weekLo = highest high / lowest low of this week's sessions BEFORE today. chart = dailyTrend. */
export function findAplus({ board, hier, chart, weekHi, weekLo }) {
  const spot = board.spot, majors = majorNodes(board, 0.03).sort((a, b) => a.strike - b.strike), out = [];
  for (const dir of ['up', 'down']) {
    const entry = dir === 'up' ? hier.floor : hier.ceiling;
    if (!entry || !['king', 'gatekeeper'].includes(entry.skylitType) || entry.share < APLUS.MIN_SHARE) continue;
    if (Math.abs(entry.strike - spot) / spot > APLUS.REACH) continue;
    if ((dir === 'up' && chart === 'down') || (dir === 'down' && chart === 'up')) continue;
    const beyond = majors.filter((n) => (dir === 'up' ? n.strike > spot : n.strike < spot) && n.strike !== entry.strike).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
    const target = beyond.find((n) => (dir === 'up' ? n.strike > weekHi : n.strike < weekLo));
    if (!target) continue;
    const between = majors.filter((n) => (dir === 'up' ? n.strike > entry.strike && n.strike < target.strike : n.strike < entry.strike && n.strike > target.strike));
    if (between.some((n) => n.abs >= APLUS.GATE * target.abs)) continue;
    const back = majors.filter((n) => (dir === 'up' ? n.strike < entry.strike : n.strike > entry.strike)).sort((a, b) => Math.abs(a.strike - entry.strike) - Math.abs(b.strike - entry.strike))[0];
    const step = entry.strike >= 200 ? 2.5 : 1;
    const stop = back && Math.abs(back.strike - entry.strike) / entry.strike <= 0.01 ? back.strike : entry.strike + (dir === 'up' ? -step : step);
    const rr = Math.abs(target.strike - entry.strike) / Math.abs(entry.strike - stop);
    if (rr < APLUS.MIN_RR) continue;
    const t2 = beyond.find((n) => (dir === 'up' ? n.strike > target.strike : n.strike < target.strike))?.strike ?? null;
    out.push({ dir, entry: entry.strike, entryType: entry.skylitType, share: entry.share, stop, target: target.strike, targetType: target.skylitType, t2, rr: +rr.toFixed(1),
      why: `${entry.skylitType} ${dir === 'up' ? 'floor' : 'ceiling'} ${entry.strike} (${(entry.share * 100).toFixed(0)}%) · untouched target ${target.strike} (${target.skylitType}) · air pocket (${between.length} small node(s) between) · R:R ${rr.toFixed(1)} · trend ${chart}` });
  }
  return out;
}

/** The retest that holds, at session bar bi (bars = today's 1-min bars from the open). */
export function retestHolds(a, bars, bi, zone) {
  const b = bars[bi];
  if (!(b.l <= a.entry + zone && b.h >= a.entry - zone)) return false;
  if (!(a.dir === 'up' ? b.c >= a.entry - zone : b.c <= a.entry + zone)) return false;
  return tapCount(bars.slice(0, bi), a.entry, zone).taps < 2;
}
