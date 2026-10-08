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

## Reviewed
- Opus reviews found:
  - backend: 2 high, 7 medium, 6 low;
  - console: 1 high, 5 medium, 7 low.
- All are fixed. The lead also revoked the public execute grant on the live database immediately.
- Checks: tsc, lint and 1,286 tests pass, and `next build` succeeds. The WebKit console walk passed 104 of 104 checks.

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
