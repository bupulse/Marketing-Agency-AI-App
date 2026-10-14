# BuPulse 2.0: release notes and go-live runbook

Target: deploy on **Wednesday 14 October 2026** to bupulse.com on **Cloudflare Workers Paid** ($5 a month; owner
decision of 13 October), with a new free production Supabase project. Hosting steps are in `docs/DEPLOY.md`; Netlify
free (`docs/DEPLOY_NETLIFY.md`) stays the fallback. This file is the order of work and what to check.

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
- **A week of posts in one click** (content packs): different posts for each angle and each app, written for that app,
  from your products, campaigns and Gallery; the best day and time for each.
- **Every post has its picture, carousel or video**, designed from your own photos first; AI scenes can show local
  people using your product (plans with AI photos).
- **Your own videos first**: upload MP4, MOV or WebM clips (up to 60 seconds) to the Gallery and albums; BuPulse posts
  them as Reels and Shorts and writes the caption about what they show.
- **Videos made for you** from your photos and script: captions in time, a voiceover in your chosen voice (plans with
  voiceover) and royalty-free music; made automatically in the background, or in your browser.
- **Add features to your plan any time**: pay only for the added features for the days left in your period; renew
  in the last 7 days of a period by Mobile Money or card without losing a day.
- **Account menu** on the public pages, and **one sign-in method per account**.
- **Lead alerts on your phone**: switch on "Alerts on this device" on the Leads page and every new lead pops up on
  that phone or computer, free; the lead email has a **Reply on WhatsApp** button when the visitor left a number.
- Coming next: the design library (templates you can browse and reuse).

**For the BuPulse team (admin console, 13 October):**

- **Staff and roles**: invite staff, built-in and custom roles, every page, route and action checked against the
  person's permissions (deny by default), audited. **Admin sign-in**: email, then an emailed code, then the
  authenticator code (no password); `/admin` opens the admin sign-in.
- **Sales**: referral links (`?ref=CODE`, 30-day cookie, the sign-up goes to that agent), My clients, the monthly
  **leaderboard** (own sales and an equal team share), reassignments with a reason, and the **sales room TV**
  (`/screen/<secret link>`): live numbers, trials to follow up, the leaderboard, and a celebration with a sound for
  every confirmed payment.
- **New Overview**: today's payments and what happened today, an approve card for payments waiting, money, clients
  and AI at a glance, each section shown only to who may see it.
- **Admin currency switch RWF | USD | EUR** at the top of the console (default in Settings): money received in RWF is
  shown exactly, converted figures are marked ≈; optional daily ECB rate for EUR. The TV uses the default currency.
- **Page-loading animation** for the whole site, chosen in Admin → Settings (top bar, BuPulse preloader, or off).

## Before Wednesday (owner)

