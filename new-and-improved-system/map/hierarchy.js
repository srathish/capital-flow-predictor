// King / floor / ceiling / gatekeepers / air pockets / midpoint. DOCTRINE §2.
import { majorNodes } from './board.js';

const MAJOR = 0.05, GATE = 0.03;

export function hierarchy(board) {
  const { spot, nodes } = board;
  const king = nodes.find((n) => n.skylitType === 'king') || nodes[0] || null;
  const below = nodes.filter((n) => !n.above).sort((a, b) => b.strike - a.strike);
  const above = nodes.filter((n) => n.above).sort((a, b) => a.strike - b.strike);
  // Doctrine Ch.3: floor = the LARGEST node below spot, ceiling = the LARGEST node above spot (classified nodes first, else raw).
  const pick = (list) => (list.filter((n) => n.skylitType !== 'normal').sort((a, b) => b.abs - a.abs)[0]) || list.sort((a, b) => b.abs - a.abs)[0] || null;
  const floor = pick(below.slice()), ceiling = pick(above.slice());
  const gatekeepersBelow = floor ? below.filter((n) => n.strike > floor.strike && (n.share >= GATE || n.skylitType === 'gatekeeper')) : [];
  const gatekeepersAbove = ceiling ? above.filter((n) => n.strike < ceiling.strike && (n.share >= GATE || n.skylitType === 'gatekeeper')) : [];
  const midpoint = floor && ceiling ? (floor.strike + ceiling.strike) / 2 : null;
  const midpointZone = midpoint != null ? Math.abs(spot - midpoint) <= (ceiling.strike - floor.strike) * 0.15 : false;
  return {
    king, floor, ceiling, gatekeepersBelow, gatekeepersAbove, midpoint, inMidpoint: midpointZone,
    airPocketUp: ceiling ? gatekeepersAbove.length === 0 : false,
    airPocketDown: floor ? gatekeepersBelow.length === 0 : false,
    majors: majorNodes(board),
  };
}

/** Nearest major node in a direction from spot (for "closest meaningful node"). */
export function nearestMajor(board, dir /* 'up'|'down' */) {
  const list = majorNodes(board).filter((n) => (dir === 'up' ? n.above : !n.above));
  return list.sort((a, b) => Math.abs(a.distPct) - Math.abs(b.distPct))[0] || null;
}
