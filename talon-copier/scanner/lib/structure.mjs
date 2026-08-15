// structure.mjs — assemble the COMPLETE GEX/VEX structural picture for one ticker,
// with ZERO directional opinion. The JS shows everything; the LLM decides using the
// full Skylit doctrine. This deliberately does NOT score "bullish" or pick a single
// magnet — it surfaces positive walls AND negative-gamma pockets AND the king's sign
// AND what's building vs dissolving, so squeeze setups (negative-gamma king) are as
// visible as grind-ups (positive wall). A rule set can only find what it was told to.
import { kingMigration } from './metrics.mjs';

const M = (x) => Math.round((x / 1e6) * 100) / 100;
const pos = (strike, spot) => (Math.abs(strike - spot) / spot < 0.004 ? 'at' : strike > spot ? 'above' : 'below');

// Trend of a strike's gamma across the trailing sessions (is this node building or
// dissolving?). Returns {trend, from_M, to_M} using nearest strike within tolerance.
function nodeTrend(strike, history, step) {
  const tol = (step || 0) * 1.5 + 1e-6;
  const series = [];
  for (const h of history || []) {
    let best = null, bd = Infinity;
    for (const s of h.strikes) { const d = Math.abs(s.strike - strike); if (d <= tol && d < bd) { bd = d; best = s.gexAgg; } }
    series.push(best == null ? 0 : best); // newest→oldest
  }
  if (series.length < 3) return { trend: 'unknown', from_M: null, to_M: null };
  const h = Math.floor(series.length / 2);
  const recent = series.slice(0, h).reduce((a, b) => a + b, 0) / h;
  const older = series.slice(h).reduce((a, b) => a + b, 0) / (series.length - h);
  const dAbs = Math.abs(recent) - Math.abs(older);
  const trend = dAbs > Math.max(0.15e6, Math.abs(older) * 0.25) ? 'building' : dAbs < -Math.max(0.15e6, Math.abs(older) * 0.25) ? 'dissolving' : 'stable';
  return { trend, from_M: M(series[series.length - 1]), to_M: M(series[0]) };
}

function strikeStep(strikes, spot) {
  const near = strikes.filter((s) => Math.abs(s.strike - spot) / spot <= 0.05).map((s) => s.strike).sort((a, b) => a - b);
  const diffs = [];
  for (let i = 1; i < near.length; i++) { const d = near[i] - near[i - 1]; if (d > 0) diffs.push(d); }
  if (!diffs.length) return null;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

export function assembleStructure(profile, history = null, { topN = 12 } = {}) {
  const spot = profile.spot;
  const step = strikeStep(profile.strikes, spot);
  const total = profile.strikes.reduce((a, s) => a + Math.abs(s.gexAgg), 0);
  const totalVex = profile.strikes.reduce((a, s) => a + Math.abs(s.vexAgg || 0), 0);

  const ranked = [...profile.strikes].sort((a, b) => Math.abs(b.gexAgg) - Math.abs(a.gexAgg));
  const nodes = ranked.slice(0, topN).map((s) => {
    const t = history ? nodeTrend(s.strike, history, step) : { trend: 'unknown' };
    return {
      strike: s.strike, gex_M: M(s.gexAgg), gamma: s.gexAgg >= 0 ? 'long' : 'short',
      position: pos(s.strike, spot), pct_from_spot: Math.round((s.strike - spot) / spot * 1000) / 10,
      share: total ? Math.round(Math.abs(s.gexAgg) / total * 100) : 0,
      trend: t.trend, trend_from_M: t.from_M, trend_to_M: t.to_M,
    };
  });

  const king = nodes[0] || null;
  const km = history ? kingMigration(profile.strikes, history) : { direction: 'unknown', pct_change: null, from: null, to: null };

  // Squeeze fuel (short-gamma) vs walls (long-gamma), near spot.
  const nearBand = 0.12;
  const near = nodes.filter((n) => Math.abs(n.pct_from_spot) / 100 <= nearBand);
  const negative_gamma_pockets = near.filter((n) => n.gamma === 'short');
  const positive_walls = near.filter((n) => n.gamma === 'long');

  // Vanna magnets (largest |vex|).
  const vanna = [...profile.strikes].sort((a, b) => Math.abs(b.vexAgg || 0) - Math.abs(a.vexAgg || 0)).slice(0, 4)
    .filter((s) => (s.vexAgg || 0) !== 0)
    .map((s) => ({ strike: s.strike, vex_M: M(s.vexAgg || 0), sign: (s.vexAgg || 0) >= 0 ? '+' : '-', position: pos(s.strike, spot), pct_from_spot: Math.round((s.strike - spot) / spot * 1000) / 10 }));

  // Where does spot sit? (context, not a verdict.)
  const atNode = nodes.find((n) => n.position === 'at');
  const spot_context = atNode
    ? `spot sits ON a ${atNode.gamma}-gamma node at ${atNode.strike} (${atNode.gex_M}M${atNode.gamma === 'short' ? ' — short-gamma at spot = unstable/explosive' : ' — long-gamma at spot = pinning'})`
    : `spot sits between nodes (nearest below: ${[...near].filter((n) => n.position === 'below')[0]?.strike ?? '—'}, nearest above: ${[...near].filter((n) => n.position === 'above')[0]?.strike ?? '—'})`;

  return {
    ticker: profile.ticker, spot: Math.round(spot * 100) / 100, prev_close: profile.previousClose,
    as_of: profile.asofDate, total_abs_gex_M: M(total), total_abs_vex_M: M(totalVex),
    king: king ? { strike: king.strike, gex_M: king.gex_M, gamma: king.gamma, position: king.position, pct_from_spot: king.pct_from_spot, trend: king.trend } : null,
    king_migration: { direction: km.direction, pct_change: km.pct_change == null ? null : Math.round(km.pct_change * 1000) / 10, from_strike: km.from, to_strike: km.to },
    nodes,
    negative_gamma_pockets, // short-gamma near spot = squeeze fuel
    positive_walls,         // long-gamma near spot = support/resistance
    vanna_magnets: vanna,
    spot_context,
    expirations: profile.expirations,
  };
}
