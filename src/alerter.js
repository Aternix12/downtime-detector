import twilio from 'twilio';
import { config } from './config.js';

const lastCallAt = new Map(); // target -> ts
const consecutiveFails = new Map(); // target -> count

function canCall(target) {
  const last = lastCallAt.get(target) || 0;
  const cooldownMs = config.alertCooldownMinutes * 60 * 1000;
  return Date.now() - last >= cooldownMs;
}

export function noteResult(result) {
  const key = result.url;
  if (result.ok) {
    consecutiveFails.set(key, 0);
    return { shouldAlert: false, consecutive: 0 };
  }
  const n = (consecutiveFails.get(key) || 0) + 1;
  consecutiveFails.set(key, n);
  return {
    shouldAlert: n >= config.failureThreshold && canCall(key),
    consecutive: n,
  };
}

function buildSpokenMessage(result) {
  const host = (() => {
    try {
      return new URL(result.url).hostname;
    } catch {
      return result.url;
    }
  })();
  const reason = (result.error || 'unknown error').replace(/[<>&]/g, ' ').slice(0, 280);
  return `Aternix downtime detector alert. ${host} is failing. ${reason}. Please investigate.`;
}

export async function sendDiscord(result) {
  if (!config.discordWebhookUrl) return { skipped: true };
  const body = {
    content: `🚨 **Downtime detector**\n**URL:** ${result.url}\n**Status:** ${result.status}\n**Error:** ${result.error || 'n/a'}\n**When:** ${result.checkedAt}`,
  };
  const res = await fetch(config.discordWebhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status };
}

export async function placeAlertCall(result) {
  const { accountSid, authToken, from } = config.twilio;
  if (!accountSid || !authToken || !from || !config.alertPhone) {
    return { ok: false, error: 'Twilio not configured' };
  }

  const client = twilio(accountSid, authToken);
  const spoken = buildSpokenMessage(result);
  const twiml = `<Response><Say voice="alice">${escapeXml(spoken)}</Say><Pause length="1"/><Say voice="alice">Repeat. ${escapeXml(spoken)}</Say></Response>`;

  const call = await client.calls.create({
    to: config.alertPhone,
    from,
    twiml,
  });

  lastCallAt.set(result.url, Date.now());
  return { ok: true, sid: call.sid, status: call.status };
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, ''');
}

export function getAlertState() {
  return {
    consecutiveFails: Object.fromEntries(consecutiveFails),
    lastCallAt: Object.fromEntries(
      [...lastCallAt.entries()].map(([k, v]) => [k, new Date(v).toISOString()])
    ),
  };
}
