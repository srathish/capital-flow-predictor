// 1-min historical backfill for a single day (research only). Skylit's historical
// endpoint serves distinct 1-min frames (verified 2026-07-14, 36/36 probe) — the
// 5-min archive granularity was OUR choice, not a Skylit limit.
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { initAuth } from '../../src/heatseeker/auth.js';
import { fetchHistoricalSnapshot } from '../../src/heatseeker/client.js';

const DAY = process.argv[2] || '2026-07-14';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'backfill', DAY);
fs.mkdirSync(OUT, { recursive: true });
await initAuth();

// 09:30-16:00 ET = 13:30-20:00 UTC (summer)
const stamps = [];
for (let mins = 13*60+30; mins <= 20*60; mins++) {
  stamps.push(`${DAY}T${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}:00.000Z`);
}
for (const T of ['SPXW','SPY','QQQ']) {
  const f = path.join(OUT, `${T}.jsonl`);
  if (fs.existsSync(f + '.gz')) { console.log(`${T}: exists, skip`); continue; }
  let ok = 0, miss = 0, consecErr = 0;
  const ws = fs.createWriteStream(f);
  for (const ts of stamps) {
    try {
      const s = await fetchHistoricalSnapshot(T, ts, 3);
      if (s && s.spot != null) {
        ws.write(JSON.stringify({ requestedTs: ts, spot: s.spot,
          strikes: (s.strikes||[]).map(x => ({ strike: x.strike, gamma: x.gamma, vanna: x.vanna, relSig: x.relativeSignificance })) }) + '\n');
        ok++;
      consecErr = 0; } else miss++;
    } catch (e) { miss++; consecErr++; if (consecErr >= 15) { console.log(`${T}: aborting after 15 consecutive errors (auth guard)`); break; } }
    await new Promise(r => setTimeout(r, 280));
  }
  await new Promise(r => ws.end(r));
  fs.writeFileSync(f + '.gz', zlib.gzipSync(fs.readFileSync(f))); fs.unlinkSync(f);
  console.log(`${T}: ${ok} frames captured, ${miss} missing -> ${f}.gz`);
}
console.log('BACKFILL COMPLETE');
