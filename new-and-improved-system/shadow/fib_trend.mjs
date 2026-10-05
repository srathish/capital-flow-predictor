#!/usr/bin/env node
// FIB EXTENSIONS + TRENDLINES — do they act as levels better than chance? Locked 2026-10-05 BEFORE running. Cached daily bars only.
// 294 universe stocks, daily, events 2023-01 → 2026-09. Swings = 3-bar pivots on daily highs/lows (confirmed 3 bars later — no look-ahead).
//   FIB    after swing low A → swing high B → swing low C (C > A, retracing 38–79% of AB): extension levels
//          E1.0 = C + 1.0·(B−A), E1.272, E1.618. Active from C's confirmation. Event = first daily bar whose HIGH reaches the level.
//          Outcome (resistance): REJECT if a later close is ≥ 1 ATR below the level before a close ≥ 1 ATR above it (60-bar limit).
//   TREND  rising line through the last two swing lows L1 < L2 (L2 higher, ≥ 5 bars apart), extended. Event = first bar whose LOW
//          touches the line from above. Outcome (support): REJECT if a close ≥ 1 ATR above the line comes before a close ≥ 1 ATR below.
//   CONTROL each real level/line is copied at a random offset of ±0.5–1.5 ATR (same slope for lines), run identically.
// PASS = REJECT rate beats its control by ≥ 5 points with z ≥ 2, in BOTH halves (2023–24 / 2025–26).
import fs from 'node:fs';
import { universe, loadDaily } from '../desk/common.mjs';

let seed = 41; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const atrAt = (b, i) => { let s = 0; for (let k = i - 13; k <= i; k++) s += Math.max(b[k].h - b[k].l, Math.abs(b[k].h - b[k - 1].c), Math.abs(b[k].l - b[k - 1].c)); return s / 14; };
function pivots(b) { const P = []; for (let i = 3; i < b.length - 3; i++) { const w = b.slice(i - 3, i + 4); if (b[i].h === Math.max(...w.map((x) => x.h))) P.push({ i, t: 'H', p: b[i].h, conf: i + 3 }); if (b[i].l === Math.min(...w.map((x) => x.l))) P.push({ i, t: 'L', p: b[i].l, conf: i + 3 }); } return P; }
// resistance test from bar j0 onward for level fn(i)
function resist(b, j0, lvl, atr) { let k0 = -1; for (let k = j0; k < Math.min(b.length, j0 + 120); k++) if (b[k].h >= lvl(k)) { k0 = k; break; } if (k0 < 0) return null;
  for (let k = k0; k < Math.min(b.length, k0 + 60); k++) { if (b[k].c <= lvl(k) - atr) return 'reject'; if (b[k].c >= lvl(k) + atr) return 'break'; } return 'neither'; }
function support(b, j0, lvl, atr) { let k0 = -1; for (let k = j0; k < Math.min(b.length, j0 + 120); k++) { if (b[k - 1].c > lvl(k - 1) && b[k].l <= lvl(k)) { k0 = k; break; } } if (k0 < 0) return null;
  for (let k = k0; k < Math.min(b.length, k0 + 60); k++) { if (b[k].c >= lvl(k) + atr) return 'reject'; if (b[k].c <= lvl(k) - atr) return 'break'; } return 'neither'; }
const T = {}; const add = (k, half, r) => { if (!r || r === 'neither') return; ((T[k] ??= {})[half] ??= { n: 0, rej: 0 }); T[k][half].n++; if (r === 'reject') T[k][half].rej++; };
for (const s of universe()) {
  const b = loadDaily(s); if (b.length < 200) continue; const P = pivots(b);
  for (let a = 0; a + 2 < P.length; a++) {
    // FIB: L(A) H(B) L(C) consecutive by type
    const A = P[a]; if (A.t !== 'L') continue; const B = P.slice(a + 1).find((x) => x.t === 'H'); if (!B) continue; const C = P.slice(P.indexOf(B) + 1).find((x) => x.t === 'L'); if (!C) continue;
    const ab = B.p - A.p, retr = (B.p - C.p) / ab; if (ab <= 0 || C.p <= A.p || retr < 0.38 || retr > 0.79) continue;
    const j0 = C.conf; if (j0 < 20 || j0 >= b.length - 5 || b[j0].d < '2023-01-01' || b[j0].d > '2026-09-30') continue;
    const atr = atrAt(b, j0), half = b[j0].d < '2025-01-01' ? 'H1' : 'H2';
    for (const m of [1.0, 1.272, 1.618]) { const L = C.p + m * ab; if (L <= b[j0].c) continue;
      add(`FIB ${m}`, half, resist(b, j0, () => L, atr)); const off = (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd()) * atr, Lc = L + off; if (Lc > b[j0].c) add(`FIB ${m} control`, half, resist(b, j0, () => Lc, atr)); }
  }
  // TRENDLINES: consecutive swing lows rising
  const lows = P.filter((x) => x.t === 'L');
  for (let k = 1; k < lows.length; k++) { const L1 = lows[k - 1], L2 = lows[k]; if (L2.p <= L1.p || L2.i - L1.i < 5) continue; const j0 = L2.conf + 1; if (j0 >= b.length - 5 || b[j0].d < '2023-01-01' || b[j0].d > '2026-09-30') continue;
    const slope = (L2.p - L1.p) / (L2.i - L1.i), line = (i) => L2.p + slope * (i - L2.i), atr = atrAt(b, j0), half = b[j0].d < '2025-01-01' ? 'H1' : 'H2';
    if (b[j0].c <= line(j0)) continue; add('TRENDLINE', half, support(b, j0, line, atr));
    const off = (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd()) * atr; if (b[j0].c > line(j0) + off) add('TRENDLINE control', half, support(b, j0, (i) => line(i) + off, atr)); }
}
const pct = (o) => o.rej / o.n;
console.log('FIB EXTENSIONS + TRENDLINES vs random-offset controls · 294 stocks daily · REJECT = turned back 1 ATR before closing 1 ATR through\n');
for (const k of ['FIB 1', 'FIB 1.272', 'FIB 1.618', 'TRENDLINE']) { let ok = true; const parts = [];
  for (const h of ['H1', 'H2']) { const a = T[k]?.[h], c = T[`${k} control`]?.[h]; if (!a || !c) { ok = false; continue; }
    const d = pct(a) - pct(c), z = d / Math.sqrt(pct(a) * (1 - pct(a)) / a.n + pct(c) * (1 - pct(c)) / c.n); if (!(d >= 0.05 && z >= 2)) ok = false;
    parts.push(`${h === 'H1' ? '2023–24' : '2025–26'}: ${(pct(a) * 100).toFixed(1)}% (n ${a.n}) vs control ${(pct(c) * 100).toFixed(1)}% (n ${c.n}) → ${(d * 100 >= 0 ? '+' : '')}${(d * 100).toFixed(1)} pts, z ${z.toFixed(1)}`); }
  console.log(`${ok ? '✓' : ' '} ${k.padEnd(10)} ${parts.join(' · ')}`); }
fs.writeFileSync(new URL('./journal/fib_trend.json', import.meta.url), JSON.stringify(T));
