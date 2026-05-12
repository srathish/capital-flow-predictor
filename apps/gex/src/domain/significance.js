/**
 * Spec §1.3 — relative_significance is the core primitive.
 *
 *   relative_significance(strike) = |gamma| / sum_over_all_strikes(|gamma|)
 *
 * Returns a percentage (0-1) per strike. Self-calibrating across days and tickers.
 * Recomputed at every snapshot.
 *
 * Input:  raw nodes [{ strike, gamma }, ...] from heatseeker/client.js + spot
 * Output: enriched nodes + surface aggregates needed for downstream layers.
 */

export function computeSurface(nodes, spot) {
  let totalAbs = 0;
  let signedTotal = 0;
  for (const n of nodes) {
    totalAbs += Math.abs(n.gamma);
    signedTotal += n.gamma;
  }

  if (totalAbs === 0) {
    return {
      nodes: nodes.map(n => ({
        ...n,
        absGamma: 0,
        sign: 'zero',
        relativeSignificance: 0,
        distanceFromSpot: n.strike - spot,
        isKing: false,
      })),
      totalAbs: 0,
      signedTotal: 0,
      regimeScore: 0,
      kingStrike: null,
      kingGamma: 0,
    };
  }

  // Find king node — argmax(|gamma|)
  let kingIdx = 0;
  let kingAbs = Math.abs(nodes[0].gamma);
  for (let i = 1; i < nodes.length; i++) {
    const a = Math.abs(nodes[i].gamma);
    if (a > kingAbs) {
      kingAbs = a;
      kingIdx = i;
    }
  }

  const enriched = nodes.map((n, i) => {
    const absGamma = Math.abs(n.gamma);
    return {
      strike: n.strike,
      gamma: n.gamma,
      absGamma,
      sign: n.gamma > 0 ? 'pika' : n.gamma < 0 ? 'barney' : 'zero',
      relativeSignificance: absGamma / totalAbs,
      distanceFromSpot: n.strike - spot,
      isKing: i === kingIdx,
    };
  });

  return {
    nodes: enriched,
    totalAbs,
    signedTotal,
    regimeScore: signedTotal / totalAbs,
    kingStrike: nodes[kingIdx].strike,
    kingGamma: nodes[kingIdx].gamma,
  };
}
