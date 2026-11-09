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
