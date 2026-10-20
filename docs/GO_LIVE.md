# Going live: the steps in order (written 20 October 2026)

The short checklist for putting `launch-rc` on bupulse.com. The details behind each step are in `docs/DEPLOY.md`
(Cloudflare, secrets, GitHub), `docs/RELEASE_2.0.md` (go-live day, Supabase settings, backups, rollback) and
`docs/STUDIO_DEPLOY.md` (studio.bupulse.com). "You" is the owner; "Claude" is the main Claude session.

**State of `launch-rc` today:** every branch combined (video studio side, bizdev, inbox and automations,
BuPulse-Socials, phone app and Share to WhatsApp, link in bio, testimonials). Type check, all tests and the build
pass. The Cloudflare Worker is about 9,050 KiB gzipped against the 10 MiB limit (`docs/DEPLOY.md`, Known notes).

## A. Before the day (you, about 3 hours in all)

| # | Step | Who | Where | Time |
|---|---|---|---|---|
| 1 | Cloudflare Workers Paid ($5 a month, decided 13 October), then `npx wrangler login` on this Mac | you | dash.cloudflare.com | 15 min |
| 2 | Create the production Supabase project (free; region nearest Rwanda that is offered) | you | supabase.com | 15 min |
| 3 | Create the Hyperdrive config with the new project's session pooler string (`docs/DEPLOY.md` section 1) and tell Claude the `id` it prints (an id, not a secret); Claude puts it in `wrangler.jsonc` | you, then Claude | Terminal | 10 min |
| 4 | Fill `.env.production` from `.env.example` with the production values yourself (never paste keys in chat). New values for `ENCRYPTION_KEY`, `API_KEY_PEPPER`, `CRON_SECRET`, `VIDEO_ROBOT_SECRET` and a new VAPID pair. `AUTH_EXTRA_ORIGINS` and `PUBLIC_LINK_URL` stay empty. Claude then runs `node --env-file=.env.production scripts/check-env.mjs --runtime` (names and problems only) | you, then Claude | this Mac | 45 min |
| 5 | Decide the AI budget: `AI_MONTHLY_BUDGET_USD` is 30 today, and one Business client at full use costs about $26 (`docs/PLANS.md`). Suggested: 60 at launch, warned at 80%, raised as clients pay | you | `.env.production` | 5 min |
| 6 | Resend: add the SPF, DKIM and DMARC records it shows for bupulse.com in Cloudflare DNS | you | resend.com, Cloudflare | 15 min |
| 7 | GitHub, Settings, Environments, `production` (deployment branch `main` only): the secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DIRECT_URL`, `CRON_SECRET`, `VIDEO_ROBOT_SECRET` and the variables `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_WHATSAPP_NUMBER`, `ROBOT_APP_URL` | you | github.com | 20 min |
| 8 | Put the runtime values in Cloudflare (`npx wrangler secret put NAME` for each, `docs/DEPLOY.md` section 2) | you (Claude can run it from `.env.production` without showing values, if you say so) | Terminal | 20 min |
| 9 | Send the MoMo Pay code (or the number clients pay to), the Airtel number and your demo availability | you | chat | 5 min |
| 10 | Reset the keys that were once pasted in chat (ElevenLabs, the old test Supabase) | you | each dashboard | 15 min |
| 11 | Install the free Postgres tools for backups | you | postgresapp.com | 10 min |

## B. Go-live day (in this order)

1. **You say "go"**: Claude merges `launch-rc` into `main` (local only) and runs the final checks again, including
   the Worker size.
2. **You say "push"**: Claude pushes `main`. GitHub's deploy workflow checks the values, runs the migrations on the
   production database, builds and deploys the Worker. If anything fails, nothing is deployed.
3. **Supabase production settings** (you): Auth, URL configuration: site URL `https://bupulse.com`, redirects
   `https://bupulse.com/**`; SMTP with Resend. Check the storage buckets (`docs/RELEASE_2.0.md`, step 6).
4. **Domain**: delete any old grey-cloud records for `bupulse.com` and `www` in Cloudflare; the Worker's routes
   create them (`docs/DEPLOY.md` section 5).
5. **Checks** (Claude): `https://bupulse.com/api/status` answers ok; the publish cron runs every minute; the home,
   pricing, sign-up and `/b/` pages answer.
6. **Admin set-up** (you): sign in as admin, set up the authenticator, MoMo details, trial days, availability,
   Connect Google Calendar, admin currency RWF.
7. **Music library** (you, or Claude on your go): seed the 20 tracks (`docs/RELEASE_2.0.md`, step 8).
8. **First real journey** (you, from a phone in Rwanda): sign up, book a demo, start the trial, pay **100 RWF** by
   MoMo, confirm it in Admin, Payments. Install BuPulse on the phone and share one post to WhatsApp Status.
9. **First real social post** (you): connect one real Instagram and Facebook account through BuPulse-Socials and
   publish one post. TikTok posts stay private until TikTok audits the app (apply once the site is live).
10. **Uptime monitor** (you): a free monitor on `/api/status` every 5 minutes (it also keeps Supabase awake).

## C. After the day

- **Video Studio** (`docs/STUDIO_DEPLOY.md`, "Going live"): production keys file with `ANTHROPIC_API_KEY` (the
  Claude subscription is never used online), the tunnel to studio.bupulse.com, then switch "Video Studio" on in Admin,
  Services. Until then clients get the daily slideshow videos and the studio button stays hidden.
- **Card payments**: when Paddle approves the live account, Admin, Settings, Card payments, **Set up prices**.
- **RDB registration by 13 November**: unlocks Meta verification (Instagram and Facebook auto-replies), an
  automatic MoMo provider and larger income (`docs/bizdev/PLAN.md`, section 9).
- **TikTok audit**: apply once bupulse.com is live, so TikTok posts can be public.
- **First testimonials**: add 3 to 5 real quotes with consent in Admin, Content, Testimonials during the first weeks.
- **Watch** Admin, Health (Supabase free storage is 1 GB) and the AI budget.

## If something goes wrong

Roll back from Admin, Settings, Updates, or redeploy the previous Worker (`docs/RELEASE_2.0.md`, "Rolling back").
Switch a service off in Admin, Services to stop it at once without a deploy.
