// END-TO-END SIM — the system trading on SPX price, with an explicit entry/exit blotter.
// Each morning: mark the strong king (>=15M) from the 10:00 surface; classify trend/chop @10:30.
//   NO strong king            -> STAND ASIDE (no trades).
//   TREND (tape+king agree)   -> enter thesis dir @10:30, hold to EOD, hard stop -STOP_T.
//   CHOP  (disagree)          -> fade the king magnet: when price extends BAND past the king, fade back
//                                to the king; stop if it extends BAND+STOP_C further. One position at a
//                                time, cooldown between trades, last entry 15:15, force-close 15:55.
// P/L in SPX points (the honest, available measure). Usage: node sim.mjs [day|ALL]
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etMin = (et) => +et.slice(0, 2) * 60 + +et.slice(3);
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const aux = (d) => { const f = path.join(DIR, `aux_${d}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { spy: [] }; };
const idxAt = (fr, et) => fr.reduce((b, x, i) => Math.abs(+etOf(x.ts).replace(':', '') - +et.replace(':', '')) < Math.abs(+etOf(fr[b].ts).replace(':', '') - +et.replace(':', '')) ? i : b, 0);
const spyAt = (a, et) => { let v = null; for (const p of a.spy) { if (p.et <= et) v = p.c; else break; } return v; };
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
// knobs
const MINSTR = 15e6, STOP_T = 8;                 // trend: strong-king filter, hard stop
const BAND = 8, STOP_C = 6, COOL = 10, LAST = 15 * 60 + 15, FLAT = 15 * 60 + 55; // chop fade params
const king = (fx) => fx.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0];

function simDay(d, blotter) {
  const fr = load(d), a = aux(d); if (!fr || !a.spy.length) return null;
  const i10 = idxAt(fr, '10:00'), k = king(fr[i10]);
  if (!k || k.g0 < MINSTR) { blotter.push({ d, mode: 'ASIDE', note: `no strong king (best ${k ? (k.g0 / 1e6).toFixed(0) + 'M @' + k.strike : '—'})` }); return { d, mode: 'ASIDE', pts: 0, trades: 0 }; }
  const i1030 = idxAt(fr, '10:30'), spot1030 = fr[i1030].spot, K = k.strike;
  const tape = sign((spyAt(a, '10:30') ?? 0) - (a.spy[0]?.c ?? 0));
  const kingSide = sign(spot1030 - K);            // king below spot(+1 bull) / above(-1 bear)
  const trend = tape !== 0 && tape === kingSide;
  let pts = 0, trades = 0;

  if (trend) {
    const dir = tape, entry = spot1030, entryET = etOf(fr[i1030].ts);
    let exit = fr[fr.length - 1].spot, exitET = etOf(fr[fr.length - 1].ts), why = 'EOD';
    for (let j = i1030 + 1; j < fr.length; j++) { const s = fr[j].spot; if (dir * (s - entry) <= -STOP_T) { exit = s; exitET = etOf(fr[j].ts); why = `stop -${STOP_T}`; break; } }
    const p = dir * (exit - entry); pts += p; trades = 1;
    blotter.push({ d, mode: 'TREND', side: dir > 0 ? 'LONG' : 'SHORT', king: K, entryET, entry, exitET, exit, pts: p, why });
  } else {
    let inPos = 0, entry = 0, entryET = '', cool = -99, stopStreak = 0;
    for (let j = i1030; j < fr.length; j++) {
      const s = fr[j].spot, et = etOf(fr[j].ts), m = etMin(et);
      if (stopStreak >= 2) { blotter.push({ d, mode: 'CHOP', side: 'STAND', king: K, entryET: et, entry: s, exitET: et, exit: s, pts: 0, why: 'grind-away kill (2 stops) — not chopping' }); break; } // it's trending, not chopping
      if (!inPos) {
        if (m > LAST || j - cool < COOL) continue;
        if (s - K >= BAND) { inPos = -1; entry = s; entryET = et; }       // extended above -> fade short to K
        else if (K - s >= BAND) { inPos = 1; entry = s; entryET = et; }   // extended below -> fade long to K
      } else {
        const hitTgt = inPos > 0 ? s >= K : s <= K;                       // reverted to the king = win
        const hitStop = inPos > 0 ? s <= entry - STOP_C : s >= entry + STOP_C; // extended further = loss
        if (hitTgt || hitStop || (m >= etMin('15:55'))) {
          const exit = s, p = inPos * (exit - entry); pts += p; trades++;
          blotter.push({ d, mode: 'CHOP', side: inPos > 0 ? 'LONG' : 'SHORT', king: K, entryET, entry, exitET: et, exit, pts: p, why: hitTgt ? 'target(king)' : hitStop ? `stop -${STOP_C}` : 'EOD' });
          stopStreak = hitStop ? stopStreak + 1 : 0;                      // consecutive stops = grinding, not chopping
          inPos = 0; cool = j;
        }
      }
    }
    if (inPos) { const s = fr[fr.length - 1].spot, p = inPos * (s - entry); pts += p; trades++; blotter.push({ d, mode: 'CHOP', side: inPos > 0 ? 'LONG' : 'SHORT', king: K, entryET, entry, exitET: etOf(fr[fr.length - 1].ts), exit: s, pts: p, why: 'EOD' }); }
  }
  return { d, mode: trend ? 'TREND' : 'CHOP', pts, trades };
}

const arg = process.argv[2] || 'ALL';
const days = arg === 'ALL' ? fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort() : [arg];
const blotter = [], summ = [];
for (const d of days) { const r = simDay(d, blotter); if (r) summ.push(r); }
console.log(`=== SIM BLOTTER (SPX points) ===`);
console.log(`day         mode   side   king   entry(ET/px)      ->  exit(ET/px)       pts    why`);
for (const b of blotter) {
  if (b.mode === 'ASIDE') { console.log(`${b.d}  ASIDE  — ${b.note}`); continue; }
  console.log(`${b.d}  ${b.mode.padEnd(5)}  ${b.side.padEnd(5)}  ${b.king}  ${b.entryET} ${b.entry.toFixed(1).padStart(7)}   ->  ${b.exitET} ${b.exit.toFixed(1).padStart(7)}   ${(b.pts >= 0 ? '+' : '') + b.pts.toFixed(1).padStart(5)}  ${b.why}`);
}
const trades = blotter.filter(b => b.pts != null && b.mode !== 'ASIDE');
const wins = trades.filter(b => b.pts > 0).length;
const tot = trades.reduce((a, c) => a + c.pts, 0);
const byMode = (m) => { const t = trades.filter(b => b.mode === m); return `${m}: ${t.length} trades, ${t.length ? (t.filter(b => b.pts > 0).length / t.length * 100).toFixed(0) : 0}% win, ${t.reduce((a, c) => a + c.pts, 0).toFixed(0)} pts`; };
console.log(`\nDAYS: ${summ.length} (${summ.filter(s => s.mode === 'TREND').length} trend, ${summ.filter(s => s.mode === 'CHOP').length} chop, ${summ.filter(s => s.mode === 'ASIDE').length} stood aside)`);
console.log(byMode('TREND')); console.log(byMode('CHOP'));
console.log(`TOTAL: ${trades.length} trades · ${trades.length ? (wins / trades.length * 100).toFixed(0) : 0}% win · ${tot >= 0 ? '+' : ''}${tot.toFixed(0)} SPX pts · ${trades.length ? (tot / trades.length).toFixed(2) : 0} pts/trade`);
console.log(`(pts are on the SPX underlying; cheap 0DTE amplifies via convexity + management. Stop=trend -${STOP_T}/chop -${STOP_C}, chop band ${BAND}.)`);