| # | Task | Where | Time |
|---|---|---|---|
| 1 | Test v2 on localhost:3001 with the test accounts | `~/BuPulse-v2/TEST_ACCOUNTS.md` | 1 h |
| 2 | Cloudflare: subscribe to Workers Paid, `npx wrangler login`, create the Hyperdrive config and send me its id (`docs/DEPLOY.md` section 1) | dash.cloudflare.com | 20 min |
| 3 | Create the production Supabase project (free, region closest to Rwanda that's offered, e.g. eu-central or eu-west) and send me its keys the same way as the test project | supabase.com | 15 min |
| 4 | Resend: add the DNS records it shows for bupulse.com in Cloudflare (SPF, DKIM, DMARC) | resend.com → Domains | 15 min |
| 5 | MoMo Pay code (or the number clients pay to), Airtel number, your demo availability | message me | 5 min |
| 6 | Reset the keys that were pasted in chat (ElevenLabs, v2 test Supabase) | each dashboard | 15 min |
| 7 | Install the free Postgres tools for backups (Postgres.app or the EnterpriseDB installer) | postgresapp.com | 10 min |
| 8 | Copy the 20 music tracks and `scripts/local/seed-music.mjs` to Google Drive (office@bupulse.com) | Google Drive | 5 min |
| 9 | Fill `.env.production` (from `.env.example`) and run `node --env-file=.env.production scripts/check-env.mjs --runtime` | your Mac | 30 min |
| 10 | Put each runtime value in Cloudflare (`npx wrangler secret put NAME`, `docs/DEPLOY.md` section 2) and the GitHub secrets and variables (section 3): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DIRECT_URL`, `CRON_SECRET`, `VIDEO_ROBOT_SECRET` | your Mac, GitHub | 30 min |

## Go-live day (in this order)

1. **Freeze**: no new merges into `v2` except fixes found on the day.
2. **Final checks on v2**: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npx next build`, and the Workers
   build with its size (`npm run build:cloudflare`, then `npx wrangler deploy --dry-run --outdir /tmp/cf`: the gzip
   size must stay under 10 MiB; it was 9.78 MiB (10,017 KiB) on 13 October evening and **8.83 MiB (9,038 KiB) after the
   trim of 14 October** (`docs/DEPLOY.md`, Known notes): about 1.2 MiB left).
3. **Merge v2 into main** (merge commit, version 2.0.0). Push only with the owner's go-ahead.
4. **Production database**: the deploy workflow runs `prisma migrate deploy` on the new Supabase project. Regions,
   plans, add-ons and industries are seeded by the migrations; check them in Admin → Plans / Regions / Industries.
5. **Environment variables**: Cloudflare secrets (`docs/DEPLOY.md` section 2; the complete list with defaults is
   `docs/DEPLOY_NETLIFY.md` section 2 and `.env.example`). On Cloudflare there is no `DATABASE_URL` (Hyperdrive) and no
   `PLATFORM`. The deploy workflow checks them before building (`scripts/check-env.mjs --build` and `--cloudflare`:
   names and problems only, never values; the Hyperdrive id in `wrangler.jsonc` too) and stops on a missing required
   one; check yourself first with `node --env-file=.env.production scripts/check-env.mjs --runtime`. New since 1.x: `AI_COMPANY_MONTHLY_USD` (3), `AI_MONTHLY_BUDGET_USD` (30),
   `WIDGET_AI_SHARE` (0.5), `MEDIA_PLATFORM_MAX_BYTES` (900 MB), `MEDIA_COMPANY_VIDEO_MAX_BYTES` (100 MB at launch),
   `ELEVENLABS_API_KEY` (voiceover and Generate a track), `VIDEO_ROBOT_SECRET` (plus the GitHub secret of that name and
   the repository variable `ROBOT_APP_URL`), `NEXT_PUBLIC_WHATSAPP_NUMBER`, `GEO_PROVIDER=builtin`,
   `API_KEY_PEPPER` (new random value), `GOOGLE_CALENDAR_CLIENT_ID/SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
   `VAPID_SUBJECT` (a NEW pair for production, see "Lead alerts" below). Never copy `ANALYTICS_DEV_COUNTRY` or
   `REGION_OVERRIDE` to production (the check refuses them). **`AUTH_EXTRA_ORIGINS` and `PUBLIC_LINK_URL` must be EMPTY
   in production**: they exist for the test tunnel (test.bupulse.com); set, they let sign-in accept that origin and
   make shareable links (sales TV, referral links, staff invitations) point at the tunnel. The check warns when either
   is set. Build-time values (every `NEXT_PUBLIC_*`) must also be
   **GitHub variables**: the Worker is built in GitHub, and Next.js bakes them into the browser code.
6. **Supabase production settings**: Auth → URL configuration (site URL `https://bupulse.com`, redirect
   `https://bupulse.com/**`), SMTP with Resend (username `resend`). The migrations create the storage buckets; check
   them in Storage:

   | Bucket | Public | Max file | Holds |
   | --- | --- | --- | --- |
   | `brand` | no | 5 MB | logos |
   | `media` | no | 10 MB | Gallery photos, rendered videos, voiceovers |
   | `designs` | no | 10 MB | designs and AI photos |
   | `invoices` | no | 5 MB | invoice PDFs |
   | `music` | **yes** (read) | 6 MB | the music library (royalty-free, admin uploads only) |
   | `gallery-videos` | no, no Storage policies | 50 MB | owners' Gallery videos and posters (server tokens only) |

