const state = {
  startedAt: new Date().toISOString(),
  lastRunAt: null,
  lastDurationMs: null,
  results: [],
  history: [],
  alerts: [],
};

const MAX_HISTORY = 50;
const MAX_ALERTS = 30;

export function getState() {
  return state;
}

export function setResults(results, durationMs) {
  state.lastRunAt = new Date().toISOString();
  state.lastDurationMs = durationMs;
  state.results = results;
  state.history.unshift({
    at: state.lastRunAt,
    durationMs,
    ok: results.every((r) => r.ok),
    summary: results.map((r) => ({
      name: r.name,
      url: r.url,
      ok: r.ok,
      status: r.status,
      error: r.error,
      failedAssets: r.assets?.failed || 0,
      totalAssets: r.assets?.total || 0,
      failedFunctional: r.functional?.failed || 0,
      totalFunctional: r.functional?.total || 0,
    })),
  });
  if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;
}

export function pushAlert(entry) {
  state.alerts.unshift({ at: new Date().toISOString(), ...entry });
  if (state.alerts.length > MAX_ALERTS) state.alerts.length = MAX_ALERTS;
}
