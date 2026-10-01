// Node-to-node plan: entry at the node, stop = one node beyond (break AND hold), targets = next nodes. DOCTRINE §8.
import { majorNodes } from '../map/board.js';

const STEP = { SPXW: 5, SPX: 5, SPY: 1, QQQ: 1 };

export function buildPlan({ board, hier, direction, entryNode, sizeMultiplier = 1 }) {
  const entry = entryNode.strike, spot = board.spot, step = STEP[board.symbol] ?? 1;
  const majors = majorNodes(board, 0.03);
  const adverse = direction === 'up' ? majors.filter((n) => n.strike < entry).sort((a, b) => b.strike - a.strike) : majors.filter((n) => n.strike > entry).sort((a, b) => a.strike - b.strike);
  let stopNode = adverse.find((n) => Math.abs(n.strike - entry) / spot <= 0.01) || null;
  const stop = stopNode ? stopNode.strike : direction === 'up' ? entry - step : entry + step;
  const favorable = direction === 'up' ? majors.filter((n) => n.strike > spot).sort((a, b) => a.strike - b.strike) : majors.filter((n) => n.strike < spot).sort((a, b) => b.strike - a.strike);
  const risk = Math.abs(entry - stop) || step;
  // T1 = first node that pays at least 1R (skip the gatekeeper sitting one step away); T2 = next DOMINANT node (≥7% share, or the floor/ceiling/king) beyond T1.
  const t1 = favorable.find((n) => Math.abs(n.strike - entry) >= risk)?.strike ?? favorable[0]?.strike ?? null;
  const big = direction === 'up' ? hier.ceiling : hier.floor;
  const dominant = favorable.find((n) => t1 != null && (direction === 'up' ? n.strike > t1 : n.strike < t1) && (n.share >= 0.07 || n === big || n.skylitType === 'king'));
  const t2 = dominant?.strike ?? (big && big.strike !== t1 && (direction === 'up' ? big.strike > spot : big.strike < spot) ? big.strike : favorable.find((n) => n.strike !== t1 && (direction === 'up' ? n.strike > t1 : n.strike < t1))?.strike ?? null);
  if (!t1) return { ok: false, why: `no target node ${direction === 'up' ? 'above' : 'below'} spot` };
  const reward = Math.abs((t2 ?? t1) - entry);
  const rr = +(reward / risk).toFixed(2), rr1 = +(Math.abs(t1 - entry) / risk).toFixed(2);
  return { ok: true, entry, stop, stopRule: `break AND hold ${direction === 'up' ? 'below' : 'above'} ${stop}${stopNode ? ` (${stopNode.skylitType}/${stopNode.sign})` : ' (one strike beyond)'}`, t1, t2, rr, rr1, sizeMultiplier: +sizeMultiplier.toFixed(2) };
}
