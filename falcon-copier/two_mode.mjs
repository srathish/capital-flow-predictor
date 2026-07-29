// TWO-MODE SYSTEM (the operator's actual workflow): every morning mark the SPX levels, then either
//   TREND day  -> price PUSHES THROUGH; hold the directional thesis to the close.
//   CHOP day   -> price DEFLECTS; fade the dominant wall, scalp each rejection, take the pop (hard TP).
// Classifier @ 10:30 = does early tape agree with the king's side? agree=TREND, disagree=CHOP.
// This is NOT buy-and-hold-everything (that only works on trend days) — the mode is chosen per day.
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const aux = (d) => { const f = path.join(DIR, `aux_${d}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { spy: [], vixy: [] }; };
const idxAt = (fr, et) => fr.reduce((b, x, i) => Math.abs(+etOf(x.ts).replace(':', '') - +et.replace(':', '')) < Math.abs(+etOf(fr[b].ts).replace(':', '') - +et.replace(':', '')) ? i : b, 0);
const spyAt = (a, et) => { let v = null; for (const p of a.spy) { if (p.et <= et) v = p.c; else break; } return v; };
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const DECISION = '10:30', TAP = 5, SCALP = 2, BREAK = 4; // chop-fade: reject scalp +2pt, kill if pushes +4pt through wall

function dayKing(fr) { const c = {}; for (const f of fr) { const k = f.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0]; if (k) c[k.strike] = (c[k.strike] || 0) + 1; } return +Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; }

// TREND P/L: hold `dir` from 10:30 to close, in SPX pts
function trendPL(fr, a, i0, dir) { const spyD = spyAt(a, DECISION), spyC = a.spy[a.spy.length - 1]?.c; return dir * ((spyC - spyD) * 10); }

// CHOP P/L: fade the king wall — each time spot taps within TAP and gets rejected, scalp SCALP pts in the
// rejection direction; if instead it pushes BREAK pts through the wall, take -BREAK (a wrong fade). Hard TP.
function chopPL(fr, i0, king) {
  let pnl = 0, trades = 0, inTap = false, entrySide = 0, entrySpot = 0;
  for (let j = i0; j < fr.length; j++) {
    const s = fr[j].spot, near = Math.abs(s - king) <= TAP;
    if (near && !inTap) { inTap = true; entrySide = sign(s - king) || 1; entrySpot = s; } // tapped the wall
    else if (inTap) {
      const movedAway = (s - king) * entrySide;         // + = pushed away from wall (deflection, our scalp)
      const pushedThrough = (king - s) * entrySide;      // + = broke through the wall the other way
      if (movedAway >= SCALP) { pnl += SCALP; trades++; inTap = false; }        // deflection paid
      else if (pushedThrough >= BREAK) { pnl -= BREAK; trades++; inTap = false; } // wall broke = wrong fade
    }
  }
  return { pnl, trades };
}

const days = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();
let tT = 0, tC = 0, nT = 0, nC = 0, hitsT = 0;
console.log(`=== TWO-MODE BACKTEST · classify @ ${DECISION} (tape vs king side) · n=${days.length} days ===`);
console.log(`day         king   tape  kingSide  MODE    P/L(pts)   note`);
for (const d of days) {
  const fr = load(d), a = aux(d); if (!fr || !a.spy.length) continue;
  const i0 = idxAt(fr, DECISION), spot = fr[i0].spot, king = dayKing(fr);
  const tape = sign((spyAt(a, DECISION) ?? 0) - (a.spy[0]?.c ?? 0));
  const kingSide = sign(spot - king);                    // king below spot(+1 bull floor) / above(-1 bear ceiling)
  const agree = tape !== 0 && tape === kingSide;
  let pl, note;
  if (agree) { const dir = tape; pl = trendPL(fr, a, i0, dir); const spyC = a.spy[a.spy.length - 1]?.c, spyD = spyAt(a, DECISION); const hit = sign((spyC - spyD)) === dir; hitsT += hit ? 1 : 0; nT++; tT += pl; note = `TREND hold ${dir > 0 ? 'LONG' : 'SHORT'} ${hit ? '✓' : '✗'}`; }
  else { const r = chopPL(fr, i0, king); pl = r.pnl; nC++; tC += pl; note = `CHOP fade ${king} (${r.trades} scalps)`; }
  console.log(`${d}  ${king}  ${String(tape).padStart(2)}    ${String(kingSide).padStart(2)}      ${agree ? 'TREND' : 'CHOP '}   ${(pl >= 0 ? '+' : '') + pl.toFixed(1).padStart(6)}   ${note}`);
}
console.log(`\nTREND days: ${nT} · hit ${nT ? (hitsT / nT * 100).toFixed(0) : 0}% · total ${tT >= 0 ? '+' : ''}${tT.toFixed(0)} pts · ${nT ? (tT / nT).toFixed(1) : 0}/day`);
console.log(`CHOP  days: ${nC} · total ${tC >= 0 ? '+' : ''}${tC.toFixed(0)} pts · ${nC ? (tC / nC).toFixed(1) : 0}/day (SCALP+${SCALP}/BREAK-${BREAK})`);
console.log(`COMBINED: ${(tT + tC) >= 0 ? '+' : ''}${(tT + tC).toFixed(0)} pts over ${days.length} days = ${((tT + tC) / days.length).toFixed(1)} pts/day.`);
console.log(`NOTE: pts are SPX-underlying; on cheap 0DTE these amplify heavily via convexity. TREND=push-through, CHOP=deflection-fade.`);
