// VIX PIVOT (The Architect): below = compressed/bullish, above = vol-expansion/bearish. Test on our data:
// does SPX drift UP + range STAY TIGHT below the pivot, and drift DOWN + range EXPAND above it?
// Pivot proxies (we have VIXY, not $VIX): (a) VIXY day-open, (b) VIXY prior-day close.
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const aux = (d) => { const f = path.join(DIR, `aux_${d}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; };
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const days = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();
const FWD = 30;

function run(dayset, label) {
  const below = { mv: [], up: 0, n: 0, days: new Set() }, above = { mv: [], up: 0, n: 0, days: new Set() };
  let prevCloseVixy = null;
  for (const d of days) {                                       // iterate all to keep prevclose continuity
    const fr = load(d), a = aux(d); const vy = a.vixy || [];
    const pivot = prevCloseVixy; if (vy.length) prevCloseVixy = vy[vy.length - 1].c;
    if (!fr || !vy.length || pivot == null || !dayset.has(d)) continue;
    const vByEt = Object.fromEntries(vy.map(p => [p.et, p.c])); const spots = fr.map(x => x.spot);
    for (let i = 0; i < fr.length - FWD; i += 3) {
      const et = etOf(fr[i].ts), v = vByEt[et]; if (v == null) continue;
      const mv = spots[i + FWD] - spots[i]; const b = v < pivot ? below : above; b.mv.push(mv); if (mv > 0) b.up++; b.n++; b.days.add(d);
    }
  }
  console.log(`  ${label}: BELOW up ${below.n ? (below.up / below.n * 100).toFixed(0) : '—'}% (${below.days.size}d) · ABOVE up ${above.n ? (above.up / above.n * 100).toFixed(0) : '—'}% (${above.days.size}d) · spread ${below.n && above.n ? ((below.up / below.n - above.up / above.n) * 100).toFixed(0) : '—'}pt`);
}
console.log(`=== VIX PIVOT (VIXY vs prior close) — does bullish-below/bearish-above generalize? ===`);
run(new Set(days), 'ALL 19d ');
run(new Set(days.slice(0, 12)), 'TRAIN 12d');
run(new Set(days.slice(12)), 'TEST  7d ');
console.log(`  real if the up% spread (below − above) stays POSITIVE and similar in TEST. Note: VIXY is a proxy; real $VIX pivot (Architect's) would be cleaner. Direction from a DIFFERENT source than GEX = why it can work.`);
