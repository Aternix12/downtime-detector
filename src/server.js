import express from 'express';
import cron from 'node-cron';
import { config } from './config.js';
import { getState } from './store.js';
import { runChecks } from './runner.js';
import { getAlertState } from './alerter.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

function basicAuth(req, res, next) {
  if (!config.dashboardUser || !config.dashboardPass) return next();
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="downtime"');
    return res.status(401).send('Auth required');
  }
  const decoded = Buffer.from(header.slice(6), 'base64').toString();
  const [user, pass] = decoded.split(':');
  if (user === config.dashboardUser && pass === config.dashboardPass) return next();
  res.set('WWW-Authenticate', 'Basic realm="downtime"');
  return res.status(401).send('Auth required');
}

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'downtime-detector' });
});

app.get('/api/status', basicAuth, (_req, res) => {
  const state = getState();
  res.json({
    ...state,
    config: {
      targets: config.targets,
      cron: config.cron,
      failureThreshold: config.failureThreshold,
      alertCooldownMinutes: config.alertCooldownMinutes,
      alertPhone: config.alertPhone,
      twilioConfigured: !!(config.twilio.accountSid && config.twilio.authToken),
    },
    alertState: getAlertState(),
  });
});

app.post('/api/check', basicAuth, async (req, res) => {
  const forceAlert = String(req.query.forceAlert || '') === '1';
  const out = await runChecks({ force: forceAlert });
  res.json(out);
});

app.get('/api/check', basicAuth, async (req, res) => {
  const forceAlert = String(req.query.forceAlert || '') === '1';
  const out = await runChecks({ force: forceAlert });
  res.json(out);
});

app.use(basicAuth, express.static(path.join(__dirname, '../public')));

app.get('/', basicAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

if (!cron.validate(config.cron)) {
  console.error('Invalid CHECK_INTERVAL_CRON', config.cron);
  process.exit(1);
}

cron.schedule(config.cron, () => {
  runChecks().catch((err) => console.error('scheduled check failed', err));
});

app.listen(config.port, () => {
  console.log(`downtime-detector listening on :${config.port}`);
  console.log(`targets: ${config.targets.join(', ')}`);
  console.log(`cron: ${config.cron}`);
  // initial check shortly after boot
  setTimeout(() => {
    runChecks().catch((err) => console.error('boot check failed', err));
  }, 3000);
});
