// Patterns = behavior, never signals. DOCTRINE §5. Each returns {detected, confidence, ...context}.
import { majorNodes } from './board.js';

const MAJOR = 0.05, MINOR = 0.03;

const DOMINANT = 0.10; // the reaction node of a rug / reverse rug must be a dominant node, not a minor one

/** Rug: a DOMINANT pika ceiling above spot (largest thing above, within 1.5%), a barney directly beneath it (between it and spot),
 *  nothing bigger than that pika between spot and it. Magnitude overrides the literal arrangement. */
export function rug(board) {
  const majors = majorNodes(board, MINOR);
  const above = majors.filter((n) => n.above && n.distPct <= 0.015);
  const p = above.filter((n) => n.sign === 'pika' && n.share >= DOMINANT).sort((a, b) => b.abs - a.abs)[0];
  if (!p) return { detected: false, pattern: 'rug' };
  const biggerBetween = above.find((n) => n.strike < p.strike && n.abs > p.abs);
  if (biggerBetween) return { detected: false, pattern: 'rug', why: `bigger ${biggerBetween.sign} ${biggerBetween.strike} sits below the pika` };
  const barney = majors.filter((n) => n.sign === 'barney' && n.strike < p.strike && n.strike >= board.spot * (1 - 0.006)).sort((a, b) => b.abs - a.abs)[0];
  if (!barney) return { detected: false, pattern: 'rug', why: 'no barney trapdoor under the pika' };
  return { detected: true, pattern: 'rug', bias: 'bearish', confidence: Math.min(1, (p.share + barney.share) / 0.3), reactionNode: p, ceiling: p, trapdoor: barney, note: 'rejection at the pika ceiling + acceleration through the barney — PUTS at the tap of the pika' };
}

/** Reverse rug: a DOMINANT pika floor below spot (largest thing below, within 1.5%), a barney directly above it. NEVER FADE. */
export function reverseRug(board) {
  const majors = majorNodes(board, MINOR);
  const below = majors.filter((n) => !n.above && -n.distPct <= 0.015);
  const p = below.filter((n) => n.sign === 'pika' && n.share >= DOMINANT).sort((a, b) => b.abs - a.abs)[0];
  if (!p) return { detected: false, pattern: 'reverse_rug' };
  const biggerBetween = below.find((n) => n.strike > p.strike && n.abs > p.abs);
  if (biggerBetween) return { detected: false, pattern: 'reverse_rug', why: `bigger ${biggerBetween.sign} ${biggerBetween.strike} sits above the pika` };
  const barney = majors.filter((n) => n.sign === 'barney' && n.strike > p.strike && n.strike <= board.spot * (1 + 0.006)).sort((a, b) => b.abs - a.abs)[0];
  if (!barney) return { detected: false, pattern: 'reverse_rug', why: 'no barney fuel above the pika' };
  return { detected: true, pattern: 'reverse_rug', bias: 'bullish', confidence: Math.min(1, (p.share + barney.share) / 0.3), reactionNode: p, floor: p, fuel: barney, note: 'pika floor deflects up + barney amplifies — CALLS at the tap of the pika; never fade' };
}

/** Pika cloud: ≥3 consecutive classified pikas (≥3% each) with no barney bigger than them interleaved, span ≤1.5%, cluster ≥20%. Friction, not bias. */
export function pikaCloud(board) {
  const cls = board.nodes.filter((n) => n.share >= 0.02).sort((a, b) => a.strike - b.strike);
  let best = null;
  for (let i = 0; i < cls.length; i++) {
    if (cls[i].sign !== 'pika' || cls[i].share < 0.03) continue;
    const run = [cls[i]]; let minPika = cls[i].abs;
    for (let j = i + 1; j < cls.length; j++) {
      if ((cls[j].strike - cls[i].strike) / board.spot > 0.015) break;
      if (cls[j].sign === 'barney') { if (cls[j].abs >= minPika) break; else continue; }
      if (cls[j].share >= 0.03) { run.push(cls[j]); minPika = Math.min(minPika, cls[j].abs); }
    }
    const share = run.reduce((a, n) => a + n.share, 0);
    if (run.length >= 3 && share >= 0.20 && (!best || share > best.share)) best = { cluster: run, share };
  }
  if (!best) return { detected: false, pattern: 'pika_cloud' };
  const lo = best.cluster[0].strike, hi = best.cluster[best.cluster.length - 1].strike;
  const where = hi < board.spot ? 'below' : lo > board.spot ? 'above' : 'surrounding';
  return { detected: true, pattern: 'pika_cloud', bias: 'neutral', confidence: Math.min(1, best.share / 0.4), lo, hi, where, share: best.share, note: `gravity well ${where} spot (${lo}-${hi}) — friction; don't push through; fade its edges` };
}

/** Beach ball: overshot a major node by ≥1.5×zone recently, now back within 2×zone and stalling. Needs 1-min bars. */
export function beachBall(board, bars) {
  if (!bars || bars.length < 10) return { detected: false, pattern: 'beach_ball' };
  const zone = board.zone, recent = bars.slice(-30), last5 = bars.slice(-5);
  const range5 = (Math.max(...last5.map((b) => b.h)) - Math.min(...last5.map((b) => b.l))) / board.spot;
  const stalling = range5 < 0.0008; // the overshoot has to STALL (≤0.08% over 5 min)
  for (const n of majorNodes(board).filter((x) => x.share >= DOMINANT)) {
    const maxH = Math.max(...recent.map((b) => b.h)), minL = Math.min(...recent.map((b) => b.l)), px = bars[bars.length - 1].c;
    const overUp = maxH >= n.strike + 1.5 * zone && px <= n.strike + 2 * zone && px >= n.strike - 2 * zone;
    const overDown = minL <= n.strike - 1.5 * zone && px >= n.strike - 2 * zone && px <= n.strike + 2 * zone;
    if ((overUp || overDown) && stalling) {
      return { detected: true, pattern: 'beach_ball', bias: overUp ? 'bearish' : 'bullish', confidence: 0.6, reactionNode: n, node: n, direction: overUp ? 'reverting_down' : 'reverting_up', note: 'overshoot → stall → reversion; NOT a breakout; trade the snap-back' };
    }
  }
  return { detected: false, pattern: 'beach_ball' };
}

/** Rainbow road: no dominant node, no floor/ceiling, flat distribution → NO TRADE. */
export function rainbowRoad(board, hier) {
  const top = board.nodes[0]?.share ?? 0;
  const p = board.nodes.map((n) => n.share).filter((x) => x > 0);
  const H = -p.reduce((a, x) => a + x * Math.log(x), 0) / Math.log(Math.max(2, p.length));
  const detected = top < 0.10 && !hier.floor && !hier.ceiling && H >= 0.85;
  return { detected, pattern: 'rainbow_road', bias: 'none', confidence: detected ? 1 : 0, entropy: Number(H.toFixed(2)), topShare: Number(top.toFixed(3)), note: 'no structure — do not trade' };
}

export function detectAll(board, hier, bars) {
  const r = { rug: rug(board), reverse_rug: reverseRug(board), pika_cloud: pikaCloud(board), beach_ball: beachBall(board, bars), rainbow_road: rainbowRoad(board, hier) };
  const directional = [r.rug, r.reverse_rug, r.beach_ball].filter((x) => x.detected).sort((a, b) => b.confidence - a.confidence);
  return { all: r, primary: directional[0] || null, friction: r.pika_cloud.detected ? r.pika_cloud : null, noTrade: r.rainbow_road.detected };
}
