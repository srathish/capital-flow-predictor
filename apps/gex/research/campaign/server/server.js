/**
 * Atlas live server — serves the swing-plays UI on localhost and refreshes the
 * scan on a timer. Zero dependencies (plain node:http). Research/observation
 * only: reads data + fetches prices, never places orders, never touches the
 * live 0DTE tracker.
 *
 *   node research/campaign/server/server.js        # http://localhost:5178
 *
 * Cadence is BEGINNING-OF-DAY, not intraday: the morning cron runs
 * morning_scan.sh (refreshes flow + full funnel) and writes plays_latest.json.
 * The server just serves that file all day. Startup + the "Refresh now" button
 * do a light re-scan (funnel on the existing flow cache + live prices); set
 * ATLAS_REFRESH_MIN>0 only if you deliberately want an intraday timer.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEX = path.resolve(__dirname, '..', '..', '..');
const CAMPAIGN = path.resolve(__dirname, '..');
const PORT = Number(process.env.ATLAS_PORT || 5178);
const REFRESH_MS = Number(process.env.ATLAS_REFRESH_MIN || 0) * 60_000;  // 0 = no intraday timer (beginning-of-day only)
const DATA = path.join(__dirname, 'plays_latest.json');
const HTML = path.join(__dirname, 'index.html');

let refreshing = false, lastRefresh = null, lastError = null, lastLog = '';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: GEX });
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (out += d));
    p.on('error', reject);
    p.on('close', c => (c === 0 ? resolve(out) : reject(new Error(out.slice(-400)))));
  });
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  const t0 = Date.now();
  try {
    await run('uv', ['run', '--with', 'numpy', 'python', 'research/campaign/gen_plays.py']);
    await run('node', ['research/campaign/fetch_prices.js']);
    lastLog = await run('uv', ['run', 'python', 'research/campaign/finalize_plays.py']);
    lastRefresh = new Date().toISOString();
    lastError = null;
    console.log(`[atlas] refreshed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } catch (e) {
    lastError = e.message;
    console.error(`[atlas] refresh failed: ${e.message}`);
  } finally {
    refreshing = false;
  }
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/' || req.url === '/index.html') {
      return send(res, 200, fs.readFileSync(HTML, 'utf-8'), 'text/html; charset=utf-8');
    }
    if (req.url === '/api/plays') {
      const data = fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA, 'utf-8')) : { plays: [], watch: {} };
      return send(res, 200, JSON.stringify({ ...data, lastRefresh, refreshing, lastError }));
    }
    if (req.url === '/api/refresh' && req.method === 'POST') {
      refresh();
      return send(res, 200, JSON.stringify({ ok: true, refreshing: true }));
    }
    send(res, 404, JSON.stringify({ error: 'not found' }));
  } catch (e) {
    send(res, 500, JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => {
  const mode = REFRESH_MS > 0 ? `intraday timer ${REFRESH_MS / 60000}min` : 'beginning-of-day only (morning cron updates data)';
  console.log(`[atlas] live at http://localhost:${PORT}  (${mode})`);
  refresh();                                     // one light re-scan on startup
  if (REFRESH_MS > 0) setInterval(refresh, REFRESH_MS);
});
