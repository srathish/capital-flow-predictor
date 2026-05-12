/**
 * Clerk JWT auto-refresh for Heatseeker API.
 *
 * Flow:
 *   1. boot:        load credentials (session_id + __client cookie) from
 *                   Postgres (skylit_credentials table). Fall back to .env
 *                   for local dev where no DB is available.
 *   2. every JWT request:
 *                   POST clerk.skylit.ai/v1/client/sessions/{sid}/tokens
 *                   using the __client cookie. Get back a fresh JWT (~60s TTL).
 *   3. on Clerk-rotated cookie:
 *                   Capture the new __client from Set-Cookie. Persist to
 *                   Postgres so the next deploy / restart loads the rotated
 *                   value instead of the stale one. Also persist to .env if
 *                   present, as a local-fallback safety net.
 *
 * Architectural change (monorepo migration): writes used to dual-post over
 * HTTP to the Bellwether API. Now that gex runs on the same Railway project
 * as the API and shares the same Postgres, we go straight to the DB via
 * src/store/pg.js — no auth hop, no network round-trip.
 */

import { config } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { updateEnvValue } from '../utils/env-persist.js';
import {
  loadSkylitCredentials,
  saveSkylitCredentials,
  writeSkylitStatus,
} from '../store/pg.js';
import { CLERK_BASE, CLERK_API_VERSION, CLERK_JS_VERSION } from './constants.js';

const log = createLogger('Auth');

let cachedJwt = null;
let cachedJwtExpiry = 0;
let currentClientCookie = null;
let currentClientUat = '';
let currentSessionId = null;
let credentialSource = 'unset';  // 'postgres' | '.env' | 'unset'

// Observability — last rotation timestamp, exposed via authStatus() so the
// Bellwether UI badge can show "cookie rotated N hours ago" instead of just
// "auth ok / auth dead".
let lastRotatedAtMs = 0;
let lastPersistResult = null;

const TOKEN_BUFFER_MS = 5_000;
// Status writes are throttled to avoid filling skylit_status with one row
// every 60s of routine JWT refreshes. State changes (rotation, persist
// failure, method change) bypass the throttle so the UI badge reacts fast.
const STATUS_THROTTLE_MS = 5 * 60 * 1000;
let lastStatusPostMs = 0;
let lastReportedMethod = null;


/**
 * Fire-and-forget Postgres write to skylit_status. Throttles routine
 * heartbeats; `force=true` for state-change events. No-op when DATABASE_URL
 * isn't set (handled inside store/pg.js).
 */
function postStatus({ method, jwtTtlSeconds, cookieRotatedAt, persistOk, persistError, sseState, note, force = false }) {
  const now = Date.now();
  if (!force && method === lastReportedMethod && now - lastStatusPostMs < STATUS_THROTTLE_MS) {
    return;
  }
  lastStatusPostMs = now;
  lastReportedMethod = method;
  writeSkylitStatus({
    method,
    jwtTtlSeconds: jwtTtlSeconds ?? null,
    cookieRotatedAt: cookieRotatedAt ? new Date(cookieRotatedAt) : null,
    persistOk: persistOk ?? null,
    persistError: persistError ?? null,
    sseState: sseState ?? null,
    note: note ?? null,
  });
}


/**
 * Async boot. Tries Postgres first; falls back to .env when:
 *   - DATABASE_URL is unset (local dev), or
 *   - the skylit_credentials row hasn't been written yet (cold cluster).
 *
 * Returns true on success, false when no credentials are available anywhere
 * (caller should log + skip the poller; gexester can't run without auth).
 */
export async function initAuth() {
  const fromDb = await loadSkylitCredentials();
  if (fromDb && fromDb.clientCookie && fromDb.sessionId) {
    currentClientCookie = fromDb.clientCookie;
    currentClientUat = fromDb.clientUat || '';
    currentSessionId = fromDb.sessionId;
    credentialSource = 'postgres';
    log.info(
      `Auth initialized from Postgres | session ${currentSessionId.slice(0, 20)}... ` +
      `(captured ${fromDb.capturedAt?.toISOString?.() ?? '?'} via ${fromDb.source})`,
    );
    return true;
  }

  // Fall back to .env. Local dev path, also a useful bootstrap mode the very
  // first time the gex service boots on Railway before the laptop daemon
  // has POSTed any cookies yet (seed those via the bootstrap script).
  currentClientCookie = config.clerkClientCookie || '';
  currentClientUat = config.clerkClientUat || '';
  currentSessionId = config.clerkSessionId || '';
  if (currentClientCookie && currentSessionId) {
    credentialSource = '.env';
    log.info(
      `Auth initialized from .env | session ${currentSessionId.slice(0, 20)}... ` +
      '(Postgres returned no row — consider migrating with the bootstrap script).',
    );
    return true;
  }

  log.warn(
    'No Clerk credentials available — Postgres skylit_credentials is empty AND ' +
    'CLERK_SESSION_ID / CLERK_CLIENT_COOKIE are unset in .env. Capture cookies ' +
    'via `cfp-jobs skylit-watch` + the /gex tab Re-auth button.',
  );
  return false;
}


