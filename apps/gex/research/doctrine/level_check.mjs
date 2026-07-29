// "ARE WE MARKING THE CORRECT LEVELS?" — mark levels from the MORNING surface only (no hindsight),
// then measure: (a) STABILITY — does the morning king/wall survive to the afternoon? and
// (b) RESPECT — does price actually react (reverse) when it reaches the level intraday?
// A correct level = marked early, stays put, and price respects it. Usage: node level_check.mjs [markET]
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const idxAt = (fr, et) => fr.reduce((b, x, i) => Math.abs(+etOf(x.ts).replace(':', '') - +et.replace(':', '')) < Math.abs(+etOf(fr[b].ts).replace(':', '') - +et.replace(':', '')) ? i : b, 0);
const MARK = process.argv[2] || '10:00', TAP = 4, REACT = 3, WIN = 8; // react = reverse REACT pts within WIN bars of a touch

const king = (fx) => fx.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0];
const callWall = (fx, s) => fx.strikes.filter(n => n.g0 >= 12e6 && n.strike > s).sort((a, b) => b.g0 - a.g0)[0];
const putWall = (fx, s) => fx.strikes.filter(n => n.g0 >= 12e6 && n.strike < s).sort((a, b) => b.g0 - a.g0)[0];
const dayKing = (fr) => { const c = {}; for (const f of fr) { const k = king(f); if (k) c[k.strike] = (c[k.strike] || 0) + 1; } return +Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; };

// how well does level L get respected from bar i0 to EOD? touches within TAP that then reverse REACT pts.
function respect(fr, i0, L) {
  let touches = 0, reacts = 0, inTouch = false, refSpot = 0, refJ = 0;
  for (let j = i0; j < fr.length; j++) {
    const s = fr[j].spot, near = Math.abs(s - L) <= TAP;
    if (near && !inTouch) { inTouch = true; touches++; refSpot = s; refJ = j; }
    else if (!near && inTouch) inTouch = false;
    if (inTouch && j - refJ <= WIN) { // did it push away from L by REACT within the window?
      const away = Math.abs(s - L);
      if (away >= REACT && ((s < L && refSpot <= L) || (s > L && refSpot >= L) || Math.abs(s - refSpot) >= REACT)) { reacts++; inTouch = false; }
    }
  }
  return { touches, reacts };
}

const MINSTR = Number(process.argv[3] || 15) * 1e6; // "strong" king threshold (gamma) — the correct-levels filter
const days = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();
let stableN = 0, totT = 0, totR = 0;
let sN = 0, sStable = 0, sT = 0, sR = 0; // strong-king subset
console.log(`=== CORRECT-LEVELS CHECK · mark @ ${MARK} · react = touch within ${TAP} then move ${REACT}+ within ${WIN}min · n=${days.length} ===`);
console.log(`day         spot@${MARK}  king   callWall  putWall  | dayKing  stable?  king-respect(reacts/touches)`);
for (const d of days) {
  const fr = load(d); if (!fr) continue;
  const i0 = idxAt(fr, MARK), fx = fr[i0], s = fx.spot;
  const k = king(fx), cw = callWall(fx, s), pw = putWall(fx, s), dk = dayKing(fr);
  const stable = k && Math.abs(k.strike - dk) <= 5; if (stable) stableN++;
  const r = k ? respect(fr, i0, k.strike) : { touches: 0, reacts: 0 };
  totT += r.touches; totR += r.reacts;
  if (k && k.g0 >= MINSTR) { sN++; if (stable) sStable++; sT += r.touches; sR += r.reacts; }
  const fm = (n) => n ? `${n.strike}(${(n.g0 / 1e6).toFixed(0)}M)` : '—';
  console.log(`${d}  ${s.toFixed(0)}    ${fm(k).padEnd(10)}  ${fm(cw).padEnd(9)} ${fm(pw).padEnd(9)}| ${dk}   ${stable ? 'YES ' : 'drift'}    ${r.reacts}/${r.touches} ${r.touches ? '(' + (r.reacts / r.touches * 100).toFixed(0) + '%)' : ''}`);
}
console.log(`\nSTABILITY: ${stableN}/${days.length} days the ${MARK} king == the day's dominant king (within 5pt). Higher = morning levels are trustworthy.`);
console.log(`RESPECT: across all days, king touches reacted ${totT ? (totR / totT * 100).toFixed(0) : 0}% of the time (${totR}/${totT}). This is the "are the levels correct" number — a real wall should reject clearly more than a random price.`);
console.log(`\n>>> STRONG-KING FILTER (>=${(MINSTR / 1e6).toFixed(0)}M gamma) = the CORRECT-LEVELS rule:`);
console.log(`    ${sN}/${days.length} days qualify · STABILITY ${sN ? (sStable / sN * 100).toFixed(0) : 0}% (vs ${(stableN / days.length * 100).toFixed(0)}% unfiltered) · RESPECT ${sT ? (sR / sT * 100).toFixed(0) : 0}% (${sR}/${sT}).`);
console.log(`    Weak nodes (<${(MINSTR / 1e6).toFixed(0)}M) drift + get ignored = noise. Only mark strong pikas. Days with NO strong king = stand aside / wait for structure.`);
