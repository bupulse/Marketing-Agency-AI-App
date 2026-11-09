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
