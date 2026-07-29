// FLIP THE EDGE: SELL premium at GEX walls (non-directional). A 0DTE iron condor — short a call at the
// nearest strong pika ABOVE spot and a put at the nearest strong pika BELOW — wins if price stays INSIDE
// to the close. Our reach engine says far/big nodes rarely get hit; this monetizes that on the sell side.
// Test the WIN RATE (price stays inside) by entry time + wing distance, + rough condor expectancy.
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const idxAt = (fr, et) => fr.reduce((b, x, i) => Math.abs(+etOf(x.ts).replace(':', '') - +et.replace(':', '')) < Math.abs(+etOf(fr[b].ts).replace(':', '') - +et.replace(':', '')) ? i : b, 0);
const days = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();

for (const ENTRY of ['10:00', '11:00', '12:00']) {
  for (const MINW of [12, 18]) {                                          // min wing distance from spot
    let win = 0, breachHi = 0, breachLo = 0, n = 0; const perDay = [];
    for (const d of days) {
      const fr = load(d); if (!fr) continue; const i0 = idxAt(fr, ENTRY), spot = fr[i0].spot, spots = fr.map(x => x.spot);
      const callK = fr[i0].strikes.filter(x => x.g0 >= 15e6 && x.strike - spot >= MINW && x.strike - spot <= 45).sort((a, b) => a.strike - b.strike)[0];
      const putK = fr[i0].strikes.filter(x => x.g0 >= 15e6 && spot - x.strike >= MINW && spot - x.strike <= 45).sort((a, b) => b.strike - a.strike)[0];
      if (!callK || !putK) continue;                                      // need walls both sides
      const rest = spots.slice(i0 + 1); const hi = Math.max(...rest), lo = Math.min(...rest);
      const bHi = hi >= callK.strike, bLo = lo <= putK.strike, inside = !bHi && !bLo;
      n++; if (inside) win++; if (bHi) breachHi++; if (bLo) breachLo++;
      perDay.push({ d, inside, callK: callK.strike, putK: putK.strike, width: callK.strike - putK.strike });
    }
    if (!n) continue;
    const wr = win / n;
    // rough condor expectancy: credit ≈ 30% of wing width, max loss ≈ 70% (in width units) → per-trade in "width fractions"
    const exp = wr * 0.30 - (1 - wr) * 0.70;
    console.log(`entry ${ENTRY} · wings ≥${MINW}pt: WIN(stay inside) ${(wr * 100).toFixed(0)}% (n=${n}) · breach up ${(breachHi / n * 100).toFixed(0)}% / down ${(breachLo / n * 100).toFixed(0)}% · condor exp ${exp >= 0 ? '+' : ''}${(exp * 100).toFixed(0)}% of width`);
  }
}
console.log(`\nSell-side edge if WIN% is high (≥70%) AND condor expectancy positive. This flips reach (which we validated) onto the profitable, non-directional side. NOTE: exit management (roll/cut the tested side) would raise realized win further.`);
