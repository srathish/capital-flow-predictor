// NODE VELOCITY as a REGIME (chop) filter — the angle that fits what's actually predictable (reach/chop, not
// direction). Hypothesis: on a TREND day the node-growth tilt is ONE-SIDED and persistent (coherent); on CHOP it
// flickers and cancels. Coherence = |Σ tilt| / Σ|tilt| (1 = one-sided, 0 = cancels). If MORNING coherence (≤11:00,
// tradeable) is high on the days our engine WON and low on the days it BLED, that's an early stand-aside filter.
// Compared against price path-efficiency (the model-free trend/chop measure) to see if GEX velocity adds anything.
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const VC = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const etMin = (ts) => (+ts.slice(11, 13) - 4) * 60 + +ts.slice(14, 16);
const load = (d) => zlib.gunzipSync(fs.readFileSync(path.join(VC, `replay_${d}_SPXW.jsonl.gz`))).toString().trim().split('\n').map(l => JSON.parse(l));
const g0At = (fr, k) => (fr.strikes.find(n => n.strike === k)?.g0 || 0);
const L = 20;
// engine flip-flop P/L per day (from backtest_replay.mjs, THRESH 3, SPXW) — the ground truth we're trying to gate
const PL = { '2026-07-17': -39.7, '2026-07-20': 6.0, '2026-07-22': -8.3, '2026-07-23': 10.0, '2026-07-24': -32.9, '2026-07-27': 6.7, '2026-07-28': -18.7 };

function metrics(F, cutMin) {
  const tilts = [], moves = []; let prevSpot = null, firstSpot = null, lastSpot = null;
  for (let i = L; i < F.length; i++) {
    const s = F[i]; if (cutMin && etMin(s.ts) > cutMin) break;
    if (firstSpot === null) firstSpot = s.spot; lastSpot = s.spot;
    let t = 0; for (const n of s.strikes) t += (n.g0 - g0At(F[i - L], n.strike)) * sign(n.strike - s.spot);
    tilts.push(t); if (prevSpot !== null) moves.push(Math.abs(s.spot - prevSpot)); prevSpot = s.spot;
  }
  const sumAbs = tilts.reduce((a, c) => a + Math.abs(c), 0) || 1;
  const coh = Math.abs(tilts.reduce((a, c) => a + c, 0)) / sumAbs;           // node-growth coherence 0..1
  const pathEff = Math.abs(lastSpot - firstSpot) / (moves.reduce((a, c) => a + c, 0) || 1);  // price efficiency 0..1
  return { coh, pathEff };
}

const days = Object.keys(PL).sort();
console.log(`\n═══ NODE-VELOCITY REGIME FILTER — coherence vs engine P/L ═══`);
console.log(`day          engineP/L   morningCoh(≤11)  fulldayCoh   morningPathEff   → win day?`);
const rows = [];
for (const d of days) {
  let F; try { F = load(d); } catch { continue; }
  const mAM = metrics(F, 11 * 60), mFull = metrics(F, 0);
  const win = PL[d] > 0;
  rows.push({ d, pl: PL[d], amCoh: mAM.coh, fullCoh: mFull.coh, amEff: mAM.pathEff, win });
  console.log(`${d}   ${(PL[d] >= 0 ? '+' : '') + PL[d].toFixed(1)}`.padEnd(24) + `${mAM.coh.toFixed(2)}`.padEnd(17) + `${mFull.coh.toFixed(2)}`.padEnd(13) + `${mAM.pathEff.toFixed(2)}`.padEnd(17) + `${win ? '✓ WIN' : '✗ LOSE'}`);
}
// does morning coherence separate winners from losers?
const winsC = rows.filter(r => r.win).map(r => r.amCoh), loseC = rows.filter(r => !r.win).map(r => r.amCoh);
const winsE = rows.filter(r => r.win).map(r => r.amEff), loseE = rows.filter(r => !r.win).map(r => r.amEff);
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
console.log(`\n  morning node-coherence: WIN days avg ${mean(winsC).toFixed(2)} vs LOSE days avg ${mean(loseC).toFixed(2)}  (higher-on-wins = usable filter)`);
console.log(`  morning price-path-eff: WIN days avg ${mean(winsE).toFixed(2)} vs LOSE days avg ${mean(loseE).toFixed(2)}  (does GEX velocity beat plain price?)`);
console.log(`  n=${rows.length} days — TINY sample; treat any separation as a hypothesis to WATCH forward, not a rule.`);
