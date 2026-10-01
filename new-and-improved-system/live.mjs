#!/usr/bin/env node
// One live pass right now (read-only, no orders). Previous frame cached in .cache/ for the living-map diff.
import fs from 'node:fs';
import path from 'node:path';
import { heatmapLive, atlasHistory, usage } from './feeds/skylit.js';
import { PRICE_SYMBOL } from './map/board.js';
import { runPass } from './loop/run.js';
import { pickContract } from './execution/contract.js';
import { renderHeader, renderSymbol } from './card/render.js';
import { etToUnix, todayET } from './lib/time.js';

const symbols = (process.argv.find((a) => a.startsWith('--symbols='))?.split('=')[1] ?? 'SPXW,SPY,QQQ').split(',');
const noContract = process.argv.includes('--no-contract');
const date = todayET();
const cacheDir = path.join(path.dirname(new URL(import.meta.url).pathname), '.cache'); fs.mkdirSync(cacheDir, { recursive: true });
const cacheFile = path.join(cacheDir, `boards-${date}.json`);
const prevBoards = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : null;

const cur = await heatmapLive(symbols, { expirations: date });
const boards = Object.fromEntries(cur.map((s) => [s.symbol, s]));
const open = etToUnix(date, '09:30'), now = Math.floor(Date.now() / 1000);
const pxSyms = [...new Set(symbols.map((s) => PRICE_SYMBOL[s] ?? s))];
const bars = {}, daily = {};
for (const px of pxSyms) { bars[px] = await atlasHistory(px, '1', open, now); daily[px] = await atlasHistory(px, 'D', open - 15 * 86400, now); }

const out = runPass({ symbols, boards, prevBoards, bars, daily, date });
console.log(renderHeader({ when: new Date().toISOString(), day: out.day, tri: out.tri, usage }));
for (const sym of symbols) {
  const r = out.results[sym]; if (!r) continue;
  const contract = r.decision === 'CARD' && !noContract ? await pickContract({ symbol: sym, direction: r.direction, spot: out.ctx[sym].board.spot }) : null;
  console.log(renderSymbol(r, out.ctx[sym], contract));
}
fs.writeFileSync(cacheFile, JSON.stringify(boards));
console.log(`\ncalls ${usage.calls} · credits left ${usage.creditsRemaining ?? '?'}`);
