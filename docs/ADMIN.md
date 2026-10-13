# Admin console (`/admin`)

The addresses in `ADMIN_EMAILS` (comma-separated, default `admin@bupulse.com`) are the **Owner**: every permission. Staff added under Organisation sign in the same way (email, emailed code, authenticator) and get their role's permissions. Everyone else, and signed-out visitors, get a 404. Everyone needs an authenticator-app code (Supabase MFA, AAL2) on every sign-in. Every page, route and server action checks the **permission** it needs (`requirePermission`, `isAdminSession(permission)`, `adminAction(permission)`), not just "is admin": without it the answer is the same 404. Money actions run only after the owner clicks Approve (see `docs/JARVIS.md`).

## Map

The sidebar groups the pages into folders; the files live in matching route groups under `app/admin/(console)/`, so URLs never changed. The map itself is `components/admin/nav.ts`: the sidebar, the breadcrumbs and the search read it, and `tests/admin-console/nav.test.ts` fails when a page is missing from it.

| Folder | Page | URL | What it is for |
| --- | --- | --- | --- |
| | Overview | `/admin` | Today and this month: to-dos, MRR, revenue (month and lifetime), costs, profit, clients by state, AI spend vs the cap, errors in 24 h. |
| | Inbox | `/admin/inbox` | Everything waiting for a person: payments to confirm, approvals, demos, plan requests, invoices to check, accepted unpaid offers, contests waiting for the client, region mismatches, errors. |
| Sales | My clients, Sales team, Leaderboard | `/admin/sales`, `/admin/sales/team`, `/admin/sales/leaderboard` | An agent's own clients (contact, plan, trial days left, last sign-in, posts, payment status) and referral link; every agent and reassigning; this month's sales per agent. |
| Clients | Companies, Users | `/admin/companies`, `/admin/users` | Find a company or person; open one for users, usage and actions. |
| | Client health | `/admin/client-health` | Inactive 7 days, trial ending in 3 days, past due, low usage, waiting for a demo; one-click WhatsApp and email. |
| | Usage per client | `/admin/usage` | Texts, images, video seconds, voice characters, chat this period; AI cost this month vs what they pay; margin. |
| | Demos, Plan requests, Connections | `/admin/demos`, `/admin/requests`, `/admin/connections` | |
| Money | Revenue and profit | `/admin/revenue` | Revenue by month (card, Mobile Money, invoices; RWF and the rate used), lifetime revenue from every client ever, MRR, ARPU, churn, profit per month, plan and client. |
| | Costs | `/admin/costs` | Provider bills, recurring costs (hosting, domain, subscriptions), one-month costs; estimate vs billed. |
| | Payments, Invoices, Offers, Plans and prices, Add-on prices, Regions | `/admin/payments` ... `/admin/settings/regions` | |
| Content | Content performance, Funnels, Design library, Music library, Industries, Announcements | | |
| AI and usage | AI calls and spend, Approvals, Jarvis | `/admin/ai`, `/admin/approvals`, `/admin/jarvis` | |
| System | Health, Services, Errors, Live activity, Audit log, Feature flags, Settings, Updates | | |
| Organisation | Staff, Roles, Sales screen | `/admin/organisation`, `/admin/organisation/roles`, `/admin/organisation/screen` | Invite staff with a role, disable and remove; custom roles; the sales room TV links and sounds. |

- **Overview** starts with "Waiting for approval" (each Mobile Money payment with its screenshot, company, amount, reference and time; Approve and Reject with a reason in place, the same audited actions as Payments), "Today's payments" (who, how much, how, when, which agent) and "What happened today" (sign-ups, demos, trials, payments, cancellations, plan requests as plain sentences). Each section shows only to someone with its permission; someone without the Overview opens their first allowed page.
- **Search:** Cmd+K (Mac) or Ctrl+K anywhere, or the Search button: any page by name, folder or keyword, and any company by name or member email (`/admin/search`, same admin gate).
- **Folders** fold with a click; the choice is remembered in this browser only. The folder of the page you are on stays open. A folded folder shows the sum of its badges.
- **Badges:** Inbox (all to-dos), Payments, Approvals, Plan requests, Errors (24 h), Health.
- Every page has a one-line explanation under its title, tables keep their header in view while scrolling, and every page shows an empty state when there is no data yet.

## Money

All money is shown in USD, by Kigali month and day (`lib/time/kigali.ts`: Money, Overview, the leaderboard, the sales screen and the AI budget all use it; the analytics roll-up keeps UTC days); RWF amounts are converted at the rate fixed when a payment was confirmed (Revenue) or at the rate in Settings on the day an RWF recurring cost or bill was saved (kept with it, so a rate change never restates past months). The back-fill of old hand-paid invoices used the rate in force when the migration ran (no rate history exists) and skips currencies other than USD and RWF. Code: `lib/money/` (pure rules in `costs-shared.ts` and `revenue-shared.ts`, tested in `tests/money/`).