export async function getFreshToken() {
  if (cachedJwt && Date.now() < cachedJwtExpiry) {
    return cachedJwt;
  }

  if (currentSessionId && currentClientCookie) {
    try {
      const token = await refreshViaClerk();
      if (token) return token;
    } catch (err) {
      log.error('Clerk refresh failed:', err.message);
    }
  }

  if (config.heatseekerJwt) {
    log.debug('Falling back to static HEATSEEKER_JWT');
    return config.heatseekerJwt;
  }

  throw new Error('No auth available — Postgres empty, .env empty, no static JWT.');
}


async function refreshViaClerk() {
  const url = `${CLERK_BASE}/v1/client/sessions/${currentSessionId}/tokens?__clerk_api_version=${CLERK_API_VERSION}&_clerk_js_version=${CLERK_JS_VERSION}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': `__client=${currentClientCookie}; __client_uat=${currentClientUat || ''}`,
      'Origin': 'https://app.skylit.ai',
      'Referer': 'https://app.skylit.ai/',
    },
    body: '',
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Clerk ${resp.status}: ${text.slice(0, 200)}`);
  }

  const setCookie = resp.headers.get('set-cookie') || '';
  if (setCookie.includes('__client=')) {
    const match = setCookie.match(/__client=([^;]+)/);
    if (match && match[1] !== currentClientCookie) {
      currentClientCookie = match[1];
      lastRotatedAtMs = Date.now();
      process.env.CLERK_CLIENT_COOKIE = match[1];
      // Persist the rotated cookie. Primary store is Postgres (so a Railway
      // redeploy survives); .env is a local-fallback safety net for dev.
      // Both run fire-and-forget so the JWT path isn't blocked on disk I/O.
      persistRotation(match[1]);
    }
  }

  const data = await resp.json();
  const jwt = data.jwt;
  if (!jwt) throw new Error('No JWT in Clerk response');

  const payload = parseJwtPayload(jwt);
  const expiresAt = payload.exp ? payload.exp * 1000 : Date.now() + 55_000;

  cachedJwt = jwt;
  cachedJwtExpiry = expiresAt - TOKEN_BUFFER_MS;

  // Throttled heartbeat — most refreshes are routine; the throttle keeps
  // skylit_status from filling up with one row every 60s.
  postStatus({
    method: 'clerk-auto-refresh',
    jwtTtlSeconds: Math.round((cachedJwtExpiry - Date.now()) / 1000),
  });
  return jwt;
}


/**
 * Write a rotated __client value to both stores. Runs async so the JWT
 * refresh return value isn't delayed. Status post is FORCED (not throttled)
 * so a persist failure shows up on the UI badge immediately.
 */
function persistRotation(newCookie) {
  // Primary store: Postgres. Fire-and-forget.
  saveSkylitCredentials({
    clientCookie: newCookie,
    clientUat: currentClientUat,
    sessionId: currentSessionId,
    source: 'gexester-rotate',
  })
    .then(result => {
      lastPersistResult = { ...result, target: 'postgres', at: Date.now() };
      if (result.ok) {
        log.info(`Clerk rotated __client cookie — saved to Postgres (session ${currentSessionId.slice(0, 16)}...)`);
      } else {
        log.warn(`Clerk rotated __client cookie — Postgres save failed: ${result.error}`);
      }
      postStatus({
        method: 'clerk-auto-refresh',
        cookieRotatedAt: lastRotatedAtMs,
        persistOk: result.ok,
        persistError: result.ok ? null : result.error,
        note: result.ok ? 'cookie rotated, saved to Postgres' : 'cookie rotated but Postgres save failed',
        force: true,
      });
    })
    .catch(err => {
      lastPersistResult = { ok: false, error: err.message, target: 'postgres', at: Date.now() };
      log.warn(`Postgres save threw: ${err.message}`);
      postStatus({
        method: 'clerk-auto-refresh',
        cookieRotatedAt: lastRotatedAtMs,
        persistOk: false,
        persistError: err.message,
        note: 'cookie rotated — Postgres save threw',
        force: true,
      });
    });

  // Best-effort secondary: update local .env if one exists. Useful for the
  // case where the operator is running gex locally without Postgres, OR for
  // operators who like having a hot-restore copy on disk. Failures here are
  // not surfaced because Postgres is the source of truth on Railway.
  updateEnvValue('CLERK_CLIENT_COOKIE', newCookie).catch(() => {});
}


function parseJwtPayload(jwt) {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return {};
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  } catch {
    return {};
  }
}


export function authStatus() {
  const hasClerk = !!(currentSessionId && currentClientCookie);
  const hasCachedJwt = !!(cachedJwt && Date.now() < cachedJwtExpiry);
  return {
    method: hasClerk ? 'clerk-auto-refresh' : config.heatseekerJwt ? 'static-jwt' : 'none',
    cachedJwtTtlSeconds: hasCachedJwt ? Math.round((cachedJwtExpiry - Date.now()) / 1000) : 0,
    lastRotatedAtMs,
    lastPersistResult,
    // Which store the boot-time credential came from. 'postgres' = healthy
    // cloud setup. '.env' = local-dev or pre-bootstrap on Railway. 'unset' =
    // boot ran but no credentials were available (gexester won't run).
    credentialSource,
  };
}
