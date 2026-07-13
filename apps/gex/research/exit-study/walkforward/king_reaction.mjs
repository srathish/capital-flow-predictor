// VEGA / hostile replication (RESEARCH ONLY, READ-ONLY archive, no logic change).
// Question: is the Skylit King an INTRADAY reference level that price REACTS to,
// or (like the EOD close-pin we already refuted) an artifact that dies against a
// distance-matched control?
//
// PRE-REGISTERED METHOD (fixed before looking at any output):
//   Data: 5-min intraday surfaces, SPXW/SPY/QQQ, ~64 days.
//   King  = strike with max AGGREGATED POSITIVE gamma across all expirations (canonical Skylit King), live each frame.
//   Windows: non-overlapping, length K bars. At each window start i:
//     - L_king   = live King K_i ; d = |spot_i - K_i| ; side = sign(K_i - spot_i)
//     - L_mirror = 2*spot_i - K_i           (distance-matched, opposite side, FIXED for window)
//     - L_rand   = spot_i + randSign*jit*d  (jit in [0.7,1.3], random near-money control)
//     - skip window if d/spot < band (King already at spot) or d/spot > 1.5% (unreachable).
//   Within frames (i, i+K]:
//     APPROACH to level L = price enters band (min|spot_j - L| <= band*spot).
//     Given approach, classify price at window end (i+K) relative to L:
//       STALL   = within band of L                          (pin / magnet-hold)
//       REVERSE = back on the spot-side of L, outside band  (wall / rejection)
//       CROSS   = beyond L on the far side, outside band     (penetrated = NO reaction)
//     REACTION = STALL or REVERSE.
//   CLAIM SURVIVES only if King reaction-rate > mirror reaction-rate (not just > a far strike),
//   and holds in a chronological OOS split (first half vs second half of days).
//   Also report rejection(REVERSE) vs magnet(STALL) split for the King.
//
// Band settings tested: 0.10% and 0.20% of spot. K tested: 3, 6, 9 bars (15/30/45 min).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(HERE, '..', '..', '..', 'data', 'skylit-archive', 'intraday');
const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const TICKERS = (process.argv[2] || 'SPXW,SPY,QQQ').split(',');

// deterministic RNG (reproducible random control)
let _s = 1234567;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };

function frames(day, t) {
  const p = path.join(ARCHIVE, day, `${t}.jsonl.gz`); if (!fs.existsSync(p)) return [];
  return zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n')
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    .map(s => {
      const agg = {};
      for (const e of (s.allExpirations || [])) for (const q of (e.strikes || [])) {
        const k = +q.strike; if (!Number.isFinite(k)) continue;
        agg[k] = (agg[k] || 0) + (+q.gamma || 0);
      }
      let king = null;
      for (const k in agg) if (king == null || agg[k] > agg[king]) king = k; // max POSITIVE aggregated gamma
      return { spot: +s.spot, king: king == null ? null : +king };
    })
    .filter(s => Number.isFinite(s.spot) && s.king != null);
}

// classify approach+reaction to a fixed level L over a forward window fr[a..b]
// spot0 = spot at window start (defines the "spot side")
function classify(fr, a, b, L, spot0, bandAbs) {
  let approached = false;
  for (let j = a + 1; j <= b; j++) if (Math.abs(fr[j].spot - L) <= bandAbs) { approached = true; break; }
  if (!approached) return 'none';
  const end = fr[b].spot;
  if (Math.abs(end - L) <= bandAbs) return 'stall';
  const spotSide = Math.sign(spot0 - L);      // which side spot started on
  const endSide = Math.sign(end - L);
  return (endSide === spotSide) ? 'reverse' : 'cross';
}

