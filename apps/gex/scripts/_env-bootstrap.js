/**
 * Env bootstrap for standalone scripts (plays-tracker, grade-universe, etc.)
 *
 * cfp-jobs skylit-login writes Clerk cookies to
 * /Users/saiyeeshrathish/gexester vexster/.env — the historical gexester
 * repo location — but our standalone scripts run from apps/gex, so plain
 * `dotenv/config` picks up the wrong .env (or none).
 *
 * This module loads env vars from every likely location, preferring later
 * ones so a local apps/gex/.env can still override. Import it at the very
 * top of a script — BEFORE any code that reads process.env.
 *
 * Search order (later wins on collision):
 *   1. Repo root .env             (for UNUSUAL_WHALES_API_KEY etc.)
 *   2. gexester-vexster .env      (for CLERK_SESSION_ID / CLERK_CLIENT_COOKIE)
 *   3. apps/gex/.env              (explicit override if it exists)
 *   4. $ENV_FILE                  (explicit path override)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HOME = process.env.HOME || '';

const CANDIDATES = [
  path.resolve(__dirname, '..', '..', '..', '.env'),                       // repo root
  path.join(HOME, 'gexester vexster', '.env'),                             // historical gexester
  path.resolve(__dirname, '..', '.env'),                                    // apps/gex/.env
  process.env.ENV_FILE || '',
].filter(Boolean);

const loaded = [];
for (const p of CANDIDATES) {
  try {
    if (!fs.existsSync(p)) continue;
    // override:true → later files win, so an explicit apps/gex/.env or ENV_FILE
    // can override the historical gexester value.
    dotenv.config({ path: p, override: true });
    loaded.push(p);
  } catch {
    // silent — a missing/unreadable file just gets skipped
  }
}

if (process.env.DEBUG_ENV === '1') {
  console.log(`[env-bootstrap] loaded ${loaded.length} file(s):`);
  for (const p of loaded) console.log(`  · ${p}`);
  console.log(`  CLERK_SESSION_ID: ${process.env.CLERK_SESSION_ID ? '(set)' : '(unset)'}`);
  console.log(`  CLERK_CLIENT_COOKIE: ${process.env.CLERK_CLIENT_COOKIE ? '(set)' : '(unset)'}`);
  console.log(`  UNUSUAL_WHALES_API_KEY: ${(process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY) ? '(set)' : '(unset)'}`);
}
