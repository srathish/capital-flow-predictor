// THE CHARM CLOCK — is there a non-directional EOD "pin magnet"? In positive gamma, charm (time-driven
// dealer hedging) should pull price TOWARD the dominant pin into the close. Time is deterministic, so this
// is a LEADING convergence trade: at the anchor, if spot is off the pin, bet it converges by close.
// Test across anchors to see if it strengthens LATER in the day (the charm signature).
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const idxAt = (fr, et) => fr.reduce((b, x, i) => Math.abs(+etOf(x.ts).replace(':', '') - +et.replace(':', '')) < Math.abs(+etOf(fr[b].ts).replace(':', '') - +et.replace(':', '')) ? i : b, 0);
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const days = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();
const MINOFF = 4, STRONG = 15e6;

console.log(`=== CHARM CLOCK — does price converge to the pin into the close? (positive-gamma EOD magnet) ===`);
console.log(`anchor   n   converged%   median conv(pts)   reached-pin%   avg |dist| shrink`);
for (const anchor of ['12:30', '13:30', '14:00', '14:30', '15:00']) {
  const rows = [];
  for (const d of days) {
    const fr = load(d); if (!fr) continue; const spots = fr.map(x => x.spot);
    const ai = idxAt(fr, anchor), spotA = spots[ai];
    const king = fr[ai].strikes.filter(n => n.g0 >= STRONG && Math.abs(n.strike - spotA) <= 40).sort((a, b) => b.g0 - a.g0)[0];
    if (!king || Math.abs(spotA - king.strike) < MINOFF) continue;          // need a strong pin with room to converge
    const netG = fr[ai].strikes.reduce((t, n) => t + n.g0, 0); if (netG <= 0) continue; // positive-gamma only
    const dist0 = king.strike - spotA, spotC = spots[spots.length - 1];
    const conv = sign(dist0) * (spotC - spotA);                              // + = moved toward pin
    const reached = spots.slice(ai + 1).some(s => Math.abs(s - king.strike) <= 2);
    rows.push({ conv, shrink: Math.abs(dist0) - Math.abs(king.strike - spotC), reached });
  }
  if (!rows.length) { console.log(`${anchor}   0`); continue; }
  const cvg = rows.filter(r => r.conv > 0).length / rows.length * 100;
  console.log(`${anchor}    ${String(rows.length).padStart(2)}    ${cvg.toFixed(0).padStart(3)}%         ${median(rows.map(r => r.conv)).toFixed(1).padStart(5)}            ${(rows.filter(r => r.reached).length / rows.length * 100).toFixed(0)}%           ${median(rows.map(r => r.shrink)).toFixed(1)}`);
}
console.log(`\nIf converged% climbs toward the close and >60%, the EOD pin magnet is real — a leading, non-directional trade (direction set by which side of the pin you're on, edge = the clock).`);
