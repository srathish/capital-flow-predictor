// The real-time 9-step loop (Academy Ch.11) for ONE symbol. Returns CARD or PASS with the failing step.
import { nearestMajor } from '../map/hierarchy.js';
import { tapCount } from '../map/living.js';
import { buildPlan } from '../execution/plan.js';

const dirOf = (bias) => (bias === 'bearish' ? 'down' : bias === 'bullish' ? 'up' : null);

export function nineSteps(ctx) {
  const { symbol, board, hier, regime, patterns, living, chart, tri, bars, day } = ctx;
  const crit = ctx.criteria || {}; // { locationOnly: true } = only floors/ceilings are entries (community-verified), kings are context
  const steps = []; const pass = (n, why) => ({ decision: 'PASS', symbol, stepFailed: n, why, steps: [...steps, `${n} ✗ ${why}`] });
  const ok = (n, what) => steps.push(`${n} ✓ ${what}`);

  // 1 PRICE
  if (!bars || bars.length < 5) return pass(1, 'not enough price data (need 5 one-minute bars)');
  const last5 = bars.slice(-5); const r5 = (Math.max(...last5.map((b) => b.h)) - Math.min(...last5.map((b) => b.l))) / board.spot;
  if (r5 < 0.0002) return pass(1, 'price not moving (5-min range < 0.02%)');
  ok(1, `trend=${chart.trend}, ${chart.belowVwap ? 'below' : 'above'} VWAP ${chart.vwap}`);

  // 2 STRUCTURE — is there a location worth attention? The location is the SETUP's reaction node when a setup exists
  // (rug → its pika ceiling, reverse rug → its pika floor, beach ball → the overshot node); otherwise the nearest major node.
  const setup = patterns.primary;
  const up = nearestMajor(board, 'up'), dn = nearestMajor(board, 'down');
  let node, dist;
  if (setup?.reactionNode) { node = setup.reactionNode; dist = Math.abs(node.strike - board.spot); }
  else { const cand = [up, dn].filter(Boolean).map((n) => ({ n, d: Math.abs(n.strike - board.spot) })).sort((a, b) => a.d - b.d)[0]; node = cand?.n ?? null; dist = cand?.d ?? Infinity; }
  if (!node) return pass(2, 'no major node near spot');
  if (crit.locationOnly && node.strike !== hier.floor?.strike && node.strike !== hier.ceiling?.strike) {
    const alt = [hier.floor, hier.ceiling].filter(Boolean).map((n) => ({ n, d: Math.abs(n.strike - board.spot) })).sort((a, b) => a.d - b.d)[0];
    if (!alt) return pass(2, 'criteria(location-only): no floor or ceiling');
    node = alt.n; dist = alt.d;
  }
  // noKing: the king is context (pin/gravity), never the entry. Verified twice: Discord calls (king = worst bucket) and
  // the 2-week shadow book (king entries −$531 overall, negative in week 2; non-king entries positive in both weeks).
  if (crit.noKing && node.skylitType === 'king') return pass(2, `king ${node.strike} is context, not an entry (criteria: noKing)`);
  const atNode = dist <= 1.5 * board.zone;
  if (setup && !atNode) return pass(2, `WATCH — ${setup.pattern.toUpperCase()} forming at ${node.strike} (${setup.bias}); price ${(dist / board.zone).toFixed(1)}× zone away. Let the map bring price to you.`);
  if (hier.inMidpoint && !atNode) return pass(2, `spot in the MIDPOINT between floor ${hier.floor?.strike} and ceiling ${hier.ceiling?.strike}`);
  if (!atNode) return pass(2, `no location: nearest major node ${node.strike} is ${(dist / board.zone).toFixed(1)}× zone away`);
  ok(2, `at node ${node.strike} (${node.skylitType}/${node.sign}, ${(node.share * 100).toFixed(0)}% share)${setup ? ` = ${setup.pattern} reaction node` : ''}`);

  // 3 MAP
  if (patterns.noTrade) return pass(3, 'RAINBOW ROAD — no structure');
  ok(3, `king ${hier.king?.strike} · floor ${hier.floor?.strike ?? '—'} · ceiling ${hier.ceiling?.strike ?? '—'} · regime ${regime.label} (${regime.score})`);

  // 4 NODE QUALITY (slow down here)
  const tap = tapCount(bars.slice(0, -1), node.strike, board.zone);
  if (tap.taps >= 3) return pass(4, `node ${node.strike} is on its ${tap.taps + 1}th tap (decaying)`);
  const grow = living.growing.find((g) => g.strike === node.strike), decay = living.decaying.find((g) => g.strike === node.strike);
  if (decay && node.share < 0.08) return pass(4, `node ${node.strike} is decaying (${(decay.chg * 100).toFixed(0)}%) and not dominant`);
  ok(4, `node ${node.strike}: ${tap.lifecycle} (tap #${tap.taps + 1})${grow ? `, GROWING +${(grow.chg * 100).toFixed(0)}%` : ''}${decay ? `, decaying ${(decay.chg * 100).toFixed(0)}%` : ''}`);

  // 5 REACTION TYPE
  const reaction = node.sign === 'barney' ? 'overshoot-then-stall (negative node): enter as the overshoot stalls' : 'direct tap (positive node): enter on the deflection';
  ok(5, reaction);

  // 6 REGIME (informational, shapes management)
  ok(6, regime.behavior);

  // 7 PATH + direction
  // location-only: the pattern only counts if its reaction node IS the floor/ceiling we're at
  const setupHere = setup && (!crit.locationOnly || setup.reactionNode?.strike === node.strike) ? setup : null;
  let direction = setupHere ? dirOf(setupHere.bias) : null, setupName = setupHere?.pattern ?? null;
  if (!direction) {
    // Range-day fade at an extreme: ceiling → down, floor → up (DOCTRINE §4 range)
    const kingOk = !crit.locationOnly && node.skylitType === 'king';
    if (node.above && (node.strike === hier.ceiling?.strike || kingOk)) { direction = 'down'; setupName = 'fade_ceiling'; }
    else if (!node.above && (node.strike === hier.floor?.strike || kingOk)) { direction = 'up'; setupName = 'fade_floor'; }
  }
  if (!direction) return pass(7, `no recognized setup at ${node.strike} (no rug/reverse rug/beach ball, not floor/ceiling)`);
  if (day.type === 'trend' && regime.label === 'negative') {
    const trendDir = living.accumulationSide === 'above' || living.rollingFloor === 'up' ? 'up' : living.accumulationSide === 'below' || living.rollingCeiling === 'down' ? 'down' : null;
    if (trendDir && trendDir !== direction) return pass(7, `TREND day in negative gamma: would be fading the ${trendDir}-move (never fade velocity)`);
  }
  if (setupName === 'reverse_rug' && direction !== 'up') return pass(7, 'never fade a reverse rug');
  const friction = patterns.friction && ((direction === 'up' && patterns.friction.where === 'above') || (direction === 'down' && patterns.friction.where === 'below'));
  ok(7, `${setupName} → ${direction}; path ${direction === 'up' ? (hier.airPocketUp ? 'AIR POCKET up' : `${hier.gatekeepersAbove.length} gatekeeper(s) up`) : (hier.airPocketDown ? 'AIR POCKET down' : `${hier.gatekeepersBelow.length} gatekeeper(s) down`)}${friction ? ' · PIKA CLOUD friction in path' : ''}`);

  // 8 TRINITY
  const want = direction === 'up' ? 'bullish' : 'bearish';
  if (!tri.playable) return pass(8, `trinity ${tri.klass} (${tri.votes.map((v) => `${v.symbol}:${v.v > 0 ? 'bull' : v.v < 0 ? 'bear' : 'neu'}`).join(' ')})`);
  if (tri.direction !== want) return pass(8, `trinity is ${tri.direction}, setup is ${want}`);
  ok(8, `${tri.klass} ${tri.direction} (${tri.agree}/3)`);

  // 9 DECIDE — charts first, then the plan
  if (chart.bias !== 'neutral' && chart.bias !== want) return pass(9, `CHART disagrees: chart says ${chart.bias} (${chart.reasons.join(', ')})`);
  const plan = buildPlan({ board, hier, direction, entryNode: node, sizeMultiplier: tri.sizeMultiplier * tap.sizeMultiplier });
  if (!plan.ok) return pass(9, plan.why);
  if (plan.rr < 2) return pass(9, `R:R ${plan.rr} < 2 (stop ${plan.stop} / target ${plan.t2 ?? plan.t1})`);
  ok(9, `${chart.bias === want ? 'chart AGREES' : 'chart neutral'} · R:R ${plan.rr}${plan.rr < 3 ? ' (below 3:1 standard — reduced)' : ''}`);
  return { decision: 'CARD', symbol, direction, setup: setupName, setupDetail: setup, node, tap, reaction, plan: { ...plan, sizeMultiplier: plan.rr < 3 ? plan.sizeMultiplier * 0.5 : plan.sizeMultiplier }, friction: !!friction, steps };
}
