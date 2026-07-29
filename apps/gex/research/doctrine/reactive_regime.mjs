// REACTIVE REGIME ENGINE (agentic > algorithmic) — read the CURRENT tape each bar, switch mode:
//   TREND now (price moving efficiently) -> RIDE momentum (trailing stop)
//   CHOP now  (price oscillating)         -> FADE the nearest wall back to it
// It does NOT predict the regime; it DETECTS the current one from recent behavior and adapts — catching
// intraday shifts a fixed strategy can't. Test: does reactive switching beat always-fade / always-ride?
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etMin = (et) => +et.slice(0, 2) * 60 + +et.slice(3);
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const days = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();
const W = 20, TREND_TH = 0.45, CHOP_TH = 0.30, TRAIL = 6, FADE_STOP = 6, MOM_W = 10, COOL = 8, STRONG = 15e6;

const eff = (s, i) => { if (i < W) return 0.5; const net = Math.abs(s[i] - s[i - W]); let p = 0; for (let j = i - W + 1; j <= i; j++) p += Math.abs(s[j] - s[j - 1]); return p ? net / p : 0; };
const nearPika = (fr, i, spot) => fr[i].strikes.filter(n => n.g0 >= STRONG && Math.abs(n.strike - spot) >= 7 && Math.abs(n.strike - spot) <= 20).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];

function rideFrom(s, i, dir) {                          // enter momentum, trailing stop; return pnl + exit idx
  const entry = s[i]; let peak = 0, j = i + 1;
  for (; j < s.length; j++) { const fav = (s[j] - entry) * dir; peak = Math.max(peak, fav); if (peak >= TRAIL && fav <= peak - TRAIL) break; if (fav <= -TRAIL) break; }
  return { pnl: (s[Math.min(j, s.length - 1)] - entry) * dir, exit: j };
}
function fadeTo(s, fr, i, pika) {                        // fade toward pika, exit at pika or stop
  const entry = s[i], dir = sign(pika.strike - entry); let j = i + 1;
  for (; j < s.length; j++) { if (dir > 0 ? s[j] >= pika.strike : s[j] <= pika.strike) break; if (dir > 0 ? s[j] <= entry - FADE_STOP : s[j] >= entry + FADE_STOP) break; }
  return { pnl: (s[Math.min(j, s.length - 1)] - entry) * dir, exit: j };
}

function run(mode) {                                     // mode: 'reactive' | 'fade' | 'ride'
  let total = 0; const perDay = {};
  for (const d of days) {
    const fr = load(d); if (!fr) continue; const s = fr.map(x => x.spot); let cd = -99, dayp = 0;
    for (let i = W; i < s.length - 5; i++) {
      if (i < cd) continue; if (etMin(etOf(fr[i].ts)) > 15 * 60) break;
      const e = eff(s, i), mom = s[i] - s[i - MOM_W], pika = nearPika(fr, i, s[i]);
      let act = null;                                   // 'ride' | 'fade'
      if (mode === 'reactive') { if (e >= TREND_TH && Math.abs(mom) >= 3) act = 'ride'; else if (e <= CHOP_TH && pika) act = 'fade'; }
      else if (mode === 'ride') { if (Math.abs(mom) >= 3) act = 'ride'; }
      else if (mode === 'fade') { if (pika) act = 'fade'; }
      if (!act) continue;
      const r = act === 'ride' ? rideFrom(s, i, sign(mom)) : fadeTo(s, fr, i, pika);
      total += r.pnl; dayp += r.pnl; cd = r.exit + COOL;
    }
    perDay[d] = +dayp.toFixed(0);
  }
  return { total: +total.toFixed(0), perDay };
}

const R = run('reactive'), F = run('fade'), D = run('ride');
console.log(`=== REACTIVE REGIME vs FIXED (SPX pts, 19 days) ===`);
console.log(`  REACTIVE (switch fade↔ride on current tape): ${R.total >= 0 ? '+' : ''}${R.total}`);
console.log(`  always FADE:                                 ${F.total >= 0 ? '+' : ''}${F.total}`);
console.log(`  always RIDE:                                 ${D.total >= 0 ? '+' : ''}${D.total}`);
console.log(`\nper-day (reactive / fade / ride):`);
for (const d of days) console.log(`  ${d}:  ${String(R.perDay[d]).padStart(5)}  /  ${String(F.perDay[d]).padStart(5)}  /  ${String(D.perDay[d]).padStart(5)}`);
console.log(`\nreactive WINS the thesis if it beats BOTH fixed strategies — detecting the regime and switching > committing to one.`);
