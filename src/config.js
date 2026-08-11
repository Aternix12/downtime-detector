import { resolveSites } from './sites.js';

export const config = {
  port: Number(process.env.PORT || 3000),
  sites: resolveSites(process.env.TARGETS),
  get targets() {
    return this.sites.map((s) => s.url);
  },
  // Default every 5 minutes — Direct is Cloudflare-sensitive
  cron: process.env.CHECK_INTERVAL_CRON || '*/5 * * * *',
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 20000),
  functionalTimeoutMs: Number(process.env.FUNCTIONAL_TIMEOUT_MS || 15000),
  // Polite delay between functional page hits
  functionalDelayMs: Number(process.env.FUNCTIONAL_DELAY_MS || 1500),
  // Run functional path suite every N root checks (1 = every time)
  functionalEveryN: Math.max(1, Number(process.env.FUNCTIONAL_EVERY_N || 3)),
  requestRetries: Number(process.env.REQUEST_RETRIES || 2),
  // Low concurrency to avoid CF bans while still scanning assets
  assetConcurrency: Number(process.env.ASSET_CONCURRENCY || 3),
  // Small pause between asset batches/requests
  assetDelayMs: Number(process.env.ASSET_DELAY_MS || 120),
  // Global minimum spacing between outbound requests
  minRequestGapMs: Number(process.env.MIN_REQUEST_GAP_MS || 150),
  maxAssetFailureRatio: Number(process.env.MAX_ASSET_FAILURE_RATIO || 0),
  functionalCheckAssets: String(process.env.FUNCTIONAL_CHECK_ASSETS || 'false').toLowerCase() === 'true',
  // Treat Cloudflare rate limits as degraded, never page/call
  rateLimitIsDegraded: String(process.env.RATE_LIMIT_IS_DEGRADED || 'true').toLowerCase() !== 'false',
  alertCooldownMinutes: Number(process.env.ALERT_COOLDOWN_MINUTES || 30),
  failureThreshold: Number(process.env.FAILURE_THRESHOLD || 2),
  alertPhone: process.env.ALERT_PHONE || '+61476977380',
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    from: process.env.TWILIO_FROM_NUMBER || '+61343279233',
  },
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
  dashboardUser: process.env.DASHBOARD_USER || '',
  dashboardPass: process.env.DASHBOARD_PASS || '',
  userAgent:
    process.env.USER_AGENT ||
    'Mozilla/5.0 (compatible; AternixDowntimeDetector/1.2; +https://downtime.aternix.com) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};
