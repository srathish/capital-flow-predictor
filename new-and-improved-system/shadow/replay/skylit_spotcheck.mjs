#!/usr/bin/env node
// Compares two replay frames with Skylit's historical API (10 credits): correlation of gamma by strike within ±2%, top-5 overlap.
import fs from 'node:fs';
import os from 'node:os';
const k = await import('../../feeds/skylit.js');
const checks = [['SPY', '2026-03-04', '2026-03-04T20:00:00Z'], ['QQQ', '2026-03-17', '2026-03-17T15:00:00Z']], out = [];
for (const [T, d, at] of checks) { const api = (await k.heatmapAt(T, at, { metric: 'gamma' }))[0], j = JSON.parse(fs.readFileSync(`${os.homedir()}/gex-data-replay-reader/data/gex-replay-${d}.json`, 'utf8'));
  const fr = j.frames.reduce((a, f) => (Math.abs(Date.parse(f.timestamp) - Date.parse(at)) < Math.abs(Date.parse(a.timestamp) - Date.parse(at)) ? f : a)), x = fr.tickers[T], spot = x.spotPrice;
  const rep = new Map(x.strikes.map((s, i) => [+s, x.gammaValues[i].reduce((a, v) => a + (v || 0), 0)])), near = api.strikes.filter((s) => Math.abs(s.strike / spot - 1) <= 0.02), pairs = near.filter((s) => rep.has(s.strike)).map((s) => [s.value, rep.get(s.strike)]);
  const n = pairs.length, mx = pairs.reduce((q, p) => q + p[0], 0) / n, my = pairs.reduce((q, p) => q + p[1], 0) / n; let sxy = 0, sx = 0, sy = 0; for (const [u, v] of pairs) { sxy += (u - mx) * (v - my); sx += (u - mx) ** 2; sy += (v - my) ** 2; }
  const top = (a) => a.slice().sort((p, q) => Math.abs(q[1]) - Math.abs(p[1])).slice(0, 5).map((z) => z[0]), tA = top(near.map((s) => [s.strike, s.value])), tR = top([...rep].filter(([s]) => Math.abs(s / spot - 1) <= 0.02));
  out.push({ T, d, frame: fr.timestamp, apiSpot: api.spot, replaySpot: spot, strikesCompared: n, correlation: +(sxy / Math.sqrt(sx * sy)).toFixed(3), apiTop5: tA, replayTop5: tR, top5Overlap: tA.filter((s) => tR.includes(s)).length }); }
fs.writeFileSync(new URL('./skylit_api_spotcheck.json', import.meta.url), JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1), 'credits', k.spend.process);
