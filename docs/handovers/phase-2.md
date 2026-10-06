# Phase 2 handover: app shell, sign-in and onboarding

Built 6 October 2026.

## What a new user goes through
1. Sign up (email → organisation → password → confirm email) or Continue with Google.
2. Google sign-ups fill in their organisation details on `/welcome` (no password).
3. `/onboarding`, required, 4 steps saved one by one (a refresh resumes): what you sell and who to,
   brand voice (6 presets with sample posts, `lib/brand/voices.ts`), logo and colours (colours suggested
   in the browser from the logo, can be added later), chat assistant knowledge (optional).
4. Dashboard with their logo and colours in the shell, trial banner on every page.

`components/app/context.ts` gates every dashboard page in this order: deletion pending → `/account/deletion`,
details missing → `/welcome`, onboarding unfinished → `/onboarding`. Server actions and pages outside the
dashboard use `lib/auth/require-user.ts` (`requireActiveUser`), which applies the same deletion lock.

## Sign-in rules
- One method per account (`User.signUpMethod`): password accounts can't use Google (a Google login Supabase
  links automatically is removed again in `/auth/callback`); Google accounts use Google until they set a
  password through "Forgot password?".
- An already registered email on the sign-up form goes to sign-in, with a Google hint when relevant.

## Brand
- `/dashboard/brand` edits the same four sections as onboarding (`components/brand-profile/*`).
- Logos: private `brand` bucket, `<userId>/logo/…`, PNG/JPG/WebP only (no SVG: could carry scripts).
- Colours are validated hex and exposed to the shell as `--brand-1..3` (+ readable `--brand-N-text`).

## Settings and account deletion
- Settings: profile name, business details, team (coming soon), delete account.
- Delete = 30-day grace period: account locked, sign-in shows "Keep my account". After 30 days the daily job
  (`.github/workflows/purge-accounts.yml` → `POST /api/cron/purge-accounts`, `lib/account-deletion.ts`)
  removes the user's Storage files and then the auth user (cascades to all data).
- The job deletes nobody unless all their files were removed, so nothing is left behind; without
  `SUPABASE_SECRET_KEY` it keeps every account and logs a warning.
- Phase 3: cancel the Stripe subscription when deletion is scheduled (TODO in `app/dashboard/settings/actions.ts`).

## Secrets added
`SUPABASE_SECRET_KEY` (Supabase → Project Settings → API Keys → secret key) and `CRON_SECRET`, in `.env`,
Cloudflare secrets and GitHub Actions secrets (see `docs/DEPLOY.md`).

## Checks at hand-over
Lint, type check, 117 unit tests, build, 38 browser tests. A real browser run covered sign-in → onboarding
(with logo upload) → dashboard → brand page → settings → delete → locked sign-in → keep account → purge job.
Reviewed for security by a separate reviewer; all findings fixed.
