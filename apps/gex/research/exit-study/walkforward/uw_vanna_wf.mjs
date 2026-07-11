// "Structural squared" cross-check (research only): does the vanna-flow lead survive
// on UW's data — a DIFFERENT dealer model, DIFFERENT vanna math, DIFFERENT frequency
// (daily, 1yr, multi-regime)? Daily analog: net vanna above−below spot each day; the
// day-over-day FLOW (Δ) and the LEVEL vs next-day price direction. Walk-forward split.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const T = process.argv[2] || 'SPY';
const ohlc = load(path.join(CACHE, `${T}_ohlc.json`)) || {};
const days = Object.keys(ohlc).sort();
const BAND = 0.025;
const sgn = x => x > 0 ? 1 : x < 0 ? -1 : 0;
function vannaAB(day, spot) {
  const s = load(path.join(CACHE, `${T}_gex_${day}.json`)); if (!s) return null;
  let ab = 0, be = 0;
  for (const r of s) { if (Math.abs(r.k - spot) / spot > BAND) continue; (r.k > spot ? ab += r.van : be += r.van); }
  return ab - be;
}
const rows = [];
for (let i = 1; i < days.length - 1; i++) {
  const d = days[i], pd = days[i - 1], nd = days[i + 1];
  const s = ohlc[d].close, van = vannaAB(d, s), vanPrev = vannaAB(pd, ohlc[pd].close);
  if (van == null || vanPrev == null) continue;
  rows.push({ d, level: sgn(van), flow: sgn(van - vanPrev), nextDir: sgn(ohlc[nd].close - s) });
}
const split = rows[Math.floor(rows.length / 2)].d;
const hit = (s, key) => { const u = s.filter(r => r[key] !== 0 && r.nextDir !== 0); return u.length ? u.filter(r => r[key] === r.nextDir).length / u.length * 100 : NaN; };
const nn = (s, key) => s.filter(r => r[key] !== 0 && r.nextDir !== 0).length;
console.log(`UW VANNA CROSS-CHECK — ${T}, ${rows.length} days ${rows[0]?.d}..${rows.at(-1)?.d} (split ${split})\n`);
console.log('signal'.padEnd(26) + 'n'.padStart(5) + 'hit%'.padStart(8));
for (const [lab, key] of [['vanna LEVEL (ab−be)', 'level'], ['vanna FLOW (Δ day/day)', 'flow']]) {
  console.log(lab.padEnd(26) + String(nn(rows, key)).padStart(5) + hit(rows, key).toFixed(0).padStart(7) + '%' + (hit(rows, key) >= 54 ? ' ✅' : ''));
  console.log('  train'.padEnd(26) + String(nn(rows.filter(r => r.d < split), key)).padStart(5) + hit(rows.filter(r => r.d < split), key).toFixed(0).padStart(7) + '%');
  console.log('  test'.padEnd(26) + String(nn(rows.filter(r => r.d >= split), key)).padStart(5) + hit(rows.filter(r => r.d >= split), key).toFixed(0).padStart(7) + '%');
}
console.log('\n(>=54% both train+test on a DIFFERENT dealer model + frequency = structural squared)');
