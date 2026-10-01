// The living map: rolling floors/ceilings, velocity, growth vs decay, tap lifecycle. DOCTRINE §6.
import { hierarchy } from './hierarchy.js';

/** Compare an earlier board to the current one. */
export function reshuffle(prevBoard, curBoard) {
  if (!prevBoard) return { rollingFloor: 'unknown', rollingCeiling: 'unknown', growing: [], decaying: [], note: 'no prior frame' };
  const a = hierarchy(prevBoard), b = hierarchy(curBoard);
  const rollingFloor = a.floor && b.floor ? (b.floor.strike > a.floor.strike ? 'up' : b.floor.strike < a.floor.strike ? 'down' : 'flat') : 'unknown';
  const rollingCeiling = a.ceiling && b.ceiling ? (b.ceiling.strike < a.ceiling.strike ? 'down' : b.ceiling.strike > a.ceiling.strike ? 'up' : 'flat') : 'unknown';
  const prevBy = new Map(prevBoard.nodes.map((n) => [n.strike, n]));
  const growing = [], decaying = [];
  for (const n of curBoard.nodes.filter((x) => x.share >= 0.03)) {
    const p = prevBy.get(n.strike);
    const chg = p ? (n.abs - p.abs) / p.abs : 1;
    if (chg >= 0.10) growing.push({ strike: n.strike, chg: Number(chg.toFixed(2)), sign: n.sign, above: n.above });
    else if (chg <= -0.10) decaying.push({ strike: n.strike, chg: Number(chg.toFixed(2)), sign: n.sign, above: n.above });
  }
  const upMass = growing.filter((g) => g.above).length, downMass = growing.filter((g) => !g.above).length;
  const oneDirectional = growing.length >= 2 && (upMass === 0 || downMass === 0);
  const evidence = [];
  if (rollingFloor === 'up') evidence.push('floor rolling UP → downside being removed (bullish evidence)');
  if (rollingCeiling === 'down') evidence.push('ceiling rolling DOWN → upside being capped (bearish evidence)');
  if (rollingFloor === 'down') evidence.push('floor rolling DOWN → downside opening (bearish evidence)');
  if (rollingCeiling === 'up') evidence.push('ceiling rolling UP → upside opening (bullish evidence)');
  if (oneDirectional) evidence.push(`one-directional accumulation ${upMass ? 'ABOVE' : 'BELOW'} spot (velocity fuel)`);
  return { rollingFloor, rollingCeiling, growing, decaying, oneDirectional, accumulationSide: oneDirectional ? (upMass ? 'above' : 'below') : 'mixed', evidence };
}

/** Tap lifecycle from 1-min bars since the open: count distinct touches of a level within the deflection zone (10-min cooldown). */
export function tapCount(bars1m, level, zone) {
  // A tap = price APPROACHES the level from ≥3×zone away and enters the deflection zone (outside→inside transition),
  // measured on 5-min bars with a 10-min cooldown. Hovering around a level is not tapping it.
  const bars = []; for (let i = 0; i < bars1m.length; i += 5) { const c = bars1m.slice(i, i + 5); bars.push({ t: c[0].t, o: c[0].o, h: Math.max(...c.map((b) => b.h)), l: Math.min(...c.map((b) => b.l)), c: c[c.length - 1].c }); }
  let taps = 0, lastTap = -Infinity, outside = true;
  for (const b of bars) {
    const inside = b.l <= level + zone && b.h >= level - zone;
    const farAway = !inside && Math.min(Math.abs(b.c - level), Math.abs(b.o - level)) >= 3 * zone;
    if (inside && outside && b.t - lastTap >= 600) { taps++; lastTap = b.t; }
    if (farAway) outside = true; else if (inside) outside = false;
  }
  const lifecycle = taps === 0 ? 'fresh' : taps === 1 ? 'tested' : taps === 2 ? 'delivered' : 'decaying';
  return { taps, lifecycle, sizeMultiplier: taps === 0 ? 1 : taps === 1 ? 0.66 : taps === 2 ? 0.33 : 0 };
}
