// Day type gate — classify before engaging. DOCTRINE §4.
// reads: [{symbol, regime, hier, patterns, living}], tri: trinity() result
export function dayType(reads, tri) {
  const negative = reads.filter((r) => r.regime.label === 'negative').length;
  const positive = reads.filter((r) => r.regime.label === 'positive').length;
  const airPockets = reads.filter((r) => r.hier.airPocketUp || r.hier.airPocketDown).length;
  const rainbow = reads.filter((r) => r.patterns.noTrade).length;
  const rolling = reads.filter((r) => ['up'].includes(r.living.rollingFloor) || ['down'].includes(r.living.rollingCeiling) || r.living.oneDirectional).length;
  const rules = [];
  let type;
  if (rainbow >= 2) { type = 'rainbow_road'; rules.push('NO TRADE — no structure on ≥2 indices'); }
  else if (tri.klass === 'whipsaw' || (negative >= 2 && !tri.playable && airPockets >= 2)) { type = 'whipsaw'; rules.push('extreme ends of ranges only; when in doubt, sit out'); }
  else if (negative >= 2 && rolling >= 2 && airPockets >= 1) { type = 'trend'; rules.push("don't fade strength; if entry missed wait for a clear pivot; structure in direction of the move"); }
  else { type = 'range'; rules.push('fade the EXTREME ends only; respect both sides; no chasing'); if (positive >= 2) rules.push('positive gamma: quick in/out, theta burns'); }
  return { type, negative, positive, airPockets, rainbow, rolling, trinity: tri.klass, rules, mayEngage: type !== 'rainbow_road' };
}
