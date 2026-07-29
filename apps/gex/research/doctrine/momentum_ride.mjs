// MOMENTUM RIDE w/ TRAILING STOP — react to a CONFIRMED move (don't predict), then let it run and trail.
// Fixes the "big trend into air / no near pika" miss (like today's +40pt rally). Test: does it catch trends
// without bleeding out on chop? Sweep trail widths. Uses SPX spot path (Skylit surface).
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etMin = (et) => +et.slice(0, 2) * 60 + +et.slice(3);
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const days = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();
const CONF = 4, MOMWIN = 10, HARDSTOP = 6, LASTENTRY = 15 * 60 + 15;

function sim(TRAIL) {
  const per = {}; let total = 0, wins = 0, n = 0;
  for (const d of days) {
    const fr = load(d); if (!fr) continue; const spots = fr.map(x => x.spot); let cd = -99, dayp = 0;
    for (let i = MOMWIN; i < fr.length - 3; i++) {
      if (i < cd) continue; const m = etMin(etOf(fr[i].ts)); if (m > LASTENTRY) break;
      const mom = spots[i] - spots[i - MOMWIN]; if (Math.abs(mom) < CONF) continue;    // confirmed move
      const dir = sign(mom), entry = spots[i]; let peak = 0, j = i + 1;
      for (; j < fr.length; j++) { const fav = (spots[j] - entry) * dir; peak = Math.max(peak, fav);
        if (fav <= -HARDSTOP) { peak = -HARDSTOP; break; }                              // initial hard stop
        if (peak >= TRAIL && fav <= peak - TRAIL) break;                                // trailing stop
        if (etMin(etOf(fr[j].ts)) >= 15 * 60 + 55) break; }                             // EOD
      const pnl = (spots[Math.min(j, fr.length - 1)] - entry) * dir; total += pnl; dayp += pnl; n++; if (pnl > 0) wins++; cd = j + 3;
    }
    per[d] = +dayp.toFixed(0);
  }
  return { TRAIL, total: +total.toFixed(0), n, win: n ? +(wins / n * 100).toFixed(0) : 0, avg: n ? +(total / n).toFixed(1) : 0, per };
}
console.log(`=== MOMENTUM RIDE + TRAILING STOP (confirm ${CONF}pt/${MOMWIN}min, hardstop ${HARDSTOP}) ===`);
console.log(`trail   #trades  win%   avg/trade   TOTAL(SPX pts)`);
const runs = [4, 6, 8, 10].map(sim);
for (const r of runs) console.log(`${String(r.TRAIL).padStart(4)}pt   ${String(r.n).padStart(3)}     ${String(r.win).padStart(3)}%   ${String(r.avg).padStart(5)}       ${r.total >= 0 ? '+' : ''}${r.total}`);
const best = runs.sort((a, b) => b.total - a.total)[0];
console.log(`\nbest trail=${best.TRAIL}pt · per-day (SPX pts):`);
for (const d of days) console.log(`  ${d}: ${best.per[d] >= 0 ? '+' : ''}${best.per[d]}`);
console.log(`\nEdge if TOTAL clearly positive AND not dependent on 1-2 days. Trend days should carry it; chop days shouldn't sink it.`);
