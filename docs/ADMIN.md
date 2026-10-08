# Admin console setup (`/admin`)

Only the addresses in `ADMIN_EMAILS` (comma-separated, default `admin@bupulse.com`) can open the console. Everyone else, and signed-out visitors, get a 404. An admin also needs an authenticator-app code (Supabase MFA, AAL2) on every sign-in. Money actions run only after the owner clicks Approve (see `docs/JARVIS.md`).

## One-time setup (owner, in this order)

1. **Supabase, Authentication, Multi-Factor:** TOTP enroll and verify must be on. (They are on for the current project.)
2. **Supabase, Authentication, Email Templates, "Magic Link":** add the code to the email, for example
   `<p>Your BuPulse admin code: <strong>{{ .Token }}</strong></p>`. Setup emails this code to the admin; without it the email only holds a link and setup cannot continue. The code is 8 digits (Authentication, Providers, Email, "Email OTP Length").
3. **Supabase, Authentication, Hooks, "MFA Verification Attempt":** turn it on, choose type "Postgres function", pick `public.hook_mfa_verification_attempt`, and save. The migration `20261009070000_admin_mfa_hook` creates the function. After 5 wrong codes in 10 minutes it refuses every further code for that user (even a correct one) until the oldest failure is 10 minutes old.
4. Set `ADMIN_EMAILS` in `.env` and in the Worker environment, create `admin@bupulse.com` normally (email and password, confirm the email), sign in at `/login`, then open `/admin`.
5. On `/admin/setup-2fa`: press "Email me a code", enter it, scan the QR in Microsoft Authenticator (or Google Authenticator or 1Password) and enter the 6-digit code.

## Why the extra layers

- `/admin/verify` limits attempts to 8 per 10 minutes per admin, but anyone holding the password can also call Supabase Auth directly. The MFA hook in step 3 is what stops that. Supabase also applies its own per-IP auth rate limits (Authentication, Rate Limits); leave them on.
- Enrolling an authenticator needs an emailed-code sign-in in the last 10 minutes, so the password alone cannot add one. Once a verified authenticator exists, enrolling a second one is refused.
- A setup another window started less than 15 minutes ago is never deleted; the second window is told to finish it or wait.

## Lost phone

Remove the factor in Supabase (Authentication, Users, the admin, Factors, delete), then repeat step 5.
