// Pull the pre-registered replay-vs-API sample (reports/DESIGN_replay_vs_api.md) through feeds/skylit.js (credit guard).
// Caches raw responses in ../../.cache/skylit_verify/<at>.json and skips instants already cached.
//   SKYLIT_BUDGET=150 node gammalab/verify/pull_api.mjs [limit]
import fs from 'node:fs';
import path from 'node:path';
import { historicalRaw, usage } from '../../../feeds/skylit.js';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname);
const ROOT = path.join(HERE, '..', '..');
const OUT = path.join(ROOT, '..', '.cache', 'skylit_verify');
fs.mkdirSync(OUT, { recursive: true });
const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', 'replay_vs_api_sample.json'), 'utf8'));
const limit = Number(process.argv[2] ?? sample.length);
let n = 0;
for (const r of sample.slice(0, limit)) {
  const f = path.join(OUT, `${r.at.replace(/:/g, '')}.json`);
  if (fs.existsSync(f)) continue;
  const j = await historicalRaw({ symbols: 'SPXW,SPY,QQQ', at: r.at, metric: 'gamma', maxStrikes: 'all', maxExpirations: 5, layout: 'matrix', includeEmpty: true });
  fs.writeFileSync(f, JSON.stringify(j));
  n++;
  console.log(r.at, j.data.symbols.map((s) => `${s.symbol}@${s.asOf}`).join(' '), j.meta?.resolution);
}
console.log(`pulled ${n}; credits remaining ${usage.creditsRemaining}`);
