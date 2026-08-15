// structure.mjs — assemble the COMPLETE dealer picture for one ticker, with ZERO
// directional opinion. We read BOTH books the same way: GAMMA (dealer price-hedging)
// AND VANNA (dealer vol-hedging / melt-ups). The JS shows everything; the LLM decides
// using the full doctrine. Field-generic helpers compute an identical rich structure
// (king, migration, nodes, pockets/walls, what's building/dissolving) for each Greek.

const M = (x) => Math.round((x / 1e6) * 100) / 100;
const pos = (strike, spot) => (Math.abs(strike - spot) / spot < 0.004 ? 'at' : strike > spot ? 'above' : 'below');

function strikeStep(strikes, spot) {
  const near = strikes.filter((s) => Math.abs(s.strike - spot) / spot <= 0.05).map((s) => s.strike).sort((a, b) => a - b);
  const diffs = [];
  for (let i = 1; i < near.length; i++) { const d = near[i] - near[i - 1]; if (d > 0) diffs.push(d); }
  if (!diffs.length) return null;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

// Trend of a strike's exposure (field) across trailing sessions — building or dissolving?
function nodeTrend(strike, history, step, field) {
  const tol = (step || 0) * 1.5 + 1e-6;
  const series = [];
  for (const h of history || []) {
    let best = null, bd = Infinity;
    for (const s of h.strikes) { const d = Math.abs(s.strike - strike); if (d <= tol && d < bd) { bd = d; best = s[field]; } }
    series.push(best == null ? 0 : best);
  }
  if (series.length < 3) return { trend: 'unknown', from_M: null, to_M: null };
  const h = Math.floor(series.length / 2);
  const recent = series.slice(0, h).reduce((a, b) => a + b, 0) / h;
  const older = series.slice(h).reduce((a, b) => a + b, 0) / (series.length - h);
  const dAbs = Math.abs(recent) - Math.abs(older);
  const trend = dAbs > Math.max(0.15e6, Math.abs(older) * 0.25) ? 'building' : dAbs < -Math.max(0.15e6, Math.abs(older) * 0.25) ? 'dissolving' : 'stable';
  return { trend, from_M: M(series[series.length - 1]), to_M: M(series[0]) };
}

// King (largest |field| node) and its drift across trailing sessions (up/down/flat).
function bookMigration(currentStrikes, history, field) {
  const kingOf = (strikes) => { let best = null, bg = -1; for (const s of strikes || []) { const g = Math.abs(s[field] || 0); if (g > bg) { bg = g; best = s.strike; } } return best; };
  const cur = kingOf(currentStrikes);
  const series = [cur, ...(history || []).map((h) => kingOf(h.strikes))].filter((x) => x != null);
  if (series.length < 4) return { direction: 'unknown', pct_change: null, from: series[series.length - 1] ?? cur, to: cur };
  const h = Math.floor(series.length / 2);
  const recent = series.slice(0, h).reduce((a, b) => a + b, 0) / h;
  const older = series.slice(h).reduce((a, b) => a + b, 0) / (series.length - h);
  const pct = older ? (recent - older) / older : 0;
  const direction = pct > 0.01 ? 'up_bullish' : pct < -0.01 ? 'down_bearish' : 'flat';
  return { direction, pct_change: Math.round(pct * 1000) / 10, from: series[series.length - 1], to: cur };
}

// The rich structure for one Greek (field = 'gexAgg' | 'vexAgg'), read the same way.
function analyzeBook(strikes, spot, history, field, { topN = 12, step, nearBand = 0.12 } = {}) {
  const total = strikes.reduce((a, s) => a + Math.abs(s[field] || 0), 0);
  const ranked = [...strikes].sort((a, b) => Math.abs(b[field] || 0) - Math.abs(a[field] || 0));
  const nodes = ranked.slice(0, topN).filter((s) => (s[field] || 0) !== 0).map((s) => {
    const t = history ? nodeTrend(s.strike, history, step, field) : { trend: 'unknown', from_M: null, to_M: null };
    return {
      strike: s.strike, M: M(s[field] || 0), sign: (s[field] || 0) >= 0 ? 'pos' : 'neg',
      position: pos(s.strike, spot), pct_from_spot: Math.round((s.strike - spot) / spot * 1000) / 10,
      share: total ? Math.round(Math.abs(s[field] || 0) / total * 100) : 0,
      trend: t.trend, trend_from_M: t.from_M, trend_to_M: t.to_M,
    };
  });
  const king = nodes[0] || null;
  const migration = history ? bookMigration(strikes, history, field) : { direction: 'unknown', pct_change: null, from: null, to: null };
  const near = nodes.filter((n) => Math.abs(n.pct_from_spot) / 100 <= nearBand);
  return {
    total_abs_M: M(total),
    king: king ? { strike: king.strike, M: king.M, sign: king.sign, position: king.position, pct_from_spot: king.pct_from_spot, trend: king.trend } : null,
    king_migration: migration,
    nodes,
    positive_near: near.filter((n) => n.sign === 'pos'),
    negative_near: near.filter((n) => n.sign === 'neg'),
  };
}

export function assembleStructure(profile, history = null, { topN = 12 } = {}) {
  const spot = profile.spot;
  const step = strikeStep(profile.strikes, spot);

  // GAMMA book — dealer PRICE hedging. pos = long-gamma wall (pin/support/resist);
  // neg = short-gamma (squeeze fuel).
  const g = analyzeBook(profile.strikes, spot, history, 'gexAgg', { topN, step, nearBand: 0.12 });
  // VANNA book — dealer VOL hedging. pos vanna above spot = melt-up magnet on IV
  // compression; the vanna king is where dealers' vol-hedge concentrates. Wider band —
  // vanna magnets are targets price melts toward, often further out.
  const v = analyzeBook(profile.strikes, spot, history, 'vexAgg', { topN, step, nearBand: 0.25 });

  const atG = g.nodes.find((n) => n.position === 'at');
  const gammaContext = atG
    ? `spot sits ON a ${atG.sign === 'pos' ? 'long' : 'short'}-gamma node at ${atG.strike} (${atG.M}M${atG.sign === 'neg' ? ' — short-gamma AT spot = unstable/explosive, dealers chase' : ' — long-gamma AT spot = pinning'})`
    : `spot between gamma nodes (below: ${g.negative_near.concat(g.positive_near).filter((n) => n.position === 'below').map((n) => n.strike)[0] ?? '—'}, above: ${g.positive_near.concat(g.negative_near).filter((n) => n.position === 'above').map((n) => n.strike)[0] ?? '—'})`;
  const posVannaAbove = v.nodes.filter((n) => n.sign === 'pos' && n.position === 'above');
  const vannaContext = posVannaAbove.length
    ? `positive vanna stacked above spot at ${posVannaAbove.slice(0, 3).map((n) => `${n.strike}(${n.M}M)`).join(', ')} — melt-up magnets on any IV compression`
    : `no dominant positive-vanna magnet above spot`;

  return {
    ticker: profile.ticker, spot: Math.round(spot * 100) / 100, prev_close: profile.previousClose,
    as_of: profile.asofDate, expirations: profile.expirations,
    gamma: { book: 'GAMMA — dealer price-hedging (pos=long-gamma wall/pin, neg=short-gamma squeeze fuel)', ...g, spot_context: gammaContext },
    vanna: { book: 'VANNA — dealer vol-hedging (pos above spot=melt-up magnet on IV compression, drives the recovery grind)', ...v, spot_context: vannaContext },
  };
}
