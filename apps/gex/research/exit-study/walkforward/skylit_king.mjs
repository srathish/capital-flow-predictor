// Skylit-King walkforward (research only, READ-ONLY on the archive — no logic change).
// Operator correctly noted UW computes GEX/VEX differently than Skylit, so the UW
// walkforward doesn't test OUR King. Re-run the same hypotheses on the SKYLIT
// archive King (total gamma/vanna per strike, summed across expirations), verified
// against UW daily closes. This is the real test of the system's magnet.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GEX = path.join(HERE, '..', '..', '..');
const DAILY = path.join(GEX, 'data', 'skylit-archive', 'daily');
const OHLC = f => JSON.parse(fs.readFileSync(path.join(HERE, 'cache', f), 'utf8'));

const T = process.argv[2] || 'SPY';
const px = OHLC(`${T}_ohlc.json`);                        // UW daily closes (verification)
const days = fs.readdirSync(DAILY).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && fs.existsSync(path.join(DAILY, d, `${T}.json.gz`))).sort();

function surface(day) {
  try {
    const s = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DAILY, day, `${T}.json.gz`))));
    const agg = {};                                       // total gamma/vanna per strike across expirations
    for (const e of (s.allExpirations || [])) for (const q of (e.strikes || [])) {
      const k = +q.strike; if (!Number.isFinite(k)) continue;
      agg[k] = agg[k] || { g: 0, v: 0 };
      agg[k].g += (+q.gamma || 0); agg[k].v += (+q.vanna || 0);
    }
    const ks = Object.keys(agg); if (ks.length < 10) return null;
    let gk = null, vk = null, totG = 0;
    for (const k of ks) { totG += agg[k].g; if (!gk || Math.abs(agg[k].g) > Math.abs(agg[gk].g)) gk = k; if (!vk || Math.abs(agg[k].v) > Math.abs(agg[vk].v)) vk = k; }
    return { spot: s.spot, gexKing: +gk, vexKing: +vk, totG };
  } catch { return null; }
}

const recs = [];
for (let i = 0; i < days.length - 1; i++) {
  const d = days[i], nd = days[i + 1];
  const s = surface(d); if (!s || !s.spot || !px[d] || !px[nd]) continue;
  const c0 = px[d].close, c1 = px[nd].close;
  recs.push({ d, c0, c1, up1: c1 > c0,
    gexAbove: s.gexKing > s.spot, vexAbove: s.vexKing > s.spot,
    towardKing: Math.abs(c1 - s.gexKing) < Math.abs(c0 - s.gexKing),
    posGamma: s.totG > 0, nextRange: (px[nd].high - px[nd].low) / c0 });
}
const pct = x => `${(x * 100).toFixed(1)}%`;
const rate = f => recs.filter(f).length / recs.length;
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
console.log(`SKYLIT-KING WALKFORWARD — ${T}, ${recs.length} days ${recs[0]?.d}..${recs.at(-1)?.d} (archive; one regime)`);
const bu = rate(r => r.up1);
console.log(`baseline next-day UP = ${pct(bu)}  (naive accuracy ${pct(Math.max(bu, 1 - bu))})\n`);
console.log('H1 GEX-King>spot => up : dir-acc ' + pct(rate(r => r.gexAbove === r.up1)));
console.log('H2 VEX-King>spot => up : dir-acc ' + pct(rate(r => r.vexAbove === r.up1)));
console.log('H3 price moves TOWARD Skylit GEX-King next day: ' + pct(rate(r => r.towardKing)) + '  (vs 50%)');
const rp = recs.filter(r => r.posGamma).map(r => r.nextRange), rn = recs.filter(r => !r.posGamma).map(r => r.nextRange);
console.log(`H4 pos-gamma range ${pct(mean(rp))} (n=${rp.length}) vs neg-gamma ${pct(mean(rn))} (n=${rn.length})  [pos should be smaller]`);
