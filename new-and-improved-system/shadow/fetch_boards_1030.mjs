// DESIGN_management_only.md boards: Skylit /v1/historical at 10:30 ET, SPXW+SPY+QQQ in one call, every SPY session
// 2025-05-01 → 2026-10-16. 5 credits per call through the feeds/skylit.js guard. Skips cached days.
//   SKYLIT_BUDGET=1900 SKYLIT_DAILY_CAP=2100 node shadow/fetch_boards_1030.mjs
import fs from 'node:fs';
import path from 'node:path';
import { historicalRaw, usage } from '../feeds/skylit.js';

const NIS = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..');
const OUT = path.join(NIS, '.cache', 'skylit_boards_1030'); fs.mkdirSync(OUT, { recursive: true });
const daily = JSON.parse(fs.readFileSync(path.join(NIS, '.cache', 'uw', 'daily_SPY.json'), 'utf8'));
const days = Object.keys(daily).sort().filter((d) => d >= '2025-05-01' && d <= '2026-10-16');
const atUtc = (d) => { // 10:30 America/New_York → UTC ISO
  for (const h of [14, 15]) { const t = new Date(`${d}T${h}:30:00Z`); const et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(t); if (+et === 10) return t.toISOString().replace('.000Z', 'Z'); }
  throw new Error('dst');
};
let n = 0, fail = 0;
for (const d of days) {
  const f = path.join(OUT, `${d}.json`);
  if (fs.existsSync(f)) continue;
  try {
    const j = await historicalRaw({ symbols: 'SPXW,SPY,QQQ', at: atUtc(d), metric: 'gamma', maxStrikes: 200, maxExpirations: 5, layout: 'matrix', includeEmpty: false });
    fs.writeFileSync(f, JSON.stringify(j)); n++;
  } catch (e) { fail++; console.error(d, e.message.slice(0, 160)); if (/credit guard/.test(e.message)) break; }
  if (n % 50 === 0 && n) console.log(n, d);
}
console.log(`pulled ${n}, failed ${fail}, cached total ${fs.readdirSync(OUT).length}; credits remaining ${usage.creditsRemaining}`);
