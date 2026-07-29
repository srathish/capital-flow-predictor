// TEST TWO CREATIVE IDEAS on the 19 days:
// (1) FAILED-REACH REVERSAL: when price approaches a strong pika but FAILS to touch it (rejected early),
//     does it reverse harder than when it reaches? (a failed high-prob reach = exhaustion signal)
// (2) REACH-ASYMMETRY LEAN: does price drift toward the MORE-REACHABLE wall (closer, adjusted for size)?
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etMin = (et) => +et.slice(0, 2) * 60 + +et.slice(3);
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const days = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();
const STRONG = 15e6;

// ---- (1) FAILED-REACH REVERSAL ---- (tag train=first12 / test=last7 for OOS check)
const reached = [], failed = [];
for (const d of days) {
  const split = days.indexOf(d) < 12 ? 'train' : 'test';
  const fr = load(d); if (!fr) continue; const spots = fr.map(x => x.spot); let cd = -99;
  for (let i = 10; i < fr.length - 25; i++) {
    if (i < cd) continue; if (etMin(etOf(fr[i].ts)) > 15 * 60) break;
    const spot = spots[i];
    const wall = fr[i].strikes.filter(n => n.g0 >= STRONG && Math.abs(n.strike - spot) <= 12).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
    if (!wall) continue;
    const dist = Math.abs(spot - wall.strike);
    if (dist > 6 || Math.abs(spots[i - 10] - wall.strike) <= 8) continue;      // fresh approach: from >8pt to <=6pt
    const dirTo = sign(wall.strike - spot);
    // did it touch within 15 bars? track closest-approach point
    let touched = false, closest = dist, cj = i;
    for (let j = i + 1; j <= i + 15 && j < fr.length; j++) { const dj = Math.abs(spots[j] - wall.strike); if (dj < closest) { closest = dj; cj = j; } if (dj <= 2) { touched = true; break; } }
    // reversal: max move AWAY from the wall over the 20 bars after the closest approach
    let rev = 0; const base = spots[cj];
    for (let j = cj + 1; j <= cj + 20 && j < fr.length; j++) rev = Math.max(rev, -(spots[j] - base) * dirTo);
    (touched ? reached : failed).push({ rev, closest, split });
    cd = cj + 5;
  }
}
const medBy = (arr, sp) => median(arr.filter(r => !sp || r.split === sp).map(r => r.rev));
console.log(`=== (1) FAILED-REACH REVERSAL — approach a strong pika, reach vs fail, then measure reversal ===`);
console.log(`  REACHED wall: n=${reached.length} · median reversal-away ${medBy(reached).toFixed(1)}pt`);
console.log(`  FAILED short: n=${failed.length} · median reversal-away ${medBy(failed).toFixed(1)}pt · median stall-gap ${median(failed.map(r => r.closest)).toFixed(1)}pt`);
console.log(`  OOS: TRAIN failed ${medBy(failed, 'train').toFixed(1)} vs reached ${medBy(reached, 'train').toFixed(1)} (n=${failed.filter(r => r.split === 'train').length}/${reached.filter(r => r.split === 'train').length})`);
console.log(`       TEST  failed ${medBy(failed, 'test').toFixed(1)} vs reached ${medBy(reached, 'test').toFixed(1)} (n=${failed.filter(r => r.split === 'test').length}/${reached.filter(r => r.split === 'test').length})`);
console.log(`  => real + generalizes if failed>reached in BOTH train AND test.`);

// ---- (2) REACH-ASYMMETRY LEAN ----
let hit = 0, tot = 0, hitClose = 0; const FWD = 20;
for (const d of days) {
  const fr = load(d); if (!fr) continue; const spots = fr.map(x => x.spot);
  for (let i = 5; i < fr.length - FWD; i += 5) {
    if (etMin(etOf(fr[i].ts)) > 15 * 60) break; const spot = spots[i];
    const cw = fr[i].strikes.filter(n => n.g0 >= 12e6 && n.strike > spot + 1 && n.strike - spot <= 30).sort((a, b) => (a.strike - spot) - (b.strike - spot))[0];
    const pw = fr[i].strikes.filter(n => n.g0 >= 12e6 && n.strike < spot - 1 && spot - n.strike <= 30).sort((a, b) => (spot - a.strike) - (spot - b.strike))[0];
    if (!cw || !pw) continue;
    // reach-proxy: closer + smaller node = more reachable (node size lowers reach, per validated finding)
    const rUp = 1 / (cw.strike - spot) * (1 / (cw.g0 / 1e6)), rDn = 1 / (spot - pw.strike) * (1 / (pw.g0 / 1e6));
    const lean = sign(rUp - rDn);                                            // toward the more-reachable wall
    const closeLean = sign((spot - pw.strike) - (cw.strike - spot));          // toward the CLOSER wall (null)
    const fwd = sign(spots[i + FWD] - spot);
    if (lean !== 0 && fwd !== 0) { tot++; if (lean === fwd) hit++; if (closeLean === fwd) hitClose++; }
  }
}
console.log(`\n=== (2) REACH-ASYMMETRY LEAN — does price go toward the more-reachable wall? ===`);
console.log(`  reachable-lean hit ${(hit / tot * 100).toFixed(0)}% · closer-wall-null hit ${(hitClose / tot * 100).toFixed(0)}% · n=${tot}`);
console.log(`  => edge only if reachable-lean clearly beats 50% AND beats the closer-wall null.`);
