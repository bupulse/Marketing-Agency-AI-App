# Troubleshooting

This page is for when something is broken. Find the symptom in the tables below: each row says what it usually
means, where to look first (a page in the admin console and, for a developer, the code file and function), and how
to fix it. Most problems are a missing key, a service switched off in Admin → Services, a scheduled job that did not
run, or a setting at an outside provider (Supabase, Meta, Google, Paddle). The last section explains the four admin
pages that help with every problem and where each host keeps its server logs.

**On this page**
- [The site will not start or is down](#the-site-will-not-start-or-is-down)
- [Sign-in and accounts](#sign-in-and-accounts)
- [Admin sign-in: emailed code and authenticator](#admin-sign-in-emailed-code-and-authenticator)
- [AI writing, images and the website chat](#ai-writing-images-and-the-website-chat)
- [Emails](#emails)
- [Publishing posts](#publishing-posts)
- [Connecting social accounts](#connecting-social-accounts)
- [Payments and plans](#payments-and-plans)
- [Videos, voiceovers and music](#videos-voiceovers-and-music)
- [Imports: store sync, Canva, Google Drive](#imports-store-sync-canva-google-drive)
- [Updates and deploys](#updates-and-deploys)
- [Database and migrations](#database-and-migrations)
- [How to debug](#how-to-debug)

## The site will not start or is down

| Symptom | What it usually means | Where to look first | Fix |
|---|---|---|---|
| Deploy stops at "Check the build variables" or "Check the Worker's secrets" | A required variable is missing on GitHub or the host | GitHub → Actions → the run's log (names only). Code: `scripts/check-env.mjs` (`checkEnv`, `RUNTIME_REQUIRED`, `BUILD_REQUIRED`) | Add the named variable (`.env.example` says what it is). Locally: `node --env-file=.env scripts/check-env.mjs --runtime` |
| Locally the app crashes with "`DATABASE_URL is not set`", "`ENCRYPTION_KEY is not set`", "`Encryption key must be 32 bytes (base64)`" or "`SUPABASE_SECRET_KEY is not set`" | `.env` missing or incomplete | `lib/db.ts` (`createClient`), `lib/crypto.ts`, `lib/supabase/admin.ts` | Fill in `.env` ([Run on a new computer](install/01-run-on-a-new-computer.md#step-3-fill-in-the-settings-file-env)) |
| "Cannot find module … `lib/generated/prisma` …" | Prisma client not generated | | `npx prisma generate --config prisma7.config.ts` |
| "Prisma's query compiler was not loaded (worker.ts)" in dev or tests | A Cloudflare build was stopped hard and left the client patched | `scripts/cf-build.mjs` | `npx prisma generate --config prisma7.config.ts` |
| `/api/status` says `down`, every page errors | The database cannot be reached. The free Supabase project pauses after 7 days without traffic | Supabase dashboard (project paused?). Code: `app/api/status/route.ts` | Restore the project in Supabase; keep an uptime monitor on `/api/status` so it stays awake |
| Netlify shows "Site not available" | The free plan's 300 credits are used up: every site on the account is paused until next month | Netlify → Usage & billing | Wait, or upgrade (Personal plan). Deploy in batches: each production deploy costs 15 credits |
| "Failed to find Server Action" or a button does nothing right after a deploy | The browser tab still has the old version's page | | **Refresh the tab** (reload the page). Nothing is wrong with the site |
| Cloudflare deploy fails: Worker too large | The bundle is over **10 MiB gzipped** (Workers Paid limit) | `npm run build:cloudflare`, then `npx wrangler deploy --dry-run --outdir /tmp/cf` prints the size. Notes: `docs/DEPLOY.md`, "Known notes" | Remove or externalise the heavy library (`serverExternalPackages` in `next.config.ts`); keep big libraries out of server code shared by many routes |
| Netlify: `[platform] production resolved to plain Node` in the logs | The host was not detected | `lib/platform/detect.ts` | Set `PLATFORM=netlify` on Netlify and redeploy |

## Sign-in and accounts

| Symptom | What it usually means | Where to look first | Fix |
|---|---|---|---|
| Confirmation email never arrives | Supabase's mail settings (SMTP) or its hourly email limit | Supabase → Authentication → Emails (SMTP) and Rate Limits; `docs/EMAIL_SETUP.md` | SMTP through Resend with user name `resend` in **lower case** (`Resend` makes every email fail with "Error sending confirmation email"); raise the email rate limit |
| Email link opens `localhost` or the wrong site | Supabase's Site URL / redirect URLs | Supabase → Authentication → URL Configuration | Site URL = `NEXT_PUBLIC_SITE_URL`; redirect `<site>/**` |
| `/login?error=confirm` | The confirmation link was old, used, or opened after a new one was sent | `app/auth/confirm/route.ts` | Send a new link from the sign-up or sign-in page |
| "It was created with Google, so use Continue with Google." | Each account has one sign-in method | `app/auth/callback/route.ts`, `app/login/page.tsx` | Use the method the account was made with (a Google account can add a password by resetting it) |
| The person lands on `/account/waiting` | A teammate whose company owner has not finished the setup | `app/account/waiting` | The owner finishes sign-up and onboarding |
| `/suspended` or `/account/deletion` | The account was suspended by the team, or deletion was asked (30-day grace) | Admin → Users / Companies. Code: `suspendUser`, `restoreUser` (`lib/admin/service.ts`) | Restore the user in the admin, or the owner cancels the deletion by signing in |
| Signed-out visitors are not sent to `/login` | `proxy.ts` did not run | `proxy.ts` (`proxy`, `PROTECTED`, `config.matcher`) | On Cloudflare, `proxy.ts` is experimental in OpenNext: check sign-in after each deploy |

## Admin sign-in: emailed code and authenticator

| Symptom | What it usually means | Where to look first | Fix |
|---|---|---|---|
| `/admin` shows "page not found" | You are not signed in as the owner or an enabled staff member, or lack the page's permission | `lib/admin/auth.ts` (`requireAdmin`, `requirePermission`) | Owner: put the address in `ADMIN_EMAILS` and redeploy (Netlify) or restart (local). Staff: Admin → Organisation → Staff |
| The admin email has a link but no code | The Supabase Magic Link template has no `{{ .Token }}` | Supabase → Authentication → Email Templates → Magic Link | Add `<p>Your BuPulse admin code: <strong>{{ .Token }}</strong></p>` |
| No admin email at all, no error | The address has no account yet (the admin sign-in never creates one), or it is not allowed (same answer on purpose) | `canReceiveAdminCode` in `lib/admin/auth.ts`; `sendAdminCode` in `app/admin/(auth)/login/actions.ts` | Create the account once at `/signup` (or Supabase → Users → Add user); check `ADMIN_EMAILS` |
| "A code was sent very recently. Wait a minute, then try again." | Supabase's email limit per address | | Wait a minute |
| "That code did not work. Check the latest email, or send a new one." | Old or mistyped code | `verifyAdminCode` | Use the newest email's code |
| "The admin console needs your admin email and an emailed code (not Google)…" | You signed in with Google | `/admin/login?error=email_only` | Sign out, sign in with the emailed code |
| "That code did not match. Check your phone's clock and try the next code." | Authenticator code wrong or the phone's clock is off | `app/admin/(auth)/actions.ts` (`verifyCode`, `confirmEnrollment`) | Set the phone's time to automatic; wait for the next code |
| Every code refused, even correct ones; "Too many attempts. Wait a few minutes and try again." | 5 wrong authenticator codes in 10 minutes (the MFA hook), or 8 tries in 10 minutes on `/admin/verify` | Supabase → Authentication → Hooks; migration `20261009070000_admin_mfa_hook` | Wait 10 minutes |
| "Authenticator-app sign-in is switched off for this project…" | TOTP is off in Supabase | Supabase → Authentication → Multi-Factor | Turn TOTP enrolment and verification on |
| Lost the phone with the authenticator | | Supabase → Authentication → Users → the admin → Factors | Delete the factor, then set it up again at `/admin/setup-2fa` |

## AI writing, images and the website chat

| Symptom | What it usually means | Where to look first | Fix |
|---|---|---|---|
| "This feature is temporarily unavailable. Please try again later." | The AI service (Gemini or Claude) is **switched off** in the kill switch | **Admin → Services** (the Gemini / Claude card). Code: `lib/admin/switch.ts` (`assertServiceEnabled`, `UNAVAILABLE_MESSAGE`) | Switch it back on |
| AI pauses for **every** company; Admin → Errors shows "AI budget reached: $… of $… in …; AI calls are paused" | BuPulse's monthly AI budget is used up | **Admin → AI calls and spend** (`/admin/ai`). Code: `lib/ai/budget.ts` (`assertWithinBudget`, `effectiveBudgetUsd`), `AI_MONTHLY_BUDGET_USD` | Raise the budget on that page (applies within 30 seconds), or wait for the 1st of the month (Kigali time) |
| One company: "Your monthly AI allowance is reached. It renews on the 1st of next month." | That company used its own allowance | Admin → Usage per client. `assertCompanyWithinBudget`, `companyAllowanceUsd` (`lib/ai/budget.ts`); `AI_COMPANY_MONTHLY_USD` or the plan's allowance (Admin → Plans) | Sell an add-on or raise the plan's allowance |
| "Your plan is not active…", "Your free trial has ended…", "Your demo comes first…" | The account is read-only (plan ended, trial over, waiting for demo) | `accountBlock`, `blockMessage` (`lib/entitlements.ts`); `consumeUsage` (`lib/usage.ts`) | The client pays, or the team starts the trial / extends it |
| Writing fails; server log says "`GEMINI_API_KEY is not set (see .env.example)`" (or `ANTHROPIC_API_KEY`) | No AI key | **Admin → Services** → Gemini → **Add key**, then **Test now**. Code: `lib/ai/index.ts` | Add the key (no redeploy) |
| Admin → Services → Test now fails for Gemini | Key wrong, expired or out of quota at Google | `runProbe` in `lib/admin/service-tests.ts` | Make a new key in Google AI Studio and **Replace** it |
| Website chat: no bubble on the client's site | Wrong key, chat off, site not in Allowed websites, or the plan has no website chat | The browser console on that site shows `unknown_key`, `disabled`, `not_allowed` or `unavailable` (plan); the client's Website chat page shows the real reason. Code: `app/api/widget/config/route.ts`, `lib/widget/origin.ts` | Fix the snippet or the Allowed websites list; add the feature to the plan |
| Chat shows only "Leave your details and the team will get back to you." | No AI reply: chat credits used, the chat's share of the AI allowance used (`WIDGET_AI_SHARE`), trial over or plan inactive, Gemini off | Admin → Usage per client; Admin → Services. Code: `handleChat` (`lib/widget/chat.ts`), `WidgetBudgetExceededError` (`lib/ai/budget.ts`) | Leads still work. Raise the plan's chat limit or allowance, renew the plan, switch Gemini on |
| Chat stuck on a security check, or refuses the first message | Cloudflare Turnstile: wrong keys, or the host is not in the Turnstile widget's hostnames | `lib/widget/turnstile.ts` (`turnstileEnabled`, `verifyTurnstile`); Admin → Services → Turnstile → Test now | Fix `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`; add the hostnames in Cloudflare Turnstile. Remove both keys to fall back to rate limits only |
| Chat stops accepting messages for a while | Rate limits: 60 requests per 10 minutes per IP, 20 messages per 10 minutes per visitor, 40 a minute per business; at most 40 visitor messages per session (then only the contact card) | `lib/widget/limits.ts` (`MAX_SESSION_MESSAGES`) | Normal protection; wait |

## Emails

| Symptom | What it usually means | Where to look first | Fix |
|---|---|---|---|
| No app emails (lead alerts, reminders, invoices, demo bookings, team invitations) | `RESEND_API_KEY` missing, or Resend switched off | **Admin → Services → Resend** (Test now lists the domains). Server log: "RESEND_API_KEY is not set; email not sent" or "Resend is switched off in the admin console". Code: `sendEmail` (`lib/publishing/email.ts`) | Add the key in Admin → Services; switch Resend on |
| Server log "[publishing.email] Resend refused the email: <status> …" | Usually the sending domain is not verified, or the sender is not on it | resend.com → Domains; `RESEND_FROM` | Verify bupulse.com (SPF, DKIM in Cloudflare DNS, `docs/EMAIL_SETUP.md`); the sender must be `@bupulse.com` |
| Emails land in spam | SPF/DKIM/DMARC not passing | Gmail → ⋮ → Show original | Add the DMARC record; check all three say PASS |
| Sign-up / password emails fail but app emails work | Those are sent by Supabase, not the app | Supabase → Authentication → SMTP | See "Sign-in and accounts" above |
| Locally, no emails | Normal without `RESEND_API_KEY` | | Add a key, or read the server log |

## Publishing posts

| Symptom | What it usually means | Where to look first | Fix |
|---|---|---|---|
| Posts stay **Scheduled** after their time | The publish job is not running | **Admin → Health** (the "Publish posts" row is late). Netlify: Logs → Functions → `cron-publish`, `cron-runner-background`. Cloudflare: Worker logs, `[cron] /api/cron/publish`. Code: `app/api/cron/publish/route.ts`, `publishDue` (`lib/publishing/engine.ts`) | Check `CRON_SECRET` is set on the host; run it by hand: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" <site>/api/cron/publish` |
| Locally, nothing ever publishes | Scheduled jobs do not run on your computer | | Call `/api/cron/publish` by hand (above), on `http://localhost:3001` |
| Posts for one network wait as Scheduled, not failed | That network is switched off in Admin → Services | Admin → Services; `disabledNetworks` (`lib/admin/switch.ts`) | Switch it on: they go out at the next run |
| Posts held with a plan reason | The company's plan ended or is read-only | `accountBlock` (`lib/entitlements.ts`), `periodState` (`lib/billing/period.ts`) | The client renews |
| **Failed**, account shows **Needs reconnect** | The network no longer accepts the login | Client: Channels. Admin → Connections | The client presses **Reconnect**, then **Retry** on the post |
| **Post it yourself** with "We could not confirm this post went out…" | A run crashed or the network timed out at the last step: BuPulse never posts twice when unsure | `sweepStalePosts`, `UNCONFIRMED_MESSAGE` (`lib/publishing/engine.ts`) | The client checks the network, then **Mark as posted** or retry |
| **Failed** after 5 tries | Waits 1, 5, 15, 60 minutes between tries (`MAX_ATTEMPTS`, `BACKOFF_MINUTES`) | The post shows the reason; Admin → Errors | Fix the reason (often the login), then Retry |
| Posts with photos fail; others work | The publisher signs photo links with `SUPABASE_SECRET_KEY` | Host environment | Set `SUPABASE_SECRET_KEY` on the host |
| Instagram: "This photo is too large (over 4096 pixels on a side)…" | Instagram rule handled by BuPulse | `prepareForInstagram`, `ImageTooLargeError` (`lib/publishing/jpeg.ts`) | Use a smaller photo (the upload screen shrinks photos to 2048 px) |
| Instagram refuses PNG / WebP | Instagram only accepts **JPEG**. BuPulse converts each picture once to `<path>.jpg` (white background, quality 88), pads it to between 4:5 and 1.91:1 and keeps it under 8 MB | `toJpeg`, `prepareForInstagram` (`lib/publishing/jpeg.ts`); on Cloudflare the codecs come from `worker.ts` | If conversion fails on Cloudflare, check the `.wasm` imports in `worker.ts` and the CPU limit (`limits.cpu_ms` in `wrangler.jsonc`) |
| Instagram post refused, account fine elsewhere | The account must be Business or Creator, linked to a Facebook Page (Facebook login); some Pages need Page Publishing Authorization; limit about 100 API posts a day | `docs/PLATFORM_APPS.md` section 1 | Switch the account type; complete PPA |
| Posts of a deleted account | Accounts scheduled for deletion are not published | | Expected |

## Connecting social accounts

| Symptom | What it usually means | Where to look first | Fix |
|---|---|---|---|
| **Coming soon** instead of Connect | BuPulse's own app keys for that network are not set | **Admin → Services** (Meta, LinkedIn, TikTok, YouTube cards) | Add the keys (`docs/PLATFORM_APPS.md`) |
| "This network is not available yet" | The network is switched off | Admin → Services | Switch it on |
| The network's page says "redirect URI mismatch" / "URL blocked" | The callback address registered at the network does not match | The provider's developer portal. Code: `redirectUri` (`lib/social/oauth.ts`) = `NEXT_PUBLIC_SITE_URL` + `/api/social/<network>/callback` | Register exactly `https://bupulse.com/api/social/instagram/callback`, `/facebook/callback`, `/linkedin/callback`, `/tiktok/callback`, `/youtube/callback` (and the local port you use) |
| Connect works for you but not for a client (Facebook / Instagram) | Meta app not live: only people with a role on the app can connect until **Business Verification** and App Review pass | Meta developer dashboard; `docs/META_APP_REVIEW.md` | Add testers meanwhile; clients use reminders and copy-and-post |
| TikTok connect fails locally | TikTok accepts only HTTPS redirect addresses | `docs/PLATFORM_APPS.md` section 2 | Use an HTTPS tunnel or the staging site |
| LinkedIn: "No LinkedIn Pages available" | Company pages need the Community Management API approval and `LINKEDIN_COMMUNITY_MANAGEMENT=true` | Admin → Services → LinkedIn | Apply at LinkedIn; personal profiles work meanwhile |
| YouTube / Google sign-in stops working after a week; "access blocked" for clients | Google consent screen still in **Testing** (refresh tokens expire after 7 days, only listed test users) | Google Cloud → Google Auth Platform → Audience | User type External, publish to "In production" |
| Test machine: connect started on the tunnel returns to localhost | OAuth always returns to the registered `NEXT_PUBLIC_SITE_URL` | `docs/RELEASE_2.0.md`, "Links follow the host" | Connect from `http://localhost:3001` |
| Account shows **Expires soon** | The daily token refresh could not renew it | Admin → Health ("Refresh social tokens"); `.github/workflows/social-refresh.yml`, `app/api/cron/social-refresh/route.ts` | Reconnect; check the GitHub workflow runs and has `CRON_SECRET` |

## Payments and plans

| Symptom | What it usually means | Where to look first | Fix |
|---|---|---|---|
| Client paid by MoMo, still "Waiting for approval" | Mobile Money is checked **by hand**: the owner must confirm it | **Admin → Payments** (badge in the sidebar; Overview → "Waiting for approval"). Code: `confirmManualPayment` (`lib/billing/momo.ts`) | Check the MoMo SMS on the business phone, then **Confirm** (type the transaction id if the client had none) |
| "Transaction id seen before on payment …" | The same transaction id was used before | Admin → Payments | Check the SMS; reject with a reason if it is a reuse |
| Client sees "Mobile Money coming soon" | No MoMo code or number set, or the region does not list Mobile Money | **Admin → Settings → Payments: Mobile Money**; Admin → Regions and prices. Code: `lib/billing/momo-settings.ts`, `lib/billing/pay-methods.ts` | Fill in the merchant code / MTN / Airtel number |
| Airtel instructions missing | No Airtel number set | Admin → Settings → Payments: Mobile Money | Add the Airtel Money number |
| Client sees "Card payments coming soon" | Paddle not fully set up: missing key, token or webhook secret, Paddle off, or no card price for that plan and region | **Admin → Settings → Card payments (Paddle)** status line. Code: `lib/billing/card-ready.ts`, `getPaddleConfig` (`lib/billing/paddle-config.ts`) | Save the key and token, press **Set up prices**; switch Paddle on in Admin → Services |
| Card paid but the plan did not change | Paddle's webhook did not arrive or was not applied | 1) Paddle → Developer tools → Notifications: the destination must be **`https://bupulse.com/api/billing/webhooks/paddle`** and show deliveries. 2) **Admin → Payments → "Card events not applied"**. Code: `app/api/billing/webhooks/paddle/route.ts` → `processPaddleEvent` (`lib/billing/paddle-events.ts`) → `applyProviderSubscription` (`lib/billing/apply.ts`) | Run **Set up prices** again (it creates or updates the destination and saves its secret). Then press **Reprocess** on the stored event |
| Paddle's delivery log shows 401 | Wrong webhook secret, or the event is older than 5 minutes | `PADDLE_WEBHOOK_SECRET` or the saved secret in Settings → Card payments | Set up prices again (new secret), or replay the event from Paddle |
| Paddle's delivery log shows 500 "Webhook is not configured" | No webhook secret at all | same | Set up prices |
| Paddle's delivery log shows 500 for one event | A price BuPulse does not know (e.g. a missing price id); Paddle retries | Admin → Payments → Card events not applied; Admin → Errors (`billing.*`) | Fix the price (Set up prices), then Reprocess |
| Set up prices lists "Paddle refusing a localhost URL" | Paddle needs a public address for the webhook | | Normal locally; use a tunnel (`docs/BILLING.md`, "Testing webhooks locally") |
| Two card subscriptions for one account | Two checkouts at once; the second is cancelled by the webhook | Admin → Errors, source `billing.duplicate` | Refund that payment in Paddle |
| Billing still says **Active** after the paid period ended | Known limit: Billing shows the stored status until the daily job or a webhook updates it. Creating is already refused ("Your plan has ended") | `periodState` (`lib/billing/period.ts`): 3 days grace for Mobile Money, 1 day for card | Wait for the job (`/api/cron/momo-renewals`, daily 05:41 UTC) or the webhook; locally run the job by hand |
| Trials never expire, reminders never sent (locally) | Scheduled jobs do not run on your computer | `processTrialReminders` (`lib/demo/trial-reminders.ts`) | `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/api/cron/trial-reminders` |
| Trials never expire online | The hourly trial job is failing | **Admin → Health** ("Trial reminders"); host logs | Fix the error shown; check `CRON_SECRET` |

## Videos, voiceovers and music

| Symptom | What it usually means | Where to look first | Fix |
|---|---|---|---|
| No voiceover option, or "Generate a track" missing | No `ELEVENLABS_API_KEY`, ElevenLabs off, or the plan has no voiceover | **Admin → Services → ElevenLabs** (Test now). Code: `ensureVoiceover` (`lib/voice/service.ts`) | Add the key (paid ElevenLabs plan); add voiceover to the plan in Admin → Plans |
| Videos stay "Being made automatically" for a long time | The video robot is late, skipped or not set up | **Admin → Services → "Video robot"** (last run, made and failed in 24 h); Admin → Health; GitHub → Actions → "Video robot". Code: `lib/visuals/robot.ts` (`robotStatus`, `claimRobotVideos`) | GitHub's schedule is often 5 to 30 minutes late: the owner can press **Make it now**. Check `VIDEO_ROBOT_SECRET` (host and GitHub, same value) and `ROBOT_APP_URL` |
| Robot log says "Video robot is not set up … skipping." | The secret or the variable is missing | `.github/workflows/video-robot.yml` | Set both (`docs/VIDEO_ROBOT.md`) |
| The robot stopped running altogether | GitHub disables scheduled workflows after 60 days without commits | GitHub → Actions | Enable the workflow again |
| Videos have no music | The music library is empty (the tracks are not in git) | Admin → Music | Load the tracks (`docs/VOICE_AND_MUSIC.md`) |
| Uploads refused: storage full | Supabase free storage (1 GB): uploads stop at `MEDIA_PLATFORM_MAX_BYTES` (900 MB), each company's Gallery videos at `MEDIA_COMPANY_VIDEO_MAX_BYTES` (100 MB) | Admin → Health (storage) | Clean up, or move to Supabase Pro |

## Imports: store sync, Canva, Google Drive

| Symptom | What it usually means | Where to look first | Fix |
|---|---|---|---|
| Shopify / WooCommerce products not updated | The daily re-sync runs at 03:47 UTC, a few stores per call; the store is switched off, or its connection broke | Admin → Health ("Store sync"); Admin → Services (Shopify, WooCommerce). Code: `runDailyStoreSync`, `resyncConnection` (`lib/stores/sync.ts`), `app/api/cron/store-sync/route.ts` | Reconnect the store on the client's Stores page; run the job by hand |
| Shopify card shows "Coming soon" | `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` missing | Admin → Services → Shopify | Add the keys (`docs/CONNECTORS.md`) |
| Some store photos not imported | The Gallery has no room left | `galleryRoom` (`lib/stores/sync.ts`) | Free space or raise the limit |
| "Edit in Canva" missing | `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` missing, or Canva switched off | Admin → Services → Canva | Add the keys (`docs/CANVA.md`) |
| Canva: redirect error after signing in | The redirect URL is not registered in Canva's portal. Canva refuses `localhost` | Canva developer portal → Redirect URLs; `CANVA_REDIRECT_URI` | Register `<site>/api/canva/callback`. Locally open the app at `http://127.0.0.1:<port>` and use that address |
| Canva: only you can connect | The integration is still a draft (only the owner's Canva team) | Canva developer portal | Submit it for review |
| Google Drive import shows "Coming soon" | `GOOGLE_PICKER_API_KEY`, `GOOGLE_PICKER_APP_ID` or the client id missing | Admin → Services → Google Drive | Add them (`docs/CONNECTORS.md`) |
| Google Drive picker opens then fails, or "origin not allowed" | The site's address is not in the OAuth client's **Authorized JavaScript origins**, or the API key is restricted to other websites | Google Cloud → Credentials | Add `https://bupulse.com` (and your local address) to both; `GOOGLE_PICKER_APP_ID` must be the project **number** |

## Updates and deploys

| Symptom | What it usually means | Where to look first | Fix |
|---|---|---|---|
| Update zip refused at upload | Signature, fingerprint, size or content check failed | Admin → Settings → Updates (the message). Code: `checkRelease`, `verifyUploadedRelease` (`lib/updates/releases.ts`) | See the table in [Install an update zip](install/03-install-an-update-zip.md#when-something-fails) |
| Version shows **Failed** | A check, the build or a migration failed in the workflow; the live site is unchanged | GitHub → Actions → the run (red step) | Fix and make a new zip |
| Updates page says "Not connected" or "GitHub refused the token (401)" | `GITHUB_REPO` / `GITHUB_TOKEN` missing or expired | Host environment; `lib/admin/github.ts` | New fine-grained token (Actions read and write, Contents read) |
| Install starts the wrong host's workflow | `DEPLOY_TARGET` in the app's environment | `deployHost` (`lib/admin/deploy-host.ts`) | Set it to `netlify` or `cloudflare`, or leave it empty |
| A push to `main` deployed nothing | On Cloudflare the push trigger of `deploy.yml` is off; on Netlify the repository variable `DEPLOY_TARGET` must be `netlify` | GitHub → Actions; Settings → Variables | Set the variable, or Run workflow by hand |
| Deploy waits "Waiting for approval" | The `production` environment has required reviewers | GitHub → the run | Approve it (take a backup first) |

## Database and migrations

| Symptom | What it usually means | Where to look first | Fix |
|---|---|---|---|
| `migrate deploy` hangs or fails with a prepared-statement error | It ran through the transaction pooler | `DIRECT_URL` | Use the **session** connection (port 5432) for migrations |
| `P3009`: "migrate found failed migrations in the target database" | A migration stopped half-way earlier; Prisma will not continue | The deploy log; the table `_prisma_migrations` in Supabase | Read the failed SQL in `prisma/migrations/<name>/`. If nothing was changed, `npx prisma migrate resolve --rolled-back <name> --config prisma7.config.ts` and deploy again; if part was applied, finish or undo it by hand first (or restore the backup). Ask a developer |
| A migration fails on a column or type that does not exist / already exists | The database was changed by hand, or `migrate dev` was used against it | Compare `prisma/schema.prisma` with the database | Never use `migrate dev` on a shared or production database; restore the backup or write a fixing migration |
| `20261009095000_plan_builder` on an old database | It converts `Subscription.plan` to text and drops `PlanLimitOverride` | `docs/PLANS.md` | Take a backup before it runs |
| Old code broken after Roll back | Rollbacks never undo migrations; a renamed or dropped column breaks the older code | `docs/UPDATES.md`, "Rollback" | Install the newer version again, or write a reverse migration |
| "Unknown field …" errors in dev after a pull | The Prisma client is older than the schema | | `npx prisma generate --config prisma7.config.ts`, restart dev |
| Saved logins or keys stop working after a move; Admin → Errors says a saved key "could not be decrypted" | `ENCRYPTION_KEY` differs from the one that encrypted them | Admin → Errors (sources `admin.service-keys`, `billing.paddle.config`) | Put the original `ENCRYPTION_KEY` back; never change it after go-live |

## How to debug

Start with these four admin pages, in this order:

| Page | What it shows | Use it for |
|---|---|---|
| **Admin → Errors** (`/admin/errors`) | The `ErrorLog` table: every unexpected error written by `logError` (`lib/errors.ts`), with its `source` (for example `ai.budget`, `billing.duplicate`, `google-calendar.freebusy`, `team.action`), time, company and a stack trace. Secrets are redacted. The sidebar badge counts the last 24 hours. | "Something went wrong" messages, failed jobs, outside services refusing calls |
| **Admin → Health** (`/admin/health`) | Each scheduled job's last run from `CronRun` (written by `recordCron`, `lib/admin/cron-run.ts`) and whether it is late (`CRON_JOBS` in `lib/admin/cron.ts`), queues, errors, database and storage size (`getSystemHealth`, `lib/admin/health.ts`) | Posts not going out, reminders not sent, trials not ending, storage filling up |
| **Admin → Services** (`/admin/services`) | One card per outside service: which keys are set (from Services or the host, never the value), on/off switch, usage counts, **Test now** (a free check, `runProbe` in `lib/admin/service-tests.ts`), Add key / Replace / Remove | "Temporarily unavailable", "Coming soon", a provider refusing calls |
| **Admin → Audit log** (`/admin/audit`) | Every admin change (`AuditLog`, written by `writeAudit`): who, what, before and after | "Who switched this off?", "When did this setting change?" |

Then the server logs, per host:

| Where it runs | Logs |
|---|---|
| Your computer | The terminal running `npm run dev` |
| Netlify | Netlify → Logs & metrics → Functions: `___netlify-server-handler` (pages and API), `cron-publish` and the other `cron-*` functions, `cron-runner-background` (`[cron] /api/cron/…` lines). Deploys: GitHub Actions |
| Cloudflare | Cloudflare dashboard → Workers → `bupulse` → Logs (observability is on in `wrangler.jsonc`), or live with `npx wrangler tail`. `[cron] …` lines for each job |
| GitHub Actions | Each workflow run's log (deploys, fallback crons, the video robot: counts only, the repository is public) |
| Supabase | Supabase dashboard → Logs (Auth for sign-in emails, Postgres for database errors) |
| Paddle | Paddle → Developer tools → Notifications → the destination's delivery log |

Quick checks from anywhere:

```bash
curl -s https://bupulse.com/api/status                     # {"status":"ok"} and the version
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://bupulse.com/api/cron/publish   # run a job by hand
```
