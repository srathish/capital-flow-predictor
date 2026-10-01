// Cross-index confluence. DOCTRINE §7. Input: per-symbol reads {symbol, bias:'bullish'|'bearish'|'neutral', strength 0..1, hasRange}
export function trinity(reads) {
  const dir = { bullish: 1, bearish: -1, neutral: 0 };
  const votes = reads.map((r) => ({ symbol: r.symbol, v: dir[r.bias] ?? 0, s: r.strength ?? 0 }));
  const bulls = votes.filter((x) => x.v > 0).length, bears = votes.filter((x) => x.v < 0).length;
  const agree = Math.max(bulls, bears), lead = bulls >= bears ? 'bullish' : 'bearish';
  const opposing = bulls > 0 && bears > 0;
  const strongOpposing = opposing && votes.filter((x) => x.v !== 0 && x.s >= 0.6).length >= 2;
  const whipsaw = strongOpposing && reads.every((r) => r.hasRange);
  let klass;
  if (reads.length < 3) klass = 'insufficient_data';
  else if (whipsaw) klass = 'whipsaw';
  else if (agree === 3) klass = 'full_alignment';
  else if (agree === 2 && !opposing) klass = 'partial_alignment';
  else if (agree === 2 && opposing) klass = 'partial_with_conflict';
  else klass = 'divergence';
  const playable = klass === 'full_alignment' || klass === 'partial_alignment';
  return { klass, direction: agree >= 2 ? lead : 'none', agree, playable, sizeMultiplier: klass === 'full_alignment' ? 1 : klass === 'partial_alignment' ? 0.5 : 0, votes };
}
