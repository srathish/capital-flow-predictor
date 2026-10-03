// VIX pivot (TheArchitect), best reconstruction from 37 of his posted values: rolling 5-session (H+L+C)/3 of spot VIX,
// recomputed each morning from the prior 5 sessions (median error vs his posts 0.26 pts). Below pivot = bullish, above = bearish.
// Side at time t is CONFIRMED only if the last `confirm` 1-min VIX closes are all on one side (his "10M rule" in miniature).

/** daily: VIX daily bars (sorted, unix t). Returns the pivot to use on `date` (YYYY-MM-DD), or null. */
export function vixPivot(daily, date) {
  const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10);
  const prior = daily.filter((b) => ymd(b.t) < date).slice(-5);
  if (prior.length < 5) return null;
  return +((Math.max(...prior.map((b) => b.h)) + Math.min(...prior.map((b) => b.l)) + prior[4].c) / 3).toFixed(2);
}

/** VIX side vs pivot at unix t from 1-min VIX bars: 'below' | 'above' | 'mixed' | null */
export function vixSide(vixMinute, pivot, t, confirm = 5) {
  if (pivot == null || !vixMinute?.length) return null;
  const last = vixMinute.filter((b) => b.t <= t).slice(-confirm);
  if (last.length < confirm) return null;
  if (last.every((b) => b.c < pivot)) return 'below';
  if (last.every((b) => b.c > pivot)) return 'above';
  return 'mixed';
}
