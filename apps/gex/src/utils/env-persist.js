/**
 * Persist single env-file key-value pairs back to disk atomically.
 *
 * Used by auth.js when Clerk rotates the __client cookie. The rotated cookie
 * is the only one that works for subsequent refreshes — if we don't persist
 * it, the next process restart loads a stale value from .env and auth fails,
 * which is the "expires every 1-2 days" symptom the operator was seeing.
 *
 * Path resolution: respects $ENV_FILE_PATH if set; otherwise uses the
 * conventional ./.env in the current working directory (matches what
 * `dotenv/config` reads at boot).
 *
 * Write strategy: read → splice → write to .env.tmp → fs.rename. The rename
 * is atomic on POSIX, so a crash mid-write can't leave a half-written .env
 * (which would brick the next boot).
 */

import { promises as fs } from 'fs';
import { resolve } from 'path';

/**
 * Resolve which .env file to update. Explicit override beats convention so
 * deployments can put the cookie store somewhere outside the repo if needed.
 */
export function envFilePath() {
  if (process.env.ENV_FILE_PATH) return resolve(process.env.ENV_FILE_PATH);
  return resolve(process.cwd(), '.env');
}

/**
 * Update a single KEY=value in the env file. Preserves every other line,
 * including comments, blanks, and unrelated entries. Appends if missing.
 *
 * Returns true on success, false on any I/O error (caller is expected to
 * keep running — auth should never fail because of a persistence problem).
 */
export async function updateEnvValue(key, value, { path = envFilePath() } = {}) {
  // Validation — only word-characters in keys, mirrors dotenv's grammar.
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
    return { ok: false, error: `invalid env key: ${key}` };
  }

  let existing = '';
  try {
    existing = await fs.readFile(path, 'utf-8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      return { ok: false, error: `read ${path}: ${err.message}` };
    }
    // Missing file is fine — we'll create it with just this key.
  }

  const lines = existing.length ? existing.split(/\r?\n/) : [];
  // Strip a single trailing empty line from the .split (we re-add at write).
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  let replaced = false;
  const out = lines.map(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (m && m[1] === key) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) out.push(`${key}=${value}`);

  const text = out.join('\n') + '\n';
  const tmp = `${path}.tmp`;
  try {
    await fs.writeFile(tmp, text, { mode: 0o600 });  // 600 — env files hold secrets
    await fs.rename(tmp, path);
    return { ok: true, path, action: replaced ? 'updated' : 'appended' };
  } catch (err) {
    // Best-effort cleanup of the half-written tmp file.
    fs.unlink(tmp).catch(() => {});
    return { ok: false, error: `write ${path}: ${err.message}` };
  }
}
