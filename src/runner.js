import { checkAll } from './checker.js';
import { noteResult, placeAlertCall, sendDiscord } from './alerter.js';
import { setResults, pushAlert } from './store.js';
import { config } from './config.js';

let running = false;

export async function runChecks({ force = false } = {}) {
  if (running) return { skipped: true, reason: 'already running' };
  running = true;
  const started = Date.now();
  try {
    const results = await checkAll(config.sites);
    setResults(results, Date.now() - started);

    for (const result of results) {
      const { shouldAlert, consecutive } = noteResult(result);
      if (!result.ok) {
        console.error(`[down] ${result.name || result.url} x${consecutive}: ${result.error}`);
      } else {
        const fn = result.functional || {};
        const tag = result.degraded ? 'degraded' : 'ok';
        console.log(
          `[${tag}] ${result.name || result.url} ${result.status} assets=${result.assets?.ok || 0}/${result.assets?.total || 0} functional=${fn.ok || 0}/${fn.total || 0} ${result.ms}ms${result.error ? ' ' + result.error : ''}`
        );
      }

      if (shouldAlert || (force && !result.ok)) {
        try {
          await sendDiscord(result);
        } catch (err) {
          console.error('discord alert failed', err.message);
        }
        try {
          const call = await placeAlertCall(result);
          pushAlert({
            type: 'call',
            url: result.url,
            name: result.name,
            ok: !!call.ok,
            detail: call,
            error: result.error,
          });
          console.log('alert call', call);
        } catch (err) {
          pushAlert({
            type: 'call',
            url: result.url,
            name: result.name,
            ok: false,
            error: err.message,
          });
          console.error('twilio call failed', err.message);
        }
      }
    }

    return { ok: true, results };
  } finally {
    running = false;
  }
}
