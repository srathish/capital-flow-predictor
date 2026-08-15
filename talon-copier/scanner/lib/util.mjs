// util.mjs — token-bucket rate limiter, JSON cache helpers, paths, logging.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Scanner root = talon-copier/scanner/ (this file lives in lib/).
export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function resolveFromRoot(p) {
  return path.isAbsolute(p) ? p : path.resolve(ROOT, p);
}

export function loadConfig(file = 'config.json') {
  return JSON.parse(fs.readFileSync(resolveFromRoot(file), 'utf8'));
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj, null, 1));
  return file;
}

export function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function exists(file) {
  return fs.existsSync(file);
}

// Token-bucket limiter: at most `capacity` bursts, refilling `refillPerSec`,
// with a hard `minIntervalMs` floor between acquisitions. Async, backpressuring.
export class RateLimiter {
  constructor({ capacity = 6, refillPerSec = 4, minIntervalMs = 250 } = {}) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillPerSec = refillPerSec;
    this.minIntervalMs = minIntervalMs;
    this.last = Date.now();
    this.lastAcquire = 0;
  }
  _refill() {
    const now = Date.now();
    const add = ((now - this.last) / 1000) * this.refillPerSec;
    if (add > 0) { this.tokens = Math.min(this.capacity, this.tokens + add); this.last = now; }
  }
  async acquire() {
    // enforce hard minimum spacing first
    const sinceLast = Date.now() - this.lastAcquire;
    if (sinceLast < this.minIntervalMs) await sleep(this.minIntervalMs - sinceLast);
    // then wait for a token
    for (;;) {
      this._refill();
      if (this.tokens >= 1) { this.tokens -= 1; this.lastAcquire = Date.now(); return; }
      await sleep(Math.ceil(1000 / this.refillPerSec));
    }
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// fetch with timeout + limited retries on network/5xx. Returns parsed JSON or null.
export async function fetchJson(url, { headers = {}, timeoutMs = 15000, retries = 2, method = 'GET', body = null } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 401 || r.status === 403) { const e = new Error('AUTH'); e.status = r.status; throw e; }
      if (r.status === 429 || r.status >= 500) { if (attempt < retries) { await sleep(300 * (attempt + 1)); continue; } return null; }
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      if (e.message === 'AUTH') throw e;
      if (attempt < retries) { await sleep(300 * (attempt + 1)); continue; }
      return null;
    }
  }
  return null;
}

let _quiet = false;
export function setQuiet(q) { _quiet = q; }
export function log(...a) { if (!_quiet) console.log(...a); }

// percentile rank (0..1) of `x` within sorted-or-unsorted array `arr`.
export function percentileRank(arr, x) {
  const v = arr.filter((n) => Number.isFinite(n));
  if (!v.length) return null;
  let below = 0;
  for (const n of v) if (n < x) below++;
  return below / v.length;
}

export function sum(arr, f = (x) => x) { return arr.reduce((a, b) => a + (f(b) || 0), 0); }
export function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
