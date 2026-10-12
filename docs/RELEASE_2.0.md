# BuPulse 2.0: release notes and go-live runbook

Target: deploy on **Wednesday 14 October 2026** to bupulse.com on the **Netlify free plan**, with a new free
production Supabase project. Hosting steps are in `docs/DEPLOY_NETLIFY.md`; this file is the order of work and what
to check.

## What's new in 2.0 (for the Updates screen and clients)

- **Prices for where you are.** Rwanda, East Africa and international prices; RWF without decimals; "Use my location".
- **Pay by MTN MoMo or Airtel Money.** Pay, send the transaction id, we confirm within minutes; reminders before
  renewal; card payments (auto-renewing) where available.
- **Demo first, then a free trial.** Sign up, choose a plan, book a demo (Google Meet); the trial starts after the demo.
- **Invoices** as PDF with MoMo details and a "Pay online" link.
- **Knowledge base** (replaces Projects): company profile, products and services, campaigns, customers, competitors,
  FAQs and policies, reviews, and the AI marketing interview that sets your brand voice.
- **Gallery albums** per product; uploads go to a folder or an album.
- **Plans with exactly the features you need**, custom plans and offers from the BuPulse team.
- **Opening hours, branches and contacts** (with building, floor and shop number) used by the AI and the website chat.
- **Chat on WhatsApp** button, MoMo/Airtel badges, status page.

## Before Wednesday (owner)

| # | Task | Where | Time |
|---|---|---|---|
| 1 | Test v2 on localhost:3001 with the test accounts | `~/BuPulse-v2/TEST_ACCOUNTS.md` | 1 h |
| 2 | Create a free Netlify account (sign in with GitHub) | netlify.com | 10 min |
| 3 | Create the production Supabase project (free, region closest to Rwanda that's offered, e.g. eu-central or eu-west) and send me its keys the same way as the test project | supabase.com | 15 min |
| 4 | Resend: add the DNS records it shows for bupulse.com in Cloudflare (SPF, DKIM, DMARC) | resend.com → Domains | 15 min |
| 5 | MoMo Pay code (or the number clients pay to), Airtel number, your demo availability | message me | 5 min |
| 6 | Reset the keys that were pasted in chat (ElevenLabs, v2 test Supabase) | each dashboard | 15 min |
| 7 | Install the free Postgres tools for backups (Postgres.app or the EnterpriseDB installer) | postgresapp.com | 10 min |

## Go-live day (in this order)

1. **Freeze**: no new merges into `v2` except fixes found on the day.
2. **Final checks on v2**: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npx next build`, and an offline
   Netlify build (`npx netlify-cli@27.12.0 build --offline`).
3. **Merge v2 into main** (merge commit, version 2.0.0). Push only with the owner's go-ahead.
4. **Production database**: the deploy workflow runs `prisma migrate deploy` on the new Supabase project. Regions,
   plans, add-ons and industries are seeded by the migrations; check them in Admin → Plans / Regions / Industries.
5. **Environment variables** in Netlify (full list in `docs/DEPLOY_NETLIFY.md` section 2). New in 2.0:
   `AI_COMPANY_MONTHLY_USD` (3), `MEDIA_PLATFORM_MAX_BYTES` (900 MB), `NEXT_PUBLIC_WHATSAPP_NUMBER`,
   `GEO_PROVIDER=builtin`, `PLATFORM=netlify`, `AI_MONTHLY_BUDGET_USD` (30), `API_KEY_PEPPER` (new random value),
   `GOOGLE_CALENDAR_CLIENT_ID/SECRET`. Never copy `ANALYTICS_DEV_COUNTRY` or `REGION_OVERRIDE` to production.
   Build-time values (every `NEXT_PUBLIC_*`, plus `PLATFORM=netlify`) must also be **GitHub repository variables**:
   the deploy workflow builds offline in GitHub without the Netlify token, so it can't read Netlify's settings at
   build time (`docs/DEPLOY_NETLIFY.md`).
6. **Supabase production settings**: Auth → URL configuration (site URL `https://bupulse.com`, redirect
   `https://bupulse.com/**`), SMTP with Resend (username `resend`), storage buckets created by the migrations.
7. **Deploy** (GitHub Actions → Deploy to Netlify), then DNS at Cloudflare (DNS only, grey cloud).
8. **After deploy** (`docs/DEPLOY_NETLIFY.md` section 7):
   - `https://bupulse.com/api/status` answers `{"status":"ok"}`.
   - Header check with `PLATFORM_CHECK=1` for 10 minutes, then remove it.
   - Admin: sign in as admin@bupulse.com, set up the authenticator, set MoMo details, trial days, availability,
     Connect Google Calendar.
   - Sign up a real test company from a phone in Rwanda: prices in RWF, book a demo, start trial, pay **100 RWF** by
     MoMo (temporary test plan or price), confirm in Admin → Payments, company becomes active.
   - Free uptime monitor (e.g. UptimeRobot free) on `/api/status` every 5 minutes, alerts to office@bupulse.com.
9. **Hand-over zip**: `git archive --format=zip -o BuPulse-2.0.0.zip main` (no `node_modules`, `.next` or `.env`).

## Backups (free plan)

Supabase Free has no downloadable backups. Before every deploy that changes the database:

```bash
# Postgres tools installed (step 7 above). DIRECT_URL is the production direct connection string.
pg_dump "$DIRECT_URL" --format=custom --no-owner --file "bupulse-$(date +%Y%m%d-%H%M).dump"
```

Keep the file on your Mac and a copy in Google Drive (office@bupulse.com). **Never** commit it or upload it as a
GitHub Actions artifact: the repository is public.

Restore (only after a failed deploy, into the same or a new project):
`pg_restore --clean --if-exists --no-owner --dbname "$DIRECT_URL" bupulse-YYYYMMDD-HHMM.dump`

## Rolling back

- **Code**: Admin → Settings → Updates → Roll back (Netlify restore-deploy, free), or
  `node scripts/netlify-rollback.mjs`.
- **Database**: migrations only add tables and columns, so the previous code keeps working on the new schema. Restore
  from the backup only if data was damaged.

## Known limits at launch

- Facebook and Instagram publishing for clients needs Meta Business Verification and App Review
  (`docs/META_APP_REVIEW.md`); until then clients get reminders plus copy-and-post.
- Card payments need Paddle live approval; until then MoMo and invoices only.
- Netlify free: 300 credits a month (the site pauses if they run out); posts go out within 5 minutes of their time.
- Supabase free: 500 MB database, 1 GB file storage (uploads stop at 900 MB), the project pauses after 7 days without
  traffic (the uptime monitor keeps it awake).
