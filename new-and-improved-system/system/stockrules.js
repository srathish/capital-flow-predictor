// v1 STOCK RULES — single source of truth for the live runner. Mirrors shadow/stock2.mjs line-for-line
// (variants inverse_trend_vex = Rule 1 "break with the trend", confluence_trend_vex = Rule 2 "confluence"). See SYSTEM_RULES.md.
import { normalizeBoard, majorNodes } from '../map/board.js';
import { hierarchy } from '../map/hierarchy.js';
import { rug, reverseRug } from '../map/patterns.js';
import { buildPlan } from '../execution/plan.js';
import { projections } from '../chart/legs.js';
import { vixSide } from '../chart/vixpivot.js';

export const PARAMS = { REACH: 0.015, ZONE_PCT: 0.0015, MIN_RR: 2, MAX_DAYS: 5 };
export const RULES = {
  R1_break_with_trend: { inverse: true, trendOnly: true, vex: true },
  // R2_confluence (std-dev + VIX + trend + VEX) was DROPPED 2026-10-03: after the daily-history fix it lost in 2 of 3 periods
  // (16 trades, −$836); its earlier positive result was an artifact of the calendar bug.
};

const ema = (vals, n) => { const k = 2 / (n + 1); let e = vals[0]; for (let i = 1; i < vals.length; i++) e = vals[i] * k + e * (1 - k); return e; };

/** Daily trend from prior closes (oldest → newest, NOT including today): 'up' | 'down' | 'mixed'. */
export function dailyTrend(priorCloses) {
  const prior = priorCloses.slice(-60);
  const prevClose = prior[prior.length - 1], e20 = ema(prior.slice(-40), 20), e50 = ema(prior, 50);
  return prevClose > e20 && e20 > e50 ? 'up' : prevClose < e20 && e20 < e50 ? 'down' : 'mixed';
}

/** VEX lean from a raw vanna board: |vanna| within ±5% above vs below spot, 1.2× threshold. */
export function vexLean(rawVanna) {
  if (!rawVanna || !rawVanna.strikes?.length) return null;
  const spot = rawVanna.spot; let up = 0, dn = 0;
  for (const s of rawVanna.strikes) { if (!s.value || Math.abs(s.strike - spot) / spot > 0.05) continue; if (s.strike > spot) up += Math.abs(s.value); else if (s.strike < spot) dn += Math.abs(s.value); }
  return up > 1.2 * dn ? 'up' : dn > 1.2 * up ? 'down' : 'flat';
}

/** Morning plan from the 09:35 gamma board: base candidates (the original bounce setups) with their plans. */
export function planDay(sym, rawGamma) {
  const board = normalizeBoard({ ...rawGamma, symbol: sym }); board.zone = board.spot * PARAMS.ZONE_PCT;
  const hier = hierarchy(board), rr = reverseRug(board), rg = rug(board);
  const cands = [];
  const add = (direction, node, setup) => {
    if (!node || Math.abs(node.strike - board.spot) / board.spot > PARAMS.REACH) return;
    if (direction === 'up' && node.strike > board.spot + board.zone) return;
    if (direction === 'down' && node.strike < board.spot - board.zone) return;
    const plan = buildPlan({ board, hier, direction, entryNode: node });
    if (!plan.ok || plan.rr < PARAMS.MIN_RR) return;
    cands.push({ direction, node, setup, plan });
  };
  add('up', rr.detected ? rr.reactionNode : null, 'reverse_rug');
  if (!cands.some((c) => c.direction === 'up')) add('up', hier.floor, 'floor');
  add('down', rg.detected ? rg.reactionNode : null, 'rug');
  if (!cands.some((c) => c.direction === 'down')) add('down', hier.ceiling, 'ceiling');
  return { board, hier, cands };
}

/**
 * Evaluate a touch of candidate `c` under rule `crit` at session bar index `bi`.
 * bars = today's 1-min bars (from the open), chart = dailyTrend, vex = vexLean, vixMin/vixPiv for R2.
 * Returns { ok:true, direction, plan, setup } or { ok:false, gate }.
 */
export function evaluateTouch({ crit, c, board, hier, bars, bi, chart, vex, vixMin, vixPiv }) {
  const b = bars[bi];
  if (!(b.l <= c.node.strike + board.zone && b.h >= c.node.strike - board.zone)) return { ok: false, gate: 'no_touch' };
  let direction = c.direction, plan = c.plan, setup = c.setup;
  if (crit.stdConfluence) {
    const pr = projections(bars.slice(0, bi + 1)).filter((l) => Math.abs(l.level - c.node.strike) <= board.zone).sort((x, y) => y.k - x.k);
    const al = pr.filter((l) => l.fade === direction); if (!al.length) return { ok: false, gate: 'std' };
    setup = `${setup}+std${al[0].k}`;
  }
  if (crit.inverse) {
    direction = direction === 'up' ? 'down' : 'up'; setup = `inverse_${setup}`;
    plan = buildPlan({ board, hier, direction, entryNode: c.node });
    if (!plan.ok || plan.rr < PARAMS.MIN_RR) return { ok: false, gate: 'rr' };
  }
  if (crit.trendOnly && !((direction === 'up' && chart === 'up') || (direction === 'down' && chart === 'down'))) return { ok: false, gate: 'trend' };
  if (crit.vex && vex !== direction) return { ok: false, gate: 'vex' };
  if (crit.vixFilter) { const s = vixSide(vixMin, vixPiv, b.t); if (direction === 'up' ? s !== 'below' : s !== 'above') return { ok: false, gate: 'vix' }; }
  return { ok: true, direction, plan, setup };
}

/** Management step on one 1-min bar. pos: {direction, entryU, plan, half, stopLvl, zone}. Returns exit legs to book (if any). */
export function manageBar(pos, b) {
  const dir = pos.direction === 'up' ? 1 : -1, P = pos.plan, out = [];
  if (!pos.half && P.t1 != null && (dir > 0 ? b.h >= P.t1 : b.l <= P.t1)) { out.push({ frac: 0.5, why: 'T1' }); pos.half = true; pos.stopLvl = pos.entryU; }
  if (pos.half && P.t2 != null && (dir > 0 ? b.h >= P.t2 : b.l <= P.t2)) { out.push({ frac: 0.5, why: 'T2' }); pos.closed = true; return out; }
  if (pos.half && (dir > 0 ? b.l <= pos.stopLvl - pos.zone : b.h >= pos.stopLvl + pos.zone)) { out.push({ frac: 0.5, why: 'breakeven' }); pos.closed = true; }
  return out;
}
/** End-of-day checks: daily-close stop (before T1) and the time exit on the last hold day. */
export function manageClose(pos, close, isLastHoldDay) {
  const dir = pos.direction === 'up' ? 1 : -1;
  if (!pos.half && (dir > 0 ? close.c < pos.stopLvl : close.c > pos.stopLvl)) { pos.closed = true; return [{ frac: 1, why: 'stop(close)' }]; }
  if (isLastHoldDay) { pos.closed = true; return [{ frac: pos.half ? 0.5 : 1, why: 'time' }]; }
  return [];
}
