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
- **A week of posts in one click** (content packs): different posts for each angle and each app, written for that app,
  from your products, campaigns and Gallery; the best day and time for each.
- **Every post has its picture, carousel or video**, designed from your own photos first; AI scenes can show local
  people using your product (plans with AI photos).
- **Your own videos first**: upload MP4, MOV or WebM clips (up to 60 seconds) to the Gallery and albums; BuPulse posts
  them as Reels and Shorts and writes the caption about what they show.
- **Videos made for you** from your photos and script: captions in time, a voiceover in your chosen voice (plans with
  voiceover) and royalty-free music; made automatically in the background, or in your browser.
- Coming next: the design library (templates you can browse and reuse).

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
| 8 | Copy the 20 music tracks and `scripts/local/seed-music.mjs` to Google Drive (office@bupulse.com) | Google Drive | 5 min |
| 9 | Fill `.env.production` (from `.env.example`) and run `node --env-file=.env.production scripts/check-env.mjs --runtime` | your Mac | 30 min |

## Go-live day (in this order)

1. **Freeze**: no new merges into `v2` except fixes found on the day.
2. **Final checks on v2**: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npx next build`, and an offline
   Netlify build (`npx netlify-cli@27.12.0 build --offline`).
3. **Merge v2 into main** (merge commit, version 2.0.0). Push only with the owner's go-ahead.
4. **Production database**: the deploy workflow runs `prisma migrate deploy` on the new Supabase project. Regions,
   plans, add-ons and industries are seeded by the migrations; check them in Admin → Plans / Regions / Industries.
5. **Environment variables**: the complete list, where each goes and what happens without it is
   `docs/DEPLOY_NETLIFY.md` section 2 (and `.env.example`, every variable, grouped and commented). The deploy workflow
   checks them before building (`scripts/check-env.mjs`: names and problems only, never values) and stops on a missing
   required one or a development switch; check yourself first with `node --env-file=.env.production
   scripts/check-env.mjs --runtime`. New since 1.x: `AI_COMPANY_MONTHLY_USD` (3), `AI_MONTHLY_BUDGET_USD` (30),
   `WIDGET_AI_SHARE` (0.5), `MEDIA_PLATFORM_MAX_BYTES` (900 MB), `MEDIA_COMPANY_VIDEO_MAX_BYTES` (300 MB),
   `ELEVENLABS_API_KEY` (voiceover and Generate a track), `VIDEO_ROBOT_SECRET` (plus the GitHub secret of that name and
   the repository variable `ROBOT_APP_URL`), `NEXT_PUBLIC_WHATSAPP_NUMBER`, `GEO_PROVIDER=builtin`, `PLATFORM=netlify`,
   `API_KEY_PEPPER` (new random value), `GOOGLE_CALENDAR_CLIENT_ID/SECRET`. Never copy `ANALYTICS_DEV_COUNTRY` or
   `REGION_OVERRIDE` to production (the check refuses them). Build-time values (every `NEXT_PUBLIC_*`, plus
   `PLATFORM=netlify`) must also be **GitHub variables**: the deploy workflow builds offline in GitHub without the
   Netlify token, so it can't read Netlify's settings at build time.
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

7. **Deploy** (GitHub Actions → Deploy to Netlify), then DNS at Cloudflare (DNS only, grey cloud).
8. **Music library**: the 20 original tracks are not in the repository. Keep the folder (and the git-ignored runner
   `scripts/local/seed-music.mjs`) in Google Drive, office@bupulse.com, then, from your Mac with
   the production values: `node --env-file=.env.production scripts/local/seed-music.mjs <folder> --dry-run`, then
   without `--dry-run` (`docs/VOICE_AND_MUSIC.md`). It needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` and
   `DIRECT_URL`, prints file names and counts only, and is safe to run twice. Check Admin → Music: 20 tracks, each
   playing. Until then videos have no music.
9. **After deploy** (`docs/DEPLOY_NETLIFY.md` section 7):
   - `https://bupulse.com/api/status` answers `{"status":"ok"}`.
   - Header check with `PLATFORM_CHECK=1` for 10 minutes, then remove it.
   - Admin: sign in as admin@bupulse.com, set up the authenticator, set MoMo details, trial days, availability,
     Connect Google Calendar.
   - Sign up a real test company from a phone in Rwanda: prices in RWF, book a demo, start trial, pay **100 RWF** by
     MoMo (temporary test plan or price), confirm in Admin → Payments, company becomes active.
   - Free uptime monitor (e.g. UptimeRobot free) on `/api/status` every 5 minutes, alerts to office@bupulse.com.
10. **Hand-over zip**: `git archive --format=zip -o BuPulse-2.0.0.zip main` (no `node_modules`, `.next` or `.env`).

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
  Since 2.0 two more regular callers spend credits: the hourly content summary (`cron-content-summary`, about 720
  runs a month) and the video robot's API calls from GitHub every 15 minutes (about 2,900 claim calls a month, plus
  one upload and confirm per video). Both are short (about 1 s), so together roughly 10 to 20 credits a month; videos
  are never rendered on Netlify. Budget in `docs/DEPLOY_NETLIFY.md` (Free plan limits).
- Supabase free: 500 MB database, 1 GB file storage (uploads stop at 900 MB), the project pauses after 7 days without
  traffic (the uptime monitor keeps it awake). Videos fill storage fast: a Gallery video can be 50 MB and each company
  may keep 300 MB of them, so three busy companies could fill the free storage. Rendered videos (8 MB at most) are
  deleted 30 days after their posts go out, unrecorded files daily. Watch Admin → Health; lower
  `MEDIA_COMPANY_VIDEO_MAX_BYTES` (e.g. 100 MB) for launch, or move to Supabase Pro (100 GB) before many clients
  upload videos.
