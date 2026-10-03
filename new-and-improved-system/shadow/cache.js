// Disk cache for everything a replay touches, so a week costs credits once and every re-run is free.
import fs from 'node:fs';
import path from 'node:path';
import { heatmapAt, atlasHistory } from '../feeds/skylit.js';
import { contractMinuteBars } from '../feeds/uw.js';
import { etToUnix, iso } from '../lib/time.js';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..', '.cache');
const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); return v; };
// OFFLINE=1: cache misses return null/[] WITHOUT fetching or writing (no credits, never caches an empty rate-limited reply).
const OFFLINE = process.env.OFFLINE === '1';
export const stats = { boardFetch: 0, boardHit: 0, barFetch: 0, optFetch: 0, optHit: 0 };

/** 0DTE boards for all symbols at ET hh:mm on date (one multi-symbol call), keyed by symbol. */
export async function boardsAt(symbols, date, hhmm) {
  const f = path.join(ROOT, 'boards', date, `${hhmm.replace(':', '')}.json`);
  const hit = read(f);
  if (hit && symbols.every((s) => hit[s])) { stats.boardHit++; return hit; }
  stats.boardFetch++;
  const arr = await heatmapAt(symbols, iso(etToUnix(date, hhmm)), { expirations: date });
  return write(f, Object.fromEntries(arr.map((s) => [s.symbol, s])));
}

/** Atlas bars for a symbol over a day (1-min RTH) or a daily lookback. */
export async function minuteBars(px, date) {
  const f = path.join(ROOT, 'bars', date, `${px}.json`);
  const hit = read(f); if (hit) return hit;
  if (OFFLINE) return [];
  stats.barFetch++;
  return write(f, await atlasHistory(px, '1', etToUnix(date, '09:30'), etToUnix(date, '16:00')));
}
export async function dailyBars(px, date) {
  const f = path.join(ROOT, 'bars', date, `${px}_daily.json`);
  const hit = read(f); if (hit) return hit;
  stats.barFetch++;
  const t = etToUnix(date, '09:30');
  return write(f, await atlasHistory(px, 'D', t - 20 * 86400, t + 86400));
}

/** Real option contract 1-min bars (UW), cached per contract+date. */
export async function optionBars(id, date) {
  const f = path.join(ROOT, 'options', date, `${id}.json`);
  const hit = read(f); if (hit) { stats.optHit++; return hit; }
  if (OFFLINE) return [];
  stats.optFetch++;
  return write(f, await contractMinuteBars(id, date));
}
