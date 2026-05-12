/**
 * JSONL event log writer.
 * Mirrors the event_log SQL table to disk so events are grep-able / openable in VS Code.
 * One file per trading day per event_type-bucket. Append-only.
 */

import { mkdirSync, createWriteStream } from 'fs';
import { join } from 'path';
import { config } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('JSONL');

const streams = new Map();

function streamFor(tradingDay, bucket) {
  const key = `${tradingDay}/${bucket}`;
  if (streams.has(key)) return streams.get(key);

  const dir = join(config.dataDir, 'events', tradingDay);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${bucket}.jsonl`);
  const s = createWriteStream(path, { flags: 'a' });
  s.on('error', err => log.error(`JSONL stream error for ${path}:`, err));
  streams.set(key, s);
  return s;
}

export function writeEvent(tradingDay, bucket, record) {
  const s = streamFor(tradingDay, bucket);
  s.write(JSON.stringify(record) + '\n');
}

export function closeAll() {
  for (const s of streams.values()) s.end();
  streams.clear();
}
