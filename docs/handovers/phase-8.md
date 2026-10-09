# Phase 8 handover: analytics, admin console and Jarvis

Built 8 October 2026. Decisions are in `docs/STAGE1_IMPLEMENTATION_PLAN.md` (Phase 8, "Decided 8 October 2026").
Details are in:
- `docs/handovers/phase-8-analytics.md`: our analytics.
- `docs/JARVIS.md`: the REST API, the MCP server and the safety rules.
- `docs/ADMIN.md`: admin sign-in and the Supabase dashboard steps.

## What works (tested locally)
- **Our analytics:**
  - A cookieless tracker (`public/t.js`) runs on marketing pages only and posts to `/api/collect`.
  - Visitors are hashed with a random daily salt (`AnalyticsSalt`) that is deleted after the day. Raw IPs and user agents are never stored, and GPC/DNT are respected.
  - Product events record sign-up through to upgrade and cancel.
  - A daily roll-up runs on cron `17 2 * * *`. Revenue is net of Paddle fees and tax.
  - `lib/analytics/queries.ts` is used by the console and by Jarvis.
- **Client Analytics** (`/dashboard/analytics`): reach and engagement per network, the best posts, a trend chart, website-chat leads, and tips backed by the data. Days are calendar days in the business's time zone.
- **Admin console** (`/admin`):
  - Access is limited to `ADMIN_EMAILS`, needs a confirmed email and an AAL2 session (TOTP). Anyone else gets a 404.
  - The first enrolment needs an emailed code. After 5 wrong codes in 10 minutes, every code is refused, through the MFA verification-attempt hook.
  - Pages: Overview, Users, Approvals, Revenue and costs, Funnels, Content, Errors, Flags, Announcements, Audit log and Jarvis keys.
- **Admin service** (`lib/admin/service.ts`): every action goes through it and is audited.
  - Money actions (refunds, changing a user to a paid plan) only create approvals. The exact payment is locked when the refund is requested. The owner approves in the console, and the action runs once.
  - When the Paddle outcome is uncertain, the approval shows `needs_check` and is never retried.
  - Suspension blocks sign-in, sessions, AI, the widget, Autopilot, publishing, previews and API keys.
- **Jarvis:** a REST API at `/api/admin/v1/*` and an MCP server at `/api/mcp` (stateless, no batches). Keys are hashed, can carry an IP allow-list, and calls are rate limited per call.
- **Database safety:**
  - `AuditLog` is append-only, enforced by a trigger.
  - Personal details in audit and approval records are redacted on account deletion, through `redact_audit_for_user`, owned by the `audit_redactor` role.
  - Analytics events are unlinked from the user on deletion.
  - Functions are closed to anon and authenticated, and so are the defaults for new functions.
  - Row-level security is on for every table.

## Added on 9 October 2026 (admin console additions, plans, companies and teams)
- **Services** (`/admin/services`):
  - 16 outside services, each with keys set or missing (never values), a "Test now" button, its last error and its usage.
  - A kill switch per service. Switching one off never loses data:
    - posts wait;
    - leads are still saved;
    - emails wait or are skipped safely;
    - Paddle webhooks keep flowing.
- **AI usage** (`/admin/ai`): spend against the cap (editable), a forecast, the top spenders and failed calls.
- **Health** (`/admin/health`): cron runs (`CronRun`), queues, error rate, database and storage size, and one overall status.
- **Activity** (`/admin/activity`): live feed, polled every 5 to 15 s.
- **Client 360** tabs and **admin notes**.
- **Connections** (`/admin/connections`): channels, connectors, webhooks, API keys and widgets, with audited:
  - force-disconnect, after which posts wait and ask for a new time once the client reconnects;
  - disconnect, pause, revoke and switch-off.
- **Plan builder** (`/admin/plans`, `PlanDefinition`): plans live in the database, and Paddle products and prices are created automatically.
  - A price increase moves every subscriber at their next renewal, at least 30 days after the email. The swap uses `do_not_bill`, and yearly clients get a reminder.
  - The nightly cron is claimed and locked, reconciles stragglers, and has a Retry button.
  - See `docs/PLANS.md`. Take a database backup before deploying: the migration is one-way.
- **Companies and teams**:
  - Roles: Owner, Admin and Member (`Membership`, `Invite`), with the role matrix enforced on the server (`lib/team/roles.ts`).
  - Settings → Team has invites, roles, transfer and team history.
  - Seats per plan: 1, 3 and 10.
  - Storage policies let members use the company folder. Writing brand files needs Admin or above.
  - `/admin/companies` has a Users tab: add user (they set their own password), reset link, change email (the old address is notified and sessions are ended), and remove.
  - Over Jarvis, changing an email or making someone owner only creates an approval.

## Reviewed
- Opus reviews found:
  - backend: 2 high, 7 medium, 6 low;
  - console: 1 high, 5 medium, 7 low.
- All are fixed. The lead also revoked the public execute grant on the live database immediately.
- Additions on 9 October: four Opus reviews (services, admin, plans, teams) found 4 high, 22 medium and 37 low issues; all are fixed.
- Checks: tsc, lint and 1,534 tests pass, and `next build` succeeds. The WebKit console walk passed 104 of 104 checks.

## Owner setup (still to do)
1. Supabase → Authentication → Hooks → "MFA Verification Attempt" → `public.hook_mfa_verification_attempt`. **Not available on the Free plan (checked 8 Oct 2026), so it is deferred until the project is upgraded.** Until then, protection is the password, TOTP, BuPulse's own limit on wrong codes and Supabase's built-in limits. The function is installed and unused.
2. Supabase → Authentication → Email Templates → Magic Link: add `{{ .Token }}`. Admin setup can't continue without it.
3. Set `ADMIN_EMAILS=admin@bupulse.com` in `.env` and in the Worker environment.
4. Create and confirm `admin@bupulse.com`, sign in, open `/admin` and enrol Microsoft Authenticator.
5. **Lost phone:** delete the factor for `admin@bupulse.com` in Supabase → Authentication → Users, then enrol again.

## Open items
- **Never run for real:**
  - Paddle refunds and plan changes, so try them in the sandbox.
  - The Paddle net-revenue field names, so check them against a real webhook.
  - Microsoft Authenticator on a real phone.
  - The MFA hook through Supabase Auth.
  - Jarvis connecting through MCP.
- **Suspended users:** a suspended user's existing access token can still write to Storage for up to about an hour. Fix this in Phase 9 with storage policies that check suspension.
- **Older tables:** tables from earlier phases rely on row-level security alone (no policies); their default anon grants remain.
- **Follow-up migration after deploy:** still pending from Phase 7 (old widget webhook columns).
