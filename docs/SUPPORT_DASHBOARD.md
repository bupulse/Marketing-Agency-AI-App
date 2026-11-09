# Support dashboard (support.bupulse.com)

The owner, 9 November 2026: a "second dashboard for technical support" with visitor analytics, the support chat,
staff accounts and server monitoring. It is the existing support app (docs/SUPPORT_CHAT.md, `app/support`), grown,
not a new app: the same `SupportAgent` rows as Admin → Live chat, so staff are never duplicated.

## Who sees what (`lib/support/roles.ts`)

| Role | Chats | Live visitors, Analytics | Stats | Server |
| --- | --- | --- | --- | --- |
| AGENT | own and unassigned | yes | no | no |
| TECH | own and unassigned | yes | no | yes |
| SUPERVISOR | all | yes | yes | yes |
| admin@bupulse.com | all | yes | yes | yes, and approves staff |

- admin@bupulse.com is the only admin. It signs in with the admin console's session (no second password).
- Staff can sign up on the dashboard. The account waits as "pending" until admin@bupulse.com approves it, in the
  dashboard or in Admin → Live chat (same rows). Invites from Admin keep working.

## Visitor analytics (one counting method everywhere)

- A unique visitor is the same IP address and the same device (phone/tablet/computer, screen size, language) on the
  same UTC day, whatever browser they open. Different phones behind one MTN/Airtel IP stay separate. The raw IP is
  never stored for plain visitors (only hashed with the daily salt); country and city are stored. People who start a
  chat keep showing their IP in the chat, as before.
- Views: live now; unique visitors by day, week and month; countries and cities; where visitors came from; most
  visited pages with time spent on each; the funnel visit → quote request → chat → sign-up → paid.
- Admin → Analytics counts the same way. Days before the switch are marked "old method" (a browser counted as a
  visitor).
- How it works: `public/t.js` sends the screen width and height, the language's first subtag and a random id per page
  view; `/api/collect` hashes daily salt + UTC day + IP + device signature (`lib/analytics/collect.ts`
  `deviceSignature`: phone/tablet/computer, screen sides rounded to 16 px, language) and marks the row
  `countMethod = "v2"`. When the page is hidden or left, a beacon to the same route sends the view id and the visible
  milliseconds; it only updates `PageView.durationMs` (capped at 30 minutes, views up to 2 hours old). The roll-up
  writes `visits_v2` per day; a day with fewer than `visits` is "old method". Queries: `lib/analytics/visitors.ts`;
  page: `app/support/(app)/analytics`.
- City: Cloudflare's `cf-ipcity`, read under the same rules as the country (`lib/platform/headers.ts` `visitorCity`).
  It only arrives when the bupulse.com zone has the free Managed Transform "Add visitor location headers" switched on
  (Cloudflare dashboard → Rules → Settings → Managed Transforms). A Rwandan address the host placed in another
  country is counted as Rwanda with no city.

## Server monitoring

- Uptime from outside: a free GitHub Actions workflow checks bupulse.com every 5 minutes, so downtime is recorded even
  when the server PC is off. Uptime % per day, week and month; outages with start, end and length.
- The server PC: CPU, memory, disk space, time since last restart, and whether the BuPulse server, tunnel and jobs
  tasks are running, reported every minute by the job loop. "Not reporting" when it stops.
- Site checks: response time of the home, pricing and login pages, database speed, errors, scheduled jobs.
- Backup servers: shown as "Not set up yet" until there is one.
- Alerts when the site goes down and when it is back: email to admin@bupulse.com, Telegram (once the bot is
  connected), and a red banner in the dashboard.

### What was built (9 November 2026)

