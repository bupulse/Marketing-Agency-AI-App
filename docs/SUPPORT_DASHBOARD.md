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
| PC heartbeat: every minute the job loop posts CPU, memory, disk space (Windows drive and the repo's drive), last restart, the three tasks, node and cloudflared versions. Its own thread and its own try/catch, so it never delays or breaks the tick. Kept 30 days. | `scripts/self-host/windows/cron-loop.ps1` → `POST /api/monitor/heartbeat` (Bearer: the PC's CRON_SECRET), table `MonitorHeartbeat` |
| Outside check: GitHub Actions every 5 minutes (free, public repo) checks `/api/status` and times `/`, `/pricing`, `/login`; a failure is retried once after 60 s before it counts. | `.github/workflows/uptime.yml`, `scripts/monitor/uptime-check.mjs` → `POST /api/monitor/uptime` (Bearer: UPTIME_SECRET), table `UptimeCheck` (kept 35 days) |
| Outages: down from the last good check to the next good check when there was no good check for more than 12 minutes and something shows it was real (a failed check, the PC silent too, or 30+ minutes). A 12-30 minute gap with the PC reporting every minute is GitHub running late and is not counted. | `lib/monitor/uptime-rules.ts`, table `UptimeIncident` |
| Alerts. Down: sent by the workflow (Telegram + email through Resend to admin@bupulse.com), only when its previous run succeeded, so a long outage sends one alert. Back up ("was down about X minutes"): sent by the server on the first good check after an outage, through the app's own Resend email and the Telegram chat connected in Admin → Settings → Lead alerts; once per outage (the outage's start is unique). Red banner on the Server page while the site looks down or the PC stopped reporting (> 3 minutes). | `scripts/monitor/uptime-check.mjs`, `lib/monitor/uptime.ts`, `lib/monitor/alerts.ts` |
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

GitHub emails the account that last edited a scheduled workflow when a run fails, and an uptime run fails while the
site is down (that is how the next run knows the alert was sent). To get only BuPulse's one alert per outage, turn
off GitHub's Actions emails: github.com → Settings → Notifications → System → Actions.
