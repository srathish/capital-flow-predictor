// One full pass of the system over the Trinity at an instant. Used by replay.mjs and live.mjs.
import { normalizeBoard, PRICE_SYMBOL } from '../map/board.js';
import { hierarchy } from '../map/hierarchy.js';
import { regime } from '../map/regime.js';
import { detectAll } from '../map/patterns.js';
import { reshuffle } from '../map/living.js';
import { trinity } from '../map/trinity.js';
import { chartStructure } from '../chart/structure.js';
import { dayType } from './daytype.js';
import { nineSteps } from './nine-steps.js';

/** boards: current raw boards by symbol; prevBoards: earlier frame (or null); bars: 1-min session bars by PRICE symbol; daily: daily bars by PRICE symbol. */
export function runPass({ symbols, boards, prevBoards, bars, daily, date, criteria = {} }) {
  const ctx = {};
  for (const sym of symbols) {
    const raw = boards[sym]; if (!raw) continue;
    const board = normalizeBoard({ ...raw, symbol: sym });
    const hier = hierarchy(board);
    const px = PRICE_SYMBOL[sym] ?? sym;
    const b1 = bars[px] || [];
    const pats = detectAll(board, hier, b1);
    const liv = reshuffle(prevBoards?.[sym] ? normalizeBoard({ ...prevBoards[sym], symbol: sym }) : null, board);
    const chart = chartStructure(b1, daily[px] || [], board.spot, { date });
    // symbol read for trinity: pattern bias > position lean > living evidence
    let bias = 'neutral', strength = 0;
    const nearSetup = pats.primary?.reactionNode && Math.abs(pats.primary.reactionNode.strike - board.spot) <= 3 * board.zone;
    if (pats.primary && nearSetup) { bias = pats.primary.bias; strength = pats.primary.confidence; }
    else if (pats.primary) { bias = pats.primary.bias; strength = 0.25; } // forming, not at the node: a lean, not a vote
    else if (hier.ceiling && Math.abs(hier.ceiling.strike - board.spot) <= 1.5 * board.zone) { bias = 'bearish'; strength = 0.4; }
    else if (hier.floor && Math.abs(hier.floor.strike - board.spot) <= 1.5 * board.zone) { bias = 'bullish'; strength = 0.4; }
    else if (liv.rollingCeiling === 'down' || liv.accumulationSide === 'below') { bias = 'bearish'; strength = 0.3; }
    else if (liv.rollingFloor === 'up' || liv.accumulationSide === 'above') { bias = 'bullish'; strength = 0.3; }
    ctx[sym] = { symbol: sym, board, hier, regime: regime(board), patterns: pats, living: liv, chart, bars: b1, read: { symbol: sym, bias, strength, hasRange: !!(hier.floor && hier.ceiling) } };
  }
  const reads = Object.values(ctx);
  const tri = trinity(reads.map((r) => r.read));
  const day = dayType(reads, tri);
  const results = {};
  for (const r of reads) {
    results[r.symbol] = day.mayEngage ? nineSteps({ ...r, tri, day, criteria }) : { decision: 'PASS', symbol: r.symbol, stepFailed: 0, why: 'day type = rainbow road (no trade)', steps: [] };
  }
  return { ctx, tri, day, results };
}
