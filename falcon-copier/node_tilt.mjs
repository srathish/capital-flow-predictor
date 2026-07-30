// NODE-GROWTH TILT as a REACTIVE directional/regime read. Raw king-growth is a dead signal (all 0DTE nodes
// balloon into the close). But the SIDE dealers are building — netTilt = Σ Δg0(above spot) − Σ Δg0(below spot)
// over a trailing window — may track the day's thesis (build above = bull magnet, below = bear). This is a
// CONCURRENT read of positioning (not a forward-move prediction), so it's a fair test even though direction is
// unpredictable OOS. Tests tilt-bias vs the day's actual drift across every SPXW replay day.
// Usage: node node_tilt.mjs   (all days)   |   node node_tilt.mjs 2026-07-20   (one day, verbose)
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const VC = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const ONE = process.argv[2];
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const et = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etMin = (ts) => (+ts.slice(11, 13) - 4) * 60 + +ts.slice(14, 16);
const load = (d) => zlib.gunzipSync(fs.readFileSync(path.join(VC, `replay_${d}_SPXW.jsonl.gz`))).toString().trim().split('\n').map(l => JSON.parse(l));
const g0At = (fr, k) => (fr.strikes.find(n => n.strike === k)?.g0 || 0);
const L = 20;                                                                // trailing window for dG0
const picks = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'falcon-copier', 'falcon_picks.json'), 'utf8')).picks || [];
const falconDir = (d) => { const p = picks.filter(x => x.date === d && x.kind === 'EXECUTED'); if (!p.length) { const w = picks.filter(x => x.date === d); return w.length ? sign(w.filter(x => x.dir === 'LONG').length - w.filter(x => x.dir === 'SHORT').length) : 0; } return sign(p.filter(x => x.dir === 'LONG').length - p.filter(x => x.dir === 'SHORT').length); };

// tilt at each frame: Σ Δg0 above spot − Σ Δg0 below spot, over trailing L min
function tiltSeries(F) {
  const out = [];
  for (let i = L; i < F.length; i++) {
    const s = F[i], spot = s.spot, prev = F[i - L];
    let t = 0; for (const n of s.strikes) { const d = n.g0 - g0At(prev, n.strike); t += d * sign(n.strike - spot); }
    out.push({ m: etMin(s.ts), et: et(s.ts), spot, tilt: t });
  }
  return out;
}
const at = (ser, mins) => { const c = ser.filter(x => x.m <= mins); return c.length ? c[c.length - 1] : ser[0]; };
const median = (xs) => { const a = xs.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };

const days = ONE ? [ONE] : fs.readdirSync(VC).map(f => (f.match(/^replay_(\d{4}-\d{2}-\d{2})_SPXW\.jsonl\.gz$/) || [])[1]).filter(Boolean).filter(d => d >= '2026-07-09').sort();

if (ONE) {
  const F = load(ONE), ser = tiltSeries(F);
  console.log(`\n═══ NODE-TILT ${ONE} (Σ Δg0 above − below, trailing ${L}min) ═══\nET     spot     tilt(20m)   biasSoFar`);
  let cum = 0; for (let i = 0; i < ser.length; i += 15) { cum += ser[i].tilt; console.log(`${ser[i].et}  ${ser[i].spot.toFixed(1)}  ${(ser[i].tilt / 1e6 >= 0 ? '+' : '') + (ser[i].tilt / 1e6).toFixed(0)}M`.padEnd(28) + `${sign(cum) > 0 ? 'BULL' : sign(cum) < 0 ? 'BEAR' : '—'}`); }
  process.exit(0);
}

console.log(`\n═══ NODE-TILT directional test — all SPXW replay days (bias = sign of node-growth tilt) ═══`);
console.log(`day         drift  tilt@10:30  tilt@12:00  tilt-median  kingSide@10:30  Falcon   drift✓?`);
let nDrift = 0, agrTiltMed = 0, agrTiltEarly = 0, agrKing = 0, agrFalcon = 0, nFal = 0;
for (const d of days) {
  let F; try { F = load(d); } catch { continue; } if (F.length < 60) continue;
  const ser = tiltSeries(F);
  const open = F[0].spot, close = F[F.length - 1].spot, drift = sign(close - open);
  const tEarly = sign(at(ser, 10 * 60 + 30).tilt), tMid = sign(at(ser, 12 * 60).tilt), tMed = sign(median(ser.map(x => x.tilt)));
  // king side at 10:30
  const f1030 = F.reduce((b, x) => Math.abs(etMin(x.ts) - 630) < Math.abs(etMin(b.ts) - 630) ? x : b, F[0]);
  const king = f1030.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0];
  const kingSide = king ? sign(king.strike - f1030.spot) : 0;
  const fdir = falconDir(d);
  nDrift++; if (tMed === drift) agrTiltMed++; if (tEarly === drift) agrTiltEarly++; if (kingSide === drift) agrKing++;
  if (fdir) { nFal++; if (tMed === fdir) agrFalcon++; }
  const S = (x) => x > 0 ? 'BULL' : x < 0 ? 'BEAR' : ' — ';
  console.log(`${d}   ${S(drift)}   ${S(tEarly).padEnd(9)}  ${S(tMid).padEnd(9)}  ${S(tMed).padEnd(10)}  ${S(kingSide).padEnd(13)}  ${S(fdir)}    ${tMed === drift ? '✓' : '✗'}`);
}
console.log(`\n  tilt-median vs drift: ${agrTiltMed}/${nDrift} (${(100 * agrTiltMed / nDrift).toFixed(0)}%) · tilt@10:30 vs drift: ${agrTiltEarly}/${nDrift} (${(100 * agrTiltEarly / nDrift).toFixed(0)}%)`);
console.log(`  king-side@10:30 vs drift: ${agrKing}/${nDrift} (${(100 * agrKing / nDrift).toFixed(0)}%) · tilt-median vs Falcon-dir: ${agrFalcon}/${nFal} (${nFal ? (100 * agrFalcon / nFal).toFixed(0) : 0}%)`);
console.log(`  (drift = close−open = the day's realized direction; a CONCURRENT read ≥65% = worth wiring as a reactive bias)`);
