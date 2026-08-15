// regime.mjs — trend vs chop, from data available at decision time (trailing closes
// only, no lookahead). Kaufman Efficiency Ratio: |net move over N| / Σ|daily moves|.
// ~1 = clean one-way trend, ~0 = violent back-and-forth. A standard, interpretable
// measure — nothing to tune to the outcome, which is the point (hard to over-fit).
export function efficiencyRatio(closes, N = 8) {
  const v = closes.filter((x) => Number.isFinite(x));
  if (v.length < N + 1) return null;
  const seg = v.slice(-(N + 1));
  const net = Math.abs(seg[seg.length - 1] - seg[0]);
  let sum = 0;
  for (let i = 1; i < seg.length; i++) sum += Math.abs(seg[i] - seg[i - 1]);
  return sum ? net / sum : 0;
}

// Same idea applied to the king-node strike series (structural trend vs churn):
// is the dominant node marching one way, or oscillating?
export function structuralEfficiency(kingStrikes, N = 8) {
  return efficiencyRatio(kingStrikes, N);
}
