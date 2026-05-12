import 'dotenv/config';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const thresholdsPath = join(__dirname, '..', '..', 'config', 'calibrated_thresholds.json');

export const config = {
  clerkSessionId: process.env.CLERK_SESSION_ID || '',
  clerkClientCookie: process.env.CLERK_CLIENT_COOKIE || '',
  clerkClientUat: process.env.CLERK_CLIENT_UAT || '',

  heatseekerJwt: process.env.HEATSEEKER_JWT || '',

  tickers: (process.env.TICKERS || 'SPXW,SPY,QQQ').split(',').map(t => t.trim()).filter(Boolean),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '5000', 10),

  dataDir: resolve(process.env.DATA_DIR || './data'),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  discordBriefWebhookUrl: process.env.DISCORD_BRIEF_WEBHOOK_URL || '',
  discordTestWebhookUrl: process.env.DISCORD_TEST_WEBHOOK_URL || '',

  // Bellwether mirror — when both are set, every Discord embed and every auth
  // event is also POSTed to the Bellwether API so the /gex tab can render the
  // same content. Unset = local-only operation (current default).
  bellwetherApiUrl: (process.env.BELLWETHER_API_URL || '').replace(/\/$/, ''),
  bellwetherApiKey: process.env.BELLWETHER_API_KEY || '',
};

// Pick which webhook to post to based on a --test flag in process.argv.
// Default: live channel. With --test: test channel (replay/dev runs).
export function discordWebhookUrl() {
  const testMode = process.argv.includes('--test');
  if (testMode && config.discordTestWebhookUrl) return config.discordTestWebhookUrl;
  return config.discordBriefWebhookUrl;
}

export const thresholds = JSON.parse(readFileSync(thresholdsPath, 'utf-8'));

export function deflectionZone(ticker) {
  return thresholds.deflection_zones[ticker] ?? thresholds.deflection_zones.SPY;
}