7. **Deploy** (push to `main`, or GitHub Actions → Deploy → Run workflow), then the domain: the `routes` in
   `wrangler.jsonc` (`docs/DEPLOY.md` section 5) create `bupulse.com` and `www` as **proxied (orange cloud)** records;
   delete any old grey-cloud `A`/`CNAME` records for them first.
8. **Music library**: the 20 original tracks are not in the repository. Keep the folder (and the git-ignored runner
   `scripts/local/seed-music.mjs`) in Google Drive, office@bupulse.com, then, from your Mac with
   the production values: `node --env-file=.env.production scripts/local/seed-music.mjs <folder> --dry-run`, then
   without `--dry-run` (`docs/VOICE_AND_MUSIC.md`). It needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` and
   `DIRECT_URL`, prints file names and counts only, and is safe to run twice. Check Admin → Music: 20 tracks, each
   playing. Until then videos have no music.
9. **After deploy** (`docs/DEPLOY.md` section 6):
   - `https://bupulse.com/api/status` answers `{"status":"ok"}`.
   - Header check with the `PLATFORM_CHECK` secret for 10 minutes, then delete it.
   - Worker logs show `[cron] /api/cron/publish` every minute.
   - Admin: sign in as admin@bupulse.com, set up the authenticator, set MoMo details, trial days, availability,
     Connect Google Calendar.
   - Sign up a real test company from a phone in Rwanda: prices in RWF, book a demo, start trial, pay **100 RWF** by
     MoMo (temporary test plan or price), confirm in Admin → Payments, company becomes active.
   - Free uptime monitor (e.g. UptimeRobot free) on `/api/status` every 5 minutes, alerts to office@bupulse.com.
10. **Owner, after the deploy** (Admin console):
   - Settings → **Admin currency**: set the Default currency (RWF), and the EUR rate or its daily refresh.
   - Organisation → **Sales screen**: create the TV link, open it on the TV, click "Start screen" once; add sounds
     with **Generate a sound** (or upload MP3s you hold the rights to): the local sounds script is for the test
     project only.
   - Organisation → **Staff**: invite the staff with their roles (each signs in with an emailed code and an
     authenticator). Settings → page-loading animation if you want another one.
11. **Hand-over zip**: `git archive --format=zip -o BuPulse-2.0.0.zip main` (no `node_modules`, `.next` or `.env`).

## Migrations added on 13 October

Applied by the deploy workflow (`prisma migrate deploy`) in name order on the new production database; nothing to do
by hand. Some were written later than a migration with a higher timestamp (e.g. `20261017191000_card_carry_over`
after `20261017200000_admin_money`): `migrate deploy` applies every pending one, so this is harmless on a fresh
database and on the test database.

`20261017110000_voice_clip_states`, `20261017120000_music_seed_moods`, `20261017130000_gallery_videos`,
`20261017140000_gallery_videos_bucket`, `20261017150000_content_run_claim`, `20261017150100_posts_per_app_per_day`,
`20261017150200_contest_posts`, `20261017170000_payment_proofs`, `20261017180000_content_format`,
`20261017190000_request_goals_optional`, `20261017191000_card_carry_over`, `20261017200000_admin_money`,
`20261017200100_admin_money_rates`, `20261018100000_organisation`, `20261018100100_admin_key_scope`,
`20261018105000_screen_billing_event_time`, `20261018110000_offer_card_pay_method`, `20261018120000_lead_alerts`
(push subscriptions, and the WhatsApp alert toggle and number on the widget settings).

**Test-only scripts, never run against production:** `scripts/local/seed-test-staff.mjs` (one test person per role,
passwords to `TEST_ACCOUNTS.md`) and `scripts/local/generate-screen-sounds.mjs` (sounds for the sales TV; it refuses
any project that is not the test one). Both are git-ignored; copies are in `~/BuPulse-v2/scripts/local`. On the live
site, staff are invited from Admin → Organisation → Staff, and the TV's sounds are made in Admin → Organisation →
Sales screen → **Generate a sound** (or uploaded there). (`scripts/local/seed-music.mjs` is the one local script that does run against production, step 8.)

