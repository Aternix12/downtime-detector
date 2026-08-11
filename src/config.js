function splitList(value, fallback = []) {
  if (!value || !String(value).trim()) return fallback;
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT || 3000),
  targets: splitList(process.env.TARGETS, [
    'https://www.betashares.com.au',
    'https://www.betashares.com.au/direct',
    'https://www.aternix.com',
  ]),
  cron: process.env.CHECK_INTERVAL_CRON || '*/2 * * * *',
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 20000),
  assetConcurrency: Number(process.env.ASSET_CONCURRENCY || 8),
  maxAssetFailureRatio: Number(process.env.MAX_ASSET_FAILURE_RATIO || 0),
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
    'AternixDowntimeDetector/1.0 (+https://downtime.aternix.com)',
};