- **Revenue** is every `BillingEvent` that is money, ever (read newest first; past 200,000 events the oldest are left out and the page says so). Each payment and each refund counts once (`pay:<id>`, `refund:<id>`). That table has no foreign key, so clients who left or deleted their account still count. Card: Paddle's payout after tax and fees, less approved refunds. Mobile Money: confirmed MTN or Airtel payments. Invoices: payments of an invoice, and plain invoices marked paid by hand (`invoice.paid_manual`, written since this build and back-filled by migration `20261017200000_admin_money`).
- **MRR:** each paying client (active or past due, not trial) at their plan's monthly price; a Mobile Money client at what they last paid for a whole period (a prorated "add to current plan" payment counts as revenue, but changes MRR only from the next renewal); yearly a twelfth. **ARPU** = MRR / paying clients. **Churn (30 days):** clients who had paid and stopped in the last 30 days, out of those paying now plus them; the stop date is the end of the paid period after a cancel or expiry, else (deleted account) the last payment plus the period it bought.
- **Costs** per month: for each AI or voice provider, its real bill when entered under Costs, Provider bills (it then replaces the estimate everywhere), otherwise the AI ledger's estimate, marked "estimate"; plus recurring costs (a yearly one counts a twelfth a month) and one-month costs. Presets fill the form for Cloudflare Workers, Netlify, Supabase, the domain, ElevenLabs, Google Workspace, email and GitHub; check the amount against the invoice.
- **Profit** = revenue - all costs. The Overview, Revenue and profit, the analytics roll-up (Jarvis) and Usage per client use the same numbers.
- The money report is cached 60 seconds per server; a cost write clears it, a new payment shows within a minute.
- Every cost write (add, change, stop, delete a recurring cost; save or delete a bill) is audited.
- **Enter the bills** at the start of each month for the month before: the Costs page shows "Estimated part" in red until then.

Why the AI estimate can differ from Google's bill, and what is done about it: `docs/AI_COSTS.md`.

## Organisation

- **Roles** (`lib/staff/permissions.ts`): Owner (everything), Sales manager, Sales agent, Finance, Support / client success, Marketing, IT, Content team, plus custom roles (a name and ticked permissions). Permissions are areas (pages) and actions: approve payments (Owner and Finance), decide money requests, reassign clients (Owner and Sales manager), manage staff (Owner and IT), manage the sales screen (Owner).
- **Inviting** (Organisation, Staff; needs "manage staff"): email, name, role. The sign-in is created if the address has none (no password), and our mailer sends a link to `/admin/login`: email, emailed code, then an authenticator, like the owner. Only the owner and enabled staff are sent codes; every address gets the same answer. Disabling takes effect on the next click; a disabled member can then be removed (their sales history stays). Nobody changes their own membership, only the owner can make or change an Owner, and nobody can give a role (or build a custom role) with permissions they do not hold. Staff act as `staff:<id>` in the audit log. Someone who is not the owner can change, disable or remove only people whose permissions they hold themselves, and only the owner gives the Jarvis permission.
- **Jarvis keys** made by a staff member carry that person's permissions: each tool needs its permission (`TOOL_PERMISSION` in `lib/admin/tools.ts`), the key stops working when the person is disabled or removed, and loses what their role loses. Staff can rotate or revoke only their own keys. The owner's keys can use every tool.
- **The menu and the search** show only the pages a person may open; the inbox and its badge count only what they can act on.
- **Agents** see only their assigned clients' contact and status (no content or settings), their link, their numbers and the leaderboard. **Sales managers** see every client's agent and reassign with a reason: it counts from that moment, earlier payments stay with the earlier agent, and it is audited and listed.
- **Referral links:** each sales staff member has a code; any page with `?ref=CODE` (`/`, `/pricing`, `/signup`...) keeps the first code in a 30-day functional cookie (`bp-ref`, never overwritten); the sign-up that follows gives the company to that agent (ClientAssignment, source referral). No code: unassigned. An agent signing up with their own account or address is not assigned to themselves.
- **Leaderboard** (`lib/sales/attribution.ts`), performance only, no commission: own sales are payments (net of refunds) of clients assigned to the agent at the payment's time; payments of clients without an agent at that time are the **team share**, split equally across the sales staff active that month (sales roles and any role with "My clients"; managers included).
- **Sales room TV** (`/screen/<secret>`; Organisation, Sales screen, Owner): view only, no emails or phones; active users now (dashboard used in the last 5 minutes) and today, revenue today and this month, trials to follow up (soonest end first, with the agent), this month's leaderboard; refreshed about every 10 seconds; at most 30 requests a minute per network address. A new confirmed payment shows a celebration (company, amount, "Brought in by" the agent or "Team", falling money, a sound from the library in turn). Click "Start screen" once (browsers need a click before playing sound). Links are stored hashed and can be revoked; sounds: up to 10 MP3s uploaded (you must hold the rights) or generated with ElevenLabs Sound Effects.
- **Test staff** (test project only): `scripts/local/seed-test-staff.mjs` (git-ignored) creates one person per role (two agents), writes their passwords to `TEST_ACCOUNTS.md` and the Keychain (the console itself uses emailed codes to those addresses), and assigns a few test companies to the agents.