## Lead alerts: push and WhatsApp

Every new lead runs four independent channels side by side (`lib/leads/notify.ts`): the instant email, the
lead.created webhook, **push** to the devices that switched alerts on, and **WhatsApp** when it is switched on. A slow
or failing channel never stops or delays the email.

**Phone and browser push (free, on at launch once the keys are set).** Web Push with VAPID, no paid service and no
library (`lib/push/web-push.ts`, WebCrypto, so it runs in the Worker). Each person turns on "Alerts on this device" on
the Leads page, per device (Members too: they work the leads). The alert says "New lead: <name>" with the first
message or the phone number; tapping it opens `/dashboard/leads/<id>`. Devices the push service no longer knows (404,
410) are removed. On an iPhone it works once BuPulse is added to the Home Screen (iOS 16.4+), which the switch explains.

- Production needs its **own** key pair (never the local one): run the one-line command in `.env.example` once, then
  `npx wrangler secret put VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:office@bupulse.com`).
  Without them the switch is hidden; nothing breaks. Changing the pair later means every device must switch alerts on
  again, so set it once. `scripts/check-env.mjs` warns when they are missing and refuses malformed ones.

**Official WhatsApp alerts (built, OFF).** A utility template sent with the WhatsApp Cloud API to the owner's number
(the "WhatsApp number for alerts" in Leads → Notifications, else the business phone). Nothing is sent and clients see
no WhatsApp option until both the keys are set and the service is on. To switch it on:

1. **Meta Business Verification** for BuPulse's Business Manager (business.facebook.com → Security centre), if not
   done already for Facebook publishing (`docs/META_APP_REVIEW.md`).
2. **A WhatsApp business number**: in the Meta app (developers.facebook.com → the BuPulse app → WhatsApp → API
   setup), add a phone number BuPulse owns that is not used in the WhatsApp app, verify it by SMS or call, and set
   the display name "BuPulse". Note its **Phone number ID**.
3. **The template**, WhatsApp Manager → Message templates → Create: category **Utility**, name **`new_lead_alert`**,
   language **English (en)**:
   - Body: `New lead for {{1}}: {{2}} got in touch through your website chat and wrote: "{{3}}". Open BuPulse to see the details and reply.`
     (samples: `Nova Phones Kigali`, `Jane Uwase`, `Do you have the Galaxy A15 in blue?`)
   - Button: **Visit website**, text `Open lead`, URL type **Dynamic**, `https://bupulse.com/dashboard/leads/{{1}}`
     (sample: `https://bupulse.com/dashboard/leads/cm123example`).
   - Wait for "Approved". If you change the name or language, set `WHATSAPP_ALERT_TEMPLATE` /
     `WHATSAPP_TEMPLATE_LANGUAGE`.
