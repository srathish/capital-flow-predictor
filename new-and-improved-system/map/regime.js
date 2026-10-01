// Gamma regime — HOW price moves, never which way. DOCTRINE §3.
export function regime(board) {
  const signed = board.nodes.reduce((a, n) => a + n.value, 0);
  const score = board.totalAbs ? signed / board.totalAbs : 0; // -1..+1
  const label = score > 0.15 ? 'positive' : score < -0.15 ? 'negative' : 'mixed';
  return {
    score: Number(score.toFixed(3)),
    label,
    behavior: label === 'positive'
      ? 'controlled: fade extremes, levels hold, take profits fast (theta/chop)'
      : label === 'negative'
        ? 'expansive: assume overshoot first, never fade velocity, follow continuation'
        : 'mixed: expect inconsistent reactions, demand confluence',
  };
}
