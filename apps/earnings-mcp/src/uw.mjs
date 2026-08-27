// uw.mjs — Unusual Whales public-API client + distillation helpers shared by the
// composite research tools. Mirrors talon-copier/scanner/research/uw-research.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const BASE = 'https://api.unusualwhales.com';

// Env: prefer process env (Railway); fall back to the repo-root .env for local runs.
export function apiKey() {
  if (process.env.UNUSUAL_WHALES_API_KEY) return process.env.UNUSUAL_WHALES_API_KEY;
  for (const rel of ['../../../.env', '../../../../.env']) {
    try {
      const txt = fs.readFileSync(path.join(DIR, rel), 'utf8');
      const m = txt.match(/^UNUSUAL_WHALES_API_KEY=(.+)$/m);
      if (m) { process.env.UNUSUAL_WHALES_API_KEY = m[1].trim(); return m[1].trim(); }
    } catch { /* keep looking */ }
  }
  return null;
}

export async function uw(pathAndQuery, { timeoutMs = 20000, retries = 1 } = {}) {
  const key = apiKey();
  if (!key) throw new Error('UNUSUAL_WHALES_API_KEY is not configured');
  const url = pathAndQuery.startsWith('http') ? pathAndQuery : BASE + pathAndQuery;
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: ctl.signal });
      clearTimeout(timer);
      if (r.status === 429 && i < retries) { await new Promise((res) => setTimeout(res, 1500 * (i + 1))); continue; }
      if (!r.ok) {
        const body = (await r.text()).slice(0, 300);
        const err = new Error(`UW ${r.status} on ${pathAndQuery}: ${body}`);
        err.code = r.status;
        throw err;
      }
      return await r.json();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (e.code && e.code !== 429) throw e; // real HTTP error: don't retry
    }
  }
  throw lastErr;
}

// tolerant helpers (same shapes as uw-research.mjs)
export const rows = (j) => (Array.isArray(j) ? j : (j && (j.data || j.result || j.chains || j.states)) || []);
export const num = (x) => (x == null || x === '' ? null : Number.isFinite(+x) ? +x : null);
export const pct = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%');
export const $fmt = (x) => (x == null ? '—' : '$' + (+x).toLocaleString('en-US', { maximumFractionDigits: 2 }));
export const m$ = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + '$' + (Math.abs(x) / 1e6).toFixed(1) + 'M');
export const sum = (arr, f) => arr.reduce((a, r) => a + (f(r) || 0), 0);

// dedup + sort daily OHLC rows into a clean px series
export function pxSeries(ohlcJ) {
  const ohlc = rows(ohlcJ)
    .filter((r) => r.market_time == null || r.market_time === 'r')
    .map((r) => ({ ...r, date: String(r.date || r.market_date || '').slice(0, 10), close: num(r.close) }))
    .filter((r) => r.date && r.close != null);
  const seen = new Set();
  const px = [];
  for (const r of ohlc) if (!seen.has(r.date)) { seen.add(r.date); px.push(r); }
  px.sort((a, b) => (a.date < b.date ? -1 : 1));
  return px;
}

// earnings reactions: close-to-close move around each past report date (picks the
// larger of the report-day vs next-day move to cover pre- vs post-market timing)
export function earningsReactions(px, ernDates, today, n = 8) {
  return ernDates
    .filter((d) => d < today)
    .slice(-n)
    .map((d) => {
      const i = px.findIndex((r) => r.date >= d);
      if (i < 1) return null;
      const a = px[i - 1]?.close, b = px[i]?.close, c = px[i + 1]?.close;
      if (!a) return null;
      const r1 = b ? b / a - 1 : 0, r2 = b && c ? c / b - 1 : 0;
      return { date: d, move: Math.abs(r2) > Math.abs(r1) ? r2 : r1 };
    })
    .filter(Boolean);
}

export function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// run a list of async thunks with bounded concurrency (movers scan)
export async function pool(thunks, width = 8) {
  const out = new Array(thunks.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, thunks.length) }, async () => {
      while (i < thunks.length) {
        const k = i++;
        out[k] = await thunks[k]().catch(() => null);
      }
    })
  );
  return out;
}
