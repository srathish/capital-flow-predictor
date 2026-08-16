// talon-levels.mjs — reproduce Skylit Talon's watchlist LEVELS deterministically from
// the structure (verified node-for-node vs Talon's published Aug-15 watchlist):
//   OTE (entry)     = nearest +gamma SUPPORT below spot (the pullback level)
//   invalidation    = the next +gamma support below the OTE (deeper floor)
//   first_target    = nearest +gamma WALL above spot (the ceiling/king)
//   swing_targets   = the vanna (VEX) magnets above spot (melt-up ladder)
// These are DETERMINISTIC — the LLM judges direction / which setups are clean / the
// theme, but the levels come from the dealer structure, not the model. This is the
// discipline that stops the chop: enter on the OTE pullback, not by chasing.

const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

// Bullish level map (long from an OTE pullback to support, up to the wall/vanna ladder).
// minShare filters out tiny nodes (Talon skips insignificant walls for the target).
export function talonLevels(structure, { minShare = 3 } = {}) {
  const spot = structure.spot;
  const g = structure.gamma?.nodes || [];
  const v = structure.vanna?.nodes || [];

  const supports = g.filter((n) => n.sign === 'pos' && n.strike < spot && (n.share ?? 0) >= minShare).sort((a, b) => b.strike - a.strike); // nearest first
  const walls = g.filter((n) => n.sign === 'pos' && n.strike > spot && (n.share ?? 0) >= minShare).sort((a, b) => a.strike - b.strike);
  const vexAbove = v.filter((n) => n.strike > spot && (n.share ?? 0) >= minShare).sort((a, b) => a.strike - b.strike).map((n) => n.strike);

  const ote = supports[0]?.strike ?? null;
  const invalidation = supports[1]?.strike ?? (ote != null ? r2(ote * 0.985) : null);
  const first_target = walls[0]?.strike ?? null;
  const swing_targets = vexAbove.slice(0, 4);
  const rr = (ote != null && first_target != null && invalidation != null && ote > invalidation)
    ? r2((first_target - ote) / (ote - invalidation)) : null;

  return { direction: 'bullish', spot: r2(spot), ote, invalidation, first_target, swing_targets, rr };
}

// Bearish mirror (short from an OTE rally to resistance, down to the support/vanna ladder below).
export function talonLevelsBearish(structure, { minShare = 3 } = {}) {
  const spot = structure.spot;
  const g = structure.gamma?.nodes || [];
  const v = structure.vanna?.nodes || [];

  const resist = g.filter((n) => n.sign === 'pos' && n.strike > spot && (n.share ?? 0) >= minShare).sort((a, b) => a.strike - b.strike); // nearest first
  const floors = g.filter((n) => n.sign === 'pos' && n.strike < spot && (n.share ?? 0) >= minShare).sort((a, b) => b.strike - a.strike);
  const vexBelow = v.filter((n) => n.strike < spot && (n.share ?? 0) >= minShare).sort((a, b) => b.strike - a.strike).map((n) => n.strike);

  const ote = resist[0]?.strike ?? null;
  const invalidation = resist[1]?.strike ?? (ote != null ? r2(ote * 1.015) : null);
  const first_target = floors[0]?.strike ?? null;
  const swing_targets = vexBelow.slice(0, 4);
  const rr = (ote != null && first_target != null && invalidation != null && invalidation > ote)
    ? r2((ote - first_target) / (invalidation - ote)) : null;

  return { direction: 'bearish', spot: r2(spot), ote, invalidation, first_target, swing_targets, rr };
}
