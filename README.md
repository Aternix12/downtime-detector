# downtime-detector

Coolify-hosted uptime + functional monitor for Aternix / Betashares surfaces.

## What it checks
For each site root:
- HTTP 200
- Linked JS/CSS assets respond successfully

Plus **low-cost functional checks** on significant areas:
- Key pages return 200
- Not a soft-404
- Optional title/body markers

## Default sites
- Betashares AU (`www.betashares.com.au`)
  - fund list, sample fund, super, resources, insights, education, about, contact, news, privacy
- Betashares Direct (`/direct`)
  - pricing, faq, auto-invest, account types, brokerage-free, portfolios, tools, transfers
- Betashares NZ (`www.betashares.co.nz`)
  - NZ/PIE funds, resources, insights, about, contact, fund materials, news, FAQs, privacy, stewardship
- Aternix (`www.aternix.com`)

## Politeness / rate limits
- Default check interval: every 5 minutes
- Functional path suite runs every N root checks (default 3)
- Global request gap + low asset concurrency
- Cloudflare 429/challenges are **degraded**, not outages, and never trigger phone alerts

## Alerts
On sustained *real* failure it places a Twilio voice call to Tristan (`ALERT_PHONE`).

## Endpoints
- `GET /` — status dashboard
- `GET /api/status` — JSON status
- `GET|POST /api/check` — force a check now
- `GET /healthz` — liveness

## Deploy
Coolify app on muscleman → `https://downtime.aternix.com`
