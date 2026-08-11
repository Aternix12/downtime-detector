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
    const results = await checkAll(config.targets);
    setResults(results, Date.now() - started);

    for (const result of results) {
      const { shouldAlert, consecutive } = noteResult(result);
      if (!result.ok) {
        console.error(`[down] ${result.url} x${consecutive}: ${result.error}`);
      } else {
        console.log(
          `[ok] ${result.url} ${result.status} assets=${result.assets.ok}/${result.assets.total} ${result.ms}ms`
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
            ok: !!call.ok,
            detail: call,
            error: result.error,
          });
          console.log('alert call', call);
        } catch (err) {
          pushAlert({ type: 'call', url: result.url, ok: false, error: err.message });
          console.error('twilio call failed', err.message);
        }
      }
    }

    return { ok: true, results };
  } finally {
    running = false;
  }
}
