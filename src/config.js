import { resolveSites } from './sites.js';

export const config = {
  port: Number(process.env.PORT || 3000),
  sites: resolveSites(process.env.TARGETS),
  // Back-compat helper for any old callers
  get targets() {
    return this.sites.map((s) => s.url);
  },
  cron: process.env.CHECK_INTERVAL_CRON || '*/2 * * * *',
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 20000),
  functionalTimeoutMs: Number(process.env.FUNCTIONAL_TIMEOUT_MS || 15000),
  functionalDelayMs: Number(process.env.FUNCTIONAL_DELAY_MS || 500),
  requestRetries: Number(process.env.REQUEST_RETRIES || 3),
  assetConcurrency: Number(process.env.ASSET_CONCURRENCY || 8),
  maxAssetFailureRatio: Number(process.env.MAX_ASSET_FAILURE_RATIO || 0),
  // Functional pages skip full asset scans by default (low cost)
  functionalCheckAssets: String(process.env.FUNCTIONAL_CHECK_ASSETS || 'false').toLowerCase() === 'true',
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
  // Browser-like UA: some Betashares edges 403 bare bots
  userAgent:
    process.env.USER_AGENT ||
    'Mozilla/5.0 (compatible; AternixDowntimeDetector/1.1; +https://downtime.aternix.com) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};
