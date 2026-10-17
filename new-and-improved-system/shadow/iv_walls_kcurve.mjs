#!/usr/bin/env node
// DESIGN_iv_walls.md — fade the day's implied (straddle) / historical-vol band, vs random twin levels; Skylit-node confluence exploratory.
import fs from 'node:fs';
const C = new URL('../.cache/', import.meta.url), OUT = new URL('./results_iv_walls/kcurve/', import.meta.url); fs.mkdirSync(OUT, { recursive: true });
const etMin = (t) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(t * 1000)); return +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value; };
let seed = 20261017; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const SPLIT = { HV: '2025-04-01', IV: '2026-01-01' };
function fade(bars, wall, side, sig, O) {
  // side +1 = upper wall (short fade), -1 = lower wall (long fade); bars = [m,o,h,l,c] from 09:45
  const ix = bars.findIndex((b, i) => i > 0 && b[0] >= 585 && b[0] <= 930 && (side > 0 ? b[2] >= wall && bars[i - 1][4] < wall : b[3] <= wall && bars[i - 1][4] > wall)); if (ix < 0 || bars.slice(0, ix).some((b) => side > 0 ? b[2] >= wall : b[3] <= wall)) return null; const touch = bars[ix];
  const risk = 0.25 * sig * O, stop = wall + side * risk, tgt = wall - side * 0.5 * sig * O;
  for (const b of bars) { if (b[0] < touch[0]) continue;
    if (side > 0 ? b[2] >= stop : b[3] <= stop) { if (b[0] === touch[0] && (side > 0 ? b[1] >= stop : b[1] <= stop)) return { m: touch[0], R: -1 }; return { m: touch[0], R: -1 }; }
    if (b[0] > touch[0] && (side > 0 ? b[3] <= tgt : b[2] >= tgt)) return { m: touch[0], R: 2 };
    if (b[0] >= 955) return { m: touch[0], R: (side > 0 ? wall - b[4] : b[4] - wall) / risk }; }
  const l = bars.at(-1); return { m: touch[0], R: (side > 0 ? wall - l[4] : l[4] - wall) / risk };
}
const KS = [0.8, 1.0, 1.2, 1.4, 1.645, 1.9, 2.2];
const rows = [], contain = [];
for (const T of ['SPY', 'QQQ']) {
  const files = fs.readdirSync(new URL(`uw/m1/${T}/`, C)).filter((f) => f.endsWith('.json')).sort(), closes = [];
  for (const f of files) {
    const d = f.slice(0, 10), raw = JSON.parse(fs.readFileSync(new URL(`uw/m1/${T}/${f}`, C), 'utf8')).filter((b) => b.m === 'r');
    const bars = raw.map((b) => [etMin(b.t), b.o, b.h, b.l, b.c]).filter((b) => b[0] >= 570 && b[0] < 960).sort((a, b) => a[0] - b[0]);
    if (bars.length < 300 || bars[0][0] !== 570) { if (bars.length) closes.push(bars.at(-1)[4]); continue; }
    const O = bars[0][1], C1 = bars.at(-1)[4], hi = Math.max(...bars.map((b) => b[2])), lo = Math.min(...bars.map((b) => b[3]));
    const sig = {};
    if (closes.length >= 21) { const r = []; for (let i = closes.length - 20; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1])); const m = r.reduce((a, b) => a + b, 0) / r.length; sig.HV = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)); }
    const sf = new URL(`straddle/${T}/${d}.json`, C);
    if (fs.existsSync(sf)) { const S = JSON.parse(fs.readFileSync(sf, 'utf8')), pick = (a) => (a ?? []).find((q) => q.m >= 575 && q.m <= 577), c = pick(S.t2?.call), p = pick(S.t2?.put); if (c && p && S.t2?.px935) sig.IV = (c.c + p.c) / (0.798 * S.t2.px935); }
    closes.push(C1);
    for (const [W, s] of Object.entries(sig)) { if (!(s > 0)) continue;
      for (const k of KS) {
        contain.push({ T, d, W, k, inHL: hi <= O * (1 + k * s) && lo >= O * (1 - k * s), inC: Math.abs(C1 / O - 1) <= k * s });
        for (const side of [1, -1]) { const wall = O * (1 + side * k * s), f0 = fade(bars, wall, side, s, O); if (!f0) continue;
          const tw = [];
          rows.push({ T, d, W, k, side, wall, m: f0.m, R: f0.R, twin: tw.length ? tw.reduce((a, b) => a + b, 0) / tw.length : null, ho: d >= SPLIT[W] }); } } }
  }
}


const byDay = (a) => { const g = new Map(); for (const x of a) { const q = g.get(x.d) ?? []; q.push(x.R); g.set(x.d, q); } return [...g.values()].map((q) => q.reduce((s, v) => s + v, 0) / q.length); };
const ts = (v) => { const n = v.length; if (n < 3) return '—'; const m = v.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)); return `${m >= 0 ? '+' : ''}${m.toFixed(2)}R t ${((m / sd) * Math.sqrt(n)).toFixed(1)}`; };
for (const W of ['IV', 'HV']) { console.log(`\n${W} wall — fade R by distance (k·σ from the open), clean crosses only`); console.log('   k     build                          holdout');
  for (const k of KS) { const b = rows.filter((x) => x.W === W && x.k === k && !x.ho), h = rows.filter((x) => x.W === W && x.k === k && x.ho); console.log(`  ${String(k).padEnd(5)} ${(ts(byDay(b)) + ' (' + b.length + ')').padEnd(30)} ${ts(byDay(h))} (${h.length})`); } }