## One-time setup (owner, in this order)

1. **Supabase, Authentication, Multi-Factor:** TOTP enroll and verify must be on. (They are on for the current project.)
2. **Supabase, Authentication, Email Templates, "Magic Link":** add the code to the email, for example
   `<p>Your BuPulse admin code: <strong>{{ .Token }}</strong></p>`. Setup emails this code to the admin; without it the email only holds a link and setup cannot continue. The code is 8 digits (Authentication, Providers, Email, "Email OTP Length").
3. **Supabase, Authentication, Hooks, "MFA Verification Attempt":** turn it on, choose type "Postgres function", pick `public.hook_mfa_verification_attempt`, and save. The migration `20261009070000_admin_mfa_hook` creates the function. After 5 wrong codes in 10 minutes it refuses every further code for that user (even a correct one) until the oldest failure is 10 minutes old.
4. Set `ADMIN_EMAILS` in `.env` and in the Worker environment, create `admin@bupulse.com` normally (email and password, confirm the email), sign in at `/login`, then open `/admin`.
5. On `/admin/setup-2fa`: press "Email me a code", enter it, scan the QR in Microsoft Authenticator (or Google Authenticator or 1Password) and enter the 6-digit code.

## Updates

Settings, Updates shows the running version, the newest GitHub release and the last deploys; **Install update** and **Roll back** start the deploy workflow on GitHub Actions after a second confirmation and are audited. Setup (`GITHUB_REPO`, `GITHUB_TOKEN`, the `production` environment) and the migrations caveat: `docs/UPDATES.md`.

## Why the extra layers

- `/admin/verify` limits attempts to 8 per 10 minutes per admin, but anyone holding the password can also call Supabase Auth directly. The MFA hook in step 3 is what stops that. Supabase also applies its own per-IP auth rate limits (Authentication, Rate Limits); leave them on.
- Enrolling an authenticator needs an emailed-code sign-in in the last 10 minutes, so the password alone cannot add one. Once a verified authenticator exists, enrolling a second one is refused.
- A setup another window started less than 15 minutes ago is never deleted; the second window is told to finish it or wait.

## Lost phone

Remove the factor in Supabase (Authentication, Users, the admin, Factors, delete), then repeat step 5.

## Currency (RWF | USD | EUR)

Every money figure in the admin (Overview, Revenue and profit, Costs, Usage per client, Payments, Invoices, AI spend,
the client page, Sales) follows the **RWF | USD | EUR** switch at the top of the console. The choice is remembered per admin
browser (cookie `bp_admin_currency`, path `/admin`); without it, Admin → Settings → **Admin currency** → "Default
currency" applies (USD until changed).

- **One formatter** (`formatMoney` in `lib/money/display.ts`; `money()` in `lib/admin/format.ts` is the same): RWF
  without decimals, USD and EUR with cents. Pages use `moneyFmt(await adminMoney())` (`components/admin/money.tsx`).
- **Exact vs converted.** An amount shown in the currency it was stored in is exact (a Mobile Money payment in RWF shows
  the RWF paid). Anything converted shows **≈** and its tooltip gives the original amount and currency.
- **Totals with RWF in them** (revenue): the RWF received is added exactly and only the rest is converted, so RWF never
  makes a round trip through USD. In USD the books' values are used (each RWF payment's USD value was fixed when it
  was confirmed).
- **Stored rates win**: a cost bill keeps its own RWF/USD rate; today's rates are only for what has none.
- **Rates.** RWF per USD is the Card prices rate (Settings). EUR per USD is set in Settings → Admin currency, with an
  optional **daily refresh from the ECB** (`api.frankfurter.app`, free, no key) run by the daily renewals job and by
  "Refresh EUR rate now". The fetched rate is used while it is under 3 days old; any failure (logged as
  `money.eur_rate`) keeps the stored rate.
- Amounts an admin must act on exactly stay in their own currency: the Mobile Money "Confirm …" dialog, a bill's
  billed amount, the refund dialog's card amounts.
- **Sales pages** (My clients, Leaderboard, Sales team) follow the switch like the rest.
- **The sales room TV** (`/screen/<token>`) has no switch: it shows every amount (revenue today and this month, the
  leaderboard, the celebration card) in the **default currency** from Settings (`defaultMoney()`, sent with each poll
  as `ScreenData.money`). A payment made in RWF shows its exact RWF amount on the celebration card; revenue totals add
  the RWF received exactly (`screenMoney`, `screenTotal` in `lib/screen/shared.ts`).
- Tests: `tests/money/display.test.ts`, `tests/screen/data.test.ts`.
