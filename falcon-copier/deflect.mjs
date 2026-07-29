// Test the deflection-zone hypothesis on a day: find the dominant king/call-wall, then
// count how many times spot tapped within TAP$ of it and reversed away — and whether the
// wall GREW (dealer-held, holds) or shrank (customer-held, breaks) on each tap.
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const day = process.argv[2] || '2026-07-20';
const TAP = 4; // $ proximity to count as a "tap" of the wall
const f = path.join(process.cwd(), 'apps/gex/research/velocity-capture', `replay_${day}_SPXW.jsonl.gz`);
const fr = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l));
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const gAt = (fx, k) => (fx.strikes.find(n => n.strike === k)?.g0 || 0);

// dominant pika of the whole day = the strike that is king most often
const kingCount = {};
for (const fr1 of fr) { const k = fr1.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0]; if (k) kingCount[k.strike] = (kingCount[k.strike] || 0) + 1; }
const WALL = +Object.entries(kingCount).sort((a, b) => b[1] - a[1])[0][0];
console.log(`=== DEFLECTION TEST — ${day} — dominant king/wall = ${WALL} (king in ${kingCount[WALL]}/${fr.length} frames) ===`);
console.log(`ET     spot   d(spot-wall)  wall gamma   event`);

let taps = 0, rejects = 0, prevSide = null, lastWallG = null, approaching = false, entryG = null;
for (let i = 0; i < fr.length; i++) {
  const x = fr[i], s = x.spot, d = s - WALL, wg = gAt(x, WALL);
  const near = Math.abs(d) <= TAP;
  let ev = '';
  if (near && !approaching) { approaching = true; entryG = wg; taps++; ev = `TAP #${taps} (wall ${(wg / 1e6).toFixed(0)}M)`; }
  else if (!near && approaching) {
    approaching = false;
    // did it reject? spot moved away from wall by > TAP in the direction it came from
    const grew = wg >= entryG;
    if (Math.abs(d) > TAP) { rejects++; ev = `↳ pushed ${d > 0 ? 'UP' : 'DOWN'} off wall — wall ${grew ? 'GREW' : 'shrank'} ${(entryG / 1e6).toFixed(0)}→${(wg / 1e6).toFixed(0)}M`; }
  }
  if (ev) console.log(`${etOf(x.ts)}  ${s.toFixed(0)}  ${d >= 0 ? '+' : ''}${d.toFixed(0)}          ${(wg / 1e6).toFixed(0).padStart(3)}M        ${ev}`);
}
console.log(`\nSUMMARY: ${taps} taps of ${WALL}, ${rejects} deflections. Wall gamma ${(gAt(fr[0], WALL) / 1e6).toFixed(0)}M → ${(gAt(fr[fr.length - 1], WALL) / 1e6).toFixed(0)}M over the day.`);
console.log(`Interpretation: a wall price keeps tapping but never closes through, that GROWS = dealer-held deflection zone = the fade setup Falcon rode.`);
