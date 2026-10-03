// "Standard deviation" levels as TheQuietCalf uses them: projections of a PRICE LEG, not volatility.
// Leg from P1 (start) to P0 (end), d = P0 − P1. Level k = P0 + k·d for k ∈ {2, 2.25, 2.5, 3.5, 4, 4.5}.
// Verified on his 10/2 MNQ chart: P1 30531.50, P0 30679.25 → −4 = 31270.25 (exact).
// The trade is the FADE at the projection: an up-leg's projections above → short there; a down-leg's below → long there.
// −2 … −2.5 = first reaction zone; −3.5 … −4.5 = max expansion (rarely exceeded).

export const KS = [2, 2.25, 2.5, 3.5, 4, 4.5];

function resample(bars, n) {
  const out = [];
  for (let i = 0; i < bars.length; i += n) { const c = bars.slice(i, i + n); out.push({ t: c[0].t, h: Math.max(...c.map((b) => b.h)), l: Math.min(...c.map((b) => b.l)), c: c[c.length - 1].c }); }
  return out;
}

/** Confirmed fractal swings on n-minute bars, alternating H/L (keeps the more extreme of consecutive same-type points). */
export function swings(bars1m, { tf = 1, k = 3 } = {}) {   // 1-min swings: Calf marks legs on the 1m ("marked on the 1m as it was cleaner")
  const b = resample(bars1m, tf), raw = [];
  // start at i=0: the session-start extreme (e.g. the high at the open) is a valid anchor — Calf's "start of a move".
  // The left window is truncated at the start; the right side still needs k confirmed bars.
  for (let i = 0; i < b.length - k; i++) {
    const w = b.slice(Math.max(0, i - k), i + k + 1);
    if (b[i].h === Math.max(...w.map((x) => x.h))) raw.push({ t: b[i].t, p: b[i].h, type: 'H' });
    if (b[i].l === Math.min(...w.map((x) => x.l))) raw.push({ t: b[i].t, p: b[i].l, type: 'L' });
  }
  const s = [];
  for (const x of raw.sort((a, c) => a.t - c.t)) {
    const last = s[s.length - 1];
    if (last && last.type === x.type) { if ((x.type === 'H' && x.p > last.p) || (x.type === 'L' && x.p < last.p)) s[s.length - 1] = x; }
    else s.push(x);
  }
  return s;
}

/** Projection levels from the last `maxLegs` completed legs of at least minLegPct size. */
export function projections(bars1m, { minLegPct = 0.001, maxLegs = 3, tf = 1, k = 3 } = {}) {
  if (!bars1m || bars1m.length < 30) return [];
  const s = swings(bars1m, { tf, k }), px = bars1m[bars1m.length - 1].c, out = [];
  const legs = [];
  for (let i = 1; i < s.length; i++) { const d = s[i].p - s[i - 1].p; if (Math.abs(d) / px >= minLegPct) legs.push({ p1: s[i - 1].p, p0: s[i].p, d, t: s[i].t }); }
  for (const leg of legs.slice(-maxLegs)) {
    for (const k of KS) out.push({ level: +(leg.p0 + k * leg.d).toFixed(2), k, fade: leg.d > 0 ? 'down' : 'up', zone: k >= 3.5 ? 'max_expansion' : 'reaction', leg: { from: leg.p1, to: leg.p0, t: leg.t } });
  }
  return out;
}
