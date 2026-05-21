/**
 * Postgres client for the gex service.
 *
 * Replaces the HTTP dual-post path that gexester used when it was a separate
 * repo running on a laptop. Now that we deploy alongside the Bellwether API
 * on Railway, both services share the same Postgres — direct INSERTs are
 * cheaper, atomic, and eliminate the API key handshake.
 *
 * Connection model:
 *   - Lazy pool, opened on first use.
 *   - DATABASE_URL must be set; if absent we degrade gracefully (writes
 *     no-op, reads return null) so the service can still run locally with
 *     just SQLite for the per-strike snapshot data.
 *   - All writes are best-effort. The data pipeline never awaits a DB write
 *     on the critical path — Discord posts and snapshot ingestion stay fast
 *     even when Postgres is slow or down.
 */

import pg from 'pg';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Pg');
const { Pool } = pg;

let _pool = null;
let _poolDisabledReason = null;

function getPool() {
  if (_poolDisabledReason) return null;
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL || '';
  if (!url) {
    _poolDisabledReason = 'DATABASE_URL not set';
    log.warn('Postgres disabled — DATABASE_URL not set. Briefs/alerts will post to Discord only.');
    return null;
  }
  _pool = new Pool({
    connectionString: url,
    // Railway TLS is required on production; sslmode=require is in the URL
    // when applicable. The pg lib reads it; no extra config needed here.
    max: 4,                          // small — single-process service, low concurrency
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  _pool.on('error', err => {
    // Don't crash — let in-flight queries fail individually.
    log.warn(`pg pool error: ${err.message}`);
  });
  log.info('Postgres pool initialized.');
  return _pool;
}

/**
 * Read the current skylit credential. Returns null when:
 *   - DATABASE_URL isn't set (local dev fallback to .env)
 *   - The table is empty (no one has captured cookies yet)
 *   - Any DB error occurs (caller falls back to .env)
 */
export async function loadSkylitCredentials() {
  const pool = getPool();
  if (!pool) return null;
  try {
    const res = await pool.query(
      'SELECT client_cookie, client_uat, session_id, captured_at, source ' +
      'FROM skylit_credentials WHERE id = 1'
    );
    if (res.rowCount === 0) {
      log.info('skylit_credentials empty — no cookies in Postgres yet.');
      return null;
    }
    const r = res.rows[0];
    return {
      clientCookie: r.client_cookie,
      clientUat: r.client_uat || '',
      sessionId: r.session_id,
      capturedAt: r.captured_at,
      source: r.source,
    };
  } catch (e) {
    log.warn(`loadSkylitCredentials failed: ${e.message}`);
    return null;
  }
}

/**
 * Upsert the current skylit credential. Called by gexester when the __client
 * cookie rotates mid-session. The skylit-watch laptop daemon writes here too
 * via the Bellwether API endpoint.
 */
export async function saveSkylitCredentials({ clientCookie, clientUat, sessionId, source }) {
  const pool = getPool();
  if (!pool) return { ok: false, error: 'pg disabled' };
  try {
    await pool.query(
      `INSERT INTO skylit_credentials (id, client_cookie, client_uat, session_id, captured_at, source)
       VALUES (1, $1, $2, $3, NOW(), $4)
       ON CONFLICT (id) DO UPDATE SET
         client_cookie = EXCLUDED.client_cookie,
         client_uat    = EXCLUDED.client_uat,
         session_id    = EXCLUDED.session_id,
         captured_at   = EXCLUDED.captured_at,
         source        = EXCLUDED.source`,
      [clientCookie, clientUat || '', sessionId, source || 'unknown'],
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Return the set of `gex_feed.title` values already posted today for the
 * given source (e.g. 'monitor'). Used by intraday-monitor.js to skip
 * checkpoints it already wrote on a previous tick — otherwise every
 * 30-min scheduler firing would re-post every prior checkpoint of the
 * session, surfacing as a flood of "catch-up" badges in the UI.
 *
 * etDay must be a `YYYY-MM-DD` string in NYSE trading-day calendar; we
 * match it inside the title (which the monitor stamps as "📈 YYYY-MM-DD · HH:MM ET").
 */
export async function loadPostedTitlesForDay(etDay, source) {
  const pool = getPool();
  if (!pool) return new Set();
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT title FROM gex_feed
       WHERE source = $1
         AND title LIKE $2
         AND ts >= NOW() - INTERVAL '36 hours'`,
      [source, `%${etDay}%`],
    );
    return new Set(rows.map(r => r.title).filter(Boolean));
  } catch (e) {
    log.warn(`loadPostedTitlesForDay failed: ${e.message}`);
    return new Set();
  }
}

/**
 * Mirror one Discord embed into gex_feed. This is the new path for what
 * webhook.mirrorToBellwether used to do over HTTP — direct INSERT, no auth
 * dance. Best-effort: rejections are logged at the call site, never thrown.
 */
export async function writeGexFeed({ source, title, description, fields, color, footer, tickers, raw }) {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO gex_feed (source, title, description, fields, color, footer, tickers, raw)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb)`,
      [
        source || 'other',
        title ?? null,
        description ?? null,
        JSON.stringify(fields || []),
        color ?? null,
        footer ?? null,
        tickers || [],
        raw ? JSON.stringify(raw) : null,
      ],
    );
  } catch (e) {
    log.warn(`writeGexFeed failed: ${e.message}`);
  }
}

/**
 * Append one row to skylit_status. Same observability semantics as the HTTP
 * /v1/skylit/status endpoint — keeps history, not a single-row store, so we
 * can audit "what was going on at 14:00 when the cookie stopped rotating?".
 */
export async function writeSkylitStatus({ method, jwtTtlSeconds, cookieRotatedAt, persistOk, persistError, sseState, note }) {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO skylit_status
         (method, jwt_ttl_seconds, cookie_rotated_at, persist_ok, persist_error, sse_state, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        method,
        jwtTtlSeconds ?? null,
        cookieRotatedAt ? new Date(cookieRotatedAt) : null,
        persistOk ?? null,
        persistError ?? null,
        sseState ?? null,
        note ?? null,
      ],
    );
  } catch (e) {
    log.warn(`writeSkylitStatus failed: ${e.message}`);
  }
}

/**
 * Append one row to skylit_structures. The Python skylit_bridge reads the
 * most recent row per ticker via:
 *   SELECT structure FROM skylit_structures
 *   WHERE ticker = $1 AND fetched_at > NOW() - INTERVAL '15 minutes'
 *   ORDER BY fetched_at DESC LIMIT 1
 *
 * `structure` is the full payload from scripts/structure-snapshot.js — the
 * top-level surface fields plus the `expiry_views` array. Stored as JSONB so
 * we don't have to flatten the term-structure shape into columns.
 */
export async function writeSkylitStructure({ ticker, fetchedAt, spot, expiration, structure }) {
  const pool = getPool();
  if (!pool) return { ok: false, error: 'no DATABASE_URL' };
  try {
    await pool.query(
      `INSERT INTO skylit_structures (ticker, fetched_at, spot, expiration, structure)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (ticker, fetched_at) DO UPDATE SET
         spot = EXCLUDED.spot,
         expiration = EXCLUDED.expiration,
         structure = EXCLUDED.structure`,
      [
        ticker,
        fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt || Date.now()),
        spot ?? null,
        expiration ?? null,
        JSON.stringify(structure),
      ],
    );
    return { ok: true };
  } catch (e) {
    log.warn(`writeSkylitStructure failed for ${ticker}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/**
 * Graceful shutdown — let connections drain. Called from src/index.js SIGINT
 * handler so a Railway redeploy doesn't leave dangling pool connections.
 */
/**
 * Read back the set of (date, event) pairs that already produced a row in
 * gex_feed for the given ET trading day. Used by schedule.js on boot to
 * avoid refiring the brief or already-fired monitor slots after a restart.
 *
 * Returns a list of strings like ["2026-05-13:brief", "2026-05-13:monitor:09:31"].
 * The slot for monitor is parsed from the embed title "📈 YYYY-MM-DD · HH:MM ET".
 */
export async function loadFiredEventsForDay(etDay) {
  const pool = getPool();
  if (!pool) return [];
  try {
    const rows = await pool.query(
      `SELECT source, title FROM gex_feed
       WHERE source IN ('brief', 'monitor')
         AND title LIKE '%' || $1 || '%'
       ORDER BY created_at DESC
       LIMIT 200`,
      [etDay],
    );
    const fired = new Set();
    for (const r of rows.rows) {
      if (r.source === 'brief') {
        fired.add(`${etDay}:brief`);
      } else if (r.source === 'monitor') {
        // Title shape: "📈 2026-05-13 · 09:31 ET"
        const m = (r.title || '').match(/(\d{4}-\d{2}-\d{2})\s*[·\.]\s*(\d{2}:\d{2})\s*ET/);
        if (m && m[1] === etDay) {
          fired.add(`${etDay}:monitor:${m[2]}`);
        }
      }
    }
    return [...fired];
  } catch (e) {
    log.warn(`loadFiredEventsForDay failed: ${e.message}`);
    return [];
  }
}


export async function closePg() {
  if (_pool) {
    try { await _pool.end(); } catch (e) { log.warn(`pg pool close: ${e.message}`); }
    _pool = null;
  }
}
