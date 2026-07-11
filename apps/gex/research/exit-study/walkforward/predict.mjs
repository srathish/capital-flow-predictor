// Walk-forward validator — PREDICT & SCORE (research only).
// For each day over ~1yr, compute the King-node picture from UW GEX/VEX-by-strike,
// make the predictions our system's logic implies, then score against the ACTUAL
// next-day (and +5d) outcome. This is a true day-by-day out-of-sample walk-forward
// across MULTIPLE regimes — the test the 92-day Skylit window couldn't support.
//
// Hypotheses tested (all vs the naive up-drift baseline):
//   H1 GEX-King magnet  : King>spot => predict UP (price pulled to the magnet)
//   H2 VEX-King direction: VEX King>spot => predict UP (vanna magnet)
//   H3 move-toward-King  : does price move TOWARD the GEX King next day?
//   H4 pin/vol regime    : does total-GEX sign predict next-day RANGE (F4: vol not dir)?
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const T = process.argv[2] || 'SPY';
const ohlc = load(path.join(CACHE, `${T}_ohlc.json`)) || {};
const days = Object.keys(ohlc).sort();

function kings(d) {
  const s = load(path.join(CACHE, `${T}_gex_${d}.json`));
  if (!s || s.length < 10) return null;
  let gk = null, vk = null, totG = 0;
  for (const r of s) {
    totG += r.gex;
    if (!gk || Math.abs(r.gex) > Math.abs(gk.gex)) gk = r;
    if (!vk || Math.abs(r.van) > Math.abs(vk.van)) vk = r;
  }
  return { gexKing: gk.k, gexKingVal: gk.gex, vexKing: vk.k, vexKingVal: vk.van, totG };
}

const recs = [];
for (let i = 0; i < days.length - 5; i++) {
  const d = days[i], k = kings(d); if (!k) continue;
  const c0 = ohlc[d].close, c1 = ohlc[days[i + 1]].close, c5 = ohlc[days[i + 5]].close;
  const nextRange = (ohlc[days[i + 1]].high - ohlc[days[i + 1]].low) / c0;
  recs.push({
    d, c0, c1, c5, up1: c1 > c0, up5: c5 > c0, nextRange,
    gexKing: k.gexKing, vexKing: k.vexKing, totG: k.totG,
    gexAbove: k.gexKing > c0, vexAbove: k.vexKing > c0,
    towardKing: Math.abs(c1 - k.gexKing) < Math.abs(c0 - k.gexKing),
    posGamma: k.totG > 0,
  });
}
console.log(`WALK-FORWARD — ${T}, ${recs.length} days ${recs[0]?.d}..${recs.at(-1)?.d}\n`);
const acc = (pred, act) => { const m = recs.filter(r => pred(r) === act(r)).length; return m / recs.length; };
const rate = f => recs.filter(f).length / recs.length;
const pct = x => `${(x * 100).toFixed(1)}%`;

const baseUp = rate(r => r.up1);
console.log(`baseline: next-day UP rate = ${pct(baseUp)}  (naive "always up" accuracy = ${pct(Math.max(baseUp, 1 - baseUp))})\n`);
console.log('H1 GEX-King magnet (King>spot => up):   dir-accuracy ' + pct(acc(r => r.gexAbove, r => r.up1)));
console.log('H2 VEX-King direction (VEX>spot => up): dir-accuracy ' + pct(acc(r => r.vexAbove, r => r.up1)));
console.log('H3 price moves TOWARD GEX King next day: ' + pct(rate(r => r.towardKing)) + '  (vs 50% coin-flip)');
// H4 pin/vol: mean next-day range when posGamma vs negGamma
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const rPos = recs.filter(r => r.posGamma).map(r => r.nextRange), rNeg = recs.filter(r => !r.posGamma).map(r => r.nextRange);
console.log(`H4 pin/vol: next-day range  posGamma ${pct(mean(rPos))} (n=${rPos.length})  vs  negGamma ${pct(mean(rNeg))} (n=${rNeg.length})  [F4: pos should be SMALLER]`);

// regime split: 4 quarters, does any signal hold across ALL?
console.log('\nby quarter (H1 GEX magnet dir-acc / H2 VEX dir-acc / up-baseline):');
const q = Math.ceil(recs.length / 4);
for (let i = 0; i < 4; i++) {
  const sub = recs.slice(i * q, (i + 1) * q); if (!sub.length) continue;
  const a1 = sub.filter(r => r.gexAbove === r.up1).length / sub.length;
  const a2 = sub.filter(r => r.vexAbove === r.up1).length / sub.length;
  const bu = sub.filter(r => r.up1).length / sub.length;
  console.log(`  ${sub[0].d}..${sub.at(-1).d}  H1 ${pct(a1)}  H2 ${pct(a2)}  up-base ${pct(bu)}`);
}