function run(band, K) {
  // counters: [approaches, stall, reverse, cross]
  const mk = () => ({ king: [0,0,0,0], mir: [0,0,0,0], rnd: [0,0,0,0] });
  const tot = mk();
  const half = [mk(), mk()];                  // OOS chronological halves
  const perT = {}; for (const t of TICKERS) perT[t] = mk();
  const nDays = days.length, mid = Math.floor(nDays / 2);

  for (let di = 0; di < nDays; di++) {
    const day = days[di], h = di < mid ? 0 : 1;
    for (const t of TICKERS) {
      const fr = frames(day, t); if (fr.length < K + 2) continue;
      for (let i = 0; i + K < fr.length; i += K) {   // non-overlapping windows
        const spot0 = fr[i].spot, king = fr[i].king;
        const d = Math.abs(spot0 - king), rel = d / spot0;
        if (rel < band || rel > 0.015) continue;       // King at spot, or unreachable
        const bandAbs = band * spot0;
        const side = Math.sign(king - spot0);
        const Lking = king;
        const Lmir = spot0 - side * d;                 // 2*spot0 - king
        const rSign = rnd() < 0.5 ? -1 : 1;
        const Lrnd = spot0 + rSign * (0.7 + 0.6 * rnd()) * d;
        for (const [key, L] of [['king', Lking], ['mir', Lmir], ['rnd', Lrnd]]) {
          const c = classify(fr, i, i + K, L, spot0, bandAbs);
          if (c === 'none') continue;
          tot[key][0]++; half[h][key][0]++; perT[t][key][0]++;
          const idx = c === 'stall' ? 1 : c === 'reverse' ? 2 : 3;
          tot[key][idx]++; half[h][key][idx]++; perT[t][key][idx]++;
        }
      }
    }
  }
  return { tot, half, perT };
}

const P = x => `${(100 * x).toFixed(0)}%`;
const reactRate = a => a[0] ? (a[1] + a[2]) / a[0] : NaN; // stall+reverse over approaches
const line = a => {
  const n = a[0]; if (!n) return `n=0`;
  return `appr=${String(n).padStart(4)}  react=${P(reactRate(a)).padStart(4)}  (stall ${P(a[1]/n)} / rev ${P(a[2]/n)} / cross ${P(a[3]/n)})`;
};

console.log(`KING INTRADAY REACTION TEST — ${days.length} days ${days[0]}..${days.at(-1)}, ${TICKERS.join('/')}`);
console.log(`King = max aggregated POSITIVE gamma across all expirations, tracked frame-by-frame. Non-overlapping windows.\n`);

for (const K of [3, 6, 9]) for (const band of [0.001, 0.002]) {
  const { tot, half, perT } = run(band, K);
  console.log(`===== band=${(band*100).toFixed(1)}%  K=${K} bars (${K*5}min) =====`);
  console.log(`  KING   ${line(tot.king)}`);
  console.log(`  MIRROR ${line(tot.mir)}`);
  console.log(`  RANDOM ${line(tot.rnd)}`);
  const dk = reactRate(tot.king), dm = reactRate(tot.mir), dr = reactRate(tot.rnd);
  console.log(`  EDGE  King-Mirror = ${((dk-dm)*100).toFixed(1)}pp   King-Random = ${((dk-dr)*100).toFixed(1)}pp`);
  console.log(`  OOS 1st half: King ${P(reactRate(half[0].king))} vs Mir ${P(reactRate(half[0].mir))}  (edge ${((reactRate(half[0].king)-reactRate(half[0].mir))*100).toFixed(1)}pp, nK=${half[0].king[0]})`);
  console.log(`  OOS 2nd half: King ${P(reactRate(half[1].king))} vs Mir ${P(reactRate(half[1].mir))}  (edge ${((reactRate(half[1].king)-reactRate(half[1].mir))*100).toFixed(1)}pp, nK=${half[1].king[0]})`);
  if (band === 0.002 && K === 6) {
    console.log('  per-ticker (King react vs Mirror react):');
    for (const t of TICKERS) console.log(`    ${t.padEnd(5)} King ${P(reactRate(perT[t].king))} (n=${perT[t].king[0]})  Mir ${P(reactRate(perT[t].mir))} (n=${perT[t].mir[0]})`);
    const k = tot.king, react = k[1] + k[2];
    console.log(`  King reaction split: rejection/wall (reverse) ${P(k[2]/react)}  vs  magnet/pin (stall) ${P(k[1]/react)}  of ${react} reactions`);
  }
  console.log('');
}
