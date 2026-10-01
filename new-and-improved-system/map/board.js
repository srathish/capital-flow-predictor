// Normalize a Skylit board into nodes with magnitude share, sign, distance. DOCTRINE §1–§2.
// Input: {symbol, spot, strikes:[{strike,value,nodeType,velocityPct?}]}

export const PRICE_SYMBOL = { SPXW: 'SPX', SPX: 'SPX', SPY: 'SPY', QQQ: 'QQQ' };
export const DEFLECTION_ZONE = { SPXW: 5, SPX: 5, SPY: 0.5, QQQ: 0.5 }; // DOCTRINE §8
export const NEAR_SPOT_PCT = 0.03; // window for regime + share math

export function normalizeBoard(raw) {
  const spot = raw.spot;
  const strikes = (raw.strikes || []).filter((s) => Number.isFinite(s.value));
  const near = strikes.filter((s) => Math.abs(s.strike - spot) / spot <= NEAR_SPOT_PCT);
  const totalAbs = near.reduce((a, s) => a + Math.abs(s.value), 0) || 1;
  const nodes = near
    .filter((s) => s.value !== 0)
    .map((s) => ({
      strike: s.strike,
      value: s.value,
      abs: Math.abs(s.value),
      share: Math.abs(s.value) / totalAbs,          // magnitude share of near-spot exposure
      sign: s.value > 0 ? 'pika' : 'barney',         // behavior, not direction
      skylitType: s.nodeType || 'normal',            // king | gatekeeper | pika | barney | significant | normal
      velocityPct: s.velocityPct ?? null,
      distPct: (s.strike - spot) / spot,
      above: s.strike > spot,
    }))
    .sort((a, b) => b.abs - a.abs);
  return { symbol: raw.symbol, spot, previousClose: raw.previousClose ?? null, nodes, totalAbs, zone: DEFLECTION_ZONE[raw.symbol] ?? spot * 0.0007 };
}

/** Classified nodes only (Skylit's own king/gatekeeper/pika/barney/significant), or share ≥ minShare. */
export function majorNodes(board, minShare = 0.05) {
  return board.nodes.filter((n) => n.skylitType !== 'normal' || n.share >= minShare);
}
