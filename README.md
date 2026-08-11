# downtime-detector

Coolify-hosted uptime monitor for Aternix.

## What it checks
- Target URL returns HTTP 200
- Linked JS and CSS assets respond successfully (no hard errors / non-2xx)
- Optional console-free static asset validation from HTML

## Alerts
On sustained failure it places a Twilio voice call to Tristan (`ALERT_PHONE`).

## Targets (default)
- https://www.betashares.com.au
- https://www.betashares.com.au/direct
- https://www.aternix.com

## Endpoints
- `GET /` — status dashboard
- `GET /api/status` — JSON status
- `GET /api/check` — force a check now
- `GET /healthz` — liveness

## Deploy
Coolify app on muscleman → `https://downtime.aternix.com`
