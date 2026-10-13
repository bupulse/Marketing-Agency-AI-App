# Admin console (`/admin`)

Only the addresses in `ADMIN_EMAILS` (comma-separated, default `admin@bupulse.com`) can open the console. Everyone else, and signed-out visitors, get a 404. An admin also needs an authenticator-app code (Supabase MFA, AAL2) on every sign-in, and every server action re-checks it (`adminAction()`). Money actions run only after the owner clicks Approve (see `docs/JARVIS.md`).

## Map

The sidebar groups the pages into folders; the files live in matching route groups under `app/admin/(console)/`, so URLs never changed. The map itself is `components/admin/nav.ts`: the sidebar, the breadcrumbs and the search read it, and `tests/admin-console/nav.test.ts` fails when a page is missing from it.

| Folder | Page | URL | What it is for |
| --- | --- | --- | --- |
| | Overview | `/admin` | Today and this month: to-dos, MRR, revenue (month and lifetime), costs, profit, clients by state, AI spend vs the cap, errors in 24 h. |
| | Inbox | `/admin/inbox` | Everything waiting for a person: payments to confirm, approvals, demos, plan requests, invoices to check, accepted unpaid offers, contests waiting for the client, region mismatches, errors. |
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

- **Search:** Cmd+K (Mac) or Ctrl+K anywhere, or the Search button: any page by name, folder or keyword, and any company by name or member email (`/admin/search`, same admin gate).
- **Folders** fold with a click; the choice is remembered in this browser only. The folder of the page you are on stays open. A folded folder shows the sum of its badges.
- **Badges:** Inbox (all to-dos), Payments, Approvals, Plan requests, Errors (24 h), Health.
- Every page has a one-line explanation under its title, tables keep their header in view while scrolling, and every page shows an empty state when there is no data yet.

## Money

All money is shown in USD; RWF amounts are converted at the rate fixed when a payment was confirmed (Revenue) or at the rate in Settings (recurring RWF costs; an RWF bill keeps the rate of the day it was saved). Code: `lib/money/` (pure rules in `costs-shared.ts` and `revenue-shared.ts`, tested in `tests/money/`).

- **Revenue** is every `BillingEvent` that is money, ever. That table has no foreign key, so clients who left or deleted their account still count. Card: Paddle's payout after tax and fees, less approved refunds. Mobile Money: confirmed MTN or Airtel payments. Invoices: payments of an invoice, and plain invoices marked paid by hand (`invoice.paid_manual`, written since this build and back-filled by migration `20261017200000_admin_money`).
- **MRR:** each paying client (active or past due, not trial) at their plan's monthly price; a Mobile Money client at what they last paid for a whole period (a prorated "add to current plan" payment counts as revenue, but changes MRR only from the next renewal); yearly a twelfth. **ARPU** = MRR / paying clients. **Churn (30 days):** clients who had paid and stopped in the last 30 days, out of those paying now plus them.
- **Costs** per month: for each AI or voice provider, its real bill when entered under Costs, Provider bills (it then replaces the estimate everywhere), otherwise the AI ledger's estimate, marked "estimate"; plus recurring costs (a yearly one counts a twelfth a month) and one-month costs. Presets fill the form for Cloudflare Workers, Netlify, Supabase, the domain, ElevenLabs, Google Workspace, email and GitHub; check the amount against the invoice.
- **Profit** = revenue - all costs. The Overview, Revenue and profit, the analytics roll-up (Jarvis) and Usage per client use the same numbers.
- Every cost write (add, change, stop, delete a recurring cost; save or delete a bill) is audited.
- **Enter the bills** at the start of each month for the month before: the Costs page shows "Estimated part" in red until then.

Why the AI estimate can differ from Google's bill, and what is done about it: `docs/AI_COSTS.md`.

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
