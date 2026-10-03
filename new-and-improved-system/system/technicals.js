// CHART TECHNICALS for the A+ rule (locked 2026-10-03, BEFORE running — Glitch "charts first").
// All computed from daily bars strictly BEFORE the trade day + today's 1-min bars up to the entry bar. No look-ahead.
//  structure : daily swing structure agrees — last two 2-bar pivot highs AND lows rising (bull) / falling (bear)
//  fib       : entry node sits in the 0.5–0.786 retracement of the last 20-day swing in the trade's direction
//  level     : entry node within 0.3% of a chart level — prior-day H/L, a 20-day daily pivot, EMA20 or EMA50
//  sweep     : today took the prior-day low (high) and the entry bar is back above (below) it
// A+ CHART = structure not against the trade AND ≥2 of {structure, fib, level, sweep}.
const ema = (xs, n) => { const k = 2 / (n + 1); let e = xs[0]; for (const x of xs.slice(1)) e = x * k + e * (1 - k); return e; };

function pivots(bars) {
  const hi = [], lo = [];
  for (let i = 2; i < bars.length - 2; i++) {
    const w = bars.slice(i - 2, i + 3);
    if (bars[i].h === Math.max(...w.map((b) => b.h))) hi.push(bars[i].h);
    if (bars[i].l === Math.min(...w.map((b) => b.l))) lo.push(bars[i].l);
  }
  return { hi, lo };
}

/** prior = daily bars before today (oldest→newest); session = today's 1-min bars up to and including the entry bar. */
export function technicals({ dir, node, prior, session }) {
  const up = dir === 'up', last20 = prior.slice(-20), pd = prior[prior.length - 1];
  const { hi, lo } = pivots(prior.slice(-40));
  const rising = hi.length >= 2 && lo.length >= 2 && hi.at(-1) > hi.at(-2) && lo.at(-1) > lo.at(-2);
  const falling = hi.length >= 2 && lo.length >= 2 && hi.at(-1) < hi.at(-2) && lo.at(-1) < lo.at(-2);
  const structure = up ? rising : falling, against = up ? falling : rising;

  const H = Math.max(...last20.map((b) => b.h)), L = Math.min(...last20.map((b) => b.l));
  const iH = last20.findIndex((b) => b.h === H), iL = last20.findIndex((b) => b.l === L);
  const retr = up ? (H - node) / (H - L) : (node - L) / (H - L);
  const fib = (up ? iL < iH : iH < iL) && retr >= 0.5 && retr <= 0.786;

  const closes = prior.map((b) => b.c), p20 = pivots(last20);
  const lv = [pd.h, pd.l, ...p20.hi, ...p20.lo, ema(closes, 20), ema(closes, 50)];
  const level = lv.some((x) => Math.abs(x - node) / node <= 0.003);

  const b = session[session.length - 1];
  const sweep = up ? Math.min(...session.map((x) => x.l)) < pd.l && b.c > pd.l : Math.max(...session.map((x) => x.h)) > pd.h && b.c < pd.h;

  const flags = { structure, fib, level, sweep }, n = Object.values(flags).filter(Boolean).length;
  return { ...flags, n, against, retr: +retr.toFixed(2), aplusChart: !against && n >= 2,
    tag: Object.entries(flags).filter(([, v]) => v).map(([k]) => k).join('+') || 'none' };
}
