/**
 * Feed poster — writes embeds to Postgres (for the Bellwether /gex UI tab) and,
 * optionally, mirrors them to Discord if a webhook URL is configured.
 *
 * Discord is no longer the primary surface — the UI is. The original gexester
 * design routed everything through Discord webhooks, but now that the same
 * data lands in gex_feed and is rendered live in the /gex tab, Discord is
 * opt-in legacy support. Set DISCORD_BRIEF_WEBHOOK_URL in env if you still
 * want the messages pinged to a channel; leave it unset for UI-only mode.
 *
 * The function name and shape stay as `postEmbed` so brief / monitor /
 * scanner callers don't change — they're still posting "Discord-shaped"
 * embeds, we just route them differently now.
 *
 * Discord limits (still respected when the webhook IS set, since exceeding
 * them rejects the post):
 *   - 256 chars per embed title / field name
 *   - 1024 chars per field value
 *   - 4096 chars per embed description
 *   - 25 fields per embed
 */

import { config, discordWebhookUrl } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { writeGexFeed } from '../store/pg.js';

const log = createLogger('Webhook');

const COLOR = {
  positive: 0x22c55e,
  negative: 0xef4444,
  neutral:  0x6b7280,
  warning:  0xf59e0b,
  default:  0x4f46e5,
};

function trim(s, n) {
  if (s == null) return '';
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Tickers we care about for feed parsing. Extracts from title + description +
// field text so the UI can filter "show me everything about SPY today".
const _TICKER_RE = /\b(SPY|QQQ|SPX|SPXW|ES)\b/g;

function extractTickers(embed) {
  const seen = new Set();
  const blobs = [embed.title || '', embed.description || ''];
  for (const f of embed.fields || []) {
    blobs.push(f.name || '', f.value || '');
  }
  for (const blob of blobs) {
    for (const m of blob.matchAll(_TICKER_RE)) {
      const t = m[1] === 'SPX' ? 'SPXW' : m[1];  // normalize
      seen.add(t);
    }
  }
  return [...seen];
}


/**
 * Post one embed to Discord. Optional `source` ('brief' | 'monitor' | 'scanner'
 * | 'decision' | 'structure' | 'other') tags the Postgres mirror so the UI
 * can filter the feed. Defaults to 'other' for callers that haven't been
 * updated.
 */
export async function postEmbed({ url, title, description, fields, color = COLOR.default, footer, source = 'other' }) {
  // Shape the embed once; reused for Postgres + (optional) Discord.
  const embed = {
    title: trim(title, 256),
    description: trim(description, 4000),
    color,
    timestamp: new Date().toISOString(),
    fields: (fields || []).slice(0, 25).map(f => ({
      name: trim(f.name || '​', 256),
      value: trim(f.value || '​', 1024),
      inline: !!f.inline,
    })),
    footer: footer ? { text: trim(footer, 2048) } : undefined,
  };

  // Primary surface: the Bellwether /gex tab via Postgres. Awaited so the
  // caller gets backpressure if Postgres is genuinely slow — the brief and
  // monitor only fire once every 30 minutes, so a 1s DB write is fine.
  await writeGexFeed({
    source,
    title: embed.title,
    description: embed.description,
    fields: embed.fields,
    color: embed.color,
    footer: embed.footer?.text || null,
    tickers: extractTickers(embed),
  });

  // Optional secondary: Discord webhook. Skip entirely if no URL is
  // configured — the UI is the primary surface now. Don't await; a slow or
  // failing Discord shouldn't delay the next brief/monitor cycle.
  const webhook = url || discordWebhookUrl();
  if (!webhook) return;
  fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
    signal: AbortSignal.timeout(5_000),
  })
    .then(res => {
      if (!res.ok) {
        return res.text().catch(() => '').then(t =>
          log.warn(`Discord webhook ${res.status}: ${t.slice(0, 200)}`));
      }
    })
    .catch(err => log.warn(`Discord webhook failed (UI mirror succeeded): ${err.message}`));
}


// Legacy exports — were used by the HTTP dual-post path from the standalone
// era. Kept as no-op stubs so any straggler imports don't crash. Remove after
// one release once we confirm nothing imports them.
export async function mirrorToBellwether(_args) {
  // intentionally empty — replaced by direct writeGexFeed in postEmbed
}
export async function reportSkylitStatus(_payload) {
  // intentionally empty — replaced by direct writeSkylitStatus call in auth.js
}


export const COLORS = COLOR;