4. **A permanent token**: Business settings → System users → add one (Admin), assign the app and the WhatsApp
   account, generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`, no expiry.
5. **The values**: `WHATSAPP_CLOUD_TOKEN` (the token) and `WHATSAPP_PHONE_NUMBER_ID` as Worker secrets (`npx wrangler
   secret put NAME`), then redeploy.
6. **A payment method** in WhatsApp Manager (utility messages are paid per message, by the recipient's country).
7. **Admin → Services → WhatsApp Cloud API**: Test now (it reads the number's details, free), then switch it **on**.
   Owners and Admins then see "WhatsApp alerts" with their number in Leads → Notifications.

Cost: each alert is counted (Admin → Services → WhatsApp: alerts sent, estimated cost) and appears in Money → Costs as
"Meta (WhatsApp lead alerts)", an estimate at `WHATSAPP_UTILITY_USD` (`lib/leads/whatsapp.ts`, a placeholder: **check
Meta's rate card** and change it) until you enter Meta's real bill for the month under Provider bills. It is not
counted in any company's AI allowance. To stop it, switch the service off: nothing else changes.

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

- **Code**: Admin → Settings → Updates → Roll back (the Worker's previous version, `wrangler rollback`), or GitHub
  Actions → Deploy → Run workflow with `rollback`. On the Netlify fallback: `node scripts/netlify-rollback.mjs`.
- **Database**: migrations only add tables and columns, so the previous code keeps working on the new schema. Restore
  from the backup only if data was damaged.

## Links follow the host (test machine and production)

Every link and redirect a visitor causes uses the address they are on (`lib/auth/request-site.ts`): `requestSiteUrl()`
for redirects and Secure cookies, `linkSiteUrl()` for links in emails and pages. Only addresses we serve count
(`NEXT_PUBLIC_SITE_URL` plus `AUTH_EXTRA_ORIGINS`); any other Host header gets the configured address. Scheduled jobs
(everything run through `recordCron`) and work outside a request use `publicSiteUrl()` (`PUBLIC_LINK_URL`, else
`NEXT_PUBLIC_SITE_URL`). **In production** `AUTH_EXTRA_ORIGINS` and `PUBLIC_LINK_URL` stay empty, so every link is
https://bupulse.com whatever Host arrives (tests/auth/request-site.test.ts).

Kept on a deliberate base, and why:

| Address | Base | Why |
|---|---|---|
| Canva OAuth redirect (`/api/canva/callback`, or `CANVA_REDIRECT_URI`) | `siteUrl()` | Registered in the Canva developer portal; Canva accepts only listed URIs. |
| Social OAuth redirects (`/api/social/<network>/callback`) | `siteUrl()` | Registered in each Meta, LinkedIn, TikTok and YouTube app; a host not listed there is refused. |
| Shopify OAuth redirect (`/api/stores/shopify/callback`) | `siteUrl()` | Listed under "Allowed redirection URLs" in the Shopify app. |
| Google Calendar OAuth redirect (`/api/admin/google-calendar/callback`) | `siteUrl()` | Registered in Google Cloud (shown on Admin -> Settings). |
| WooCommerce `callback_url` | `publicSiteUrl()` | The store posts the keys to us server to server: it must be reachable from the internet (WooCommerce takes any URL per request; `return_url` follows the visitor). |
| Shopify webhooks, Paddle webhook destination | `publicSiteUrl()` | Called by Shopify and Paddle servers: the public address. |
| Chat widget script (`scriptTag`, the Cloudflare install, Widget and Domains pages) | `publicSiteUrl()` | Pasted into customers' sites and loaded from anywhere for months: never a visitor's host. |
| Demo `.ics` link, invoice pay link, lead and calendar-event links | `publicSiteUrl()` | Opened later, from calendar apps, PDFs or phones. |

On the test machine, an OAuth connect started on https://test.bupulse.com still returns to the registered
`NEXT_PUBLIC_SITE_URL` (localhost) unless that provider also lists the tunnel's callback: connect those from
http://localhost:3001.

## Known limits at launch

- Facebook and Instagram publishing for clients needs Meta Business Verification and App Review
  (`docs/META_APP_REVIEW.md`); until then clients get reminders plus copy-and-post.
- Card payments need Paddle live approval; until then MoMo and invoices only.
- Cloudflare Workers Paid: $5 a month includes 10 million requests and 30 million CPU milliseconds; the crons (about
  45,000 runs a month, the publisher every minute) and the video robot's calls are a small part of that. The Worker is
  9.2 MiB gzipped against a 10 MiB limit (`docs/DEPLOY.md`, Known notes): re-measure before adding a heavy
  library. Videos are never rendered in the Worker.
- Supabase free: 500 MB database, 1 GB file storage (uploads stop at 900 MB), the project pauses after 7 days without
  traffic (the uptime monitor keeps it awake). Videos fill storage fast: a Gallery video can be 50 MB and each company
  may keep 100 MB of them at launch (`MEDIA_COMPANY_VIDEO_MAX_BYTES`, the default), so about eight busy companies
  could fill the free storage. Rendered videos (8 MB at most) are deleted 30 days after their posts go out,
  unrecorded files daily. Watch Admin → Health, and move to Supabase Pro (100 GB) before many clients upload videos.
