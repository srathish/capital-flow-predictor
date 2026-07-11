/**
 * Forecast-ensemble Phase 1a backfill — daily UW history for SPY/QQQ/SPX.
 *
 * Modes:
 *   --probe    few paced calls to verify endpoint paths, prints status only
 *   --oneshot  greek-exposure 1Y + short-vol ratio + Stooq daily OHLC (labels)
 *   --perday   market-tide + net-prem-ticks (SPY/QQQ/SPX) + darkpool (SPY)
 *              per session over the last ~250 sessions — run detached
 *   --slow     insider sector-flow pages + congress trades pages
 *
 * Output: research/forecast-ensemble/data/<family>/...
 * Caps (logged, not silent): darkpool SPY-only limit=500/day; congress
 * capped at 40 pages.
 */
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const UW = 'https://api.unusualwhales.com';
const SPACING_MS = 550;
let last = 0, backoff = 0, calls = 0;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function get(url, { auth = true } = {}) {
  for (;;) {
    const wait = Math.max(0, last + SPACING_MS - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    last = Date.now(); calls++;
    let r;
    try {
      r = await fetch(url, {
        headers: auth ? { Authorization: `Bearer ${KEY}` } : {},
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) { return { error: String(e.message || e) }; }
    if (r.status === 429) {
      backoff = backoff ? Math.min(backoff * 2, 120_000) : 15_000;
      log(`429 — backing off ${backoff / 1000}s`);
      await new Promise(rr => setTimeout(rr, backoff)); continue;
    }
    backoff = 0;
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const text = await r.text();
    try { return { data: JSON.parse(text) }; } catch { return { text }; }
  }
}

function save(family, name, obj) {
  const dir = path.join(DATA, family);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), typeof obj === 'string' ? obj : JSON.stringify(obj));
}

// trading sessions: weekdays in window (holidays yield empty payloads, fine)
function sessions(fromISO, toISO) {
  const out = [];
  for (let d = new Date(fromISO + 'T00:00:00Z'); d <= new Date(toISO + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const FROM = '2025-07-14', TO = '2026-07-10';
const TICKERS = ['SPY', 'QQQ', 'SPX'];

async function probe() {
  const tests = [
    ['greek-exposure 1W', `${UW}/api/stock/SPY/greek-exposure?timeframe=1W`],
    ['shorts volume-and-ratio', `${UW}/api/shorts/SPY/volume-and-ratio`],
    ['shorts volumes-by-exchange', `${UW}/api/shorts/SPY/volumes-by-exchange`],
    ['market-tide (old date)', `${UW}/api/market/market-tide?date=2025-07-16`],
    ['net-prem-ticks (old date)', `${UW}/api/stock/SPY/net-prem-ticks?date=2025-07-16`],
    ['darkpool ticker (old date)', `${UW}/api/darkpool/SPY?date=2025-07-16&limit=5`],
    ['insider sector-flow A', `${UW}/api/insider/Technology/sector-flow`],
    ['insider sector-flow B', `${UW}/api/insider/sector-flow?sector=Technology`],
    ['congress recent-trades', `${UW}/api/congress/recent-trades?limit=5`],
    ['ohlc daily 1Y', `${UW}/api/stock/SPY/ohlc/1d?timeframe=1Y`],
  ];
  for (const [name, url] of tests) {
    const r = await get(url);
    const size = r.data ? JSON.stringify(r.data).length : 0;
    const rows = Array.isArray(r.data?.data) ? r.data.data.length : (Array.isArray(r.data) ? r.data.length : 'n/a');
    log(`${name}: ${r.error ?? `OK bytes=${size} rows=${rows}`}`);
  }
  // Stooq (no auth)
  for (const s of ['spy.us', 'qqq.us', '^spx', '^vix']) {
    const r = await get(`https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d&d1=20250701&d2=20260711`, { auth: false });
    const lines = r.text ? r.text.trim().split('\n').length : 0;
    log(`stooq ${s}: ${r.error ?? `OK lines=${lines}`}`);
  }
}

async function oneshot() {
  for (const t of TICKERS) {
    const g = await get(`${UW}/api/stock/${t}/greek-exposure?timeframe=1Y`);
    if (g.error) log(`greeks ${t}: ${g.error}`); else { save('greeks', `${t}.json`, g.data); log(`greeks ${t}: rows=${(g.data?.data ?? g.data ?? []).length}`); }
    const s = await get(`${UW}/api/shorts/${t}/volume-and-ratio`);
    if (s.error) log(`shortvol ${t}: ${s.error}`); else { save('shortvol', `${t}.json`, s.data); log(`shortvol ${t}: ok`); }
  }
  for (const t of [...TICKERS, 'VIX']) {
    const r = await get(`${UW}/api/stock/${t}/ohlc/1d?timeframe=2Y`);
    if (r.error) log(`ohlc ${t}: ${r.error}`);
    else { save('ohlc', `${t}.json`, r.data); log(`ohlc ${t}: rows=${(r.data?.data ?? r.data ?? []).length}`); }
  }
}

async function perday() {
  const days = sessions(FROM, TO);
  log(`perday: ${days.length} candidate sessions, est calls=${days.length * 5}`);
  let wrote = 0, empty = 0, errored = 0, skipped = 0;
  for (const day of days) {
    // market tide
    const tf = path.join(DATA, 'tide', `${day}.json`);
    if (!fs.existsSync(tf)) {
      const r = await get(`${UW}/api/market/market-tide?date=${day}`);
      if (r.error) errored++;
      else if (!(r.data?.data ?? []).length) empty++;
      else { save('tide', `${day}.json`, r.data); wrote++; }
    } else skipped++;
    // net-prem-ticks per ticker
    for (const t of TICKERS) {
      const f = path.join(DATA, 'netprem', `${t}_${day}.json`);
      if (fs.existsSync(f)) { skipped++; continue; }
      const r = await get(`${UW}/api/stock/${t}/net-prem-ticks?date=${day}`);
      if (r.error) { errored++; continue; }
      const rows = r.data?.data ?? r.data ?? [];
      if (!rows.length) { empty++; continue; }
      save('netprem', `${t}_${day}.json`, rows); wrote++;
    }
    // darkpool SPY only (cap logged in header)
    const df = path.join(DATA, 'darkpool', `SPY_${day}.json`);
    if (!fs.existsSync(df)) {
      const r = await get(`${UW}/api/darkpool/SPY?date=${day}&limit=500`);
      if (r.error) errored++;
      else {
        const rows = r.data?.data ?? r.data ?? [];
        if (!rows.length) empty++; else { save('darkpool', `SPY_${day}.json`, rows); wrote++; }
      }
    } else skipped++;
    if (days.indexOf(day) % 20 === 0) log(`perday ${day}: wrote=${wrote} empty=${empty} err=${errored} skip=${skipped} calls=${calls}`);
  }
  log(`perday done: wrote=${wrote} empty=${empty} errored=${errored} skipped=${skipped} calls=${calls}`);
}

async function slow() {
  const SECTORS = ['Technology', 'Financial Services', 'Healthcare', 'Consumer Cyclical', 'Communication Services', 'Industrials', 'Energy', 'Consumer Defensive', 'Basic Materials', 'Real Estate', 'Utilities'];
  for (const sec of SECTORS) {
    const r = await get(`${UW}/api/insider/${encodeURIComponent(sec)}/sector-flow`);
    if (r.error) { log(`insider ${sec}: ${r.error}`); continue; }
    const rows = r.data?.data ?? [];
    if (rows.length) { save('insider', `${sec.replace(/ /g, '_')}.json`, rows); log(`insider ${sec}: rows=${rows.length}`); }
  }
  // congress — capped at 40 pages (logged cap)
  const ct = [];
  for (let page = 1; page <= 40; page++) {
    const r = await get(`${UW}/api/congress/recent-trades?limit=100&page=${page}`);
    if (r.error) { log(`congress p${page}: ${r.error}`); break; }
    const rows = r.data?.data ?? [];
    ct.push(...rows);
    if (rows.length < 100) break;
  }
  if (ct.length) { save('congress', 'trades.json', ct); log(`congress: rows=${ct.length} (cap 40 pages)`); }
  log(`slow done: calls=${calls}`);
}

const mode = process.argv.find(a => a.startsWith('--'))?.slice(2) ?? 'probe';
if (!KEY) { console.error('no UNUSUAL_WHALES_API_KEY in env'); process.exit(1); }
({ probe, oneshot, perday, slow })[mode]().then(() => log(`mode=${mode} finished, total calls=${calls}`));
