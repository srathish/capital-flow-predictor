// Skylit historical boards for SPXW + SPY at 9 instants on 2026-11-05 (EST = UTC−5). ~90 credits.
import fs from 'node:fs';
import { heatmapAt, account, usage } from '../../feeds/skylit.js';
const times = ['09:35', '10:00', '10:30', '11:00', '11:30', '12:30', '13:30', '14:30', '15:30'];
const before = await account().catch(() => null);
const out = {};
for (const t of times) { const [h, m] = t.split(':').map(Number); const iso = `2026-11-05T${String(h + 5).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
  out[t] = await heatmapAt(['SPXW', 'SPY'], iso); process.stdout.write(t + ' '); }
fs.writeFileSync(new URL('./skylit_2026_11_05.json', import.meta.url), JSON.stringify(out));
const after = await account().catch(() => null);
console.log('\ncredits before', JSON.stringify(before)?.slice(0, 120), '| after', usage.creditsRemaining);
