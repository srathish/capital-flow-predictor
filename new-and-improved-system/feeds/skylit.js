// Skylit feeds: MCP (JSON-RPC), REST (Heatseeker/Tempest), Atlas (price).
// One key. Global throttle (120 req/min shared across hosts) + 429 backoff + credit/rate-limit logging.
import { SKYLIT_API_KEY } from './env.js';

const H = { Authorization: `Bearer ${SKYLIT_API_KEY}`, Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const usage = { calls: 0, creditsRemaining: null, rateLimitRemaining: null };
let lastCall = 0;
const MIN_GAP_MS = 540; // ~110/min, under the 120/min cap

async function gate() {
  const wait = MIN_GAP_MS - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

// ---------- CREDIT GUARD ----------
// Every billable call is checked BEFORE it is sent. Two limits (override per run with env vars):
//   SKYLIT_BUDGET     max credits this process may spend (default 50)
//   SKYLIT_DAILY_CAP  max credits ALL processes may spend per ET day (default 200), tracked in .cache/skylit_ledger.jsonl
// Costs are Skylit's published per-call prices; /v1/account is free. Exceeding a limit throws — nothing is sent.
import fs from 'node:fs';
import path from 'node:path';
const LEDGER = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..', '.cache', 'skylit_ledger.jsonl');
const BUDGET = Number(process.env.SKYLIT_BUDGET ?? 50), DAILY_CAP = Number(process.env.SKYLIT_DAILY_CAP ?? 200);
const COST = { '/v1/historical': 5, '/v1/history': 1, heat_heatmap: 1, heat_levels: 1, heat_historical_heatmap: 5, aggregate_score: 3, chain_bull_bear: 3, option_chain: 3 };
const dayET = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
const script = path.basename(process.argv[1] ?? 'repl');
export const spend = { process: 0, today: null };
function todaySpent() {
  if (spend.today != null) return spend.today;
  let t = 0; const d = dayET();
  try { for (const l of fs.readFileSync(LEDGER, 'utf8').split('\n')) { if (!l) continue; const x = JSON.parse(l); if (x.d === d) t += x.c; } } catch {}
  return (spend.today = t);
}
function charge(label, cost) {
  if (cost <= 0) return;
  if (spend.process + cost > BUDGET) throw new Error(`Skylit credit guard: ${label} would take this run to ${spend.process + cost} > SKYLIT_BUDGET=${BUDGET}. Raise SKYLIT_BUDGET for this run if intended.`);
  if (todaySpent() + cost > DAILY_CAP) throw new Error(`Skylit credit guard: ${label} would take today's total to ${todaySpent() + cost} > SKYLIT_DAILY_CAP=${DAILY_CAP}.`);
  spend.process += cost; spend.today += cost;
  try { fs.mkdirSync(path.dirname(LEDGER), { recursive: true }); fs.appendFileSync(LEDGER, JSON.stringify({ d: dayET(), at: new Date().toISOString(), script, label, c: cost }) + '\n'); } catch {}
}

async function withRetry(fn, label) {
  // Honor 429s properly: the 120/min budget is per ACCOUNT, so parallel jobs share it. Back off using Retry-After
  // when Skylit sends it, else 5s, 10s, 15s … (up to ~3 minutes total) before giving up.
  for (let attempt = 0; attempt < 10; attempt++) {
    await gate();
    usage.calls++;
    const res = await fn();
    if (res.status === 429) {
      const ra = Number(res.headers?.get?.('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 + 250 : 5000 * (attempt + 1));
      continue;
    }
    return res;
  }
  throw new Error(`${label}: rate-limited after retries`);
}

// ---------- MCP ----------
export async function mcp(name, args = {}) {
  charge(`mcp:${name}`, COST[name] ?? 1);
  const res = await withRetry(() => fetch('https://mcp.skylit.ai/mcp', {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }), `mcp:${name}`);
  const text = await res.text();
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  if (!line) throw new Error(`mcp:${name}: no data frame (${res.status})`);
  const j = JSON.parse(line.slice(5));
  const payload = j.result?.content?.[0]?.text;
  let out;
  try { out = payload ? JSON.parse(payload) : (j.result ?? j.error); } catch { out = payload ?? j.error; }
  if (typeof out === 'string') throw new Error(`mcp:${name}: ${out.slice(0, 200)}`);
  if (out?.meta) {
    if (out.meta.creditsRemaining != null) usage.creditsRemaining = out.meta.creditsRemaining;
    if (out.meta.rateLimitRemaining != null) usage.rateLimitRemaining = out.meta.rateLimitRemaining;
  }
  return out;
}

// ---------- REST ----------
async function rest(host, pathAndQuery) {
  const ep = pathAndQuery.split('?')[0]; charge(`rest:${ep}`, ep === '/v1/account' ? 0 : (COST[ep] ?? 1));
  const res = await withRetry(() => fetch(`https://${host}.skylit.ai${pathAndQuery}`, { headers: H }), `rest:${pathAndQuery.split('?')[0]}`);
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`rest ${pathAndQuery.split('?')[0]} ${res.status}: ${JSON.stringify(j?.error ?? j).slice(0, 200)}`);
  return j;
}

/** Live board(s). metric gamma|vanna. expirations='YYYY-MM-DD' isolates one column (0DTE for indices). */
export async function heatmapLive(symbols, { metric = 'gamma', expirations } = {}) {
  const args = { symbols: [].concat(symbols).join(','), metric, maxStrikes: 'all' }; // 'all' = same strike set as /v1/historical (backtests)
  if (expirations) args.expirations = expirations;
  const out = await mcp('heat_heatmap', args);
  return out.data.symbols; // [{symbol, spot, previousClose, strikes:[{strike,value,nodeType,velocityPct}], expirations[]}]
}

/** Historical board(s) at an ISO instant. 5 credits/symbol. */
export async function heatmapAt(symbols, atIso, { metric = 'gamma', expirations } = {}) {
  const q = new URLSearchParams({ symbols: [].concat(symbols).join(','), at: atIso, metric, maxStrikes: 'all' });
  if (expirations) q.set('expirations', expirations);
  const j = await rest('api', `/v1/historical?${q}`);
  return j.data.symbols; // [{symbol, spot, strikes:[{strike,value,nodeType}]}]
}

/** Classified levels + summary (flip, walls, netExposure). 1 credit. Live only. */
export async function levelsLive(symbols) {
  const out = await mcp('heat_levels', { symbols: [].concat(symbols).join(',') });
  return out.data.symbols;
}

export const tempestMarket = () => mcp('tempest_market', {});
export const expirations = (ticker, date) => mcp('expirations', date ? { ticker, date } : { ticker });
export const optionChain = (ticker, expiration, date) => mcp('option_chain', date ? { ticker, expiration, date } : { ticker, expiration });
export const aggregateScore = (ticker, timeframes = '1h,1d', date) => mcp('aggregate_score', date ? { ticker, timeframes, date } : { ticker, timeframes });

// ---------- Atlas (price) ----------
/** resolution: '1' | '60' | 'D'. from/to unix seconds. Returns bars [{t,o,h,l,c,v}] sorted. */
export async function atlasHistory(symbol, resolution, from, to) {
  const j = await rest('atlas-api', `/v1/history?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`);
  if (j?.s !== 'ok' || !j.t?.length) return [];
  return j.t.map((t, i) => ({ t, o: j.o[i], h: j.h[i], l: j.l[i], c: j.c[i], v: j.v?.[i] ?? 0 })).sort((a, b) => a.t - b.t);
}

export async function account() {
  const j = await rest('api', '/v1/account');
  return j.data;
}