| Part | Where |
| --- | --- |
| Server page in the support app (TECH and SUPERVISOR only, `canSeeMonitoring`; anyone else gets "not found"): status banner, uptime today / 7 days / 30 days with recent outages, the server PC, site checks, and a "Backup servers: Not set up yet" card. Refreshes every minute. | `app/support/(app)/server/page.tsx`, `components/support-app/server/`, `lib/monitor/dashboard.ts` |
| PC heartbeat: every minute the job loop posts CPU, memory, disk space (Windows drive and the repo's drive), last restart, the three tasks, node and cloudflared versions. Its own thread and its own try/catch, so it never delays or breaks the tick. Kept 7 days. | `scripts/self-host/windows/cron-loop.ps1` → `POST /api/monitor/heartbeat` (Bearer: the PC's CRON_SECRET), table `MonitorHeartbeat` |
| Outside check: GitHub Actions every 5 minutes (free, public repo) checks `/api/status` and times `/`, `/pricing`, `/login`; a failure is retried once after 60 s before it counts. | `.github/workflows/uptime.yml`, `scripts/monitor/uptime-check.mjs` → `POST /api/monitor/uptime` (Bearer: UPTIME_SECRET), table `UptimeCheck` (kept 35 days) |
| Outages: down from the last good check to the next good check when there was no good check for more than 12 minutes and something shows it was real (a failed check, the PC silent too, or 30+ minutes). A 12-30 minute gap with the PC reporting every minute is GitHub running late and is not counted. | `lib/monitor/uptime-rules.ts`, table `UptimeIncident` |
| Alerts. Down: sent by the workflow (Telegram + email through Resend to admin@bupulse.com), only when its previous run did not find the site down too (a "site-down" artifact), so a long outage sends one alert. Back up ("was down about X minutes"): sent by the server on the first good check after an outage, through the app's own Resend email and the Telegram chat connected in Admin → Settings → Lead alerts; once per outage (the outage's start is unique). Red banner on the Server page while the site looks down or the PC stopped reporting (> 3 minutes). | `scripts/monitor/uptime-check.mjs`, `lib/monitor/uptime.ts`, `lib/monitor/alerts.ts` |
| Site checks: page times (last check and 24-hour average), database answer time (now, and at the last outside check), database size, errors in the last hour / 24 hours by source, scheduled jobs. Jobs, errors and the database size come from Admin → Health's own reader (`getSystemHealth`). | `lib/monitor/dashboard.ts` |

### What the owner must set

1. **One new password, UPTIME_SECRET**, used in two places with the same value (any long random text, e.g.
   `openssl rand -hex 32`, or a password manager's 40-character password):
   - on the server: Admin → Services → custom key named `UPTIME_SECRET` (works within 30 seconds, no restart), or
     `UPTIME_SECRET` in the hosting environment;
   - on GitHub: bupulse/Marketing-Agency-AI-App → Settings → Secrets and variables → Actions → New repository secret
     `UPTIME_SECRET`.
2. **GitHub repository secrets for the "down" alert** (each one missing only switches its channel off):
   - `TELEGRAM_BOT_TOKEN`: the same bot token as in Admin → Services (from @BotFather, /mybots → API Token).
   - `TELEGRAM_CHAT_ID`: the owner's Telegram id (send any message to @userinfobot; it replies with "Id: 123456789").
     Write /start to the BuPulse bot first if you have not.
   - `RESEND_API_KEY`: a Resend API key (resend.com → API Keys; a new key with "Sending access" only is best). The
     email goes from register@bupulse.com, which is already verified.
3. Nothing to set for the PC heartbeat: it uses the PC's own cron secret. It starts after the next
   `update.ps1` on the PC, which now restarts the "BuPulse jobs" task at the end.

Uptime runs stay green even while the site is down, so GitHub sends no failure emails. A run that finds the site down
uploads a tiny "site-down" artifact (kept 1 day); the next run reads the previous run's artifacts through the GitHub
API (the workflow's own token, `actions: read`) to tell the first down run (alert) from "still down" (no alert), and
tells the server when the site is back after a down run so it sends the "back up" alert.

## Signing in and joining (built 9 November 2026)

- Sign-in page: email + password, or "Sign in with an emailed code instead" (`signInWithCode`), then the 6-digit code
  from the authenticator app. admin@bupulse.com uses the emailed code, like the admin console: its supervisor row is
  made on its first visit (`lib/support/owner.ts ensureOwnerAgent`), only while it is in ADMIN_EMAILS.
- "Ask to join" (`/join`, Turnstile + sign-up limits): a `SupportAgent` row with status `pending` (no sign-in exists,
  so it opens nothing); every admin address gets an email. Taken addresses (admin, staff, an agent, any BuPulse
  sign-in) get the same answer and nothing is written.
- Approve on the support app's Team page (admin@bupulse.com only) or in Admin → Live chat (Live chat permission):
  the usual invite email; every department until narrowed in Admin. Decline removes the row. Inviting a pending
  address from Admin approves it with the form's role and departments (one row per address).

## support.bupulse.com (one-time setup)

1. The tunnel serves support.bupulse.com from the PC: `scripts/self-host/windows/tunnel-config.ps1` (used by
   install.ps1 and update.ps1, which restarts the tunnel when the list changes).
2. DNS, once, on the PC (it holds Cloudflare's cert.pem):
   `cloudflared tunnel route dns bupulse-prod support.bupulse.com`.
3. Admin → Services → Custom keys: `SUPPORT_APP_URL` = `https://support.bupulse.com`, so invite and alert links use it.
