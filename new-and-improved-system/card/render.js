// Render one symbol's result (CARD or PASS) for the terminal.
const f = (x, d = 2) => (x == null ? '—' : typeof x === 'number' ? x.toFixed(d) : String(x));

export function renderHeader({ when, day, tri, usage }) {
  return [
    `════════ ${when} ════════`,
    `DAY: ${day.type.toUpperCase()}  (neg-gamma ${day.negative}/3 · air pockets ${day.airPockets}/3 · rolling ${day.rolling}/3)   TRINITY: ${tri.klass} ${tri.direction} (${tri.votes.map((v) => `${v.symbol}:${v.v > 0 ? 'bull' : v.v < 0 ? 'bear' : 'neu'}`).join(' ')})`,
    `RULES: ${day.rules.join(' · ')}`,
    usage ? `credits ${usage.creditsRemaining ?? '?'} · rate-left ${usage.rateLimitRemaining ?? '?'} · calls ${usage.calls}` : '',
  ].filter(Boolean).join('\n');
}

export function renderSymbol(r, ctx, contract) {
  const { board, hier, regime, chart, living, patterns } = ctx;
  const lines = [];
  lines.push(`\n── ${r.symbol}  spot ${f(board.spot)}  regime ${regime.label} (${regime.score})  king ${hier.king?.strike ?? '—'}  floor ${hier.floor?.strike ?? '—'}  ceiling ${hier.ceiling?.strike ?? '—'}`);
  lines.push(`   chart: ${chart.bias} (${chart.reasons.join(', ')})`);
  if (living.evidence?.length) lines.push(`   living map: ${living.evidence.join(' · ')}`);
  const pats = Object.values(patterns.all).filter((p) => p.detected).map((p) => `${p.pattern}${p.confidence ? ` ${(p.confidence * 100).toFixed(0)}%` : ''}`);
  lines.push(`   patterns: ${pats.length ? pats.join(', ') : 'none'}`);
  if (r.decision === 'PASS') {
    lines.push(`   ▸ PASS at step ${r.stepFailed}: ${r.why}`);
    return lines.join('\n');
  }
  const p = r.plan;
  lines.push(`   ★ CARD  ${r.direction === 'up' ? 'CALLS' : 'PUTS'} off ${r.node.strike} (${r.node.skylitType}/${r.node.sign}, ${(r.node.share * 100).toFixed(0)}%, ${r.tap.lifecycle})  setup: ${r.setup}`);
  lines.push(`   reaction: ${r.reaction}`);
  lines.push(`   plan: entry ${p.entry} → stop ${p.stop} [${p.stopRule}] → T1 ${p.t1} (R:R ${p.rr1}) · T2 ${p.t2 ?? '—'} (R:R ${p.rr})   size ×${p.sizeMultiplier}${r.friction ? '   ⚠ pika-cloud friction in path' : ''}`);
  if (contract) lines.push(`   contract: ${contract.ticker} ${contract.expiration} ${contract.strike}${contract.type === 'call' ? 'C' : 'P'}  last ${f(contract.last)}  iv ${f(contract.iv, 2)}  oi ${contract.oi}  vol ${contract.volume}  (dte ${contract.dte})`);
  lines.push(`   invalidation: ${r.node.strike} fails to hold · ${r.direction === 'up' ? 'ceiling rolls down' : 'floor rolls up'} · trinity breaks`);
  lines.push(`   steps: ${r.steps.join(' | ')}`);
  return lines.join('\n');
}
