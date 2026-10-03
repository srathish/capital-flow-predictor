// Paper-trading engine. A CARD becomes a resting limit at the node; fills, stops and targets are decided on the
// UNDERLYING's 1-min bars (exactly as the plan is written); P&L is priced on the REAL 0DTE contract's 1-min bars.
import { occ } from '../feeds/uw.js';
import { optionBars } from './cache.js';

export const RULES = {
  pendingMinutes: 15,   // resting limit lives this long
  stopHoldBars: 3,      // stop = break AND hold: 3 consecutive 1-min closes beyond the stop level
  flatBy: '15:45',      // 0DTE: flat by this ET time
  noNewAfter: '15:15',  // no new entries after this
  cooldownMinutes: 10,  // per symbol after an exit
};
const ROOT = { SPXW: 'SPXW', SPY: 'SPY', QQQ: 'QQQ' };
const STRIKE_STEP = { SPXW: 5, SPY: 1, QQQ: 1 };

/** price of the contract at minute t: bar at t, else the last bar within 5 min before it. side: 'close' | 'high' | 'low' */
const SIDE = { close: 'c', high: 'h', low: 'l', open: 'o' };
function optPx(bars, t, side = 'close') {
  let best = null;
  for (const b of bars) { if (b.t > t) break; if (t - b.t <= 300) best = b; }
  return best ? best[SIDE[side]] : null;
}

/**
 * Simulate one card. card: {symbol, direction:'up'|'down', plan:{entry,stop,t1,t2}, t (unix), zone}
 * ubars: underlying 1-min bars for the day. Returns a trade record or {filled:false}.
 */
export async function simulate(card, ubars, date, flatByUnix) {
  const { symbol, direction, plan, zone } = card;
  const dir = direction === 'up' ? 1 : -1;
  const start = ubars.findIndex((b) => b.t >= card.t);
  if (start < 0) return { filled: false, why: 'no bars after card' };

  // 1) resting limit at the node: fills when a bar trades within the deflection zone of entry
  let fi = -1;
  for (let i = start; i < ubars.length && ubars[i].t <= card.t + RULES.pendingMinutes * 60; i++) {
    const b = ubars[i];
    if (b.l <= plan.entry + zone && b.h >= plan.entry - zone) { fi = i; break; }
  }
  if (fi < 0) return { filled: false, why: `limit at ${plan.entry} not touched within ${RULES.pendingMinutes}m` };
  const fillT = ubars[fi].t, fillU = plan.entry;

  // 2) the real contract: ATM at the fill
  const strike = Math.round(fillU / STRIKE_STEP[symbol]) * STRIKE_STEP[symbol];
  const type = dir > 0 ? 'call' : 'put';
  const id = occ(ROOT[symbol], date, type, strike);
  const ob = await optionBars(id, date);
  const entryMid = optPx(ob, fillT, 'close'), entryWorst = optPx(ob, fillT, 'high');
  if (!entryMid || entryMid <= 0.02) return { filled: false, why: `no option print for ${id} at fill` };

  // 3) manage on the underlying: T1 → sell half + stop to breakeven; T2 → sell rest; stop = 3 closes beyond; flat-by
  let stopLvl = plan.stop, beyond = 0, legs = [], half = false;
  const exitAt = (i, frac, reason) => legs.push({ t: ubars[i].t, u: ubars[i].c, frac, reason });
  let i = fi;
  for (; i < ubars.length; i++) {
    const b = ubars[i];
    if (b.t >= flatByUnix) { exitAt(i, half ? 0.5 : 1, 'flat_by'); break; }
    const hitT1 = plan.t1 != null && (dir > 0 ? b.h >= plan.t1 : b.l <= plan.t1);
    const hitT2 = plan.t2 != null && (dir > 0 ? b.h >= plan.t2 : b.l <= plan.t2);
    if (!half && hitT1) { legs.push({ t: b.t, u: plan.t1, frac: 0.5, reason: 'T1' }); half = true; stopLvl = fillU; beyond = 0; }
    if (half && hitT2) { legs.push({ t: b.t, u: plan.t2, frac: 0.5, reason: 'T2' }); break; }
    const closedBeyond = dir > 0 ? b.c < stopLvl : b.c > stopLvl;
    beyond = closedBeyond ? beyond + 1 : 0;
    if (beyond >= (half ? 1 : RULES.stopHoldBars) && i > fi) { exitAt(i, half ? 0.5 : 1, half ? 'breakeven' : 'stop'); break; }
  }
  if (!legs.length || legs.reduce((a, l) => a + l.frac, 0) < 0.999) exitAt(Math.min(i, ubars.length - 1), 1 - legs.reduce((a, l) => a + l.frac, 0), 'eod');

  // 4) price every leg on the real contract
  let pnlMid = 0, pnlWorst = 0, uR = 0;
  const risk = Math.abs(fillU - plan.stop) || zone;
  for (const l of legs) {
    const xm = optPx(ob, l.t, 'close') ?? 0, xw = optPx(ob, l.t, 'low') ?? 0;
    l.optMid = xm; l.optWorst = xw;
    pnlMid += (xm - entryMid) * 100 * l.frac;
    pnlWorst += (xw - entryWorst) * 100 * l.frac;
    uR += ((l.u - fillU) * dir / risk) * l.frac;
  }
  const lastT = legs[legs.length - 1].t;
  return {
    filled: true, symbol, direction, setup: card.setup, nodeType: card.nodeType, contract: id,
    fillT, exitT: lastT, holdMin: Math.round((lastT - fillT) / 60),
    entryOpt: entryMid, entryOptWorst: entryWorst, legs,
    pnlMid: +pnlMid.toFixed(2), pnlWorst: +pnlWorst.toFixed(2), retMid: +(pnlMid / (entryMid * 100)).toFixed(3), retWorst: +(pnlWorst / (entryWorst * 100)).toFixed(3),
    uR: +uR.toFixed(2), outcome: legs.map((l) => l.reason).join('+'),
  };
}
