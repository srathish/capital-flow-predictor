// NODE GROWTH VELOCITY — the missing data stream. We track king MIGRATION (did the wall move strikes) but NOT
// dG0/dt (how fast a node is GROWING). Hypothesis (user's, + PICKS_2026-07-21: "7520 king grew 16→44→82→177M =
// the magnet"): on a TREND/thesis day the directional king grows monotonically (conviction building); on a CHOP
// day nodes flicker. This is PURE GEX time-series → fully reconstructable historically (unlike flow/dp).
// Prints a 30-min growth timeline + a day-level regime read. Usage: node node_velocity.mjs <YYYY-MM-DD> [sym=SPXW]
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DAY = process.argv[2] || '2026-07-20', SYM = process.argv[3] || 'SPXW';
const VC = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const f = path.join(VC, `replay_${DAY}_${SYM}.jsonl.gz`);
if (!fs.existsSync(f)) { console.log(`no replay for ${DAY} ${SYM}`); process.exit(0); }
const F = zlib.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').map(l => JSON.parse(l));
const et = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const M = (x) => (x >= 0 ? '+' : '') + (x / 1e6).toFixed(0) + 'M';
const g0At = (fr, k) => (fr.strikes.find(n => n.strike === k)?.g0 || 0);
const kingOf = (fr) => fr.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0];
const L = 15;                                                                // look-back window (minutes) for dG0/dt

console.log(`\n═══ NODE GROWTH VELOCITY — ${DAY} ${SYM} (dG0 over trailing ${L}min) ═══`);
console.log(`ET     spot    king(g0)        kingΔ${L}   growthLeader(Δ,side)      shrinkLeader(Δ,side)   netTilt(above−below)`);
const kingSeries = [];
for (let i = L; i < F.length; i += 30) {                                     // every 30 min
  const s = F[i], spot = s.spot, prev = F[i - L], king = kingOf(s); if (!king) continue;
  const kingΔ = king.g0 - g0At(prev, king.strike);
  // per-strike growth over the window
  const deltas = s.strikes.map(n => ({ k: n.strike, g0: n.g0, d: n.g0 - g0At(prev, n.strike), side: n.strike > spot ? 'above' : 'below' }));
  const grow = deltas.slice().sort((a, b) => b.d - a.d)[0], shrink = deltas.slice().sort((a, b) => a.d - b.d)[0];
  const tilt = deltas.filter(x => x.side === 'above').reduce((a, c) => a + c.d, 0) - deltas.filter(x => x.side === 'below').reduce((a, c) => a + c.d, 0);
  kingSeries.push({ et: et(s.ts), spot, k: king.strike, g0: king.g0, kingΔ });
  console.log(`${et(s.ts)}  ${spot.toFixed(1)}  ${String(king.strike).padStart(5)}(${M(king.g0).padStart(5)})  ${M(kingΔ).padStart(6)}   ${String(grow.k).padStart(5)} ${M(grow.d).padStart(5)} ${grow.side.padEnd(5)}   ${String(shrink.k).padStart(5)} ${M(shrink.d).padStart(6)} ${shrink.side.padEnd(5)}   ${M(tilt).padStart(6)}`);
}
// DAY-LEVEL REGIME READ
const g0s = kingSeries.map(x => x.g0), open = g0s[0], peak = Math.max(...g0s), close = g0s[g0s.length - 1];
const kingMoves = kingSeries.map(x => x.k); const kingStable = new Set(kingMoves).size <= 3;
const monotone = kingSeries.filter((x, i) => i && x.g0 >= kingSeries[i - 1].g0 * 0.9).length / (kingSeries.length - 1);   // fraction of steps where king held/grew
const avgAbsΔ = kingSeries.reduce((a, c) => a + Math.abs(c.kingΔ), 0) / kingSeries.length;
console.log(`\n  DAY READ: king ${open ? M(open) : '?'} → peak ${M(peak)} → close ${M(close)}  (${(peak / (open || 1)).toFixed(1)}× open) · king-strike ${kingStable ? 'STABLE' : 'WANDERS'} (${new Set(kingMoves).size} distinct) · held/grew ${(monotone * 100).toFixed(0)}% of steps · avg|Δ| ${M(avgAbsΔ)}`);
console.log(`  → ${peak / (open || 1) >= 2 && kingStable && monotone >= 0.6 ? 'TREND/THESIS regime (magnet building — trade toward the king with size)' : monotone < 0.5 || !kingStable ? 'CHOP regime (node flickers — small/stand aside)' : 'MIXED'}`);
