// Charts first. Price structure from Atlas bars. DOCTRINE §0, Academy Ch.1.
// bars1m: session 1-min bars up to "now"; daily: trailing daily bars (last one may be today's partial).

const ema = (vals, n) => { if (!vals.length) return null; const k = 2 / (n + 1); let e = vals[0]; for (let i = 1; i < vals.length; i++) e = vals[i] * k + e * (1 - k); return e; };

function resample5(bars) {
  const out = []; for (let i = 0; i < bars.length; i += 5) { const c = bars.slice(i, i + 5); out.push({ t: c[0].t, o: c[0].o, h: Math.max(...c.map((b) => b.h)), l: Math.min(...c.map((b) => b.l)), c: c[c.length - 1].c, v: c.reduce((a, b) => a + (b.v || 0), 0) }); } return out;
}
function swings(b5, k = 2) {
  const highs = [], lows = [];
  for (let i = k; i < b5.length - k; i++) {
    const w = b5.slice(i - k, i + k + 1);
    if (b5[i].h === Math.max(...w.map((x) => x.h))) highs.push({ t: b5[i].t, p: b5[i].h });
    if (b5[i].l === Math.min(...w.map((x) => x.l))) lows.push({ t: b5[i].t, p: b5[i].l });
  }
  return { highs, lows };
}

export function chartStructure(bars1m, daily, spot, { date } = {}) {
  if (!bars1m?.length) return { ok: false, bias: 'neutral', strength: 0, reasons: ['no bars'] };
  const b5 = resample5(bars1m);
  const closes5 = b5.map((b) => b.c);
  const ema5 = ema(closes5, 5), ema20 = ema(closes5, 20);
  const volSum = bars1m.reduce((a, b) => a + (b.v || 0), 0);
  const vwap = volSum > 0 ? bars1m.reduce((a, b) => a + ((b.h + b.l + b.c) / 3) * (b.v || 0), 0) / volSum : bars1m.reduce((a, b) => a + b.c, 0) / bars1m.length;
  const sessionHigh = Math.max(...bars1m.map((b) => b.h)), sessionLow = Math.min(...bars1m.map((b) => b.l));
  const range = sessionHigh - sessionLow, mid = (sessionHigh + sessionLow) / 2;
  const prior = (daily || []).filter((d) => !date || new Date(d.t * 1000).toISOString().slice(0, 10) < date).slice(-1)[0] || null;
  const { highs, lows } = swings(b5);
  const lastH = highs.slice(-2), lastL = lows.slice(-2);
  const lowerHigh = lastH.length === 2 && lastH[1].p < lastH[0].p;
  const higherLow = lastL.length === 2 && lastL[1].p > lastL[0].p;
  const higherHigh = lastH.length === 2 && lastH[1].p > lastH[0].p;
  const lowerLow = lastL.length === 2 && lastL[1].p < lastL[0].p;
  const doubleBottom = lastL.length === 2 && Math.abs(lastL[1].p - lastL[0].p) / spot <= 0.001;
  const doubleTop = lastH.length === 2 && Math.abs(lastH[1].p - lastH[0].p) / spot <= 0.001;
  const near = (lvl) => lvl != null && Math.abs(spot - lvl) / spot <= 0.0015;
  const belowVwap = spot < vwap, emaDown = ema5 != null && ema20 != null && ema5 < ema20, emaUp = ema5 != null && ema20 != null && ema5 > ema20;
  const trend = (lowerHigh && lowerLow) || (emaDown && lowerHigh) ? 'down' : (higherHigh && higherLow) || (emaUp && higherLow) ? 'up' : 'range';
  // A session extreme being MADE in a trend is continuation, not a level. Only a prior-day extreme, a double top/bottom,
  // or a session extreme that has HELD (price moved away and came back) counts as a level.
  const sessionLowHeld = near(sessionLow) && !(trend === 'down' && lowerLow) && bars1m.slice(-15).some((b) => b.c > sessionLow + 2 * (spot * 0.0015));
  const sessionHighHeld = near(sessionHigh) && !(trend === 'up' && higherHigh) && bars1m.slice(-15).some((b) => b.c < sessionHigh - 2 * (spot * 0.0015));
  const nearResistance = sessionHighHeld || near(prior?.h) || (doubleTop && near(lastH[1].p));
  const nearSupport = sessionLowHeld || near(prior?.l) || (doubleBottom && near(lastL[1].p));
  const midrange = range > 0 && Math.abs(spot - mid) < 0.25 * range && !nearResistance && !nearSupport;

  // Thesis scoring (charts create the thesis)
  const reasons = []; let bull = 0, bear = 0;
  if (nearResistance) { bear += 2; reasons.push(near(prior?.h) ? 'at prior-day high' : doubleTop ? 'double top' : 'at session high (held)'); }
  if (nearSupport) { bull += 2; reasons.push(near(prior?.l) ? 'at prior-day low' : doubleBottom ? 'double bottom' : 'at session low (held)'); }
  if (trend === 'down' && lowerLow && near(sessionLow)) { bear += 1; reasons.push('making new session lows (continuation)'); }
  if (trend === 'up' && higherHigh && near(sessionHigh)) { bull += 1; reasons.push('making new session highs (continuation)'); }
  if (lowerHigh) { bear += 1; reasons.push('lower high'); }
  if (higherLow) { bull += 1; reasons.push('higher low'); }
  if (belowVwap) { bear += 1; reasons.push('below VWAP'); } else { bull += 1; reasons.push('above VWAP'); }
  if (emaDown) { bear += 1; reasons.push('EMA5 < EMA20'); } else if (emaUp) { bull += 1; reasons.push('EMA5 > EMA20'); }
  if (midrange) reasons.push('MIDRANGE — no structural edge');
  const net = bull - bear, strength = Math.min(1, Math.abs(net) / 4);
  const bias = midrange ? 'neutral' : net >= 2 ? 'bullish' : net <= -2 ? 'bearish' : 'neutral';
  return { ok: true, bias, strength, trend, vwap: +vwap.toFixed(2), ema5: ema5 && +ema5.toFixed(2), ema20: ema20 && +ema20.toFixed(2), sessionHigh, sessionLow, mid: +mid.toFixed(2), priorHigh: prior?.h ?? null, priorLow: prior?.l ?? null, nearResistance, nearSupport, midrange, lowerHigh, higherLow, doubleTop, doubleBottom, belowVwap, reasons };
}
