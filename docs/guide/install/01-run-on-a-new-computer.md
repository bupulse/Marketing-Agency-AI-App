# Run BuPulse on a new computer

This page takes you from an empty computer to BuPulse running on it, so you can try changes before they go online.
You install a few free tools, download the code, fill in a settings file (`.env`) with keys from Supabase and the
other services, create the database tables, and start the app at http://localhost:3001. At the end you sign in to the
admin console for the first time. Keys for outside services (AI, email, social networks and others) can also be added
later in **Admin → Services**, with no restart or redeploy.

**On this page**
- [What you need first](#what-you-need-first)
- [Step 1: get the code](#step-1-get-the-code)
- [Step 2: create a Supabase project](#step-2-create-a-supabase-project)
- [Step 3: fill in the settings file (.env)](#step-3-fill-in-the-settings-file-env)
- [Step 4: create the database tables](#step-4-create-the-database-tables)
- [Step 5: start the app](#step-5-start-the-app)
- [Step 6: sign in to the admin console the first time](#step-6-sign-in-to-the-admin-console-the-first-time)
- [Step 7: run the tests](#step-7-run-the-tests)
- [Common problems on the first run](#common-problems-on-the-first-run)
- [For developers](#for-developers)

## What you need first

| Tool | Version | Why | Where to get it |
|---|---|---|---|
| Node.js | **24** | Runs the app and its tools. Netlify builds with `NODE_VERSION = "24"` (`netlify.toml`) and the GitHub workflows use `node-version: 24`. `package.json` has no `engines` field, so nothing stops an older Node: check it yourself. | nodejs.org (the "24" line), or `nvm install 24` |
| npm | comes with Node | Installs the packages | with Node |
| git | any recent | Downloads the code and its history | git-scm.com, or `xcode-select --install` on a Mac |
| A Supabase project | free plan is fine | The database, sign-in and file storage. The database tables use Supabase's own sign-in and storage tables, so a plain Postgres database will not work. | supabase.com |
| A Gemini API key (or a Claude key) | | The AI that writes posts. You can add it later in Admin → Services. | aistudio.google.com |
| Postgres tools (`pg_dump`, `pg_restore`) | optional | Only for backups | Postgres.app or the EnterpriseDB installer |

Check Node:

```bash
node --version   # should print v24.x
```

Use a **test** Supabase project on your computer, never the production one: what you do locally (sign-ups, payments
you confirm, test posts) is written to that database.

## Step 1: get the code

```bash
git clone <the BuPulse repository address> BuPulse
cd BuPulse
npm ci
```

`npm ci` installs exactly the versions in `package-lock.json`. It takes a few minutes the first time.

## Step 2: create a Supabase project

1. On supabase.com, create a new project (free). Choose a strong database password and keep it in your password manager.
2. **Project Settings → API keys**: copy the project URL, the **publishable** key (`sb_publishable_…`) and the
   **secret** key (`sb_secret_…`). The secret key is like a master password: never share it or put it in a screenshot.
3. **Connect** (top of the dashboard) **→ ORMs / Prisma**: copy two connection strings:
   - the **transaction pooler** (port **6543**, ends with `?pgbouncer=true`): this is `DATABASE_URL`;
   - the **session** connection (port **5432**): this is `DIRECT_URL`.
4. **Authentication → URL Configuration**: Site URL `http://localhost:3001`, and add the redirect URL
   `http://localhost:3001/**`. (The confirmation emails link to this address.)
5. **Authentication → Sign In / Providers → Email**: Email on, **Confirm email** on.
6. **Authentication → Email Templates**: paste the three designs from `supabase/templates/`
   (`confirm-signup.html`, `reset-password.html`, `email-change.html`; subjects in `docs/EMAIL_SETUP.md` section 3).
   In the **Magic Link** template add the admin code, for example
   `<p>Your BuPulse admin code: <strong>{{ .Token }}</strong></p>`. Without it the admin sign-in email has no code.
7. **Authentication → Multi-Factor**: TOTP (authenticator app) enrolment and verification **on**.
8. Optional but recommended: **Authentication → Emails → SMTP Settings**: send through Resend
   (`docs/EMAIL_SETUP.md` section 2). Supabase's own mailer has a low hourly limit, so a few test sign-ups can use it up.

The **MFA hook** (step 3 of the admin setup in `docs/ADMIN.md`) can only be switched on after Step 4, because the
migrations create the function it uses.

## Step 3: fill in the settings file (.env)

```bash
cp .env.example .env
```

Open `.env` in a text editor. Every variable in `.env.example` has a comment saying what it does and what happens when
it is empty. `.env` is git-ignored: it never goes into the repository. Never send it to anyone or paste it into a chat.

### Needed to start (fill these in now)

| Variable | What to put | Where it comes from |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3001` | The address the app runs on (`npm run dev` uses port 3001) |
| `NEXT_PUBLIC_SUPABASE_URL` | the project URL | Supabase → Project Settings → API keys |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | same page |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | same page (server only) |
| `DATABASE_URL` | transaction pooler string (port 6543) | Supabase → Connect → ORMs |
| `DIRECT_URL` | session string (port 5432) | same place; used by the migrations |
| `ENCRYPTION_KEY` | 32 random bytes, base64 | generate it (below) |
| `API_KEY_PEPPER` | 32 random bytes, base64 | generate it (below) |
| `CRON_SECRET` | a long random string | generate it (below) |
| `ADMIN_EMAILS` | your email address (comma-separated for more) | you |
| `AI_TEXT_PROVIDER` | `gemini` (or `claude`) | you |
| `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`) | your key | Google AI Studio (or console.anthropic.com). Can also be added in Admin → Services |

Generate the random values (each command prints a new value; copy it into `.env`):

```bash
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -base64 32   # API_KEY_PEPPER
openssl rand -hex 32      # CRON_SECRET
```

`ENCRYPTION_KEY` locks the stored social-network logins and saved keys. **Never change it** once a database has data
in it, and use the same value everywhere that database is used, or the saved logins stop working. (To replace it
safely, `.env.example` explains `ENCRYPTION_KEY_ID` and `ENCRYPTION_KEY_1`.) Changing `API_KEY_PEPPER` cancels every
API key clients made.

### Needed in production, optional on your computer

| Variable | Without it on your computer |
|---|---|
| `RESEND_API_KEY` | App emails (lead alerts, reminders, invoices) are not sent; the server log says "RESEND_API_KEY is not set; email not sent". Sign-up emails still go out, because Supabase sends those. |
| `RESEND_FROM` | The default sender `BuPulse <register@bupulse.com>` is used |

### Optional: each one switches on a feature

Leave them empty until you need them. Most can be entered later in **Admin → Services** instead (see the last section).

| Group | Variables | Feature |
|---|---|---|
| Social networks | `FACEBOOK_*`, `INSTAGRAM_*`, `META_APP_SECRET`, `LINKEDIN_*`, `TIKTOK_*`, `GOOGLE_YOUTUBE_*` | Connect buttons on Channels (`docs/PLATFORM_APPS.md`) |
| Card payments | `BILLING_PROVIDER`, `PADDLE_*` | Card checkout. Easier: Admin → Settings → Card payments (`docs/BILLING.md`) |
| Voice and video | `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL`, `VIDEO_ROBOT_SECRET` | Voiceovers, music tracks, automatic videos |
| Website chat protection | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Bot check on sign-up and chat |
| Phone alerts | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | "Alerts on this device" on Leads. Generate a pair with the one-line command in `.env.example` |
| WhatsApp alerts | `WHATSAPP_*` | Paid per message, off by default (`docs/RELEASE_2.0.md`) |
| Demo bookings | `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` | Google Calendar events and Meet links (`docs/GOOGLE_CALENDAR.md`) |
| Imports | `GOOGLE_PICKER_*`, `GOOGLE_CLIENT_ID`, `DROPBOX_APP_KEY`, `SHOPIFY_*`, `CANVA_*` | Google Drive, Dropbox, Shopify, Canva (`docs/CONNECTORS.md`, `docs/CANVA.md`) |
| Addresses | `GOOGLE_MAPS_API_KEY`, `GEO_PROVIDER` | Address autocomplete, "Use my location" |
| Updates screen | `GITHUB_REPO`, `GITHUB_TOKEN`, `DEPLOY_TARGET`, `RELEASE_PUBLIC_KEY`, `UPDATES_DRY_RUN` | Admin → Settings → Updates (`docs/UPDATES.md`) |
| AI limits | `AI_MONTHLY_BUDGET_USD`, `AI_COMPANY_MONTHLY_USD`, `WIDGET_AI_SHARE`, model names | Spending caps (defaults apply when empty) |
| Storage limits | `MEDIA_PLATFORM_MAX_BYTES`, `MEDIA_COMPANY_VIDEO_MAX_BYTES` | Upload caps (defaults apply when empty) |
| Test tunnel only | `AUTH_EXTRA_ORIGINS`, `PUBLIC_LINK_URL` | A second address such as test.bupulse.com. Empty in production. |
| Local only | `ANALYTICS_DEV_COUNTRY`, `REGION_OVERRIDE` | Pretend to be in another country (`?region=RW`). Never in production. |

Not needed on your computer: `PLATFORM`, `PLATFORM_CHECK`, `NETLIFY_*`, `ROBOT_APP_URL`, `BUILD_SHA` (these are for the
hosts and GitHub).

Check the file (prints names and problems only, never a value):

```bash
node --env-file=.env scripts/check-env.mjs --runtime
```

It is the production check, so on your computer it also complains about things that are fine locally (for example an
`http://` site address). Read it as a list of what is missing.

## Step 4: create the database tables

Two commands. Both read `.env` themselves. The `--config prisma7.config.ts` part is needed every time: the project's
Prisma settings file has that name, so Prisma does not find it on its own.

```bash
# 1. Make the database code the app uses (lib/generated/prisma, git-ignored). Run again after every pull.
npx prisma generate --config prisma7.config.ts

# 2. Create every table, storage bucket and starting row on the NEW database.
npx prisma migrate deploy --config prisma7.config.ts
```

`migrate deploy` applies every migration in `prisma/migrations/` in order (about 100 of them) through `DIRECT_URL`.
It is the same command the deploy workflows run in production. It only ever goes forward and never deletes your data.

**There is no separate "seed" step.** The migrations themselves insert the starting data: the plans, the regions and
their prices (Rwanda, East Africa, international), add-on prices, industries, the demo availability (Monday to Friday,
09:00 to 17:00 Kigali time) and the storage buckets. Check them after you sign in, in Admin → Plans, Regions and
Industries. Two things are not in the repository and stay empty until added:

- the **music library** (20 original tracks): kept with the owner (Google Drive) with the git-ignored runner
  `scripts/local/seed-music.mjs`; see `docs/VOICE_AND_MUSIC.md`. Without it, videos have no music;
- **test accounts**: `scripts/local/` is git-ignored, so a fresh clone does not have the test-account scripts. Create
  your own account at `/signup` instead.

Do **not** use `npx prisma migrate dev` (the old README says so): it can create new migration files and asks to reset
the database when it finds differences. Developers use it only when they write a new migration, never on a shared
database.

After the migrations, switch on the MFA hook in Supabase: **Authentication → Hooks → MFA Verification Attempt**, type
"Postgres function", choose `public.hook_mfa_verification_attempt`, save. It locks the admin sign-in after 5 wrong
authenticator codes in 10 minutes.

## Step 5: start the app

| Command | What it does | Address |
|---|---|---|
| `npm run dev` | Development mode: reloads when you change a file | http://localhost:3001 |
| `npm run build` | Makes a production build (also checks the code types) | |
| `npm run start` | Runs that production build (port 3000 unless you add `-- -p 3001`) | http://localhost:3000 |
| `npm run build:cloudflare` | The Cloudflare Workers build (`scripts/cf-build.mjs`), only to check it | |
| `npm run preview` | The Workers build run locally with wrangler | |

```bash
npm run dev
```

Open http://localhost:3001. Sign up with an email you can read at http://localhost:3001/signup, confirm the email, and
you go through the client screens (organisation, brand set-up, book a demo).

If you use `npm run start`, run it on port 3001 (`npm run start -- -p 3001`) so it matches `NEXT_PUBLIC_SITE_URL`, or
set `NEXT_PUBLIC_SITE_URL` to the port you use and rebuild.

**Scheduled jobs do not run on your computer.** Publishing scheduled posts, trial expiry, Mobile Money reminders and
the other jobs are started by Cloudflare, Netlify or GitHub online. To run one by hand while `npm run dev` is running:

```bash
curl -X POST -H "Authorization: Bearer <your CRON_SECRET>" http://localhost:3001/api/cron/publish
```

The job names are listed in [Put it online](02-put-it-online.md#scheduled-jobs-cron).

## Step 6: sign in to the admin console the first time

The admin console is at `/admin`. Only the addresses in `ADMIN_EMAILS` (the owner) and staff invited in Admin →
Organisation can enter; everyone else gets "page not found". There is no admin password: you sign in with an emailed
code, then an authenticator-app code.

1. Make sure your address is in `ADMIN_EMAILS` in `.env`, and restart `npm run dev`.
2. Create the account once: sign up at `/signup` with that address and confirm the email. (Or Supabase →
   Authentication → Users → Add user.) The admin sign-in never creates an account by itself.
3. Open http://localhost:3001/admin. You are sent to `/admin/login`. Type your email and press send.
4. Open the email and type the code it contains (it is the Magic Link template from Step 2, point 6).
5. The first time you are sent to `/admin/setup-2fa`: press **Email me a code**, type the new code, then scan the QR
   code with an authenticator app (Microsoft Authenticator, Google Authenticator or 1Password) and type the 6-digit
   code it shows.
6. The Overview opens. From now on each sign-in is: email, emailed code, authenticator code (`/admin/verify`).

Lost the phone with the authenticator? Supabase → Authentication → Users → your user → Factors → delete, then repeat
step 5 (`docs/ADMIN.md`, "Lost phone").

**Add the other keys in Admin → Services.** Each outside service has a card with **Add key**, **Replace** and
**Remove** next to every variable. A saved key is encrypted with `ENCRYPTION_KEY`, shown again only by its last 4
characters, and used by the app within 30 seconds with no restart or redeploy. A saved key wins over the one in
`.env`; **Remove** brings the `.env` value back. **Test now** checks the key with a free call. Supabase's keys stay in
`.env` only (the app needs them to start), and Paddle's are entered in Admin → Settings → Card payments.

## Step 7: run the tests

| Command | What it runs | Needs |
|---|---|---|
| `npm test` | All unit tests (`vitest run`, files `tests/**/*.test.ts`) | Nothing: no database or keys |
| `npm run lint` | Code style (ESLint) | |
| `npx tsc --noEmit` | Type check | `prisma generate` done |
| `npm run test:e2e` | Browser tests in `e2e/` (Playwright, Chromium) | Starts `next dev` on port 3100 itself. First time: `npx playwright install chromium` |
| `RUN_DB_TESTS=1 npm test` | Also runs the `*.db.test.ts` tests against the database in `.env` | A **test** database |
| `npm run ai:eval` | Checks the quality of AI writing against the real model | `GEMINI_API_KEY`; costs a little AI money |

```bash
npm test
npx playwright install chromium   # once
npm run test:e2e
```

The same checks run on GitHub for every pull request (`.github/workflows/ci.yml`).

## Common problems on the first run

| What you see | What it means | Fix |
|---|---|---|
| `Cannot find module '@/lib/generated/prisma/client'` (or similar) | The database code was not generated | `npx prisma generate --config prisma7.config.ts` |
| `DATABASE_URL is not set` | `.env` is missing or not filled in | Check `.env` is in the project folder and has `DATABASE_URL` |
| `ENCRYPTION_KEY is not set` or `Encryption key must be 32 bytes (base64)` | The key is missing or was typed by hand | Generate it with `openssl rand -base64 32` |
| `SUPABASE_SECRET_KEY is not set (see .env.example)` | Uploads and server storage need the secret key | Copy it from Supabase → API keys |
| `GEMINI_API_KEY is not set (see .env.example)` in the server log when AI writes a post | No AI key | Add it in `.env` or in Admin → Services |
| `migrate deploy` hangs or fails on "prepared statement" | It used the pooled connection | `DIRECT_URL` must be the **session** string, port 5432 |
| `migrate deploy` fails with `P3009` / "failed migrations" | A migration stopped half-way earlier | See [Troubleshooting](../troubleshooting.md#database-and-migrations) |
| Confirmation email link goes to `localhost:3000` or the live site | Supabase's Site URL is wrong | Step 2, point 4 |
| The admin sign-in email has only a link, no code | Magic Link template has no `{{ .Token }}` | Step 2, point 6 |
| `/admin` says "page not found" | Your email is not in `ADMIN_EMAILS`, or the server was not restarted | Fix `.env`, restart |
| "Prisma's query compiler was not loaded (worker.ts)" in dev or tests | A Cloudflare build was stopped hard and left the generated code patched | `npx prisma generate --config prisma7.config.ts` |
| Port 3001 already in use | Another copy is running | Stop it, or `npx next dev -p 3002` (and change `NEXT_PUBLIC_SITE_URL`) |
| Trials never end, scheduled posts never go out | Scheduled jobs do not run locally | Call the job by hand (Step 5) |

More in [Troubleshooting](../troubleshooting.md).

## For developers

- **Prisma 7 with a custom config.** `prisma7.config.ts` (loads `.env` with `dotenv/config`) points the CLI at
  `prisma/schema.prisma` and `prisma/migrations`, and uses `DIRECT_URL` (falling back to `DATABASE_URL`). Every CLI call
  needs `--config prisma7.config.ts`. The client is generated to `lib/generated/prisma` (`generator client` with
  `provider = "prisma-client"` in `prisma/schema.prisma`) and is git-ignored. There is no `postinstall` hook, so
  generate after `npm ci` and after every pull that touches the schema.
- **Runtime connection.** `lib/db.ts` (`createClient`, `getClient`) builds a `PrismaClient` with the `@prisma/adapter-pg`
  driver adapter from `DATABASE_URL` (Netlify, local) or the Hyperdrive binding (Cloudflare, `requestDatabase()` in
  `lib/platform/database.ts`). Pool size: `poolMax()` / `DATABASE_POOL_MAX`.
- **Migrations are Supabase-specific.** Several reference `auth.users`, `storage.buckets` and `storage.objects`
  (e.g. `20261006120100_storage_buckets`, `20261006170000_user_follows_auth_user`), create RLS policies, and define the
  auth hook `public.hook_mfa_verification_attempt` (`20261009070000_admin_mfa_hook`). Starting data is inserted by
  migrations such as `20261009095000_plan_builder`, `20261010100100_regions_and_demos`, `20261012120000_industries`.
- **New migration:** edit `prisma/schema.prisma`, then `npx prisma migrate dev --create-only --name <name> --config
  prisma7.config.ts` against a throwaway or test database, review the SQL, commit it. Production only ever runs
  `migrate deploy`.
- **Env check:** `scripts/check-env.mjs` (`checkEnv`, lists `BUILD_REQUIRED`, `RUNTIME_REQUIRED`,
  `RUNTIME_RECOMMENDED`, `PRODUCTION_FORBIDDEN`, `PRODUCTION_TEST_ONLY`); modes `--build`, `--runtime`, `--netlify`,
  `--cloudflare`. Tested in `tests/check-env.test.ts`.
- **Saved service keys:** `lib/admin/service-keys.ts` (`loadServiceKeys`, `saveServiceKey`, `removeServiceKey`,
  `getCustomKey`, AdminSetting `services.keys`), the catalog of services and their variables in
  `lib/admin/service-catalog.ts`, the page `app/admin/(console)/(system)/services/` (`saveServiceKeyAction`,
  `removeServiceKeyAction`, `saveCustomKeyAction`, `removeCustomKeyAction`), tests `lib/admin/service-tests.ts`
  (`runProbe`).
- **Admin sign-in:** `app/admin/(auth)/login/actions.ts` (`sendAdminCode` → `supabase.auth.signInWithOtp` with
  `shouldCreateUser: false`; `verifyAdminCode`), `app/admin/(auth)/actions.ts` (`sendEnrollCode`, `confirmEnrollCode`,
  `startEnrollment`, `confirmEnrollment`, `verifyCode`), gates in `lib/admin/auth.ts` (`canReceiveAdminCode`,
  `requireAdminIdentity`, `requireAdmin`, `requirePermission`).
- **Tests:** `vitest.config.ts` aliases `server-only` to `tests/stubs/server-only.ts` so server modules load in Node;
  `playwright.config.ts` starts `next dev -p 3100` locally (`next start` in CI, `E2E_PORT` overrides the port).
  Database tests are `*.db.test.ts`, skipped unless `RUN_DB_TESTS` and `DATABASE_URL` are set.
- **Dev port:** `npm run dev` is `next dev -p 3001` (`package.json`). Some older docs (`README.md`,
  `docs/EMAIL_SETUP.md`, `docs/PLATFORM_APPS.md`, `docs/CONNECTORS.md`) still say `localhost:3000`; register the port
  you actually use with each provider. Canva only accepts `127.0.0.1`, not `localhost` (`docs/CANVA.md`).
