// "HOW LONG DO WE RIDE?" — conditional on a CONFIRMED move (not predicting direction cold), does the
// structure ahead tell us where it stalls? Hypothesis: a confirmed move rides to the next strong PIKA
// ahead (stalls/reverses there) and rides THROUGH a barney (accelerant). If ride-length tracks
// distance-to-next-pika, we know the exit — the piece that answers "how long to ride."
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etMin = (et) => +et.slice(0, 2) * 60 + +et.slice(3);
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const CONF_MOVE = 3, CONF_WIN = 10, RETR = 4, AHEAD = 40, WALLG = 12e6, BARNEYG = 8e6;
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const days = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();

const rides = [];
for (const d of days) {
  const fr = load(d); if (!fr) continue; const spots = fr.map(x => x.spot);
  let cd = -99;
  for (let i = CONF_WIN; i < fr.length - 5; i++) {
    if (i < cd) continue;
    const et = etOf(fr[i].ts); if (etMin(et) > 15 * 60) break;
    const mv = spots[i] - spots[i - CONF_WIN];
    if (Math.abs(mv) < CONF_MOVE) continue;                          // move confirmed?
    const dir = sign(mv), entry = spots[i];
    // structure ahead in the move direction
    const pikaAhead = fr[i].strikes.filter(n => n.g0 >= WALLG && (n.strike - entry) * dir > 1 && Math.abs(n.strike - entry) <= AHEAD).sort((a, b) => Math.abs(a.strike - entry) - Math.abs(b.strike - entry))[0];
    const barneyAhead = fr[i].strikes.filter(n => n.g0 <= -BARNEYG && (n.strike - entry) * dir > 1 && Math.abs(n.strike - entry) <= AHEAD).sort((a, b) => Math.abs(a.strike - entry) - Math.abs(b.strike - entry))[0];
    // ride: peak favorable until it retraces RETR from the peak
    let peak = 0, peakSpot = entry, peakJ = i;
    let j = i + 1; for (; j < fr.length; j++) { const fav = (spots[j] - entry) * dir; if (fav > peak) { peak = fav; peakSpot = spots[j]; peakJ = j; } if (peak - fav >= RETR) break; }
    const distPika = pikaAhead ? Math.abs(pikaAhead.strike - entry) : null;
    const distBarney = barneyAhead ? Math.abs(barneyAhead.strike - entry) : null;
    const barneyCloser = distBarney != null && (distPika == null || distBarney < distPika);
    rides.push({ d, et, dir, rideLen: +peak.toFixed(1), bars: peakJ - i, distPika, pikaSize: pikaAhead ? pikaAhead.g0 / 1e6 : null, distBarney, barneyCloser, stallAtPika: pikaAhead ? Math.abs(peakSpot - pikaAhead.strike) <= 3 : false });
    cd = j + 3;                                                       // cooldown past the ride
  }
}
console.log(`=== RIDE-LENGTH (conditional on a confirmed ${CONF_MOVE}pt/${CONF_WIN}min move) · ${rides.length} rides across ${days.length} days ===`);
console.log(`\nQ: does ride length track DISTANCE TO NEXT PIKA ahead? (would mean: ride to the next pika, stall there)`);
console.log(`next-pika dist    n     median rideLen    stall-at-pika%`);
for (const [lo, hi] of [[0, 6], [6, 12], [12, 20], [20, 99]]) {
  const b = rides.filter(r => r.distPika != null && r.distPika >= lo && r.distPika < hi); if (!b.length) continue;
  console.log(`${(lo + '-' + hi).padEnd(14)}    ${String(b.length).padStart(3)}   ${median(b.map(r => r.rideLen)).toFixed(1).padStart(6)}            ${(b.filter(r => r.stallAtPika).length / b.length * 100).toFixed(0)}%`);
}
const withP = rides.filter(r => r.distPika != null);
console.log(`\nride vs pika: median rideLen ${median(withP.map(r => r.rideLen)).toFixed(1)} · median dist-to-pika ${median(withP.map(r => r.distPika)).toFixed(1)} · overall stall-at-pika ${(withP.filter(r => r.stallAtPika).length / withP.length * 100).toFixed(0)}%`);
const bAhead = rides.filter(r => r.barneyCloser), pAhead = rides.filter(r => !r.barneyCloser && r.distPika != null);
console.log(`\nQ: does a BARNEY ahead extend the ride (accelerant) vs a PIKA ahead (resistance)?`);
console.log(`  barney closer ahead: n=${bAhead.length} median rideLen ${median(bAhead.map(r => r.rideLen)).toFixed(1)}`);
console.log(`  pika closer ahead:   n=${pAhead.length} median rideLen ${median(pAhead.map(r => r.rideLen)).toFixed(1)}`);
console.log(`\nIf rideLen rises with pika-distance + stall%>50 => the exit IS the next pika. If barney-ahead rides longer => barney = accelerant confirmed.`);
